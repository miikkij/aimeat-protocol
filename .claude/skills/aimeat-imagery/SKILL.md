---
name: aimeat-imagery
description: How images for AIMEAT are produced with scripts/gen_image.py instead of stock or placeholder art, including the upload log to check before regenerating. Use whenever a task needs an app icon, banner, hero graphic, illustration, logo, og-image or any other picture.
---

# Generating imagery

No stock, clip-art or placeholder images. When a task needs a picture, generate a proper AIMEAT-quality one with `scripts/gen_image.py`.

```bash
python scripts/gen_image.py --out icons/agent-badge "a glowing AI agent badge, coral-red accent"
python scripts/gen_image.py --out banners/hero --size 1344x576 "wide hero banner for the CADENCE CRM app"
python scripts/gen_image.py --out app/logo --upload "the DROP app logo, minimal geometric mark"
```

- **Config** is `scripts/.env` (copy from `scripts/.env.example`): `OPENROUTER_API_KEY` + `IMAGE_MODEL`. The capability activates only when that key is set. If it is not, tell the developer rather than falling back to a placeholder.
- **Check `genimages/uploads.json` before generating.** Every `--upload` is logged there with URL, storage key, account GHII, model and prompt. Reuse an already-uploaded image instead of paying for it twice.
- **Output** lands in `genimages/<subfolder>/` (gitignored). Pick the subfolder by where the image is headed. Then either copy the chosen file into the project (`public/`, an app bundle, `aimeat-desktop/.../icons`) or `--upload` it to AIMEAT storage for apps to reference by URL.
- **House style** is applied automatically (`HOUSE_STYLE` in `scripts/gen_image.py`). Pass `--no-style` only when a specific look demands it. The default leans flat vector, not 3D render.

  **Bright, warm and alive is the house style, and it is not negotiable by drift.** Light ground, vivid coral-red `#E8564A`, warm sunlit support, high contrast, a sense of motion. Darks are for outlines and type, never for the background.

  This is written down because the opposite was: the style string used to name "deep near-black #0E1116" and "cool neutral slate grays", every model obliged, and the result was a year of dark, lifeless, interchangeable images that were each technically on-brand. Jouni's words on 2026-08-16: tired of images that are gloomy and lifeless. If an image needs a dark ground, the CALLER asks for it in the subject; the house style never supplies one unasked.

  Look at what you generated before you ship it. `Read` the file. A prompt that says "bright" and a picture that is not are two different things, and only one of them is what the person gets.
