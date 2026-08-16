"""gen_image.py — on-demand AIMEAT image generator for Claude Code.

Whenever Claude Code needs an image (an app icon, a banner, an illustration, a hero graphic)
it runs THIS instead of shipping a bland placeholder. It renders a description via an OpenRouter
image model, applies the AIMEAT house style, and saves the result under genimages/<subfolder>/
(gitignored) so nothing junky ever lands in the repo by accident.

Design lineage: adapted from crewfive's ec_image_gen.py / lingua_image_gen.py (same OpenRouter
unified-image-API call + BFL moderation retry + AIMEAT presigned public upload), generalised into
a reusable "give me a picture of X, put it here" tool.

Config lives in scripts/.env (gitignored — copy scripts/.env.example):
    OPENROUTER_API_KEY        required — image generation
    IMAGE_MODEL               optional — the model to use (else the built-in candidate list)
    AIMEAT_APP_LOGIN_USER     only for --upload — owner login; files land under the owner GHII
    AIMEAT_APP_LOGIN_PASSWORD only for --upload
    AIMEAT_BASE               optional — default https://aimeat.io
    AIMEAT_NODE_ID            optional — GHII fallback suffix (default aimeat-finland-001-genesis)

Usage (from the repo root):
    # single image → genimages/icons/agent-badge.png
    python scripts/gen_image.py --out icons/agent-badge "a glowing AI agent badge, red accent"

    # force a size and skip the house style
    python scripts/gen_image.py --out banners/hero --size 1344x576 --no-style "..."

    # batch: one "relative/path=prompt" per line
    python scripts/gen_image.py --file scripts/my-images.txt

    # also upload PUBLIC to AIMEAT storage (for use inside an app) and record it in the manifest
    python scripts/gen_image.py --out app/logo --upload "the CADENCE app logo, minimal"

Every --upload is appended to genimages/uploads.json (out path, local file, storage key, public
URL, account GHII, model, size, bytes, prompt, timestamp) so a later session knows exactly what
was uploaded, where it lives, and how to reference it.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(SCRIPT_DIR)
ENV_PATH = os.path.join(SCRIPT_DIR, ".env")
OUT_DIR = os.path.join(REPO, "genimages")
MANIFEST_PATH = os.path.join(OUT_DIR, "uploads.json")
OR_BASE = "https://openrouter.ai/api/v1"

# Tried in order until one answers, when IMAGE_MODEL is not set and --model is not passed.
MODEL_CANDIDATES = [
    "black-forest-labs/flux.2-pro",
    "black-forest-labs/flux-2-pro",
    "google/gemini-2.5-flash-image",
    "bytedance-seed/seedream-4.5",
]

# The AIMEAT house style. Prepended to every prompt unless --no-style. Keep it about QUALITY and
# palette, not a fixed background/composition, so it fits icons, banners and illustrations alike.
#
# BRIGHT BY DEFAULT, and this is not a preference to be quietly re-tuned. The previous version named
# "deep near-black #0E1116" and "cool neutral slate grays", and every model obliged: a year of dark,
# lifeless, interchangeable images, each one technically on-brand and none of them anything anybody
# wanted to look at. A dark ground is now something a caller asks for in the subject line, never
# something the house style supplies unasked.
HOUSE_STYLE = (
    "Premium, polished AIMEAT brand visual: bright, energetic, warm and alive. Light airy ground, "
    "off-white or a soft warm tint, generous natural light. Confident modern geometry with clean "
    "shapes and generous negative space, a sense of motion and optimism. Palette led by a vivid "
    "coral-red #E8564A, supported by warm sunlit tones, fresh accents and clear whites; keep darks "
    "to sparing outlines and type, never as the background. High contrast and saturation, cheerful "
    "rather than corporate. No murky greys, no black backgrounds, no gloom, no stock-photo cheese, "
    "no clip-art, no watermark, no clutter, no gibberish text. Subject: "
)

_IMAGE_MIMES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
CTX = ssl.create_default_context()


def read_env() -> dict:
    vals: dict[str, str] = {}
    if not os.path.exists(ENV_PATH):
        return vals
    with open(ENV_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None, timeout: int = 240):
    req = urllib.request.Request(
        url, data=(json.dumps(body).encode("utf-8") if body is not None else None), method=method
    )
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, None


def _images_api(or_key: str, model: str, prompt: str, size: str):
    hdrs = {"Authorization": f"Bearer {or_key}", "HTTP-Referer": "https://aimeat.io", "X-Title": "AIMEAT image gen"}
    # BFL moderation throws flaky false positives ("Protected Content") — the same prompt passes on
    # retry, so try up to 3 times before giving up on this model (proven in the lingua/ec generators).
    st, resp = None, None
    for attempt in range(3):
        st, resp = http_json(
            "POST",
            OR_BASE + "/images/generations",
            {"model": model, "prompt": prompt, "size": size, "usage": {"include": True}},
            hdrs,
        )
        if st == 200:
            break
        msg = str((resp or {}).get("error", {}))[:160] if isinstance(resp, dict) else ""
        print(f"    [{model}] images API HTTP {st} size={size} (attempt {attempt + 1}) {msg[:100]}", file=sys.stderr)
        if "Moderat" not in msg:
            break
    if st != 200 or not isinstance(resp, dict):
        return None
    data = (resp.get("data") or [{}])[0]
    b64 = data.get("b64_json")
    if not b64 and str(data.get("url", "")).startswith("data:"):
        b64 = data["url"].split("base64,", 1)[1]
    if not b64:
        return None
    raw = base64.b64decode(b64)
    mime = "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    cost = (resp.get("usage") or {}).get("cost")
    return raw, mime, (float(cost) if isinstance(cost, (int, float)) else None)


def generate(or_key: str, model: str, prompt: str, sizes: list[str]):
    """Try the requested sizes in order (preferred first, square fallback)."""
    for size in sizes:
        out = _images_api(or_key, model, prompt, size)
        if out:
            return out
    return None


def owner_token(env: dict):
    """AIMEAT owner login → (token, owner GHII). Only needed for --upload."""
    base = os.environ.get("AIMEAT_BASE") or env.get("AIMEAT_BASE") or "https://aimeat.io"
    node = os.environ.get("AIMEAT_NODE_ID") or env.get("AIMEAT_NODE_ID") or "aimeat-finland-001-genesis"
    user = os.environ.get("AIMEAT_APP_LOGIN_USER") or env.get("AIMEAT_APP_LOGIN_USER")
    pw = os.environ.get("AIMEAT_APP_LOGIN_PASSWORD") or env.get("AIMEAT_APP_LOGIN_PASSWORD")
    if not user or not pw:
        return None
    st, resp = http_json("POST", base + "/v1/ghii/login", {"username": user, "password": pw})
    if st != 200:
        print(f"AIMEAT login failed: HTTP {st}", file=sys.stderr)
        return None
    data = resp.get("data") or {}
    token = data.get("token")
    ghii = (data.get("ghii") or {}).get("gaii") or (data.get("ghii") or {}).get("id") or f"{user}@{node}"
    return token, ghii, base


def upload_public(token: str, base: str, key: str, raw: bytes, mime: str) -> bool:
    st, resp = http_json(
        "POST",
        base + "/v1/storage",
        {"key": key, "mime_type": mime, "visibility": "public", "mode": "presigned"},
        {"Authorization": f"Bearer {token}"},
    )
    upload_url = ((resp or {}).get("data") or {}).get("upload_url") if st == 200 else None
    if not upload_url:
        print(f"    presign failed: HTTP {st}", file=sys.stderr)
        return False
    req = urllib.request.Request(upload_url, data=raw, method="PUT")
    req.add_header("Content-Type", mime)
    try:
        with urllib.request.urlopen(req, timeout=120, context=CTX) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        print(f"    PUT failed: HTTP {e.code}", file=sys.stderr)
        return False


def record_manifest(entry: dict) -> None:
    """Append one upload to genimages/uploads.json (created if missing) so later sessions know
    what was uploaded, where it lives, and how to reference it."""
    records = []
    if os.path.exists(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, encoding="utf-8") as f:
                records = json.load(f)
            if not isinstance(records, list):
                records = []
        except Exception:
            records = []
    records.append(entry)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-") or "image"


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate AIMEAT-style images into genimages/ (optional public upload).")
    ap.add_argument("prompt", nargs="*", help="the image description (omit when using --file)")
    ap.add_argument("--out", help="relative path under genimages/, no extension, e.g. icons/agent-badge")
    ap.add_argument("--file", help="batch file: one 'relative/path=prompt' per line")
    ap.add_argument("--model", help="force one OpenRouter model id (else IMAGE_MODEL / candidate list)")
    ap.add_argument("--size", default="1024x1024", help="preferred size; falls back to 1024x1024 (default 1024x1024)")
    ap.add_argument("--no-style", action="store_true", help="skip the AIMEAT house-style prefix")
    ap.add_argument("--upload", action="store_true", help="also upload PUBLIC to AIMEAT storage + record in manifest")
    ap.add_argument("--key", help="storage key for --upload (default gen.img.<slug of out path>)")
    args = ap.parse_args()

    # Build the work list: {out_relpath: prompt}
    jobs: list[tuple[str, str]] = []
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln or ln.startswith("#") or "=" not in ln:
                    continue
                rel, phrase = ln.split("=", 1)
                jobs.append((rel.strip(), phrase.strip()))
    prompt_text = " ".join(args.prompt).strip()
    if prompt_text:
        if not args.out:
            ap.error("--out is required with a positional prompt (e.g. --out icons/agent-badge)")
        jobs.append((args.out.strip(), prompt_text))
    if not jobs:
        ap.error("give a prompt with --out, or a batch --file")
    if args.key and len(jobs) > 1:
        ap.error("--key only works with a single image")

    env = read_env()
    or_key = env.get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not or_key:
        print(f"OPENROUTER_API_KEY missing — set it in {os.path.relpath(ENV_PATH, REPO)}", file=sys.stderr)
        return 1

    env_model = env.get("IMAGE_MODEL") or os.environ.get("IMAGE_MODEL")
    models = [args.model] if args.model else ([env_model] if env_model else list(MODEL_CANDIDATES))
    sizes = [args.size, "1024x1024"] if args.size and args.size != "1024x1024" else ["1024x1024"]

    auth = None
    if args.upload:
        auth = owner_token(env)
        if not auth:
            print("--upload needs AIMEAT_APP_LOGIN_USER/PASSWORD in scripts/.env", file=sys.stderr)
            return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    active_model = None
    total_cost = 0.0
    results = []
    for rel, phrase in jobs:
        # normalise the out path: strip any extension the caller added, keep the subfolder
        rel = rel.replace("\\", "/").lstrip("/")
        rel = re.sub(r"\.(png|jpg|jpeg|webp)$", "", rel, flags=re.IGNORECASE)
        print(f"[{rel}]")
        prompt = phrase if args.no_style else (HOUSE_STYLE + phrase)
        out = None
        for m in ([active_model] if active_model else models):
            out = generate(or_key, m, prompt, sizes)
            if out:
                active_model = m
                break
        if not out:
            print("    FAILED (all models)")
            results.append((rel, None, None))
            continue
        raw, mime, cost = out
        if cost:
            total_cost += cost
        ext = _IMAGE_MIMES.get(mime, "png")
        local_path = os.path.join(OUT_DIR, *rel.split("/")) + f".{ext}"
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(raw)
        rel_local = os.path.relpath(local_path, REPO).replace("\\", "/")
        print(f"    model={active_model} bytes={len(raw)} size={sizes[0]} cost={f'${cost:.4f}' if cost is not None else '?'}")
        print(f"    local={rel_local}")

        url = None
        if args.upload and auth:
            token, ghii, base = auth
            key = args.key or f"gen.img.{slugify(rel)}"
            if upload_public(token, base, key, raw, mime):
                url = f"{base}/v1/pub/{urllib.parse.quote(ghii, safe='')}/{key}"
                record_manifest({
                    "out": rel,
                    "local": rel_local,
                    "storage_key": key,
                    "url": url,
                    "account": ghii,
                    "model": active_model,
                    "size": sizes[0],
                    "mime": mime,
                    "bytes": len(raw),
                    "prompt": phrase,
                    "uploaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                })
                print(f"    public={url}")
                print(f"    key={key} account={ghii}")
        results.append((rel, rel_local, url))

    ok = sum(1 for _, p, _ in results if p)
    print(f"\ndone: {ok}/{len(jobs)} images, model={active_model}, total billed cost ~${total_cost:.4f}")
    if args.upload:
        print(f"manifest: {os.path.relpath(MANIFEST_PATH, REPO).replace(chr(92), '/')}")
    return 0 if ok == len(jobs) else 2


if __name__ == "__main__":
    sys.exit(main())
