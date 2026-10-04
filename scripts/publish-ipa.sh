#!/usr/bin/env bash
# Publishes an ad hoc / development-signed IPA to ipa-host.
#
#   scripts/publish-ipa.sh path/to/App.ipa ["release notes"]
#
# Reads name, bundle id, version and icon from the IPA (macOS: unzip, plutil,
# sips), then copies a build directory onto the host over ssh and renames it
# into place, so the server never sees a half-written build. Prints the public
# install link.
#
# Env: IPA_HOST (ssh host, default n0)
#      IPA_DIR  (data dir on the host, default /mnt/primary/appdata/ipa)
#      IPA_URL  (public URL, default https://ipa.lt3.co)
set -euo pipefail

IPA="${1:?usage: publish-ipa.sh App.ipa [notes]}"
NOTES="${2:-}"
IPA_HOST="${IPA_HOST:-n0}"
IPA_DIR="${IPA_DIR:-/mnt/primary/appdata/ipa}"
IPA_URL="${IPA_URL:-https://ipa.lt3.co}"

WORK="$(mktemp -d -t ipa-publish)"
trap 'rm -rf "$WORK"' EXIT

ENTRIES="$(unzip -Z1 "$IPA")"
APP_DIR="$(awk '/^Payload\/[^\/]+\.app\/Info\.plist$/ { sub(/Info\.plist$/, ""); print; exit }' <<< "$ENTRIES")"
[[ -n "$APP_DIR" ]] || { echo "No Payload/*.app in $IPA" >&2; exit 1; }
unzip -p "$IPA" "${APP_DIR}Info.plist" > "$WORK/Info.plist"

plist() { plutil -extract "$1" raw -o - "$WORK/Info.plist" 2>/dev/null || true; }
NAME="$(plist CFBundleDisplayName)"; NAME="${NAME:-$(plist CFBundleName)}"
BUNDLE_ID="$(plist CFBundleIdentifier)"
VERSION="$(plist CFBundleShortVersionString)"
BUILD="$(plist CFBundleVersion)"

mkdir -p "$WORK/build"
cp "$IPA" "$WORK/build/app.ipa"

# Largest primary icon file in the bundle. Xcode stores these as Apple's CgBI
# PNG variant; sips re-encodes them as standard PNG.
ICON_BASE="$(plist CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.0)"
if [[ -n "$ICON_BASE" ]]; then
  ICON_ENTRY="$(grep -E "^${APP_DIR}${ICON_BASE}[^/~]*\.png$" <<< "$ENTRIES" | sort | tail -1 || true)"
  if [[ -n "$ICON_ENTRY" ]]; then
    unzip -p "$IPA" "$ICON_ENTRY" > "$WORK/icon-raw.png"
    sips -s format png "$WORK/icon-raw.png" --out "$WORK/build/icon.png" >/dev/null 2>&1 \
      || rm -f "$WORK/build/icon.png"
  fi
fi

NAME="$NAME" BUNDLE_ID="$BUNDLE_ID" VERSION="$VERSION" BUILD="$BUILD" NOTES="$NOTES" \
python3 - > "$WORK/build/manifest.json" <<'EOF'
import datetime, json, os
m = {k: os.environ[e] for k, e in [("name", "NAME"), ("bundleId", "BUNDLE_ID"),
     ("version", "VERSION"), ("build", "BUILD"), ("notes", "NOTES")] if os.environ[e]}
m["uploadedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
print(json.dumps(m, indent=2))
EOF

# 128-bit random, URL-safe: everything under /i/<id>/ is public.
ID="$(openssl rand -base64 16 | tr '+/' '-_' | tr -d '=')"

# COPYFILE_DISABLE/--no-mac-metadata keep macOS ._* and xattr records out.
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -C "$WORK/build" -cf - app.ipa manifest.json \
  $([[ -f "$WORK/build/icon.png" ]] && echo icon.png) | ssh "$IPA_HOST" \
  "set -e; mkdir -p '$IPA_DIR/.$ID' && tar --no-same-owner -C '$IPA_DIR/.$ID' -xf - && mv '$IPA_DIR/.$ID' '$IPA_DIR/$ID'"

echo "$NAME $VERSION ($BUILD) published"
echo "$IPA_URL/i/$ID"
