#!/usr/bin/env bash
# Quick checks before uploading to Google Play.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AAB="$ROOT/android-twa/app-release-bundle.aab"
KEYSTORE="$ROOT/android-twa/android-release.keystore"
ASSETLINKS="$ROOT/.well-known/assetlinks.json"
ERR=0

ok() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; ERR=1; }

echo "QuickKart's Cafe — Play Store readiness"
echo ""

if [[ -f "$AAB" ]]; then
  ok "Release bundle: android-twa/app-release-bundle.aab"
else
  fail "Missing app-release-bundle.aab — run: yarn android:build"
fi

if [[ -f "$KEYSTORE" ]]; then
  ok "Signing keystore present (not committed to git)"
else
  fail "Missing android-twa/android-release.keystore — run: yarn android:keygen"
fi

if grep -q 'REPLACE_WITH_SHA256_FINGERPRINT' "$ASSETLINKS" 2>/dev/null; then
  fail "assetlinks.json still has placeholder fingerprint"
  echo "      Fix: KEYSTORE_PASSWORD=xxx yarn android:sync-assetlinks"
  echo "      Then deploy to Vercel and verify:"
  echo "      https://www.quickkartcafe.com/.well-known/assetlinks.json"
else
  ok "assetlinks.json has a real fingerprint (local file)"
fi

echo ""
if [[ "$ERR" -eq 0 ]]; then
  echo "Local checks passed. Also verify live URLs before release:"
  echo "  https://www.quickkartcafe.com/privacy-policy"
  echo "  https://www.quickkartcafe.com/.well-known/assetlinks.json"
  echo ""
  echo "Upload to Play Console: android-twa/app-release-bundle.aab"
else
  echo "Fix the items above before submitting to Play Store."
  exit 1
fi
