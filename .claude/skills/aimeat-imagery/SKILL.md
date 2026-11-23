---
name: aimeat-imagery
description: How the repository's own and marketing images for AIMEAT are produced with scripts/gen_image.py instead of stock or placeholder art, including the upload log to check before regenerating. Use when a task in this repo needs a picture for the node's own screens, the desktop app's icons, the README or docs, a deck, an og-image or a banner. Not for the pictures of an app built on the node, which the node generates.
---

# Generating imagery

No stock, clip-art or placeholder images. When a task needs a picture, generate a proper AIMEAT-quality one.

**Which way depends on where the picture goes.**

- **The repository and marketing** (the node's own screens under `aimeat/public/`, the desktop app's icons, the README and `docs/`, decks, og-images, banners): `scripts/gen_image.py`, below. It runs on the developer's machine with the developer's own key.
- **An app built on the node** (its icon, its pictures, the images it makes for its users): the node generates them with `aimeat_image_generate`, as the Atelier build spec says, so the image is billed to the app's owner and has the node's provenance record. Never use this script or the developer's key for an app's pictures.

```bash
uv run python scripts/gen_image.py --out icons/agent-badge "a glowing AI agent badge, coral-red accent"
uv run python scripts/gen_image.py --out banners/hero --size 1344x576 "wide hero banner for the front page"
uv run python scripts/gen_image.py --out desktop/logo --upload "the AIMEAT desktop logo, minimal geometric mark"
```

- **Config** is `scripts/.env` (copy from `scripts/.env.example`): `OPENROUTER_API_KEY` + `IMAGE_MODEL`, and for `--upload` also `AIMEAT_APP_LOGIN_USER` + `AIMEAT_APP_LOGIN_PASSWORD`. There is no `python` on PATH on the developer's machines, so every command goes through `uv run python`. The capability activates only when that key is set. If it is not, tell the developer rather than falling back to a placeholder.
- **Check `genimages/uploads.json` before generating.** Every `--upload` is logged there with URL, storage key, account GHII, model and prompt. Reuse an already-uploaded image instead of paying for it twice.
- **Output** is written to `genimages/<subfolder>/` (gitignored). Pick the subfolder by where the image is headed. Then either copy the chosen file into the project (`public/`, `aimeat-desktop/.../icons`) or `--upload` it to AIMEAT storage for a page to reference by URL.
- **House style** is applied automatically (`HOUSE_STYLE` in `scripts/gen_image.py`). Pass `--no-style` only when a specific look demands it. The default leans flat vector, not 3D render.

  **Bright, warm and alive is the house style, and it is not negotiable by drift.** Light ground, vivid coral-red `#E8564A`, warm sunlit support, high contrast, a sense of motion. Darks are for outlines and type, never for the background.

  This is written down because the opposite was: the style string used to name "deep near-black #0E1116" and "cool neutral slate grays", every model obliged, and the result was a year of dark, lifeless, interchangeable images that were each technically on-brand. Jouni's words on 2026-08-16: tired of images that are gloomy and lifeless. If an image needs a dark ground, the CALLER asks for it in the subject; the house style never supplies one unasked.

  Look at what you generated before you ship it. `Read` the file. A prompt that says "bright" and a picture that is not are two different things, and only one of them is what the person gets.
