// ipa-host: lists ad hoc iOS builds and serves what iOS needs to install them.
//
// Builds are plain directories under DATA_DIR, written directly by the
// publisher (no upload API):
//
//   <DATA_DIR>/<id>/app.ipa
//   <DATA_DIR>/<id>/manifest.json   {name, bundleId, version, build, notes?, uploadedAt?}
//   <DATA_DIR>/<id>/icon.png        optional
//
// Publishers write to a dot-prefixed temp dir and rename it into place, so a
// half-written build is never listed. <id> must be long and random: everything
// under /i/<id>/ is public (iOS fetches the manifest and IPA without cookies),
// while the listing and API sit behind Cloudflare Access.

import { readdir, rm, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data")
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "http://localhost:8080").replace(/\/$/, "")
const TITLE = process.env.APP_TITLE || "iOS Apps"
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(import.meta.dir, "../web/dist"))
const PORT = Number(process.env.PORT ?? 8080)

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/

type Manifest = {
  name: string
  bundleId: string
  version: string
  build?: string
  notes?: string
  uploadedAt?: string
}

export type Build = Manifest & {
  id: string
  size: number
  uploadedAt: string
  hasIcon: boolean
}

async function readBuild(id: string): Promise<Build | null> {
  if (!ID_RE.test(id)) return null
  const dir = join(DATA_DIR, id)
  try {
    const manifest = (await Bun.file(join(dir, "manifest.json")).json()) as Manifest
    if (!manifest.bundleId || !manifest.name || !manifest.version) return null
    const ipa = await stat(join(dir, "app.ipa"))
    const hasIcon = await Bun.file(join(dir, "icon.png")).exists()
    return {
      ...manifest,
      id,
      size: ipa.size,
      uploadedAt: manifest.uploadedAt ?? ipa.mtime.toISOString(),
      hasIcon,
    }
  } catch {
    return null
  }
}

async function listBuilds(): Promise<Build[]> {
  let names: string[] = []
  try {
    names = await readdir(DATA_DIR)
  } catch {
    return []
  }
  const builds = await Promise.all(names.filter((n) => !n.startsWith(".")).map(readBuild))
  return builds
    .filter((b): b is Build => b !== null)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
}

function groupApps(builds: Build[]) {
  const apps = new Map<string, Build[]>()
  for (const b of builds) {
    const list = apps.get(b.bundleId) ?? []
    list.push(b)
    apps.set(b.bundleId, list)
  }
  return [...apps.entries()].map(([bundleId, builds]) => ({ bundleId, name: builds[0].name, builds }))
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function manifestPlist(b: Build) {
  const base = `${PUBLIC_URL}/i/${b.id}`
  const icon = b.hasIcon
    ? `<dict><key>kind</key><string>display-image</string><key>url</key><string>${base}/icon.png</string></dict>
        <dict><key>kind</key><string>full-size-image</string><key>url</key><string>${base}/icon.png</string></dict>`
    : ""
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict><key>kind</key><string>software-package</string><key>url</key><string>${base}/app.ipa</string></dict>
        ${icon}
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${xml(b.bundleId)}</string>
        <key>bundle-version</key><string>${xml(b.version)}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xml(b.name)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`
}

export const installUrl = (id: string) =>
  `itms-services://?action=download-manifest&url=${encodeURIComponent(`${PUBLIC_URL}/i/${id}/manifest.plist`)}`

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`

// Public, dependency-free install page for sharing a single build (QR codes,
// links sent to someone without access to the listing).
function installPage(b: Build) {
  const icon = b.hasIcon ? `<img src="/i/${b.id}/icon.png" alt="">` : `<div class="ph"></div>`
  const notes = b.notes ? `<p class="notes">${xml(b.notes)}</p>` : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${xml(b.name)} ${xml(b.version)}</title>
<style>
:root{--bg:#fff;--fg:#0a0a0a;--mute:#737373;--line:#e5e5e5;--btn:#171717;--btnfg:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fafafa;--mute:#a3a3a3;--line:#262626;--btn:#fafafa;--btnfg:#171717}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:360px;margin:0 auto;padding:64px 16px;text-align:center}
img,.ph{width:96px;height:96px;border-radius:22px;border:1px solid var(--line)}
.ph{display:inline-block;background:var(--line)}
h1{font-size:20px;font-weight:600;margin:16px 0 2px}
p{margin:0;color:var(--mute);font-size:13px}
.notes{margin-top:12px;color:var(--fg)}
a.btn{display:inline-block;margin-top:24px;background:var(--btn);color:var(--btnfg);text-decoration:none;font-weight:500;padding:10px 24px;border-radius:8px}
</style></head><body><main>
${icon}
<h1>${xml(b.name)}</h1>
<p>${xml(b.version)}${b.build ? ` (${xml(b.build)})` : ""} · ${mb(b.size)}</p>
<p>${xml(b.bundleId)}</p>
${notes}
<a class="btn" href="${installUrl(b.id)}">Install</a>
</main></body></html>`
}

const notFound = () => new Response("Not found", { status: 404 })

async function serveStatic(pathname: string) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "")
  const path = resolve(STATIC_DIR, rel)
  if (path.startsWith(STATIC_DIR + "/")) {
    const file = Bun.file(path)
    if (await file.exists()) {
      const immutable = rel.startsWith("assets/")
      return new Response(file, {
        headers: immutable ? { "Cache-Control": "public, max-age=31536000, immutable" } : {},
      })
    }
  }
  // SPA fallback
  const index = Bun.file(join(STATIC_DIR, "index.html"))
  if (!(await index.exists())) return notFound()
  return new Response(index, { headers: { "Cache-Control": "no-cache" } })
}

export const server = Bun.serve({
  port: PORT,
  routes: {
    "/healthz": new Response("ok"),
    "/api/config": () => Response.json({ title: TITLE }),
    "/api/apps": async () => Response.json(groupApps(await listBuilds())),
    "/api/builds/:id": {
      DELETE: async (req) => {
        const b = await readBuild(req.params.id)
        if (!b) return notFound()
        await rm(join(DATA_DIR, b.id), { recursive: true, force: true })
        return new Response(null, { status: 204 })
      },
    },
    "/i/:id": async (req) => {
      const b = await readBuild(req.params.id)
      return b
        ? new Response(installPage(b), { headers: { "Content-Type": "text/html; charset=utf-8" } })
        : notFound()
    },
    "/i/:id/manifest.plist": async (req) => {
      const b = await readBuild(req.params.id)
      return b
        ? new Response(manifestPlist(b), { headers: { "Content-Type": "application/xml" } })
        : notFound()
    },
    "/i/:id/app.ipa": async (req) => {
      const b = await readBuild(req.params.id)
      if (!b) return notFound()
      return new Response(Bun.file(join(DATA_DIR, b.id, "app.ipa")), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${b.name.replace(/[^\w.-]+/g, "_")}-${b.version}.ipa"`,
        },
      })
    },
    "/i/:id/icon.png": async (req) => {
      const b = await readBuild(req.params.id)
      if (!b?.hasIcon) return notFound()
      return new Response(Bun.file(join(DATA_DIR, b.id, "icon.png")), {
        headers: { "Cache-Control": "public, max-age=86400" },
      })
    },
  },
  fetch: (req) => {
    const { pathname } = new URL(req.url)
    // /i/ is public; never fall through to the SPA there.
    return pathname.startsWith("/i/") ? notFound() : serveStatic(pathname)
  },
})

console.log(`ipa-host on :${server.port}, data ${DATA_DIR}, public ${PUBLIC_URL}`)
