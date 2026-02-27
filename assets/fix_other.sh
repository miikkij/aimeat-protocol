#!/bin/bash
SRC="/mnt/e/dev/GitHub/JM001/assets/platforms_transparent.png"
OUT="/mnt/e/dev/GitHub/JM001/aimeat/public/img/platforms/other.png"

echo "Re-extracting other cell"
convert "$SRC" -crop 684x684+1364+1364 +repage /tmp/other_raw.png

echo "Extracting alpha channel, painting sparkle area black (=transparent)"
# Extract alpha channel as grayscale
convert /tmp/other_raw.png -alpha extract /tmp/other_alpha.png
# Paint the sparkle rectangle black on the alpha
convert /tmp/other_alpha.png -fill black -draw "rectangle 520,530 684,684" /tmp/other_alpha_fixed.png
# Reapply the fixed alpha to the original
convert /tmp/other_raw.png /tmp/other_alpha_fixed.png -alpha off -compose copy_opacity -composite /tmp/other_clean.png

echo "Verifying sparkle area:"
for coords in "560,560" "580,580" "600,580" "560,580"; do
  IFS=',' read -r x y <<< "$coords"
  alpha=$(convert /tmp/other_clean.png -crop 1x1+${x}+${y} -depth 8 -format '%[fx:a*255]' info:)
  echo "  ($coords) alpha=$(printf '%.0f' "$alpha")"
done

echo "Trimming and resizing"
convert /tmp/other_clean.png -trim +repage -resize 256x256 "$OUT"
identify -format 'Result: %wx%h\n' "$OUT"
echo "Done"
