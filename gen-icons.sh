#!/usr/bin/env bash
# Regenerates the site's raster icons (favicon.png, favicon.ico,
# apple-touch-icon.png, og-image.png) from frontend/public/favicon.svg.
# Needs rsvg-convert (librsvg) and ImageMagick 7 (magick).
#
#   ./gen-icons.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC="$ROOT_DIR/frontend/public"
SRC="$PUBLIC/favicon.svg"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

for cmd in rsvg-convert magick; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rsvg-convert -w 512 -h 512 "$SRC" -o "$TMP/512.png"
rsvg-convert -w 128 -h 128 "$SRC" -o "$PUBLIC/favicon.png"
# Shrunk from the 128px render with the default filter, like the original
# hand-made ICO; a direct render smears edges that land between pixels.
for s in 16 32 48; do
  magick "$PUBLIC/favicon.png" -resize "${s}x${s}" "$TMP/$s.png"
done
# Force truecolor: with few colors ImageMagick writes a palette ICO, which keeps
# only on/off transparency and makes the soft edges blocky.
magick "$TMP/48.png" "$TMP/32.png" "$TMP/16.png" -type TrueColorAlpha "$PUBLIC/favicon.ico"
# iOS and link previews show transparency as black, so these get a white background.
rsvg-convert -w 180 -h 180 -b white "$SRC" -o "$PUBLIC/apple-touch-icon.png"
magick "$TMP/512.png" -background white -alpha remove -alpha off "$PUBLIC/og-image.png"

echo "Wrote favicon.png, favicon.ico, apple-touch-icon.png, og-image.png to frontend/public/"
