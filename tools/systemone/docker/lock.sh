#!/usr/bin/env bash
# Writes the hash-pinned lock files every Dockerfile installs from, with uv (https://docs.astral.sh/uv/).
#
#   bash lock.sh            # all three models, CPU and CUDA
#
# Per model directory: requirements.in (what the model needs, by hand), and from it
#   hub.txt               huggingface_hub alone, for the weights layer that comes before torch
#   requirements-cpu.txt  everything, with torch from PyTorch's CPU index
#   requirements-cu130.txt  the same with torch built for CUDA 13.0 (NVIDIA driver 580 or newer)
# Each Dockerfile installs with --require-hashes, so a changed or substituted package fails the build.
# Run it again to move a version; commit the .txt files it writes.
set -euo pipefail
cd "$(dirname "$0")"
TORCH_CPU=2.14.0+cpu
TORCH_CU130=2.14.0+cu130
compile() { # in out [torch-index [constraints]]
  local extra=()
  [ -n "${3:-}" ] && extra=(--extra-index-url "https://download.pytorch.org/whl/$3" --index-strategy unsafe-best-match)
  [ -n "${4:-}" ] && extra+=(-c "$4")
  # --emit-index-url: the lock names PyTorch's index, so pip in the image finds the +cpu/+cu130 build.
  uv pip compile "$1" -o "$2" --generate-hashes --emit-index-url --quiet --no-header \
    --python-version 3.12 --python-platform x86_64-manylinux_2_28 "${extra[@]}"
}
printf 'huggingface_hub>=1.0\n' > /tmp/systemone-hub.in
for m in laya von jeff; do
  compile /tmp/systemone-hub.in "$m/hub.txt"
  # torch is pinned so that the lock never picks PyPI's default CUDA build by itself. The cu128 index
  # stops at 2.11, which torch's own advisories and its setuptools<82 bound left behind, so the CUDA
  # images moved to cu130 on 2026-09-27: it carries torch 2.14 for Linux and Windows both, and
  # systemone.ps1 installs the same pin on Windows.
  printf 'torch==%s\n' "$TORCH_CPU" > /tmp/systemone-cpu.txt
  printf 'torch==%s\n' "$TORCH_CU130" > /tmp/systemone-cu130.txt
  compile "$m/requirements.in" "$m/requirements-cpu.txt" cpu /tmp/systemone-cpu.txt
  compile "$m/requirements.in" "$m/requirements-cu130.txt" cu130 /tmp/systemone-cu130.txt
  for t in cpu cu130; do
    echo "$m/requirements-$t.txt: $(grep -c '^[a-z]' "$m/requirements-$t.txt") packages, $(grep -o '^torch==[^ ]*' "$m/requirements-$t.txt")"
  done
done
