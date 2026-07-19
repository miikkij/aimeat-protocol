# `scripts/`

Local developer utilities for the AIMEAT repo. Standalone, stdlib-only Python — no `pip install`,
no venv required.

## `gen_image.py` — the AIMEAT image generator

Whenever an image is needed — an app icon, a banner, a hero graphic, an illustration, an og-image —
generate a proper **AIMEAT-quality** one instead of shipping a bland placeholder. This is
[**Rule 12**](../CLAUDE.md) in the project instructions: no stock/clip-art/placeholder junk, ever.

It renders a text description via an OpenRouter image model, applies the AIMEAT house style
(coral-red `#E8564A` + slate/near-black, premium/geometric), and saves the result under
`genimages/<subfolder>/` (gitignored). Optionally it uploads the image public to AIMEAT storage so
apps can reference it by URL.

Lineage: adapted from crewfive's `ec_image_gen.py` / `lingua_image_gen.py` (same OpenRouter
unified-image API, BFL moderation retry, and AIMEAT presigned-upload logic), generalised into a
reusable "give me a picture of X, put it here" tool.

### Setup

```bash
cp scripts/.env.example scripts/.env
# then edit scripts/.env and set OPENROUTER_API_KEY (+ optionally IMAGE_MODEL)
```

`scripts/.env` is **gitignored** — it holds secrets, never commit it. The generator's capability is
**inactive until `OPENROUTER_API_KEY` is set**; with no key it exits with a clear message rather
than producing anything.

`scripts/.env` keys:

| Key | Required | Purpose |
|-----|----------|---------|
| `OPENROUTER_API_KEY` | yes | Image generation. Get one at <https://openrouter.ai/keys>. |
| `IMAGE_MODEL` | no | The model to use. Unset → tries a built-in candidate list (flux.2-pro → gemini-2.5-flash-image → seedream-4.5). |
| `AIMEAT_APP_LOGIN_USER` / `AIMEAT_APP_LOGIN_PASSWORD` | only for `--upload` | Owner login; uploaded files land under this owner's GHII. |
| `AIMEAT_BASE` | no | Default `https://aimeat.io`. |
| `AIMEAT_NODE_ID` | no | GHII fallback suffix, default `aimeat-finland-001-genesis`. |

### Usage

Run from the **repo root**:

```bash
# single image → genimages/icons/agent-badge.png
python scripts/gen_image.py --out icons/agent-badge "a glowing AI agent badge, coral-red accent"

# wide banner (falls back to 1024x1024 if the model rejects the size)
python scripts/gen_image.py --out banners/hero --size 1344x576 "wide hero banner for the CADENCE CRM app"

# skip the house style for a specific look
python scripts/gen_image.py --out misc/thing --no-style "a photorealistic ..."

# generate AND upload public to AIMEAT storage → prints the /v1/pub URL, logs it to the manifest
python scripts/gen_image.py --out app/logo --upload "the DROP app logo, minimal geometric mark"

# batch: one 'relative/path=prompt' per line
python scripts/gen_image.py --file scripts/my-images.txt
```

### Flags

| Flag | Meaning |
|------|---------|
| `--out PATH` | Relative path under `genimages/`, **no extension** (e.g. `icons/agent-badge`). The subfolder is yours to choose — pick it by where the image is headed. Required with a positional prompt. |
| `--file FILE` | Batch file, one `relative/path=prompt` per line (`#` comments allowed). |
| `--size` | Preferred size (default `1024x1024`); non-square sizes fall back to `1024x1024` automatically. |
| `--model` | Force one OpenRouter model id (overrides `IMAGE_MODEL`). |
| `--no-style` | Skip the AIMEAT house-style prefix. |
| `--upload` | Also upload public to AIMEAT storage and record it in the manifest. |
| `--key` | Storage key for `--upload` (default `gen.img.<slug of out path>`). Single image only. |

### Where images go

- **Local:** `genimages/<--out>.<ext>` (png/jpg/webp per what the model returns). The whole
  `genimages/` tree is gitignored — it's a scratch area, not committed.
- **Into the project:** copy the file you want into its real home (`public/`, an app bundle,
  `aimeat-desktop/.../icons`, …). Those tracked locations are committed as normal.
- **For apps:** `--upload` PUTs the image to AIMEAT storage as a public file and prints a
  `https://aimeat.io/v1/pub/<ghii>/<key>` URL the app can reference directly.

### The upload manifest — `genimages/uploads.json`

Every `--upload` appends a record so a later session knows exactly what exists, where it lives, and
how to reference it — **read it before regenerating** so an already-uploaded image is reused instead
of paid for twice.

```json
[
  {
    "out": "app/logo",
    "local": "genimages/app/logo.png",
    "storage_key": "gen.img.app-logo",
    "url": "https://aimeat.io/v1/pub/alice%40aimeat-finland-001-genesis/gen.img.app-logo",
    "account": "alice@aimeat-finland-001-genesis",
    "model": "black-forest-labs/flux.2-pro",
    "size": "1024x1024",
    "mime": "image/png",
    "bytes": 128374,
    "prompt": "the DROP app logo, minimal geometric mark",
    "uploaded_at": "2026-07-19T14:22:03Z"
  }
]
```

### Cost

OpenRouter bills per image at generation time (FLUX.2 Pro has roughly a `$0.03` floor per image;
Gemini flash-image is cheaper). Each run prints the billed cost reported by OpenRouter. Generate
deliberately, not in bulk-speculation.
