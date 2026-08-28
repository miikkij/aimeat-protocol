---
name: aimeat-video
description: How AIMEAT videos are made from live captures and existing recordings with the three tools in aimeat/scripts/demo-video/ (a scripted performer, a passive camera, and a stills-plus-cards cutter), including the capture rules, the card style, the honesty captions and the YouTube hand-off. Use whenever a task is to make, re-cut, extend or publish a demo, pitch, ad or social video of AIMEAT.
---

# Making a video of AIMEAT

Every video here shows the production node with real data. Nothing is mocked and no slide is
re-narrated: the deck says what is claimed, the video shows it moving. Three tools cover the
three kinds of footage, and all three live in `aimeat/scripts/demo-video/`, which is gitignored
on purpose (marketing tooling, plus login paths). They exist on Jouni's machine; a fresh clone
does not have them.

| You need | Tool | Output |
|---|---|---|
| A browser DOING things, scripted step by step (register, build a board, buy a listing) | `record.mjs` + `cut.mjs` with a `scenes.<name>.json` manifest | `genimages/videos/<name>/<name>.mp4` + `<name>.marks.json` |
| A browser WATCHING things happen that someone else does (an agent over MCP, a scheduled job) | `watch.mjs --url=… --seconds=… --name=…` | same, plus `live/NNNN.png` every 5 s |
| A cut from stills and existing clips with narrator cards (pitch, overview, montage) | `stills/render_cards.py` + `stills/build.py` on a project folder with `cut.json` | `genimages/videos/<project>/out/<name>.mp4` |

`aimeat/scripts/demo-video/README.md` documents the manifest step types for the performer;
`genimages/videos/mainos/README.md` is the worked example of an ad cut from generated clips;
`genimages/videos/pitch2026/cut.json` is the worked example of a stills cut (the Maria01 pitch
video, ten scenes, 2:56).

## Before the first capture

- **ffmpeg on PATH, Python with Pillow, and for the performer `@playwright/test`** (already a
  devDep in `aimeat/`; run its scripts from `aimeat/` so it resolves).
- **Signed-in state for the performer and the camera:** `node scripts/demo-video/_login-state.mjs`
  (from `aimeat/`). It reads `docs/internal/prod-login-happydude500001.json`, signs in on
  aimeat.io and on the ORIGAMI origin, and writes `genimages/videos/_state/prod-owner-state.json`,
  which every `scenes.*.json` points at. The ORIGAMI session is bridge-based and goes stale;
  re-run this before a shoot rather than debugging a stale state.
- **Stills are captured with the Playwright MCP server** in a 1920×1080 viewport
  (`browser_resize` first). Sign in through the app's own Sign In button: it opens the
  app-grant page on aimeat.io, and the credentials go into `#aimeat-username` /
  `#aimeat-password` there. Apps on their own subdomains share that session afterwards.
- **A capture lands in the repo root by default.** Move it into the project's `src/` at once;
  no scratch files stay in the root.

## Capture rules, each one paid for

1. **Go inside and use the app before the shot.** A landing page, a sign-in gate or an empty
   canvas is a wasted frame. FreePartyLights is filmed with a preset loaded and playing; Band
   Jam with a room created and the studio open; AGENCY with an agent selected so its run history
   fills the pane; UNIVERSE inside a world, never the world list; AIMEAT Pages with an organism
   picked; SUUNTA on the map, the matrix, the analyses and the proposals, not the cover.
2. **Capture moving things mid-motion.** A screenshot taken after a ten-second effect has run
   to its end is black. Start the effect, then screenshot within a second or two.
3. **Full-page screenshots are the raw material for scrolls** (`fullPage: true`); the cutter
   pans them at a constant 280 px/s. Viewport screenshots become slow push-ins.
4. **What may not appear:** Innokas by name (ARCHIMATE's model list carries it; open the
   Verso Medical example instead), any organism or company that is not Jouni's own in a
   selector list (WithSecure, Vastuu Group, HeroPlay names in AIMEAT Pages), CADENCE with real
   customer rows, and admin pages that list people's names or e-mails (use compliance,
   statistics and federation). SUUNTA's competitor matrix is shown only when Jouni says so for
   that video.
