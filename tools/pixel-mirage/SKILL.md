---
name: pixel-mirage
description: Turn a photograph into limited-palette dithered art on AIMEAT. Use when asked to dither, halftone, posterise, pixel-art, risograph, Game Boy, CGA or duotone an image, to reduce a picture to a few inks, to make a print-screen or optical-illusion version of a photo, or to compare several looks of the same photo side by side. Covers the pixel-mirage app tool (dither, variants), the 32 palettes, the 18 dither algorithms and the full recipe grammar.
---

# Pixel Mirage

A dither renderer that runs on the AIMEAT node. You send an image and a **recipe**; it sends back a
PNG built from a handful of exact colours, plus the normalised recipe so the render is reproducible.

The same engine powers the human studio at <https://pixel-mirage.apps.aimeat.io/>. A recipe tuned
there and a recipe sent here produce the same picture, so a person and an agent can hand work back
and forth without anything drifting.

## What you can call

| Tool | What it does | Price |
|---|---|---|
| `dither` | One image, one recipe, one PNG back. | 1 morsel per call |
| `variants` | One image, up to six recipes, six PNGs back for comparison. | 1 morsel per call |

```
aimeat_app_tool_invoke
  owner: "happydude500001"
  app:   "pixel-mirage.html"
  tool:  "dither"
  input: { image_base64: "data:image/jpeg;base64,...", palette: "riso-trio", algorithm: "halftone-dot", scale: 3 }
```

Buying: the tools are listed on the EXCHANGE. Accept the offering once
(`aimeat_exchange_accept`), then `aimeat_app_tool_invoke` charges each call against that contract.
The owner's own agents call it without a contract.

## Sending the image

Two channels, pick whichever costs you less.

**`image_base64`**, a `data:` URL or bare base64 of a **PNG** or **baseline JPEG**.
Ceiling: 3 MB of base64. A PNG source is additionally capped at **0.9 megapixels**, because a PNG
has to be inflated whole while a JPEG can be decoded at 1/2, 1/4 or 1/8 scale. **If your source is
large, send it as a JPEG.** That single choice is the difference between a render that completes
and one that is refused.

**`image_ref`**, `"<gaii>/<memory-key>"` of a **public** memory record holding the base64 (as a
bare string, or under `b64` / `base64` / `data`). Use this when the picture is already on the node:
it keeps a megabyte of base64 out of your context. The studio's "Publish this photo for my agent"
button writes exactly such a record and shows you the ref.

Not decodable: WebP, GIF, AVIF, progressive JPEG, interlaced (Adam7) PNG. Each is refused by name,
so you can re-encode and retry rather than guess.

## The recipe

Write recipe fields flat on the input, or nested under `recipe`. Flat wins. Every field is
optional; anything you leave out takes the default. The response echoes the **fully normalised**
recipe, so feed that back verbatim to reproduce a render exactly.

### Palette

| Field | Range | Default | Notes |
|---|---|---|---|
| `palette` | preset id, or `"auto"` | `ink-cyan` | `auto` runs median cut on the image itself |
| `colors` | 2 to 16 hex strings | none | overrides `palette` entirely |
| `colorCount` | 2 to 16 | 6 | how many inks `auto` extracts |

Two inks read as the classic optical illusion: the picture resolves at a distance and dissolves
into pure colour up close. Three or more move it into risograph, poster and pixel-art territory.

### Dither

| Field | Range | Default | Notes |
|---|---|---|---|
| `algorithm` | see the table below | `bayer4` | |
| `scale` | 1 to 24 | 2 | size of one dither cell in output pixels; for halftones this is the screen frequency |
| `strength` | 0 to 200 | 100 | how much of the pattern is applied; 0 collapses to plain nearest colour |
| `angle` | 0 to 180 | 45 | halftone screen rotation; ignored by the other families |
| `bias` | -100 to 100 | 0 | pushes the threshold light or dark |
| `serpentine` | boolean | true | error diffusion alternates direction each row |
| `pixelate` | boolean | false | average each `scale` x `scale` block first, for chunky pixel art |

### Adjust (applied before the dither)

`brightness` -100..100 (0) · `contrast` -100..100 (**20**) · `gamma` 10..300 (100 = 1.0) ·
`saturation` -100..200 (0) · `hue` -180..180 (0) · `sharpen` 0..100 (0) ·
`posterize` 0 or 2..16 (0 = off) · `invert` boolean (false)

### Frame and size

`size` 64..768 (512), the longest edge · `zoom` 100..400 (100) · `offsetX` / `offsetY` -100..100 (0) ·
`rotate` -180..180 (0) · `fit` `cover` (default) or `contain`

## Palettes

**Two inks.** `ink-cyan` `hot-magenta` `midnight-gold` `paper-red` `terminal` `amber-crt`
`blueprint` `newsprint` `riso-flame` `oxide` `mono`

**Three to six inks.** `riso-trio` `riso-quad` `sunset-strip` `vaporwave` `thermal` `ocean-depth`
`forest-floor` `sepia-five` `ash-grey` `neon-noir` `candy-shop`

**Hardware, exact.** `gameboy` `gameboy-pocket` `cga-cyan` `cga-red` `teletext` `ega` `c64`
`pico8` `zx-spectrum` `solarized`

Call the extension action `styles` (or read the studio) for the exact hex values of each.

## Algorithms

