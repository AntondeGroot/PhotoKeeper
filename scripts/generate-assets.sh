#!/usr/bin/env bash
# Regenerates the rendered brand assets from the SVGs in assets/src:
# the Android launcher icon and the web favicon.
#
# No native splash is generated on purpose. The app has its own splash — the
# developing-print animation in frontend/src/app/splash/ — and a native one in
# front of it is just a second splash to sit through. The launch window is
# blanked out instead, in android/app/src/main/res/values/styles.xml.
#
# Only needed when the artwork changes — the generated files are committed, so a
# normal build or install does not run this.
#
# The SVGs are the same drawing as the splash mark in
# frontend/src/app/splash/splash.html, at the same coordinates. Change the
# splash, copy the shapes across, run this.
#
# Usage:
#   npm run assets

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found — install it with: brew install librsvg" >&2
  exit 1
}

# ——— Sources for @capacitor/assets ———
#
# It expects these exact filenames in assets/, at 1024px. There is no splash.png
# alongside them, which is what stops it generating a native splash.

echo "→ rendering source PNGs from assets/src"
for name in icon-only icon-background icon-foreground; do
  rsvg-convert -w 1024 -h 1024 "assets/src/$name.svg" -o "assets/$name.png"
done

echo "→ generating Android icons"
npx capacitor-assets generate --android

# capacitor-assets writes both adaptive layers with a 16.7% inset, which leaves
# the sky short of the icon canvas — see the comment in the file it overwrites.
echo "→ restoring full-bleed adaptive layers"
for f in android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml \
  android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml; do
  cat > "$f" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- Both layers are full bleed on purpose. @capacitor/assets insets each by
     16.7% so the art exactly fills the 72dp guaranteed-visible circle, but that
     leaves the sky short of the 108dp canvas: any launcher using a wider mask,
     or parallaxing the background, reveals transparency at the edge and ridges
     that stop mid-icon. The artwork in assets/src is drawn to be cropped — the
     sun sits inside the safe zone, the ridges are meant to run off the corners.
     Rewritten by scripts/generate-assets.sh after every regeneration. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
XML
done

# ——— Favicon ———
#
# 16px gets the simplified mark; at that size the full drawing turns to mush.

echo "→ building favicon.ico"
frames="$(mktemp -d)"
trap 'rm -rf "$frames"' EXIT
rsvg-convert -w 16 -h 16 assets/src/icon-small.svg -o "$frames/16.png"
rsvg-convert -w 32 -h 32 assets/src/icon-only.svg -o "$frames/32.png"
rsvg-convert -w 48 -h 48 assets/src/icon-only.svg -o "$frames/48.png"
python3 scripts/make-favicon.py frontend/public/favicon.ico \
  "$frames/16.png" "$frames/32.png" "$frames/48.png"

printf '\nAssets regenerated. Reinstall to see them: npm run android:install\n'