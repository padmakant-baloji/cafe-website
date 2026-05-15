# Baloji's Cafe — Android app (Play Store)

This folder builds a **Trusted Web Activity (TWA)** app that opens **https://www.balojicafe.com** in full screen (no browser bar). The website stays on your server; the APK is a thin Android wrapper.

## Prerequisites

1. **JDK 17+** — install [Android Studio](https://developer.android.com/studio), **or** run `cd android-twa && npx bubblewrap update` once and accept JDK install (saved to `~/.bubblewrap/jdk`).
2. **Node.js 18+** — already used for this project.

Project scripts auto-detect Java from Android Studio, `java_home`, or Bubblewrap’s JDK.

On first `bubblewrap` run, accept installing Android SDK build tools when prompted.

## One-time setup

```bash
# 1. Create signing keystore (save passwords!)
yarn android:keygen

# 2. Publish Digital Asset Links (needs keystore password)
KEYSTORE_PASSWORD=your_password yarn android:sync-assetlinks

# 3. Deploy website so assetlinks.json is live
git add .well-known/assetlinks.json
git commit -m "Add Android asset links for TWA"
# push / deploy to Vercel

# 4. Generate Android project from twa-manifest.json
yarn android:update
```

## Build release APK and AAB (Play Store)

```bash
export BUBBLEWRAP_KEYSTORE_PASSWORD='your_keystore_password'
export BUBBLEWRAP_KEY_PASSWORD='your_key_password'

yarn android:build
```

Outputs (in `android-twa/`):

| File | Use |
|------|-----|
| `app-release-signed.apk` | Test on a phone |
| `app-release-bundle.aab` | **Upload to Google Play Console** |

Install on a connected device:

```bash
yarn android:install
```

## Google Play Console

1. Create a [Google Play Developer](https://play.google.com/console) account ($25 one-time).
2. **Create app** → name: Baloji's Cafe.
3. **Release** → Production → Create new release → upload `app-release-bundle.aab`.
4. Complete **Store listing** (description, screenshots, icon 512×512, feature graphic).
5. **Privacy policy** URL (required) — host a page on your site.
6. **Content rating** questionnaire.
7. **Target audience** and **Data safety** forms.

### App signing (important)

If you enable **Google Play App Signing** (recommended):

1. After first upload, open **Setup → App signing**.
2. Copy the **App signing key certificate** SHA-256 fingerprint.
3. Add it to asset links:

```bash
yarn android:sync-assetlinks --fingerprint "AA:BB:CC:..."
```

4. Redeploy `.well-known/assetlinks.json` to production.

Without the correct fingerprint, the app opens your site in a browser tab with a URL bar instead of full-screen TWA.

## Verify asset links

- https://www.balojicafe.com/.well-known/assetlinks.json  
- [Statement Tester](https://developers.google.com/digital-asset-links/tools/generator)

## Version updates

Edit `twa-manifest.json`:

- `appVersionName` — e.g. `"1.0.1"` (shown to users)
- `appVersionCode` — integer, must increase each Play upload (e.g. `2`)

Then:

```bash
yarn android:update
yarn android:build
```

Upload the new `.aab` to Play Console.

## Package name

`com.balojicafe.app` — cannot be changed after publishing without a new Play listing.
