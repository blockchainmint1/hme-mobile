# Ecosystem trusted-site registry (wallet side)

The wallet labels sign-in and xpub-link requests from sites listed by the
Honest.Money Ecosystem project (Admin → SSO sites, table `sso_sites`).
A site on the list shows its friendly name and a "Verified honest.money
ecosystem site" note; anything else still works but shows a warning.

The strict sign-in message template and hardened-branch-only xpub rule apply
to every site. Spending delegation additionally requires exact membership in
a freshly server-verified registry; offline labels and name patterns never authorize it.

## Feed the ecosystem must publish

`GET https://honest.money/api/public/v1/trusted-sites`

```json
{ "v": 1, "sites": [ { "host": "filefingerprint.com", "label": "File Fingerprint", "active": true } ] }
```

Request headers (current Honest Money API):
- `Authorization: Bearer <dedicated site API key>`
- `X-HME-Site: <stable site code>`
- Site permission: `trusted-sites:read`.
- Configure `HME_SITE_API_KEY` and `HME_SITE_CODE` in the wallet secret store;
  do not reuse the cross-partner `HME_ECOSYSTEM` bearer key.

Response headers:
- `x-hme-timestamp` — unix seconds when signed
- `x-hme-signature` — hex HMAC-SHA256 of `${timestamp}.${rawBody}` with that site's dedicated API key

The wallet rejects malformed/unsigned/mis-signed or >5-minute-old responses. Server
cache lasts five minutes. Spending approval refreshes the registry and fails
closed on unavailability/removal. Empty valid lists clear trust. Cached labels
may still display offline, but cannot grant spending access.

Asymmetric registry verification remains a coordinated partner change: no
public-key registry endpoint exists in the current Honest Money source.
