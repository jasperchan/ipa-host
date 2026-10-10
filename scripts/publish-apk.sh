#!/usr/bin/env bash
# Publishes an Android APK to ipa-host.
#
#   scripts/publish-apk.sh path/to/App.apk ["release notes"]
#
# Reads package name, versionName, versionCode, label and launcher icon from
# the APK with aapt2 (found on PATH or under $ANDROID_HOME / $ANDROID_SDK_ROOT
# build-tools). Without aapt2, pass the metadata in by env instead:
#
#   APK_NAME     application label        (required)
#   APK_PACKAGE  package name             (required)
#   APK_VERSION  versionName              (required)
#   APK_BUILD    versionCode              (optional)
#   APK_ICON     PNG to show as the icon  (optional; otherwise taken from the APK via aapt2)
#
# Env values win over aapt2 when both are set. The build directory is copied
# onto the host over ssh and renamed into place, so the server never sees a
# half-written build. Prints the public install link.
#
# Env: IPA_HOST (ssh host, default n0)
#      IPA_DIR  (data dir on the host, default /mnt/primary/appdata/ipa)
#      IPA_URL  (public URL, default https://ipa.lt3.co)
set -euo pipefail

APK="${1:?usage: publish-apk.sh App.apk [notes]}"
NOTES="${2:-}"
# shellcheck source=lib/publish-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/publish-common.sh"

[[ -f "$APK" ]] || { echo "No such file: $APK" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/apk-publish.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

find_aapt2() {
  command -v aapt2 && return
  local root found
  for root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [[ -n "$root" ]] || continue
    found="$(ls "$root"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"
    [[ -n "$found" ]] && { echo "$found"; return; }
  done
  return 1
}

NAME="${APK_NAME:-}" PACKAGE="${APK_PACKAGE:-}" VERSION="${APK_VERSION:-}" BUILD="${APK_BUILD:-}"
AAPT2="$(find_aapt2 || true)"
BADGING=""
if [[ -n "$AAPT2" ]]; then
  BADGING="$("$AAPT2" dump badging "$APK")"
  # package: name='com.example.app' versionCode='42' versionName='1.2.3' ...
  pkg_attr() { sed -n "s/^package:.*[[:space:]]$1='\([^']*\)'.*/\1/p" <<< "$BADGING" | head -1; }
  NAME="${NAME:-$(sed -n "s/^application-label:'\(.*\)'$/\1/p" <<< "$BADGING" | head -1)}"
  PACKAGE="${PACKAGE:-$(pkg_attr name)}"
  VERSION="${VERSION:-$(pkg_attr versionName)}"
  BUILD="${BUILD:-$(pkg_attr versionCode)}"
fi

MISSING=()
[[ -n "$NAME" ]] || MISSING+=(APK_NAME)
[[ -n "$PACKAGE" ]] || MISSING+=(APK_PACKAGE)
[[ -n "$VERSION" ]] || MISSING+=(APK_VERSION)
if (( ${#MISSING[@]} )); then
  if [[ -z "$AAPT2" ]]; then
    echo "aapt2 not found (PATH, \$ANDROID_HOME or \$ANDROID_SDK_ROOT build-tools); set ${MISSING[*]} instead" >&2
  else
    echo "Could not read ${MISSING[*]} from $APK with aapt2; set them by env" >&2
  fi
  exit 1
fi

mkdir -p "$WORK/build"
cp "$APK" "$WORK/build/app.apk"
FILES=(app.apk manifest.json)

# Icon: APK_ICON when given, else the densest raster launcher icon in the APK.
# Adaptive (.xml) and .webp icons are skipped, and no match must not abort the
# script under pipefail.
if [[ -n "${APK_ICON:-}" ]]; then
  [[ -f "$APK_ICON" ]] || { echo "No such file: $APK_ICON" >&2; exit 1; }
  cp "$APK_ICON" "$WORK/build/icon.png"
  FILES+=(icon.png)
elif [[ -n "$BADGING" ]]; then
  ICON_ENTRY="$(grep -E "^application-icon-[0-9]+:'.*\.png'$" <<< "$BADGING" \
    | sort -t- -k3,3n | tail -1 | sed -n "s/^[^']*'\(.*\)'$/\1/p" || true)"
  if [[ -n "$ICON_ENTRY" ]] && unzip -p "$APK" "$ICON_ENTRY" > "$WORK/build/icon.png" 2>/dev/null \
    && [[ "$(head -c 8 "$WORK/build/icon.png" | od -An -tx1 | tr -d ' \n')" == "89504e470d0a1a0a" ]]; then
    FILES+=(icon.png)
  else
    rm -f "$WORK/build/icon.png"
  fi
fi

write_manifest "$WORK/build/manifest.json" android "$NAME" "$PACKAGE" "$VERSION" "$BUILD" "$NOTES"
ID="$(new_build_id)"
upload_build "$ID" "$WORK/build" "${FILES[@]}"

echo "$NAME $VERSION${BUILD:+ ($BUILD)} published"
echo "$IPA_URL/i/$ID"
