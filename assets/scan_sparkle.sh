#!/bin/bash
# Scan the bottom-right area to find sparkle pixels
IMG="/tmp/other_raw.png"
for x in 450 480 500 520 540 560 580 600 620 640 660 680; do
  for y in 450 480 500 520 540 560 580 600 620 640 660 680; do
    pixel=$(convert "$IMG" -crop 1x1+${x}+${y} -depth 8 -format '%[fx:a*255]' info:)
    rounded=$(printf "%.0f" "$pixel")
    if [ "$rounded" -gt 5 ] 2>/dev/null; then
      echo "VISIBLE at ($x,$y) alpha=$rounded"
    fi
  done
done
echo "scan complete"
