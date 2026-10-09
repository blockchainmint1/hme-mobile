# Ecosystem trusted-site registry (wallet side)

The wallet labels sign-in and xpub-link requests from sites listed by the
Honest.Money Ecosystem project (Admin → SSO sites, table `sso_sites`).
A site on the list shows its friendly name and a "Verified honest.money
ecosystem site" note; anything else still works but shows a warning.

The list never grants extra powers: the strict sign-in message template and
the hardened-branch-only xpub rule apply to every site. It only sets labels.

## Feed the ecosystem must publish

`GET https://honest.money/api/public/v1/trusted-sites`

```json
{ "v": 1, "sites": [ { "host": "filefingerprint.com", "label": "File Fingerprint", "active": true } ] }
```

Headers:
- `x-hme-timestamp` — unix seconds when signed
- `x-hme-signature` — hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the shared `HME_ECOSYSTEM` secret

The wallet rejects unsigned, mis-signed, or >24h-old lists and falls back to its
last good copy plus the built-in list in `src/lib/web-login-hosts.ts`.
