# TXC Electrum outage — what broke and the forward path

## What broke

The legacy TXC Wallet (BlueWallet fork) does **not** speak REST. It only speaks the
**Electrum protocol** (JSON-RPC over a raw TLS socket) and ships a hardcoded server list:

```
electrum1.texitcoin.org:443 (ssl)
electrum2.texitcoin.org:443 (ssl)
```

Measured 2026-08-05:

| Host | IP | Status |
|---|---|---|
| electrum1.texitcoin.org | 13.220.116.160 (AWS us-east-1) | **443 connection refused** |
| electrum2.texitcoin.org | 54.86.19.193 (AWS us-east-1) | **443 connection refused** |
| mempool.texitcoin.org | 185.158.133.1 (non-AWS) | 200 OK, full Esplora API |
| explorer.texitcoin.org | 185.158.133.1 | 200 OK |
| price.texitcoin.org | 185.158.133.1 | 200 OK (`$0.1908`, coinmarketcap) |

Both Electrum endpoints were the EC2 boxes that were shut down. Everything else lives on
185.158.133.1 and is healthy. So: the old app is 100% dead in the water for balances,
history and broadcast, while the new HME wallet (which uses the Esplora/mempool REST API)
is unaffected.

The dead boxes are the *only* thing the old app can talk to — no app update can fix it,
because the store binaries are frozen with that server list.

## Forward path (no AWS, no app update)

The mempool.texitcoin.org stack already runs **electrs** (mempool's backend requires it),
bound to localhost — port 50001 is not publicly reachable from outside. So the fix is
exposure + DNS, not new infrastructure:

1. **Expose electrs over TLS** on the mempool host with an nginx `stream` block on :443
   of a dedicated IP/interface (or :50002 plus a :443 alias).
2. **Repoint DNS** `electrum1` and `electrum2` A records from the dead EC2 IPs to
   185.158.133.1. Old installs pick this up on next launch with zero user action.
3. Kill the EC2 instances for good and release the elastic IPs.

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

Issue the cert with a SAN covering both names:

```bash
certbot certonly --nginx -d electrum1.texitcoin.org -d electrum2.texitcoin.org
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
  default_backend mempool_web
```

### Verify

```bash
echo '{"id":1,"method":"server.version","params":["probe","1.4"]}' \
  | openssl s_client -quiet -connect electrum1.texitcoin.org:443
# expect: {"jsonrpc":"2.0","result":["electrs/...","1.4"],"id":1}
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
