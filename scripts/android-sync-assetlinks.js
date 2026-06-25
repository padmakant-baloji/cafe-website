#!/usr/bin/env node
/**
 * Reads SHA-256 from android-twa/android-release.keystore and updates
 * .well-known/assetlinks.json for Trusted Web Activity verification.
 *
 * Usage:
 *   KEYSTORE_PASSWORD=secret node scripts/android-sync-assetlinks.js
 *   node scripts/android-sync-assetlinks.js --fingerprint AA:BB:...
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEYSTORE = path.join(ROOT, 'android-twa', 'android-release.keystore');
const ALIAS = 'quickkartcafe';
const PACKAGE_ID = 'com.quickkartcafe.app';
const ASSETLINKS = path.join(ROOT, '.well-known', 'assetlinks.json');
const JAVA_ENV_SH = path.join(__dirname, 'android-java-env.sh');

function resolveKeytool() {
  if (process.env.JAVA_HOME) {
    const fromEnv = path.join(process.env.JAVA_HOME, 'bin', 'keytool');
    if (fs.existsSync(fromEnv)) return fromEnv;
  }
  try {
    return execSync(
      `source "${JAVA_ENV_SH}" && printf '%s' "$JAVA_HOME/bin/keytool"`,
      { encoding: 'utf8', shell: '/bin/bash' }
    ).trim();
  } catch {
    return 'keytool';
  }
}

function parseFingerprintArg() {
  const i = process.argv.indexOf('--fingerprint');
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

function fingerprintFromKeystore() {
  if (!fs.existsSync(KEYSTORE)) {
    console.error(`Keystore not found: ${KEYSTORE}`);
    console.error('Run: yarn android:keygen');
    process.exit(1);
  }

  const password = process.env.KEYSTORE_PASSWORD;
  if (!password) {
    console.error('Set KEYSTORE_PASSWORD to read the keystore, or pass --fingerprint.');
    console.error('Example: KEYSTORE_PASSWORD=yourpass yarn android:sync-assetlinks');
    process.exit(1);
  }

  const keytool = resolveKeytool();
  const out = execSync(
    `"${keytool}" -list -v -keystore "${KEYSTORE}" -alias "${ALIAS}" -storepass "${password}"`,
    { encoding: 'utf8' }
  );

  const match = out.match(/SHA256:\s*([0-9A-F:]+)/i);
  if (!match) {
    console.error('Could not parse SHA256 from keytool output.');
    process.exit(1);
  }
  return match[1].toUpperCase();
}

function writeAssetLinks(fingerprint) {
  const payload = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_ID,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ];

  fs.mkdirSync(path.dirname(ASSETLINKS), { recursive: true });
  fs.writeFileSync(ASSETLINKS, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Updated ${ASSETLINKS}`);
  console.log(`Fingerprint: ${fingerprint}`);
  console.log('');
  console.log('Deploy the site, then verify:');
  console.log('  https://www.quickkartcafe.com/.well-known/assetlinks.json');
  console.log('');
  console.log('Play Store: if you use Google Play App Signing, also add the');
  console.log('App signing certificate SHA-256 from Play Console → Setup → App signing.');
}

const fp = parseFingerprintArg() || fingerprintFromKeystore();
writeAssetLinks(fp);
