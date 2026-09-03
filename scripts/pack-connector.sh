#!/usr/bin/env bash
#
# Build the connector tarball npm WOULD publish, without publishing it.
#
# WHY THIS EXISTS. Every connector fix used to cost a public version bump, because the only way
# another machine could run our code was `npm publish`. Nine of those in a row is what the outside
# world sees, and every one of them is permanent. This produces the identical artifact locally, so
# a fix is proven on the real fleet BEFORE a version number is spent on it.
#
# WHY A TARBALL AND NOT `npm link`. 3.11.0 shipped without cli/connect/agent-key and
# cli/connect/enrolment: the code was in the tree and missing from the package, so every real agent
# that tried to move to a key failed. `npm link` points at the working tree and would have shown
# none of that -- it is exactly the check that cannot catch a packaging hole. `pnpm pack` runs the
# same `files` list npm publishes through, so what the fleet installs is what npm would have given
# it, minus the irreversible part.
#
# It runs the real prepublishOnly chain (licences, notices, build), because that chain is where the
# 3.11.0 hole was.
#
# Usage:
#   bash scripts/pack-connector.sh              # build + pack, print the path
#   bash scripts/pack-connector.sh --verify     # ...and prove the v2 identity path is inside it
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/aimeat"

VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/dist-pack"
mkdir -p "$OUT"

echo "[pack] aimeat $VERSION -> $OUT"
pnpm pack --pack-destination "$OUT" >/dev/null

TARBALL="$OUT/aimeat-$VERSION.tgz"
[ -f "$TARBALL" ] || { echo "[pack] expected $TARBALL and it is not there" >&2; exit 1; }

# THE PROOF IS THE ARTIFACT, NOT THE TREE. Reading the source to decide whether a file ships is the
# mistake 3.11.0 was: list what is actually inside.
if [ "${1:-}" = "--verify" ]; then
  echo "[pack] what the connector's identity path looks like inside the tarball:"
  # LISTED ONCE, INTO A FILE. `tar | grep -q` under `set -o pipefail` reports the whole pipeline as
  # failed: grep exits at the first match, tar takes SIGPIPE writing the remaining 8000 entries, and
  # pipefail hands back tar's status. The first run of this script reported all four files missing
  # from a tarball that contained all four -- a verifier that says "missing" when it means "I could
  # not tell" is worse than none.
  LIST="$OUT/.contents-$VERSION.txt"
  tar -tzf "$TARBALL" > "$LIST"
  MISSING=0
  for f in dist/src/cli/connect/agent-key.js \
           dist/src/cli/connect/enrolment.js \
           dist/src/cli/connect/tunnel-client.js \
           dist/src/cli/connect/agent-registry.js; do
    if grep -qx "package/$f" "$LIST"; then
      echo "  ok      $f"
    else
      echo "  MISSING $f"
      MISSING=1
    fi
  done
  echo "  ($(wc -l < "$LIST" | tr -d ' ') files in the package)"
  [ "$MISSING" = 0 ] || { echo "[pack] the package is incomplete -- do not hand this to anyone" >&2; exit 1; }
fi

# THE PATH HAS TO BE ONE npm CAN OPEN. Git Bash's `pwd` gives `/e/dev/...`, which is its own mount
# and means nothing to npm, node or PowerShell — so the line this script printed for someone to
# paste was a line that could not work. `cygpath -m` gives `E:/dev/...`; elsewhere the path already
# is the native one.
if command -v cygpath >/dev/null 2>&1; then NATIVE="$(cygpath -m "$TARBALL")"; else NATIVE="$TARBALL"; fi

echo
echo "[pack] $NATIVE"
echo "[pack] install it on the fleet machine with:"
echo "         npm i \"$NATIVE\""
echo "[pack] and confirm what landed, which is the check that matters:"
echo "         ls node_modules/aimeat/dist/src/cli/connect/agent-key.js"
