# Baloji Cafe — Android app (Play Store)

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

## Before you submit (required)

```bash
yarn android:check
```

1. **Asset links** — must not show `REPLACE_WITH_SHA256_FINGERPRINT` on the live site:
   ```bash
   KEYSTORE_PASSWORD=your_password yarn android:sync-assetlinks
   ```
   Deploy, then open https://www.balojicafe.com/.well-known/assetlinks.json

2. **Privacy policy** (live): https://www.balojicafe.com/privacy-policy

3. **Upload file**: `android-twa/app-release-bundle.aab` (not the `.apk`)

## Google Play Console — step by step

1. [Create a developer account](https://play.google.com/console/signup) ($25 one-time fee).
2. **Create app** → App name: `Baloji Cafe` → Default language: English (India) → App / Game: App → Free.
3. **Dashboard** — complete every item under “Set up your app” (required before production):

   | Section | What to enter |
   |--------|----------------|
   | **App access** | All functionality available without special access (or explain login if asked). |
   | **Ads** | No, app does not contain ads. |
   | **Content rating** | Start questionnaire → category “Utility, Productivity, Communication, or Other” / food ordering → answer honestly (no violence, etc.). |
   | **Target audience** | 18+ or 13+ as appropriate; not designed for children. |
   | **News app** | No. |
   | **COVID-19** | No (if shown). |
   | **Data safety** | Collect: name, phone, address, app activity (orders). Purpose: app functionality. Not sold. Encrypted in transit. See privacy policy URL. |
   | **Privacy policy** | `https://www.balojicafe.com/privacy-policy` |
   | **Store listing** | Short & full description (below), app icon 512×512, feature graphic 1024×500, ≥2 phone screenshots. |
   | **Main store listing contact** | Phone +91 9900582650, website https://www.balojicafe.com |

4. **Release** → **Production** → **Create new release** → Upload `app-release-bundle.aab`.
5. **Release name**: `1.0.0` (match `appVersion` in `twa-manifest.json`).
6. **Review and roll out** → Submit for review (first review often takes 1–7 days).

### Store listing text (copy-paste)

**Short description** (max 80 chars):

```
Order veg food from Baloji Cafe, Kudachi. Menu, cart & live order tracking.
```

**Full description**:

```
Order vegetarian food online from Baloji Cafe in Kudachi.

• Browse our full menu — pizza, Chinese, momos, beverages & more
• Add items to cart and place orders for delivery
• Track order status in the app
• Free delivery in Kudachi (see website for hours)

Open 1 PM – 10 PM daily.

Pickup: Opp. Railway Station, Near Bus Stop, Kudachi – 591311.

Questions? Call or WhatsApp us from the website.
```

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
