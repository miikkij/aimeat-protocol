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
# IT BUILDS EXPLICITLY, because the first version of this script did not and shipped the bug it was
# written to prevent. `prepublishOnly` runs on `npm publish` and NOT on `pack` — pack's hook is
# `prepack`, which this package does not have — so the tarball was whatever happened to be in dist/.
# It carried package.json 3.12.1 with 3.12.0 code from a commit two fixes old, and was handed to the
# fleet as the fix. That is the 3.11.0 defect exactly, reproduced by its own countermeasure.
# Never trust a lifecycle hook to have run: run it, then read the artifact.
#
# Usage:
#   bash scripts/pack-connector.sh              # build + pack, print the path
#   bash scripts/pack-connector.sh --verify     # ...and prove what is inside it
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/aimeat"

VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/dist-pack"
mkdir -p "$OUT"

HEAD_SHA="$(git rev-parse HEAD)"
echo "[pack] aimeat $VERSION at ${HEAD_SHA:0:12} -> $OUT"

echo "[pack] building..."
pnpm build >/dev/null

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

  # WHICH CODE IS IN THERE, asked of the artifact and not of the tree. The tarball carries
  # dist/build-stamp.json, which names the commit and version the build came from, so the one
  # question that matters — is this the code I just wrote — has an answer that cannot be fooled by
  # a stale dist/ or a hook that did not run. This is the check whose absence let a tarball
  # labelled 3.12.1 leave with 3.12.0 code inside it.
  tar -xzf "$TARBALL" -O package/dist/build-stamp.json > "$OUT/.stamp-$VERSION.json" 2>/dev/null || true
  if [ -s "$OUT/.stamp-$VERSION.json" ]; then
    # Read with sed, not `node -p require(...)`: this script's path is Git Bash's `/e/dev/...`
    # mount, which node cannot resolve, and the failure came back as "?" rather than as an error.
    # That is twice now that a POSIX path was handed to a Windows-native tool in this one file.
    STAMP_COMMIT="$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OUT/.stamp-$VERSION.json")"
    STAMP_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OUT/.stamp-$VERSION.json")"
    if [ "$STAMP_COMMIT" = "$HEAD_SHA" ] && [ "$STAMP_VERSION" = "$VERSION" ]; then
      echo "  ok      built from HEAD, $STAMP_VERSION @ ${STAMP_COMMIT:0:12}"
    else
      echo "  WRONG   the package holds $STAMP_VERSION @ ${STAMP_COMMIT:0:12}, not $VERSION @ ${HEAD_SHA:0:12}"
      MISSING=1
    fi
  else
    echo "  WRONG   no dist/build-stamp.json in the package — cannot tell what code this is"
    MISSING=1
  fi

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

# BOTH FORMS, LABELLED, because one path cannot serve both tools and printing only one sent
# somebody down the wrong road. npm, node and PowerShell need `E:/...`; Git Bash's own `tar` reads
# `E:` as a REMOTE HOST and answers "Cannot connect to E: resolve failed" — an empty listing that
# reads as a broken tarball rather than as a bad argument. It needs `/e/...`.
echo
echo "[pack] $NATIVE"
echo "[pack] install it on the fleet machine (npm reads the Windows path):"
echo "         npm i \"$NATIVE\""
echo "[pack] look inside it from THIS shell (tar reads the POSIX path; E: is a host to it):"
echo "         tar -tzf \"$TARBALL\" | grep cli/connect"
echo "[pack] and after installing, the check that actually matters — which build is it:"
echo "         cat node_modules/aimeat/dist/build-stamp.json"
