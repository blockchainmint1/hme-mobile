# Open sign-in: any site, no wallet rebuild

## Short answer to your questions

**Is there a standard?** Partly. The *message* people sign is standardized —
"Sign-In With Ethereum" (EIP-4361) and its chain-neutral version (CAIP-122)
define exactly the text our six-line message already imitates: domain, nonce,
issued-at, statement. There is **no** universal standard for the QR envelope
itself; every wallet ships its own (WalletConnect is the closest thing, and
it's heavy, EVM-centric, and needs a relay server). So the sensible move is:
keep our own small envelope, make the signed message SIWE/CAIP-122 shaped, and
publish it as a spec any site can implement.

**Do we have to add sites one by one?** No — and we shouldn't. The current
allow-list is the reason every new site needs a wallet rebuild. A sign-in
signature is domain-bound and authorizes no payment, so the real protection is
(a) the wallet showing the user which domain is asking and (b) the wallet
refusing to sign anything outside the fixed template. Neither needs a list.

**Can we trust `*.honest.money`?** Yes, as a *fast path* — those are our own
domains, so they can be auto-labelled and trusted without an extra warning.
Everything else gets in too, just with a louder confirmation screen.

## What changes

Three trust tiers instead of one list:

1. **Ours** — any `honest.money` subdomain (and the matching `*.lovable.app`
   preview hosts): friendly name, normal approve button.
2. **Known partners** — the current list (NectarPay, streamTXC, Bonfire):
   unchanged, friendly name.
3. **Everyone else** — allowed, but the approve screen leads with the bare
   domain, an "unrecognized site" warning, and a second confirm tap. First
   time a domain is used it's recorded locally, so repeat sign-ins to a site
   you've already approved show a "you've signed in here before" note.

The signed message stays exactly the strict template it is now — a site still
cannot smuggle extra terms into it.

## Technical detail

- `src/lib/web-login-hosts.ts`: replace the `Set`-only check with
  `classifyLoginHost(hostname)` returning `{ tier: "first-party" | "partner" |
  "unknown", name }`. Keep `TRUSTED_LOGIN_HOSTS` exported for the partner tier.
  Wildcard match: exact `honest.money` or `*.honest.money`, plus our own
  `hme-*.lovable.app` previews.
- `src/lib/nectar/auth.ts`: `trustedUrl()` no longer requires list membership;
  it enforces https, no port, no credentials, host === `origin`, and rejects
  IP-literal / `localhost` / non-public hosts. `validateRequest` returns the
  tier so the UI can render the right confirmation.
- `src/routes/api/nectar.link.ts`: this proxy must not become an open relay.
  Same host rules as above, plus: block private/loopback/link-local addresses
  after DNS-free literal checks, allow only `GET`/`POST`, cap the forwarded
  and returned body (e.g. 32 KB), strip cookies and any inbound auth headers,
  fixed timeout, and no redirect following (`redirect: "manual"`).
- `src/lib/security/headers.ts`: unchanged — all partner traffic still goes
  through the same-origin proxy, so `connect-src` stays strict.
- `src/components/wallet/WebsiteSignInCard.tsx`: tiered confirmation UI —
  warning banner + second confirm for unknown domains, "signed in here before"
  hint from a small local record (`src/lib/web-login-history.ts`).
- New `docs/wallet-signin-spec.md`: the envelope, the six-line message
  template, and the callback contract, so any site can implement sign-in
  without us touching the wallet.

## Result

Any site on the public internet can build a sign-in QR that this wallet
accepts, our own `honest.money` properties work with no ceremony, and new
partners never require an app store release again.
