#!/bin/bash
# Slice the 2048x2048 transparent grid into 9 individual platform icons
# Grid is 3x3, each cell is 682x682 (2048/3 ≈ 682.67, we'll use crop+repage)

SRC="/mnt/e/dev/GitHub/JM001/assets/platforms_transparent.png"
OUTDIR="/mnt/e/dev/GitHub/JM001/aimeat/public/img/platforms"

mkdir -p "$OUTDIR"

CELL=682
# Image is 2048px, 3 cells of 682 = 2046, last cell gets 2 extra pixels (684)

# Grid layout (from the prompt guide):
# Row 1: chatgpt,   claude,    copilot
# Row 2: deepseek,  grok,      gemini
# Row 3: lmstudio,  openclaw,  other

declare -A ICONS
ICONS[chatgpt]="0,0"
ICONS[claude]="1,0"
ICONS[copilot]="2,0"
ICONS[deepseek]="0,1"
ICONS[grok]="1,1"
ICONS[gemini]="2,1"
ICONS[lmstudio]="0,2"
ICONS[openclaw]="1,2"
ICONS[other]="2,2"

for name in chatgpt claude copilot deepseek grok gemini lmstudio openclaw other; do
  IFS=',' read -r col row <<< "${ICONS[$name]}"
  x=$((col * CELL))
  y=$((row * CELL))

  # Use 684 for the last column/row to capture any remaining pixels
  w=$CELL
  h=$CELL
  if [ "$col" -eq 2 ]; then w=684; fi
  if [ "$row" -eq 2 ]; then h=684; fi

  echo "Slicing $name: ${w}x${h}+${x}+${y}"
  convert "$SRC" -crop "${w}x${h}+${x}+${y}" +repage -trim +repage -resize 256x256 "$OUTDIR/${name}.png"
done

echo ""
echo "=== Results ==="
for f in "$OUTDIR"/*.png; do
  echo "$(basename "$f"): $(identify -format '%wx%h %b' "$f")"
done
echo "Done!"
