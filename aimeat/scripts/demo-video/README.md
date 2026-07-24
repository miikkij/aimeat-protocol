# Demo-video harness (PoC)

Scripted, repeatable **vertical (9:16) product demo videos** of AIMEAT, driven by a real
browser and composed with ffmpeg. Aimed at social clips (LinkedIn, Reels, Shorts).

Nothing here touches the app or the protocol — it is a marketing-asset tool, sibling to
`scripts/gen_image.py`. Output lands in the gitignored `genimages/videos/<name>/`.

## Requirements

- The dev server running on `http://localhost:40050` (see below).
- `@playwright/test` + Chromium (already in `aimeat/` devDeps) and **ffmpeg** on PATH.

## Usage

```bash
# from aimeat/  (so @playwright/test resolves)
node scripts/demo-video/make.mjs scripts/demo-video/scenes.register.json
# -> genimages/videos/register/register.mp4   (1080x1920, H.264)
```

Or the two stages separately:

```bash
node scripts/demo-video/record.mjs  scripts/demo-video/scenes.register.json   # -> register.webm
node scripts/demo-video/compose.mjs scripts/demo-video/scenes.register.json   # -> register.mp4
```

## How it works

- **record.mjs** launches Chromium at a mobile viewport (432x768, `locale: fi-FI` so the whole
  UI renders in Finnish), records the session to a `.webm`, and injects an overlay: a visible
  red cursor with click ripples and a bottom **caption bar** synced to the steps. Because
  Playwright records at CSS-pixel resolution, the webm is captured at the viewport size and
  **compose.mjs upscales it** to the final 1080x1920 (same 9:16 aspect).
- **compose.mjs** (pure ffmpeg): webm -> mp4 (H.264, yuv420p, faststart), optional `intro`/`outro`
  title cards, and an optional looped background `music` track with a fade-out.
- **make.mjs** just runs both.

## Scene manifest

A JSON file describes the shoot declaratively (see `scenes.register.json`). Top-level:
`name`, `baseUrl`, `locale`, `viewport {width,height}`, `output {width,height}`, optional
`intro`/`outro` `{title,subtitle,seconds,bg}`, optional `music` (path) + `musicVolume`, and
`scenes[]`. Each scene is `{ label, steps[] }`. Step types:

| type | fields | does |
|------|--------|------|
| `goto` | `path` | navigate + let the SPA mount |
| `caption` | `title`, `subtitle` | show the synced caption bar |
| `captionHide` | | fade the caption out |
| `wait` | `ms` | pause (pacing) |
| `waitFor` | `selector`, `ms` | wait for an element |
| `click` | `selector` \| `text` \| `role`+`name` | move cursor, ripple, click |
| `type` | `selector`/`text`, `text`, `delayMs` | click a field and type |
| `hover` | `selector` | move the cursor over an element |
| `scroll` | `selector` or `byPx` | smooth scroll |
| `press` | `key` | keyboard key |

Prefer stable ids for selectors. The sign-in modal uses `#aimeat-username`,
`#aimeat-password`, `#aimeat-displayname`, submit `#aimeat-go-btn`.

## Notes

- Captions/UI copy follow the house copy rules: no em-dashes, functional glyphs only.
- The `register` demo registers a throwaway account. On the **dev** node, dev-mode
  wipe-on-duplicate lets the same username be re-used every run, so the demo is repeatable.
- **Match production:** aimeat.io REQUIRES an email at registration. Start the dev server
  with `AIMEAT_EMAIL_CONFIRMATION_REQUIRED=true` so the recorded flow shows the real email
  step (username/password -> email -> "we sent you a 6-digit code"). Without an SMTP host the
  code is never delivered, so the demo truthfully ends at the "check your email" screen.
- App i18n bug found + fixed while recording: the sign-in modal's "correct the language" reload
  short-circuited when opts.i18n's signInBtn/descNew matched, so newer keys the host's opts.i18n
  predated (the email-step strings, "Jatka Casdoorilla") stayed on their English fallbacks. Fixed
  in `src/static/sdk-libs/auth/modal.js` (adopt the node's full dict when ANY key differs) +
  `pnpm build:sdk`. This is a real product fix, not video-only.
- Voiceover is not generated here (no local TTS); add narration in post if wanted.
- To localize to English, set `locale: "en-US"` and translate the caption strings (the modal
  field ids are language-independent, so selectors keep working).
