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
# shellcheck source=lib/publish-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/publish-common.sh"

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
FILES=(app.ipa manifest.json)

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
[[ -f "$WORK/build/icon.png" ]] && FILES+=(icon.png)

write_manifest "$WORK/build/manifest.json" ios "$NAME" "$BUNDLE_ID" "$VERSION" "$BUILD" "$NOTES"
ID="$(new_build_id)"
upload_build "$ID" "$WORK/build" "${FILES[@]}"

echo "$NAME $VERSION ($BUILD) published"
echo "$IPA_URL/i/$ID"
