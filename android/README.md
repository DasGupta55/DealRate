# DealRate — Android App (WebView Wrapper)

A thin, installable Android wrapper around the live DealRate website.
It is **not** a separate app: there is no duplicated page, database,
backend, or business logic. The APK opens the live website
(`https://dealrate2.netlify.app`) inside a full-screen WebView, so it
uses the same auth, APIs, subscriptions, payments, and data as the
website.

## Why WebView (not TWA)

The brief preferred a Trusted Web Activity, but TWA needs Digital
Asset Links verification against the domain, and a failed check falls
back to a Chrome Custom Tab — which shows a browser address bar, the
one thing the brief forbids. A WebView wrapper loads the same live
site with no domain verification and no browser UI, so it is the
reliable choice here. Nothing about the website changes for it.

## Live website updates

The APK does **not** bundle a copy of the website. Every launch loads
the live URL, and the site's `index.html` is served with
`Cache-Control: public,max-age=0,must-revalidate` while the JS/CSS
bundles are content-hashed. So when you publish a website update, the
installed app shows it on the next launch — no APK rebuild, no
reinstall. Only changes to the wrapper itself (icon, package ID,
permissions) need a new APK.

## What the wrapper does

- Loads `https://dealrate2.netlify.app` full-screen, no address bar.
- Keeps DealRate links inside the app; opens external links
  (Razorpay, WhatsApp, mail, other sites) in the browser/app.
- Login sessions persist via WebView cookies (same as the website).
- Android back button walks the in-app history before exiting.
- File uploads open the system file chooser; downloads go through
  Android's DownloadManager into the Downloads folder.
- Shows a "You're offline — Retry" screen when the site can't be
  reached.
- Dark splash/background matching the site (#0A0A0F, lime #C8FF3D).

## Project layout

```
android/
  settings.gradle            root project (DealRate)
  build.gradle               Android Gradle Plugin 8.2.2
  gradle.properties          JVM + AndroidX flags
  local.properties           sdk.dir (local only, never committed)
  keystore.properties        release signing (local only, NEVER committed)
  dealrate-release.keystore  release signing key (local only, NEVER committed)
  app/
    build.gradle             applicationId com.dealrate.app, SDK 34
    src/main/
      AndroidManifest.xml    INTERNET, camera/media for uploads
      java/com/dealrate/app/MainActivity.java
      res/layout/activity_main.xml
      res/values/ (strings, colors, themes)
      res/mipmap-*/ic_launcher.png
```

Package ID: `com.dealrate.app` — **never change it** after release.
Every future update must use the same package ID **and** the same
release keystore, or Android will refuse to install it as an update.

## Build a new release APK

Prerequisites: JDK 17, Android SDK (platform 34 + build-tools 34.0.0),
Gradle 8.5. On this machine the SDK lives at `~/Android` and Gradle
at `~/gradle-8.5`; `local.properties` already points at the SDK.

```bash
cd android
# The Gradle daemon needs IPv4 on this VM (IPv6 localhost is blocked):
export JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"
export GRADLE_OPTS="-Djava.net.preferIPv4Stack=true"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=~/Android
~/gradle-8.5/bin/gradle assembleRelease --no-daemon
# Output: app/build/outputs/apk/release/app-release.apk
```

Bump `versionCode` (integer, +1 each release) and `versionName` in
`app/build.gradle` before building an update.

## Signing

The release keystore is `dealrate-release.keystore` (PKCS12, RSA 2048,
25-year validity, alias `dealrate`). Its passwords live in
`keystore.properties` (gitignored) and in the credentials file handed
to the owner. **Back the keystore up in two safe places.** If it is
lost, the app can never be updated under the same package ID.

Verify a built APK is signed:

```bash
~/Android/build-tools/34.0.0/apksigner verify --verbose \
  app/build/outputs/apk/release/app-release.apk
```

## Install & test

1. Copy the APK to the phone and tap it (allow "Install unknown apps"
   for the file manager/browser once).
2. Open DealRate — it should load the live site with no address bar.
3. Sign in, open Brands/Deals/Invoices/Plan, and confirm they work.
4. Publish a small website change, reopen the app, and confirm the
   change appears without reinstalling.

## Limits

- No Play Store release is configured (sideload only, as requested).
- The APK was built and signature-verified on this machine; the
  on-device install/launch/login check needs a real phone.
- Push notifications are not part of this wrapper; the site's
  in-app notifications bell works as on the web.
