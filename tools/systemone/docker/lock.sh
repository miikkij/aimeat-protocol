#!/usr/bin/env bash
# Writes the hash-pinned lock files every Dockerfile installs from, with uv (https://docs.astral.sh/uv/).
#
#   bash lock.sh            # all three models, CPU and CUDA
#
# Per model directory: requirements.in (what the model needs, by hand), and from it
#   hub.txt               huggingface_hub alone, for the weights layer that comes before torch
#   requirements-cpu.txt  everything, with torch from PyTorch's CPU index
#   requirements-cu128.txt  the same with torch built for CUDA 12.8
# Each Dockerfile installs with --require-hashes, so a changed or substituted package fails the build.
# Run it again to move a version; commit the .txt files it writes.
set -euo pipefail
cd "$(dirname "$0")"
TORCH_CPU=2.14.0+cpu
TORCH_CU128=2.11.0+cu128
compile() { # in out [torch-index [constraints]]
  local extra=()
  [ -n "${3:-}" ] && extra=(--extra-index-url "https://download.pytorch.org/whl/$3" --index-strategy unsafe-best-match)
  [ -n "${4:-}" ] && extra+=(-c "$4")
  # --emit-index-url: the lock names PyTorch's index, so pip in the image finds the +cpu/+cu128 build.
  uv pip compile "$1" -o "$2" --generate-hashes --emit-index-url --quiet --no-header \
    --python-version 3.12 --python-platform x86_64-manylinux_2_28 "${extra[@]}"
}
printf 'huggingface_hub>=1.0\n' > /tmp/systemone-hub.in
for m in laya von jeff; do
  compile /tmp/systemone-hub.in "$m/hub.txt"
  # torch is pinned to the builds the images were measured with. Left to itself the CUDA lock
  # picks PyPI's default CUDA build, and the cu128 index stops at 2.11.
  printf 'torch==%s\n' "$TORCH_CPU" > /tmp/systemone-cpu.txt
  printf 'torch==%s\n' "$TORCH_CU128" > /tmp/systemone-cu128.txt
  compile "$m/requirements.in" "$m/requirements-cpu.txt" cpu /tmp/systemone-cpu.txt
  compile "$m/requirements.in" "$m/requirements-cu128.txt" cu128 /tmp/systemone-cu128.txt
  for t in cpu cu128; do
    echo "$m/requirements-$t.txt: $(grep -c '^[a-z]' "$m/requirements-$t.txt") packages, $(grep -o '^torch==[^ ]*' "$m/requirements-$t.txt")"
  done
done
