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
- **House style** (coral-red `#E8564A` with slate/near-black, premium and geometric) is applied automatically. Pass `--no-style` only when a specific look demands it. The default leans flat vector, not 3D render.