| Family | Ids | Character |
|---|---|---|
| Ordered | `bayer2` `bayer4` `bayer8` `bayer16` `spiral` | Regular grid. Graphic, retro, predictable. Coarse to fine. `spiral` clusters dots outward, like engraving. |
| Noise | `void-cluster` `white-noise` | `void-cluster` is blue-noise-like: organic film grain with no visible grid. `white-noise` is deliberately rough static. |
| Halftone | `halftone-dot` `halftone-line` `halftone-cross` | Rotatable print screens. Use `angle` and a larger `scale` (3 to 8). |
| Error diffusion | `floyd-steinberg` `jarvis` `stucki` `burkes` `sierra` `sierra-lite` `atkinson` | Detail-preserving and irregular. `atkinson` blows out highlights the way an early Macintosh did. `jarvis` / `stucki` / `sierra` are the widest and by far the slowest. |
| None | `threshold` | No dither at all. Pure posterised shapes. |

## Recipes that work

```jsonc
// Classic two-tone illusion, the app's signature look
{ "palette": "ink-cyan", "algorithm": "bayer4", "scale": 2, "contrast": 25 }

// Risograph print, three inks on cream paper, rotated dot screen
{ "palette": "riso-trio", "algorithm": "halftone-dot", "scale": 4, "angle": 30, "contrast": 30 }

// Newspaper photo
{ "palette": "newsprint", "algorithm": "halftone-dot", "scale": 3, "angle": 45, "contrast": 15 }

// Pen-and-ink shading
{ "palette": "blueprint", "algorithm": "halftone-cross", "scale": 5, "angle": 20 }

// Game Boy screenshot
{ "palette": "gameboy", "algorithm": "bayer8", "scale": 2, "pixelate": true, "size": 320 }

// Film-grain duotone with no visible grid
{ "palette": "sepia-five", "algorithm": "void-cluster", "scale": 1, "saturation": -30 }

// Early Macintosh
{ "palette": "mono", "algorithm": "atkinson", "scale": 1, "contrast": 35 }

// The photo's own colours, reduced to eight
{ "palette": "auto", "colorCount": 8, "algorithm": "floyd-steinberg" }

// Thermal camera
{ "palette": "thermal", "algorithm": "bayer16", "scale": 1, "contrast": 40, "saturation": -100 }
```

## Comparing looks: `variants`

One decode, up to six renders, one price. Every frame sees identical source pixels, which is what
makes the sheet an honest comparison.

```
tool: "variants"
input: {
  image_base64: "...",
  recipe:   { size: 320, contrast: 25 },
  variants: [
    { "label": "riso",    "palette": "riso-trio", "algorithm": "halftone-dot", "scale": 3 },
    { "label": "gameboy", "palette": "gameboy",   "algorithm": "bayer8" },
    { "label": "noir",    "palette": "neon-noir", "algorithm": "floyd-steinberg" },
    { "label": "press",   "palette": "newsprint", "algorithm": "halftone-line", "scale": 4 }
  ]
}
```

Each entry returns `{ label, overrides, image, width, height, bytes, palette, recipe, render_ms }`.
Variant output is capped at 384 px (default 288) because six renders share one time budget. Pick a
winner, then re-run `dither` at full size with that entry's `recipe`.

## Reading the response

```jsonc
{
  "image": "data:image/png;base64,...",   // pass return:"png" for bare base64
  "width": 512, "height": 286,
  "bytes": 33112,                          // the PNG is palette-indexed, so it is small
  "palette": { "id": "riso-trio", "colors": ["#fff6e8","#0050d0","#ff4d8d"], "count": 3 },
  "recipe": { /* every field, normalised, replay this to reproduce the render */ },
  "source": { "width": 688, "height": 384, "format": "jpeg" },
  "timing_ms": { "decode": 1218, "render": 1458, "encode": 132, "total": 2970 }
}
```

## Working inside the budget

The render runs in a sandbox with a hard **5 second** ceiling, and the tool prices a recipe
**before** starting it. If it will not fit you get a refusal that names the fix, for example
"needs about 3427 ms and only 2927 ms is left, set size to 560 or lower". That is a normal
outcome, not a fault. Act on it rather than retrying the same call.

What costs time, worst first:

1. **Decoding the source.** A 1 MP PNG is around 2.5 s all by itself. A JPEG of the same picture
   is a fraction of that because it decodes at reduced scale. Send JPEG.
2. **Output size.** Cost grows with the square. 768 px costs roughly 2.2x what 512 px costs.
3. **The algorithm.** `jarvis` / `stucki` / `sierra` are about twice `floyd-steinberg`, which is
   about three times `bayer4`.
4. **`sharpen`** and **`rotate`** each add a full extra pass.

A combination that always fits: a JPEG source, `size` 512, any algorithm. If you want 768 px, stay
off the wide diffusion kernels or turn `sharpen` off.

## Guidance

- **Match the palette to the picture.** A palette whose inks are all light cannot render a dark
  photograph; you will get one flat ink back and the tool will not pretend otherwise. Check
  `palette.count` against the number of inks you expected.
- **`scale` is the single strongest aesthetic control.** 1 to 2 for photographic texture, 3 to 6
  for visible print screens, 8 and up for poster graphics.
- **Sweep before you commit.** One `variants` call across four looks costs the same as one
  `dither`, and it tells you which direction is worth a full-size render.
- **The echoed `recipe` is the artefact worth keeping.** It is what lets someone else, or the
  studio, reproduce the picture months later.
