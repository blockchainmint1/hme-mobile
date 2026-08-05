# TXC Electrum outage — what broke and the forward path

## What broke

The legacy TXC Wallet (BlueWallet fork) does **not** speak REST. It only speaks the
**Electrum protocol** (JSON-RPC over a raw TLS socket) against three peers:

```
electrum1.texitcoin.org:443 (ssl)
electrum2.texitcoin.org:443 (ssl)
electrum3.texitcoin.org:443 (ssl)
```

BlueWallet also stores a user-selected peer in AsyncStorage (`electrum_host` /
`electrum_port`); the "Reset to default" button in the error dialog clears it and falls
back to the list above.

Measured 2026-08-05:

| Host | IP | EC2 instance | Status |
|---|---|---|---|
| electrum1.texitcoin.org | 13.220.116.160 | TXC ElectrumX [1] `i-07b536febd8b8fd84` | Running, **all ports dark** |
| electrum2.texitcoin.org | 54.86.19.193 | TXC ElectrumX [2] `i-025df3921ac7c391c` | Running, **all ports dark** |
| electrum3.texitcoin.org | 3.236.158.80 | TXC ElectrumX [3] `i-0dea407c4eb600c0b` | Running, **all ports dark** |
| mempool.texitcoin.org | 185.158.133.1 (non-AWS) | — | 200 OK, full Esplora API |
| explorer.texitcoin.org | 185.158.133.1 | — | 200 OK |
| price.texitcoin.org | 185.158.133.1 | — | 200 OK (`$0.1908`, coinmarketcap) |

**The instances were never shut down.** All three are Running with 3/3 status checks, and
`electrumx-txc-sg` allows 443 / 50001 / 50002 / 50004 from `0.0.0.0/0`. Nothing answers on
any of them, so the **ElectrumX daemon itself is not listening** — either the process died
or its `txcd` backend did. SSH (22) is restricted to `ssh-vpn-sg`
(source `sg-0902312d7cc8ccd52`), so if that VPN host was part of the AWS cleanup, there is
no way in to inspect them.

Either way the old app is dead for balances, history and broadcast, while the new HME
wallet (Esplora/mempool REST) is unaffected.

## Forward path — retire all three EC2 boxes

The legacy client does not care *what* answers on those hostnames, only that something
speaks Electrum over TLS with a valid cert for the name it dialled. So one electrs on the
mempool host can replace all three ElectrumX instances.

The mempool.texitcoin.org stack already runs **electrs** (mempool's backend requires it),
bound to localhost — 50001 is not reachable from outside. The fix is exposure + DNS, not
new infrastructure:

1. **Expose electrs over TLS** on the mempool host with an nginx `stream` block on :443
   of a dedicated IP/interface (or :50002 plus a :443 alias).
2. **Verify electrs is fully indexed first.** The boxes are already dark, so there is no
   worse-than-now state — but pointing users at a half-synced server turns "network error"
   into "wrong balance", which is far more alarming.
3. **Repoint DNS** for `electrum1`, `electrum2` **and** `electrum3` to 185.158.133.1. All
   three names on one host is fine: the client treats them as independent peers. Old
   installs pick this up on next launch with zero user action.
4. **Terminate** `i-07b536febd8b8fd84`, `i-025df3921ac7c391c`, `i-0dea407c4eb600c0b` and
   release any associated elastic IPs. Three m5.large ≈ $210/month recovered.

### Manual override for impatient users

Until DNS propagates, any user can unblock themselves in the legacy app:
Settings → Network → Electrum server → enter the working host/port → Save.


### nginx stream terminator

```nginx
# /etc/nginx/modules-enabled/electrum.conf  (nginx -V must show --with-stream --with-stream_ssl_module)
stream {
  upstream electrs {
    server 127.0.0.1:50001;
  }

  server {
    listen 443 ssl;                 # legacy app expects 443
    listen 50002 ssl;               # standard Electrum SSL port
    proxy_pass electrs;

    ssl_certificate     /etc/letsencrypt/live/electrum1.texitcoin.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/electrum1.texitcoin.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    proxy_timeout 10m;              # Electrum subscriptions are long-lived
    proxy_connect_timeout 5s;
  }
}
```

Issue one cert with SANs covering all three names — every name the app may dial must
present a valid cert, or the TLS handshake fails before any JSON-RPC happens:

```bash
certbot certonly --nginx \
  -d electrum1.texitcoin.org \
  -d electrum2.texitcoin.org \
  -d electrum3.texitcoin.org
```

If :443 on that host is already taken by the mempool web vhost, give electrs its own IP
(secondary address on the interface) or an `haproxy` frontend doing ALPN/SNI routing —
BlueWallet does send SNI, so SNI-based split works:

```
frontend tls443
  bind :443
  mode tcp
  tcp-request inspect-delay 5s
  tcp-request content accept if { req_ssl_hello_type 1 }
  use_backend electrs if { req_ssl_sni -i electrum1.texitcoin.org }
  use_backend electrs if { req_ssl_sni -i electrum2.texitcoin.org }
  use_backend electrs if { req_ssl_sni -i electrum3.texitcoin.org }
  default_backend mempool_web
```

### Verify

Check every name before terminating anything:

```bash
for h in electrum1 electrum2 electrum3; do
  echo "== $h"
  echo '{"id":1,"method":"server.version","params":["probe","1.4"]}' \
    | openssl s_client -quiet -connect $h.texitcoin.org:443 -servername $h.texitcoin.org
done
# expect: {"jsonrpc":"2.0","result":["electrs/...","1.4"],"id":1}
```

Also confirm the index is current, so users don't see stale balances:

```bash
echo '{"id":1,"method":"blockchain.headers.subscribe","params":[]}' \
  | openssl s_client -quiet -connect electrum1.texitcoin.org:443
# the returned height must match https://mempool.texitcoin.org/api/blocks/tip/height
```


Then confirm from the legacy app: balance loads, history loads, and a 1-TXC send
broadcasts.

## Fallback if electrs is not actually running there

If the mempool deployment uses esplora-electrs in REST-only mode, run a standalone
electrs against the same `txcd` node:

```bash
electrs --network bitcoin \
  --daemon-rpc-addr 127.0.0.1:8332 \
  --cookie-file /var/lib/txcd/.cookie \
  --db-dir /var/lib/electrs \
  --electrum-rpc-addr 127.0.0.1:50001
```

Initial index takes a few hours on TXC's chain size; run it before flipping DNS so the
old app never sees a half-indexed server.

## Longer term

Keep the legacy Electrum endpoint alive only as a bridge. Push legacy users to HME Wallet,
which talks to `mempool.texitcoin.org` REST and never needs an Electrum socket, so the
next infra change breaks nothing.
