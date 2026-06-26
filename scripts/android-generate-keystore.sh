#!/usr/bin/env bash
# Creates the release keystore for signing the Play Store APK/AAB.
# Run once: yarn android:keygen
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=android-java-env.sh
source "${SCRIPT_DIR}/android-java-env.sh"

ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEYSTORE="$ROOT/android-twa/android-release.keystore"
ALIAS="balojicafe"
KEYTOOL="${JAVA_HOME}/bin/keytool"

if [[ -f "$KEYSTORE" ]]; then
  echo "Keystore already exists: $KEYSTORE"
  echo "Delete it first if you need a new key."
  exit 1
fi

echo "Using Java: $JAVA_HOME"
echo "Creating release keystore for Baloji Cafe Android app..."
echo "SAVE THE PASSWORDS — you need them for every release build."
echo ""

KEYTOOL_ARGS=(
  -genkeypair
  -keystore "$KEYSTORE"
  -alias "$ALIAS"
  -keyalg RSA
  -keysize 2048
  -validity 10000
  -dname "CN=Baloji Cafe, OU=Mobile, O=Baloji Cafe, L=Kudachi, ST=Karnataka, C=IN"
)

if [[ -n "${KEYSTORE_PASSWORD:-}" ]]; then
  KEYTOOL_ARGS+=(-storepass "$KEYSTORE_PASSWORD" -keypass "${KEY_PASSWORD:-$KEYSTORE_PASSWORD}")
  echo "Using KEYSTORE_PASSWORD from environment (non-interactive)."
  "$KEYTOOL" "${KEYTOOL_ARGS[@]}"
else
  echo "You will be prompted for a keystore password (enter twice)."
  "$KEYTOOL" "${KEYTOOL_ARGS[@]}"
fi

echo ""
echo "Keystore created: $KEYSTORE"
echo "Next: KEYSTORE_PASSWORD=yourpass yarn android:sync-assetlinks"
