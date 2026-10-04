# ipa-host

A small OTA install server for ad hoc iOS builds: one listing page (shadcn on
Base UI) plus the public routes iOS needs to install.

Builds are plain directories; there is no upload API. Publishers write them
directly into the data dir:

```
<DATA_DIR>/<id>/app.ipa
<DATA_DIR>/<id>/manifest.json   {"name","bundleId","version","build"?,"notes"?,"uploadedAt"?}
<DATA_DIR>/<id>/icon.png        optional, standard PNG
```

`<id>` is a random 128-bit URL-safe string; write to `.<id>` and rename into
place. `scripts/publish-ipa.sh App.ipa ["notes"]` does all of that from a Mac
(metadata and icon are read from the IPA).

## Routes

| Route | Access |
| --- | --- |
| `/` listing, `/api/apps`, `DELETE /api/builds/:id` | private (Cloudflare Access) |
| `/i/:id` install page, `/i/:id/manifest.plist`, `/i/:id/app.ipa`, `/i/:id/icon.png` | public (iOS fetches these without cookies) |

The app has no auth of its own. Expose it only through a proxy that gates
everything except `/i/`, and don't publish its port on the LAN.

## Config

| Env | Default |
| --- | --- |
| `PUBLIC_URL` | `http://localhost:8080` (used in install manifests) |
| `APP_TITLE` | `iOS Apps` |
| `DATA_DIR` | `/data` in the image |
| `PORT` | `8080` |

## Development

```
DATA_DIR=./data bun server/index.ts      # API on :8080
cd web && bun install && bun run dev      # UI on :5173, proxies /api and /i
```

GitHub Actions builds `ghcr.io/<owner>/ipa-host` on every push to `main`.
