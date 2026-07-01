# Native app icon + splash sources

These PNGs are the **source images** consumed by [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets)
to generate every iOS and Android icon / splash size.

## Files

- `icon.png` — 1024×1024 app icon (opaque, edge-to-edge, no rounded mask; iOS applies its own mask).
- `splash.png` — 1920×1920 splash source. The generator crops/centers this for every device size, so keep the logo centered with generous padding.
- (optional) `icon-foreground.png`, `icon-background.png` — supply these if you want an Android adaptive icon with a separate foreground layer. Not required.
- (optional) `splash-dark.png` — supply for a dark-mode splash. If omitted, `splash.png` is used for both.

## Generate all sizes

After `bunx cap add ios` / `bunx cap add android` has created the native projects:

```bash
bun run cap:assets    # writes into ios/App/App/Assets.xcassets + android/app/src/main/res
bun run cap:sync      # rebuilds the web bundle and syncs it into both native shells
```

Re-run `cap:assets` any time you change these source PNGs.
