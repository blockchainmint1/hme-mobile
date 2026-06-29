# TEXITcoin Wallet — Native (Capacitor) builds

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
bun run build
bunx cap sync
```

`vite build` writes to `dist/client`, which `capacitor.config.ts` points at
via `webDir`.

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
<string>Unlock your TEXITcoin wallet with Face ID.</string>
<key>NSCameraUsageDescription</key>
<string>Scan TEXITcoin addresses and payment QR codes.</string>
```

Android — `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
```

## Store identity

- App ID: `money.honest.txcwallet`
- Display name: `TEXITcoin Wallet`
- Icon source: `src/assets/txc-icon-512.png`

## Migration from the old TXC Wallet

The new binary publishes under a **different bundle ID** than the legacy
BlueWallet fork, so installing it from the store cannot overwrite the
existing app. Users keep the old wallet installed, back up their seed
phrase from it, and use the new app's "Import seed phrase" flow to bring
funds across.