5. **His own e-mail is on some surfaces** (hatchery cockpit top bar, M-ROOM deliver panel). Say
   so in the report and let him decide whether to crop.
6. **Clips come from the clean masters** in `genimages/videos/<name>/<name>.mp4`. The copies in
   `assets/video/` carry burned captions that collide with new cards. `captions.ass` and
   `<name>.marks.json` next to a master give exact timecodes without watching it.
7. **Anything that would spend money is asked first**: Band Jam's "Compose whole song" and any
   other AI action on Jouni's key.

## The cards

Narrator text is on cards, not in a voice-over, unless a voice is asked for. One thought per
card, at most about ten words, at least three seconds on screen, DM Sans Medium in coral on a
paper plate in the lower third. Corner captions (JetBrains Mono, indigo, top right) carry the
honesty marks: `recorded in July` on archive footage, `overnight, compressed` and `time jump`
where time is cut. Every time jump and every piece of older footage gets one; that is the same
rule the decks follow. The end card is the AIME♥AT wordmark over the domain on paper.

A number on a card is the number on the deck the viewer also has, read from `/v1/stats` or the
deck itself the same day: the pitch cut said "165 apps" while the deck said "130+" and had to be
rebuilt. Writing rules apply to card text like any other prose (`aimeat-writing`): no
em-dashes in Finnish, no grand pronouncements, no negative parallelism.

## Cutting a stills project

```
genimages/videos/<project>/
  cut.json     scenes, cards, corner captions, placeholders, clip sources
  src/         captures (viewport and full-page PNGs)
  cards/       rendered by render_cards.py
  tmp/         one mp4 per segment and per scene
  out/         <name>.mp4
```

```bash
python aimeat/scripts/demo-video/stills/render_cards.py genimages/videos/<project>
python aimeat/scripts/demo-video/stills/build.py genimages/videos/<project>          # whole cut
python aimeat/scripts/demo-video/stills/build.py genimages/videos/<project> --scene 07
```

Segment kinds in `cut.json`: `zoom` (viewport still, slow push-in), `scroll` (full-page still,
constant-speed pan), `clip` (`from`/`to` seconds out of a named clip, fitted on ink), `endcard`.
Cards are `[name, start, end]` in scene seconds with 0.4 s fades. A missing capture falls back
to the scene's placeholder, so the cut is watchable at every stage and one capture can be
replaced by dropping a file into `src/` and running `build.py` again.

## Verifying a cut

`build.py` prints duration, frame count and the planned total; they must agree. Then pull
frames at the scene boundaries and at every card and look at them:

```bash
ffmpeg -y -hide_banner -loglevel error -ss 110 -i out/<name>.mp4 -frames:v 1 tmp/check_110.png
```

Check for a burned caption colliding with a card, a black canvas, a scroll that ran past the
page, and a card whose number differs from the deck. The `.playwright-mcp` snapshot of a page is
not a check of the frame; only the frame is.

## Publishing

Masters stay gitignored. A clip that goes into the README is re-encoded into `assets/video/`
(`-c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -an -movflags +faststart`; the faststart
is what lets GitHub stream it). YouTube: unlisted by default, because a cut can carry the
competitor matrix, personal e-mail and numbers that age; visibility can be raised later on the
same link. "Set as instant Premiere" stays off, since a juror opening the link wants the video,
not a waiting room. The description names what is on screen, states that everything is the
production node with real data and that time jumps are marked, and ends with the two links
(aimeat.io, the GitHub repo); `assets/video/youtube-metadata.md` holds the house-style
descriptions of the three published clips. The 30 MB chat upload limit means the file is handed
over by path, not attached.

## Reporting

Findings and leftovers are labelled, and the leftovers are the owner's decisions: which stills
deserve a real OBS take, whether an e-mail on screen is cropped, whether a paid AI action gets
run to fill an empty editor, and the upload itself.
