import { useCallback, useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  DownloadIcon,
  EllipsisIcon,
  LinkIcon,
  QrCodeIcon,
  Trash2Icon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Bundled by Vite under a content hash, so a new mark is never served from a cache of the old one.
import logo from "./assets/logo.svg"

type Platform = "ios" | "android"

type Build = {
  id: string
  platform: Platform
  name: string
  bundleId: string
  version: string
  build?: string
  notes?: string
  uploadedAt: string
  size: number
  hasIcon: boolean
}

type AppGroup = {
  platform: Platform
  bundleId: string
  name: string
  builds: Build[]
}

const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
const isAndroid = /Android/.test(navigator.userAgent)

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "ios", label: "iOS" },
  { id: "android", label: "Android" },
]
const platformLabel = (p: Platform) => PLATFORMS.find((x) => x.id === p)!.label
const isPlatform = (p: string | null): p is Platform =>
  PLATFORMS.some((x) => x.id === p)

// Tab shown first: the device's own platform when it has one; otherwise the
// platform with the newest build, decided once the listing has loaded.
const devicePlatform: Platform | null = isIOS
  ? "ios"
  : isAndroid
    ? "android"
    : null

const newestPlatform = (apps: AppGroup[]): Platform => {
  let best: Build | undefined
  for (const a of apps)
    for (const b of a.builds)
      if (!best || b.uploadedAt > best.uploadedAt) best = b
  return best?.platform ?? "ios"
}

// Whether this device can install the build straight from the listing; other
// devices get the QR code to the public install page instead.
const canInstallHere = (b: Build) =>
  b.platform === "android" ? isAndroid : isIOS

const shareUrl = (b: Build) => `${location.origin}/i/${b.id}`
const installUrl = (b: Build) =>
  b.platform === "android"
    ? `/i/${b.id}/app.apk`
    : `itms-services://?action=download-manifest&url=${encodeURIComponent(
        `${location.origin}/i/${b.id}/manifest.plist`
      )}`

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
const label = (b: Build) => `${b.version}${b.build ? ` (${b.build})` : ""}`

function AppIcon({ build, size }: { build: Build; size: "lg" | "sm" }) {
  const cls = size === "lg" ? "size-14 rounded-[14px]" : "size-8 rounded-[8px]"
  if (build.hasIcon) {
    return (
      <img
        src={`/i/${build.id}/icon.png`}
        alt=""
        className={`${cls} shrink-0 ring-1 ring-foreground/10`}
      />
    )
  }
  return (
    <div
      className={`${cls} flex shrink-0 items-center justify-center bg-muted font-medium text-muted-foreground`}
    >
      {build.name.slice(0, 1)}
    </div>
  )
}

type Actions = {
  onQr: (b: Build) => void
  onDelete: (b: Build) => void
}

function InstallButton({
  build,
  onQr,
  size,
}: {
  build: Build
  onQr: (b: Build) => void
  size?: "sm"
}) {
  if (canInstallHere(build)) {
    return (
      <Button size={size} render={<a href={installUrl(build)} />}>
        <DownloadIcon />
        Install
      </Button>
    )
  }
  return (
    <Button size={size} variant="outline" onClick={() => onQr(build)}>
      <QrCodeIcon />
      Install
    </Button>
  )
}

