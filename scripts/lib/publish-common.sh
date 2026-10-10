#!/usr/bin/env bash
# Shared by publish-ipa.sh and publish-apk.sh: host config, manifest.json and
# the tar | ssh upload that renames the build into place atomically.
#
# Env: IPA_HOST (ssh host, default n0)
#      IPA_DIR  (data dir on the host, default /mnt/primary/appdata/ipa)
#      IPA_URL  (public URL, default https://ipa.lt3.co)

IPA_HOST="${IPA_HOST:-n0}"
IPA_DIR="${IPA_DIR:-/mnt/primary/appdata/ipa}"
IPA_URL="${IPA_URL:-https://ipa.lt3.co}"

# write_manifest <out.json> <platform> <name> <bundleId> <version> <build> <notes>
# Empty build/notes are omitted; uploadedAt is now (UTC).
write_manifest() {
  PLATFORM="$2" NAME="$3" BUNDLE_ID="$4" VERSION="$5" BUILD="$6" NOTES="$7" \
  python3 - > "$1" <<'EOF'
import datetime, json, os
m = {"platform": os.environ["PLATFORM"]}
m.update({k: os.environ[e] for k, e in [("name", "NAME"), ("bundleId", "BUNDLE_ID"),
          ("version", "VERSION"), ("build", "BUILD"), ("notes", "NOTES")] if os.environ[e]})
m["uploadedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
print(json.dumps(m, indent=2))
EOF
}

# new_build_id — 128-bit random, URL-safe: everything under /i/<id>/ is public.
new_build_id() { openssl rand -base64 16 | tr '+/' '-_' | tr -d '='; }

# upload_build <id> <build dir> <file>... — copies the named files from
# <build dir> into <IPA_DIR>/<id> on the host. Writes to .<id> and renames so
# the server never lists a half-written build. The remote shell's output is
# left on stdout as before (nothing is captured from it).
upload_build() {
  local id="$1" dir="$2"; shift 2
  # COPYFILE_DISABLE/--no-mac-metadata keep macOS ._* and xattr records out.
  COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -C "$dir" -cf - "$@" | ssh "$IPA_HOST" \
    "set -e; mkdir -p '$IPA_DIR/.$id' && tar --no-same-owner -C '$IPA_DIR/.$id' -xf - && mv '$IPA_DIR/.$id' '$IPA_DIR/$id'"
}
