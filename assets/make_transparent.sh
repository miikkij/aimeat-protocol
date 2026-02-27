#!/bin/bash
SRC="/mnt/e/dev/GitHub/JM001/assets/Gemini_Generated_Image_3esbtn3esbtn3esb.png"
OUT="/mnt/e/dev/GitHub/JM001/assets/platforms_transparent.png"
BG_COLOR="#F904F7"

echo "Step 1: Creating per-channel difference masks"
convert "$SRC" \( +clone -fill "$BG_COLOR" -colorize 100% \) -compose difference -composite /tmp/diff.png
convert /tmp/diff.png -channel R -separate -auto-level /tmp/diff_r.png
convert /tmp/diff.png -channel G -separate -auto-level /tmp/diff_g.png
convert /tmp/diff.png -channel B -separate -auto-level /tmp/diff_b.png
convert /tmp/diff_r.png /tmp/diff_g.png -compose lighten -composite /tmp/diff_rg.png
convert /tmp/diff_rg.png /tmp/diff_b.png -compose lighten -composite /tmp/mask_raw.png

echo "Step 2: Enhancing mask — map 5%-48% to 0-100% alpha"
# Below 5% (~13) → fully transparent (kills background noise)
# Above 48% (~122) → fully opaque (makes all icon bodies solid)
# 13-122 → smooth gradient (preserves shadow semi-transparency)
convert /tmp/mask_raw.png -level 5%,48% /tmp/mask_final.png

echo "Step 3: Applying mask as alpha channel"
convert "$SRC" /tmp/mask_final.png -alpha off -compose copy_opacity -composite "$OUT"

echo "Verification:"
echo "BG (5,5):"
convert "$OUT" -crop 1x1+5+5 -depth 8 txt:-
echo "Robot (340,340):"
convert "$OUT" -crop 1x1+340+340 -depth 8 txt:-
echo "Brain (1024,340):"
convert "$OUT" -crop 1x1+1024+340 -depth 8 txt:-
echo "Diamond (1700,1024):"
convert "$OUT" -crop 1x1+1700+1024 -depth 8 txt:-
echo "Crab (1024,1700):"
convert "$OUT" -crop 1x1+1024+1700 -depth 8 txt:-
echo "Gear (1700,1700):"
convert "$OUT" -crop 1x1+1700+1700 -depth 8 txt:-
echo "Done!"
