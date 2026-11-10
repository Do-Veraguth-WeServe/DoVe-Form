# Form Android

Form uses a signed Trusted Web Activity (TWA), package `ch.doveit.form`, canonical origin `https://form.dove-it.net`. It shares the existing web application and browser-managed login; it is not an offline native rewrite. Android 7.0+ (minSdk 24), current Chrome or another TWA-capable browser and internet access are required. Custom Tabs are the safe fallback. No provider credentials are embedded in the APK.

## Rebuild

- Bubblewrap CLI pinned to `1.27.0`; JDK 17. Android SDK root `/opt/android-build`; Bubblewrap config `/root/.bubblewrap/config.json` contains `jdkPath` and `androidSdkPath`.
- SDK includes build-tools `36.1.0`; generated Gradle project compiles/targets SDK 36 and uses Gradle 8.11.1 / Android Gradle Plugin 8.9.1. Gradle may install additional SDK components after license acceptance.
- Source configuration: `android/twa-manifest.json`. Generated workspace: `/opt/android-build/twa`.
- Bubblewrap legacy SDK path validation needs `bin/` or `tools/` at the configured root. The modern SDK command remains `cmdline-tools/latest/bin/sdkmanager`.
- Use an interactive PTY for `npx -y @bubblewrap/cli@1.27.0 build --skipVersionUpgrade`; do not pipe passwords into setup/regeneration prompts. On first generation confirm regeneration and provide the version name. Subsequent builds require two masked signing-password prompts.
- Keystore and password remain outside Git in `/opt/android-build/keystore`, restricted permissions. Preserve BOTH securely for future updates. Never regenerate the key for a normal update. Increment versionCode when releasing an update.
- Verify with SDK `apksigner verify --verbose --print-certs` and `aapt dump badging`. Compare signer SHA-256 with `assets/assetlinks.json`, rebuild assets and deploy that file to `/.well-known/assetlinks.json`. The DAL field is `sha256_cert_fingerprints` (colon-separated hex), not `sha256_cert_base64`.

## Installation and acceptance

Download the signed APK, open it on Android, permit installation from the chosen file/browser app only as needed, and install Form. Revoke that installation permission afterwards. Open Form, log in with the existing account, test keyboard, back navigation, sharing, Elements and rotation. A website or desktop browser test is not an Android device test. If the browser bar remains visible, investigate Digital Asset Links/caching/browser support rather than disabling verification.

Play Store publication is separate and requires an owner-controlled developer account, listing and review. With Play App Signing, publish the Play signing certificate fingerprint too (not only the upload key).
