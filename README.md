# ipa-host

A small OTA install server for ad hoc iOS and Android builds: one listing page
(shadcn on Base UI) plus the public routes the devices need to install.

Builds are plain directories; there is no upload API. Publishers write them
directly into the data dir:

```
<DATA_DIR>/<id>/app.ipa         iOS, or
<DATA_DIR>/<id>/app.apk         Android
<DATA_DIR>/<id>/manifest.json   {"platform"?,"name","bundleId","version","build"?,"notes"?,"uploadedAt"?}
<DATA_DIR>/<id>/icon.png        optional, standard PNG
```

`platform` is `"ios"` or `"android"`; when absent it is `"ios"`, so existing
builds keep working. For APKs `bundleId` is the package name and `build` the
`versionCode`. A directory with neither package file is ignored.

`<id>` is a random 128-bit URL-safe string; write to `.<id>` and rename into
place. The publish scripts do all of that from a Mac:

```
scripts/publish-ipa.sh App.ipa ["notes"]   # metadata and icon read from the IPA
scripts/publish-apk.sh App.apk ["notes"]   # metadata and icon read with aapt2
```

`publish-apk.sh` looks for `aapt2` on `PATH`, then under
`$ANDROID_HOME/build-tools/*/` and `$ANDROID_SDK_ROOT/build-tools/*/`. Without
it, pass the metadata by env: `APK_NAME`, `APK_PACKAGE`, `APK_VERSION`
(required) and `APK_BUILD` (optional); the icon is only extracted with aapt2, or pass `APK_ICON=path.png`,
and only when the launcher icon is a plain PNG. Both scripts share
`scripts/lib/publish-common.sh` for the manifest and the `tar | ssh` upload
(`IPA_HOST`, `IPA_DIR`, `IPA_URL`) and print the install link `<IPA_URL>/i/<id>`.

## Routes

| Route | Access |
| --- | --- |
| `/` listing, `/api/apps`, `DELETE /api/builds/:id` | private (Cloudflare Access) |
| `/i/:id` install page, `/i/:id/icon.png` | public |
| `/i/:id/manifest.plist`, `/i/:id/app.ipa` | public, iOS builds only (404 for Android) |
| `/i/:id/app.apk` | public, Android builds only (404 for iOS) |

`/i/:id` shows an Install button: an `itms-services://` link for iOS, a direct
download of `app.apk` (`application/vnd.android.package-archive`, attachment
`<name>-<version>.apk`) for Android. iOS fetches the manifest and IPA without
cookies, and Android downloads the APK through the browser, so Cloudflare
Access must keep `/i/` public.

Android install caveat: the phone only installs a downloaded APK once the
browser is allowed to install unknown apps (Settings → Apps → Special app
access → Install unknown apps, or the prompt shown when opening the download).
The install page says so in one line.

The app has no auth of its own. Expose it only through a proxy that gates
everything except `/i/`, and don't publish its port on the LAN.

## Config

| Env | Default |
| --- | --- |
| `PUBLIC_URL` | `http://localhost:8080` (used in install manifests) |
| `APP_TITLE` | `iOS Apps` (set to e.g. `Apps` when hosting both platforms) |
| `DATA_DIR` | `/data` in the image |
| `PORT` | `8080` |

## Development

```
DATA_DIR=./data bun server/index.ts      # API on :8080
cd web && bun install && bun run dev      # UI on :5173, proxies /api and /i
```

GitHub Actions builds `ghcr.io/<owner>/ipa-host` on every push to `main`.
