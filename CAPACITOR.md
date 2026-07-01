# HME Wallet — Native (Capacitor) builds

This app ships as a Progressive Web App **and** as a native iOS / Android
binary via [Capacitor](https://capacitorjs.com). The native shell is what
enables real Face ID / Touch ID / Android biometric unlock backed by the
Keychain / Keystore. The same web bundle runs in both.

## One-time setup

```bash
bun install
bunx cap add ios
bunx cap add android
```

This generates `ios/` and `android/` Xcode / Android Studio projects. Commit
them to whichever native repo you ship from.

## Build + sync the web bundle into the native projects

```bash
bun run cap:sync        # = bun run build && bunx cap sync
```

`vite build` writes a TanStack Start SPA shell to `dist/client/index.html`.
That is the file Capacitor needs as its native-webview entry point. The
`capacitor.config.ts` `webDir` points at `dist/client` when that file exists,
with `.output/public` only as a fallback for alternate adapters.

## Generate app icons and splash screens

Source PNGs live in `assets/` (`icon.png` 1024×1024, `splash.png` 1920×1920).
After the native projects exist, generate every required size in one shot:

```bash
bun run cap:assets
```

That runs `@capacitor/assets` which writes into
`ios/App/App/Assets.xcassets` and `android/app/src/main/res`. Re-run it any
time you change the source PNGs.

## Run on a device

```bash
bunx cap open ios       # opens Xcode → Run on device / simulator
bunx cap open android   # opens Android Studio → Run on device / emulator
```

## Live-reload against the Lovable preview

For day-to-day iteration without rebuilding the bundle each time, point
Capacitor at the Lovable preview URL by adding to `capacitor.config.ts`:

```ts
server: {
  url: "https://id-preview--<your-project>.lovable.app",
  cleartext: false,
},
```

Then `bunx cap sync && bunx cap run ios|android`. Remove the `server.url`
block before producing release builds.

## Required native permissions

iOS — add to `ios/App/App/Info.plist`:

```xml
<key>NSFaceIDUsageDescription</key>
<string>Unlock your HME Wallet with Face ID.</string>
<key>NSCameraUsageDescription</key>
<string>Scan wallet addresses and payment QR codes.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Import wallet addresses from QR codes saved to your photos.</string>
<key>UIRequiresFullScreen</key>
<false/>
<key>UIViewControllerBasedStatusBarAppearance</key>
<true/>
```

Android — `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.VIBRATE" />
```

## iOS pre-flight checklist

Before archiving for TestFlight, verify:

- [ ] `bun run cap:assets` was re-run after the latest `assets/icon.png` and `assets/splash.png` (icon set + LaunchScreen storyboard both update).
- [ ] `assets/icon.png` has no transparency and no rounded corners (iOS masks it).
- [ ] In Xcode → Signing & Capabilities, **Associated Domains** contains `applinks:nectar-pay.com` (Nectar universal-link handoff, see below).
- [ ] Info.plist includes all four strings above. Missing `NSFaceIDUsageDescription` = crash-on-first-Face-ID-prompt.
- [ ] Deployment target ≥ iOS 14 (biometric-auth plugin requirement).
- [ ] "Encryption Export Compliance" — wallet uses only standard crypto (AES-GCM, secp256k1). In App Store Connect, answer "Yes, uses encryption" → "No, only exempt encryption (standard iOS APIs and open-source algorithms)". No ERN required.
- [ ] Test in dark mode + light mode (`ThemeProvider` respects system preference).
- [ ] Test with iPhone SE (small screen) and iPhone 15 Pro Max (large + Dynamic Island safe area).
- [ ] Kill-and-relaunch after enabling biometric unlock — Face ID prompt should appear on cold-start.

## iOS-only niceties baked into the web layer

These already work without any Xcode changes — they light up automatically inside the Capacitor shell:

- **Haptics** on successful/failed sends (`@capacitor/haptics`).
- **Native share sheet** on the Receive screen (`@capacitor/share`).
- **Status bar overlay** with matching background — configured on mount in `src/lib/native/ui.ts` via `initNativeChrome()`.
- **Keyboard resize** in native mode so form fields aren't hidden.
- **Safe-area padding** top and bottom in the root layout (`env(safe-area-inset-*)`).

## Store identity

- App ID: `money.honest.txcwallet`
- Display name: `HME Wallet`
- Icon source: `assets/icon.png` (1024×1024)
- Splash source: `assets/splash.png` (1920×1920)

## Migration from the old TXC Wallet

The new binary publishes under a **different bundle ID** than the legacy
BlueWallet fork, so installing it from the store cannot overwrite the
existing app. Users keep the old wallet installed, back up their seed
phrase from it, and use the new app's "Import seed phrase" flow to bring
funds across.

## Nectar.Pay tap-to-pay (NFC deep links)

The wallet receives Nectar terminal taps via two URL shapes:

```
nectar://pay?inv=<invoice_id>&t=<nonce>          # custom scheme (Android primary)
https://nectar-pay.com/pay/<invoice_id>?t=<nonce> # universal/app link (iOS primary)
```

Both land on the in-app route `/pay/$invoiceId?t=<nonce>`. The runtime
wiring lives in `src/lib/native/deeplink.ts` and is registered from the
root component.

### iOS — Associated Domains

1. In Xcode → Signing & Capabilities, add **Associated Domains**.
2. Add entry: `applinks:nectar-pay.com`
3. Nectar.Pay hosts `https://nectar-pay.com/.well-known/apple-app-site-association`
   referencing the wallet's team ID + bundle ID (`money.honest.txcwallet`).
   Send them both values when you cut the build.

The custom `nectar://` scheme is **not** required on iOS — universal
links handle the tap. If you want it as a fallback, add to `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>nectar</string></array>
  </dict>
</array>
```

### Android — intent filters

In `android/app/src/main/AndroidManifest.xml`, inside the main
`<activity>` block, add:

```xml
<!-- Custom scheme: nectar://pay?inv=...&t=... -->
<intent-filter android:autoVerify="false">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="nectar" android:host="pay" />
</intent-filter>

<!-- App Link: https://nectar-pay.com/pay/<id> -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="nectar-pay.com"
          android:pathPrefix="/pay/" />
</intent-filter>
```

Nectar.Pay must host `https://nectar-pay.com/.well-known/assetlinks.json`
listing the wallet's package (`money.honest.txcwallet`) and SHA-256
signing fingerprint for the autoVerify=true link to work.

### Currently supported payment chains

- USDC on Base, BSC, Ethereum
- Native ETH on Ethereum, ETH on Base, BNB on BSC

BTC, SOL, TRON, and native TXC tap-to-pay are not handled in this build
— if a merchant accepts only those, the wallet shows "not enough funds"
and the user can fall back to the hosted checkout in their browser.
