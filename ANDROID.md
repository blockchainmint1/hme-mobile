# Android setup (Play Store)

The sandbox can't run `cap add android` (no Android SDK), so run this on your
Mac / Linux box after pulling the latest `main`:

```bash
bun install
bun run build
bunx cap add android          # one-time; creates ./android
bunx cap sync android
bunx cap open android         # opens Android Studio
```

## Required `android/app/src/main/AndroidManifest.xml` additions

Capacitor generates a working manifest, but the plugins we use need these
edits inside `<manifest>` / the main `<activity>`:

```xml
<!-- Camera (barcode scanner) -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />

<!-- Biometrics -->
<uses-permission android:name="android.permission.USE_BIOMETRIC" />

<!-- Network reachability -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Nectar tap-to-pay deep links: nectar://... and https://pay.honest.money/... -->
<activity ...>
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="nectar" />
  </intent-filter>
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="pay.honest.money" />
  </intent-filter>
</activity>
```

## Signing / release

- App ID: `money.honest.txcwallet` (must match iOS bundle to share the same
  Nectar universal link config on the backend).
- Generate an upload keystore: `keytool -genkey -v -keystore hme.jks -alias hme -keyalg RSA -keysize 2048 -validity 10000`.
- Store `HME_KEYSTORE_PASSWORD` / `HME_KEY_ALIAS` in `~/.gradle/gradle.properties` (never commit).
- Build the AAB: `./gradlew bundleRelease`. Output at
  `android/app/build/outputs/bundle/release/app-release.aab`.

## Splash / icon

`bun run cap:assets` regenerates both iOS and Android assets from
`resources/icon.png` + `resources/splash.png`. Re-run whenever those change.

## Play Console listing

Reuse the App Store screenshots under `/mnt/documents/app-store-screenshots/`
resized to Play's phone requirement (1080 x 1920 or larger, 16:9).
