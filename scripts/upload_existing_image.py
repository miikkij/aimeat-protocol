"""upload_existing_image.py — publish an ALREADY generated genimages/ file to AIMEAT storage.

gen_image.py only uploads as part of a generation run, so re-uploading meant paying to
regenerate an image we already liked. This reuses gen_image's own owner-login, presigned-PUT and
manifest-append helpers on a file that is already on disk, so genimages/uploads.json stays the
single record of what was uploaded and where.

Usage (from the repo root):
    python scripts/upload_existing_image.py odps/hero
    python scripts/upload_existing_image.py odps/hero --key gen.img.odps-hero

Prints the public /v1/pub/ URL an app can reference. Config is scripts/.env, same as gen_image.py
(AIMEAT_APP_LOGIN_USER / AIMEAT_APP_LOGIN_PASSWORD required).
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_image import OUT_DIR, REPO, MANIFEST_PATH, owner_token, read_env, record_manifest, slugify, upload_public

_EXT_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Upload an existing genimages/ file to AIMEAT storage.")
    ap.add_argument("out", help="relative path under genimages/, with or without extension (e.g. odps/hero)")
    ap.add_argument("--key", help="storage key (default gen.img.<slug of out path>)")
    args = ap.parse_args()

    rel = args.out.replace("\\", "/").lstrip("/")
    base, ext = os.path.splitext(rel)
    candidates = [rel] if ext else [base + e for e in _EXT_MIME]
    local = next((os.path.join(OUT_DIR, *c.split("/")) for c in candidates
                  if os.path.exists(os.path.join(OUT_DIR, *c.split("/")))), None)
    if not local:
        print(f"not found under genimages/: {base}.[png|jpg|webp]", file=sys.stderr)
        return 1

    auth = owner_token(read_env())
    if not auth:
        print("needs AIMEAT_APP_LOGIN_USER / AIMEAT_APP_LOGIN_PASSWORD in scripts/.env", file=sys.stderr)
        return 1
    token, ghii, node_base = auth

    with open(local, "rb") as f:
        raw = f.read()
    mime = _EXT_MIME.get(os.path.splitext(local)[1].lower(), "image/png")
    key = args.key or f"gen.img.{slugify(base)}"

    if not upload_public(token, node_base, key, raw, mime):
        return 1

    url = f"{node_base}/v1/pub/{urllib.parse.quote(ghii, safe='')}/{key}"
    record_manifest({
        "out": base,
        "local": os.path.relpath(local, REPO).replace("\\", "/"),
        "storage_key": key,
        "url": url,
        "account": ghii,
        "model": "(existing file, not regenerated)",
        "size": None,
        "mime": mime,
        "bytes": len(raw),
        "prompt": "(uploaded from disk by upload_existing_image.py)",
        "uploaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    print(f"public={url}")
    print(f"key={key} account={ghii} bytes={len(raw)}")
    print(f"manifest: {os.path.relpath(MANIFEST_PATH, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
