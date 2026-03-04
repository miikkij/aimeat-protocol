# AIMEAT Desktop Icons

## Source

- `icon.svg` -- the AIMEAT brand icon (heart + circuit motif, 512x512)

## Development Placeholders

The PNG, ICO, and ICNS files in this directory are development placeholders
generated from a pixel-level renderer (no external dependencies required).

To regenerate them:

```bash
node icons/generate-dev-icons.mjs   # PNGs (all sizes)
node icons/generate-ico.mjs         # icon.ico (Windows)
node icons/generate-icns.mjs        # icon.icns (macOS)
```

## Production Icons

For production-quality icons rendered from the SVG, use Tauri's built-in tool:

```bash
cargo tauri icon icons/icon.svg
```

This will generate all required sizes from the SVG source with proper
anti-aliasing and quality.

Alternatively, with `sharp` installed:

```bash
npm install -g sharp-cli
sharp -i icons/icon.svg -o icons/icon.png resize 256 256
sharp -i icons/icon.svg -o icons/32x32.png resize 32 32
sharp -i icons/icon.svg -o icons/128x128.png resize 128 128
sharp -i icons/icon.svg -o icons/128x128@2x.png resize 256 256
```

## File Inventory

| File | Size | Purpose |
|------|------|---------|
| `icon.svg` | 512x512 | Source icon |
| `32x32.png` | 32x32 | Small icon (taskbar, etc.) |
| `128x128.png` | 128x128 | Medium icon |
| `128x128@2x.png` | 256x256 | Retina medium icon |
| `icon.png` | 256x256 | Tray icon |
| `icon.ico` | multi | Windows icon (32+128+256) |
| `icon.icns` | multi | macOS icon bundle |
| `Square*.png` | various | Windows UWP tile icons |
| `StoreLogo.png` | 50x50 | Windows Store logo |
