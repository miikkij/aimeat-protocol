# Portal AI Platform Icons — nanobanana2 Prompts

Image generation prompts for the 9 AI platform selector cards on the AIMEAT Onboarding Portal (`/v1/portal`).

**Target style:** 3D-rendered, soft-shaded, slightly glossy icons on a transparent background. Each ~128x128px. Palette should feel at home on a dark purple/plum UI (#0f0a14 background, pink accents #ff6b9d). Avoid flat emoji look — these should feel like polished app icons with subtle depth and lighting.

---

## 1. ChatGPT (OpenAI)

```
A friendly robot head icon, 3D rendered, soft matte finish. Dark teal body with a lighter teal visor/screen face showing two small dot eyes. Small antenna on top. Rounded corners, subtle shadow underneath. Transparent background. Icon style, centered composition, no text.
```

## 2. Claude (Anthropic)

```
A stylized brain icon, 3D rendered, soft pink and magenta tones with subtle translucency. Organic rounded shape with gentle folds and curves. Soft inner glow, slightly glossy surface. Transparent background. Icon style, centered composition, no text.
```

## 3. Microsoft Copilot

```
A four-pane window icon, 3D rendered, blue and purple gradient glass tiles arranged in a 2x2 grid. Each pane slightly different shade — blue, indigo, violet, purple. Subtle reflections and depth between panes. Rounded square frame. Transparent background. Icon style, centered composition, no text.
```

## 4. DeepSeek

```
A magnifying glass icon, 3D rendered, with a purple-blue gradient glass lens and a metallic silver handle. A small sparkle or light refraction visible in the lens. Tilted at a slight angle. Transparent background. Icon style, centered composition, no text.
```

## 5. Grok (xAI)

```
A retro-futuristic rocket ship icon, 3D rendered, white and orange body with small fins, tilted diagonally upward to the right. A pink-orange flame trail at the base. Playful proportions, slightly cartoonish. Transparent background. Icon style, centered composition, no text.
```

## 6. Gemini (Google)

```
A faceted gemstone icon, 3D rendered, brilliant cut diamond shape. Blue and cyan gradient with internal light refractions and sparkle highlights. Crystal clear with subtle rainbow caustics. Transparent background. Icon style, centered composition, no text.
```

## 7. LM Studio

```
A retro desktop computer icon, 3D rendered, with a small CRT-style monitor showing a cyan/teal code prompt on screen. A mini keyboard in front. Soft pastel blue-gray tones, slightly nostalgic feel. Transparent background. Icon style, centered composition, no text.
```

## 8. OpenClaw

```
A cute cartoon crab icon, 3D rendered, coral pink/salmon colored with two raised claws. Friendly round eyes, slightly smiling. Smooth soft-shaded surface with a playful, approachable feel. Transparent background. Icon style, centered composition, no text.
```

## 9. Other / Custom

```
A mechanical gear/cog icon, 3D rendered, matte silver-gray with subtle pink-purple accent lighting on the edges. Six-tooth gear with a smaller concentric circle in the center. Industrial but clean, slightly stylized. Transparent background. Icon style, centered composition, no text.
```

---

## Integration Notes

Once generated, save images to `aimeat/public/img/platforms/` as:
- `chatgpt.png`
- `claude.png`
- `copilot.png`
- `deepseek.png`
- `grok.png`
- `gemini.png`
- `lmstudio.png`
- `openclaw.png`
- `other.png`

Then update `portal.ts` to replace the `icon` emoji field with an `iconUrl` path, and update the card rendering to use `<img>` tags instead of emoji text.
