# Honest Money wallet sign-in (hm-login) — site implementation spec

Any public HTTPS site can let people sign in with an Honest Money / TXC wallet.
No registration with us, no allow-list, no wallet release required. The wallet
accepts any public https host; sites we know are labelled with a friendly name,
everything else shows the bare domain plus an extra confirmation tap.

The signed message follows the shape of EIP-4361 / CAIP-122 ("Sign-In With
Ethereum"), adapted to TXC. The wallet enforces the template exactly — a site
cannot add extra terms to what the user signs.

## 1. Create a challenge (server side)

Per sign-in attempt store: `id` (UUID v4), `nonce` (16–128 chars, random),
`domain` (your public hostname), `issued_at` (ISO 8601), `expires_at` (ISO 8601,
a few minutes out), `status` ("pending"), and the exact `message`.

## 2. The message — six lines, exactly

```
<domain> wants you to sign in with your TXC wallet.

Nonce: <nonce>
Issued At: <issued_at>
By signing, you authorize a sign-in session for <Site Name>.
This signature does not authorize any payment.
```

Line 2 is empty. `<domain>` must equal the `domain` your callback returns.
`<Site Name>` is 1–40 characters from `A–Z a–z 0–9 space . _ -`. Any deviation
is rejected by the wallet.

## 3. The QR payload

JSON envelope (preferred):

```json
{
  "v": 1,
  "type": "hm-login",
  "origin": "example.com",
  "nonce": "<nonce>",
  "callback": "https://example.com/api/public/auth/wallet-callback?id=<uuid>&domain=example.com",
  "expiresAt": 1750000000000,
  "chain": "txc"
}
```

Rules the wallet checks: `callback` is https, a public hostname, default port,
no credentials; `callback` host === `origin`; `callback?id` === the challenge id;
`callback?domain`, if present, === `origin`; `expiresAt` (ms epoch) in the future.

Deep link alternative, for a "open wallet on this phone" button:

```
payhme://login?id=<uuid>&nonce=<nonce>&from=example.com&cb=<urlencoded callback>&msg=<base64url message>
```

## 4. The callback endpoint

Must be public (no auth), CORS-free is fine — the wallet calls it through its own
same-origin proxy — and must respond with JSON under 32 KB.

**GET** `?id=<uuid>` → the pending challenge:

```json
{
  "id": "<uuid>",
  "nonce": "<nonce>",
  "domain": "example.com",
  "issued_at": "2026-09-16T10:00:00.000Z",
  "expires_at": "2026-09-16T10:05:00.000Z",
  "status": "pending",
  "message": "<the exact six-line message>"
}
```

**POST** with the signature:

```json
{ "id": "<uuid>", "address": "T…", "signature": "<base64 compact sig>", "message": "<same message>" }
```

Your server must: load the challenge by `id`, confirm it is pending and unexpired,
confirm `message` byte-identical to the stored message, verify the signature
against `address` (Bitcoin-style compact message signature, BIP-137, TEXITcoin
message prefix), then mark it used and issue your own session. Return `200` with
your own JSON on success, or `4xx` with `{ "error": "…" }`.

Do not follow redirects, do not require cookies, and never reuse a nonce.

## 5. Notes

- The wallet signs with the TXC identity address at `m/44'/696969'/0'/0/0`.
- Sign-in never authorizes a payment; payments use a separate flow.
- To be labelled with a friendly name instead of the bare domain, ask us to add
  your host to the partner list in `src/lib/web-login-hosts.ts` — optional, and
  purely cosmetic.