function BuildMenu({ build, onQr, onDelete }: { build: Build } & Actions) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="More" />}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          onClick={() =>
            navigator.clipboard
              .writeText(shareUrl(build))
              .then(() => toast.success("Install link copied"))
          }
        >
          <LinkIcon />
          Copy install link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onQr(build)}>
          <QrCodeIcon />
          Show QR code
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(build)}>
          <Trash2Icon />
          Delete build
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Phone: icon and text on top, the actions on a row of their own underneath
// (Install stretches to the width of a thumb). From `sm` up the actions sit to
// the right of the text. The version pill always has the title's full width
// to itself (it wraps under the name rather than squeezing it).
function AppCard({ app, ...actions }: { app: AppGroup } & Actions) {
  const [latest, ...older] = app.builds
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <AppIcon build={latest} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 text-base leading-tight font-medium">
                  {latest.name}
                </h2>
                <Badge variant="secondary">{label(latest)}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {app.bundleId}
              </p>
              <p className="text-xs text-muted-foreground">
                {when(latest.uploadedAt)} · {mb(latest.size)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 [&>a,&>button:first-child]:flex-1 sm:[&>a,&>button:first-child]:flex-none">
            <InstallButton build={latest} onQr={actions.onQr} />
            <BuildMenu build={latest} {...actions} />
          </div>
        </div>
        {latest.notes && <p className="text-sm">{latest.notes}</p>}
        {older.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground data-[panel-open]:[&_svg]:rotate-180"
                />
              }
            >
              {older.length} older build{older.length === 1 ? "" : "s"}
              <ChevronDownIcon className="transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 divide-y">
                {older.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{label(b)}</p>
                      <p className="text-xs text-muted-foreground">
                        {when(b.uploadedAt)} · {mb(b.size)}
                        {b.notes ? ` · ${b.notes}` : ""}
                      </p>
                    </div>
                    <InstallButton build={b} onQr={actions.onQr} size="sm" />
                    <BuildMenu build={b} {...actions} />
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}

export function App() {
  const [title, setTitle] = useState("Apps")
  const [apps, setApps] = useState<AppGroup[] | null>(null)
  const [platform, setPlatform] = useState<Platform | null>(devicePlatform)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<Build | null>(null)
  const [deleting, setDeleting] = useState<Build | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/apps")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list: AppGroup[] = await res.json()
      setApps(list)
      // Only the first load picks a tab; a later refresh keeps the user's choice.
      setPlatform((p) => p ?? newestPlatform(list))
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setTitle(c.title)
        document.title = c.title
      })
      .catch(() => {})
    load()
    const onFocus = () => load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [load])

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/builds/${deleting.id}`, { method: "DELETE" })
    if (res.ok) toast.success(`Deleted ${deleting.name} ${label(deleting)}`)
    else toast.error(`Delete failed (HTTP ${res.status})`)
    setDeleting(null)
    load()
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-4 px-4 py-8 sm:py-12">
      <header className="flex items-center gap-3">
        <img src={logo} alt="" className="size-8" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      <Tabs
        value={platform ?? "ios"}
        onValueChange={(v) => isPlatform(v) && setPlatform(v)}
      >
        <TabsList>
          {PLATFORMS.map(({ id, label: name }) => (
            <TabsTrigger key={id} value={id} className="px-3">
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {error && (
        <p className="text-sm text-destructive">
          Couldn't load builds: {error}
        </p>
      )}
      {apps && platform && (
        <section className="flex flex-col gap-4">
          {apps.filter((a) => a.platform === platform).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {platformLabel(platform)} builds yet.
            </p>
          ) : (
            apps
              .filter((a) => a.platform === platform)
              .map((app) => (
                <AppCard
                  key={`${app.platform}:${app.bundleId}`}
                  app={app}
                  onQr={setQr}
                  onDelete={setDeleting}
                />
              ))
          )}
        </section>
      )}

      <Dialog open={qr !== null} onOpenChange={(open) => !open && setQr(null)}>
        <DialogContent className="sm:max-w-sm">
          {qr && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {qr.name} {label(qr)}
                </DialogTitle>
                <DialogDescription>
                  {qr.platform === "android"
                    ? "Scan with the phone's camera, then allow the browser to install unknown apps if asked."
                    : "Scan with the iPhone's camera to install."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-center rounded-lg bg-white p-4">
                <QRCodeSVG value={shareUrl(qr)} size={208} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.name} {deleting && label(deleting)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The {deleting?.platform === "android" ? "APK" : "IPA"} is removed
              from the server and its install link stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster />
    </main>
  )
}

export default App
