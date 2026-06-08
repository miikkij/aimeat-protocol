# Continuation Prompt — AIMEAT Document Workspace (Organisms → Workspace → Documents)

_Date: 2026-06-08. Branch `feat/project-core` has been **merged to `main`** (fast-forward, 24 commits, clean). Latest commit `0c1b483f`. **NOT pushed to origin** — local only._

You are continuing work on the **AIMEAT "project brain" / document-workspace** feature. The operator (`happyadmin`, see `[[dev-login-credentials]]` memory) is **frustrated** because the document editor's **Save draft** and **image upload** appear broken *for them*, while the agent's headless Playwright tests passed. **Read the "TOP PRIORITY BUG" section first and resolve it before anything else.**

---

## ⛔ TOP PRIORITY BUG (unresolved — operator is angry)

**Symptoms the operator reports (in their real browser):**
1. **"Save draft" does not save the document as a draft.** Clicking it doesn't persist / doesn't show the document as a draft in the left index.
2. **"📷 Upload image from file" button does nothing** — no file dialog appears.
3. (Earlier) pasting an image shows it in the editor but it's "not stored" on save.

**Why the previous agent's verification was misleading (do NOT repeat this mistake):**
- The agent tested via **Playwright (headless/automated Chrome)** and via `browser_evaluate` shortcuts (native value setters + dispatched `input` events), then queried the memory API and saw the doc saved. Those passed. **But the operator's real interaction fails.** The agent kept saying "fixed" — the operator (rightly) called this out.
- **The operator said they use the SAME Chrome session the agent (Playwright) drives.** THIS IS LIKELY A LARGE PART OF THE PROBLEM:
  - **Playwright intercepts file choosers.** When a `<input type=file>` opens, Playwright captures it as a "modal state" instead of showing a real OS dialog. So clicking **"Upload image from file"** in the Playwright-controlled browser → **no visible dialog → "nothing happens"** for the operator. This almost certainly explains symptom #2.
  - Playwright's automation context may interfere with other interactions too.

**What to do FIRST (don't guess, reproduce the operator's real flow):**
1. **Stop conflating the agent's automation browser with the operator's manual testing.** Ask the operator to test in a **separate, normal Chrome window** (not the one Playwright drives), OR make sure you are not driving their active session. The file-dialog interception is an artifact of the shared automated browser.
2. **Reproduce the EXACT operator flow as a real user** (not via `evaluate` shortcuts): open a document-space → **New document** → **type** a title with real keystrokes (`browser_type`, not a native setter) → type content in the WYSIWYG → **paste a real screenshot-sized image** → click **Save draft** with a real click → then **observe the left index**: does the draft appear (with the "draft" badge)? Reopen it: is the content + image there?
3. **Capture the operator's actual error.** Have them open **DevTools → Console + Network** at the moment they click Save draft / Upload, and report the failing request (status, response body) and any console error. The agent has only ever seen its own headless runs succeed — it needs the **real failure signal**.
4. **Specifically check the "doesn't SHOW as draft" path:** after `savePage` writes `organism.{id}.{namespace}.{docId}.draft`, the workspace `load()` re-reads and the index should render it under its section / "Unsorted" with a `draft` badge. Verify this actually happens in the UI (not just that the memory key exists). A doc saved to memory but not shown in the index would read as "doesn't save as draft."

**Strong hypotheses to test (in order):**
- (a) **Upload button "nothing happens"** = Playwright intercepting the file chooser in the shared browser. Fix = operator tests in a real browser window; confirm the `<label>`-wrapped input (`.pj-file-btn` in `DocumentEditor`) opens a normal dialog there.
- (b) **Save draft "doesn't save"** = unknown real failure. Candidates: the `save()` in `DocumentEditor` does `await Promise.all(pending.current)` (in-flight image uploads) before writing — if an upload **hangs/fails** the save is delayed up to the `api.js` 30s timeout (feels like "doesn't save"); OR the memory write fails for a reason only visible in the operator's Network tab; OR the save button was disabled (`disabled = busy || saving || !title.trim()`) at click time. **Get the operator's console/network output to pinpoint it.**
- (c) Possibly the doc DOES save but the **index doesn't refresh/show it** — verify the post-save `load()` + render path in the UI for real.

**Hard rule for this work:** **Do not tell the operator "it's fixed" until THEY confirm it in THEIR browser.** Verify by reproducing their flow, not your own headless shortcuts.

**Process gotcha that already burned the operator:** the dev server's cache-busting `BUILD_ID` is `Date.now()` generated at server start and only changes on restart. `spa.html` is served `no-cache`, but module URLs are stamped `?v=BUILD_ID`. **If you commit frontend changes WITHOUT restarting `pnpm dev`, the operator keeps getting cached OLD modules on reload.** → **ALWAYS `pnpm dev` (restart) after any frontend commit**, then poll `http://localhost:40050/v1/portal` for 200. (The background runner reports a spurious "failed exit 1" on the old process — ignore it, verify via the 200 poll.)

---

## What this feature is

A **workspace = an organism (`type` any) + a `meta.manifest`**. The manifest declares `objectTypes`, each either:
- **`mode: 'records'`** — schema-locked structured items (a JSON-Schema-driven form), versioned via `.draft`/`.latest`/`.version.N`.
- **`mode: 'document'`** — **free-form markdown documents** (a wiki), NOT schema-locked.

"Generic core, always": AIMEAT stores/governs via the generic memory + schema + consent APIs; no per-service backend. Documents/records are plain memory records; the manifest is an index; one convenience read `GET /v1/organisms/:id/workspace`.

**The UI lives inside the Organisms profile tab** (`public/views/profile/organisms-tab.js`), NOT a separate Projects tab. Open any organism → its workspace (if it has a manifest) or a "Set up workspace / Generate with AI" screen.

## What's built (all merged to main)

Read the **`aimeat-project-brain-phase3` memory** for the full commit-by-commit detail. Summary:
- **Phase 3/4:** manifest-format schema, project CSM bundle, gates (`gate-policy.ts`, PendingApproval), draft→publish→version.N versioning (a memory-key convention, no memory-core change; `publishDraft` now CONSUMES the draft).
- **Generator:** AI manifest generator (`POST /v1/ai/complete` + `GENERATOR_PROMPT` in `services/organisms.js`, positive-framed, one-shot JSON) + copy-prompt/paste path + `validateGenerated` + "copy fix prompt". Inline `OpenRouterSettings`. 600s per-call timeout (`api.js` `timeoutMs`/`retries`). **Works with the operator's owl-alpha key.** Example-data + date pickers.
- **Schema-driven record forms** (`SchemaForm`), **workspace settings** panel, **restructure** (additive AI re-gen) + **delete workspace** (`DELETE /v1/organisms/:id/workspace`, typed-name confirm + "are you sure" dialog).
- **Manual add/remove spaces** (Settings → Spaces; `addSpace`/`removeSpace`; agents can too via memory API).
- **Document-space sections + left index panel:** index at `organism.{id}.meta.sections.{typeName}` = `{sections:[{id,name,parentId,documents:[docId]}]}` (`getAllSections`/`saveSections`). `renderDocSpace(ot)` in organisms-tab.js: left index (section tree + docs + "Unsorted") + main pane (active doc view/edit). Add/rename(inline, blur-saves)/remove(confirm)/sub-section; **drag-and-drop** docs into sections; section "+" creates a doc filed there. **Reorder-within-section is deferred.**
- **Toast UI Editor** (MIT, vendored `public/lib/toastui/` — served locally, no CDN) lazy-loaded in `DocumentEditor` (built-in Markdown⇄WYSIWYG toggle; its own image button removed via `toolbarItems`). Falls back to a markdown textarea if it won't load.
- **`[[Document Title]]` + `[[Doc#Heading]]` wiki links** + `![](url)` images in `Markdown.js` (threaded `onWikiLink` resolver; heading anchor ids via exported `slugifyHeading`). Resolver opens the target doc + scrolls to the heading.
- **Images:** insert via the **`<label>` "📷 Upload image from file"** button OR paste/drag (Toast UI `addImageBlobHook`). Both → `blobToDataUrl` (instant editor preview) + background `uploadImage` to **private `/v1/storage`** (`organism.{id}.img.*`) + map data→storage; `save()` awaits uploads then rewrites data→storage URL so the saved markdown is `![](/v1/storage/<key>)`. The **doc VIEW** fetches `/v1/storage` images **with the session JWT** (`fetchStorageObjectUrl`) → blob URL (GET /v1/storage needs auth). Body limits: `/v1/memory` 5MB, `/v1/storage` 15MB.

## Pending / next (after the TOP PRIORITY BUG)

1. **Autosave (operator wants "store draft changes all the time, never lose them")** — a timer in `DocumentEditor` that **silently writes the markdown draft** every few seconds (awaiting uploads, no editor close, no toast) + a "Saved ✓ / Saving…" indicator. **No Yjs, no editor change.** This is the near-term win for "never lose changes."
2. **B.3 slice 2 — per-image visibility:** a badge + changer per image (like profile › memory). Needs a **NEW backend route `PATCH /v1/storage/:key/visibility`** (none exists; mirror `PATCH /v1/memory/files/:key/visibility`). Operator wants: a **public document → its images public too**.
3. **Pass C — Sources/knowledge:** own + external (other-account, read-only) **memory/storage/knowledge** listings; a **memory picker** (pick entries into the project); **knowledge-by-reference** (org stores a ref; the knowledge package is untouched; reuse `/v1/knowledge/*` + `/v1/catalogue/knowledge`).

## The Yjs / real-time multiuser vision (BIG, separate initiative)

The operator wants real-time collaborative editing + autosave, and gave references:
- Client: `E:/dev/GitHub/Spechops/src/stores/syncedProjectStore.ts` (studied) + `projectsStore.ts` — uses **`@syncedstore/core` + `y-websocket` + `yjs`**, a `WebsocketProvider` → a collaboration websocket server, with reconnect + awareness + share-token auth.
- Server (subset needed): `E:/dev/GitHub/Spechops/microservices/SpechopsSystemAgentRedux` (large/complex).
- Editor: **Quill** (`https://quilljs.com/`, **BSD-3-Clause — MIT-compatible ✓**, keep the notice) with `y-quill`; or TipTap (`y-prosemirror`). Docs: `https://docs.yjs.dev/getting-started/a-collaborative-editor#y-websocket`, `https://docs.yjs.dev/api/y.doc`, `https://github.com/yjs/yjs-demos`.

**Honest scope (Yjs is NOT in the AIMEAT stack; there is NO websocket/sync backend):** this is a multi-part initiative —
1. **Backend** y-websocket relay+persist server inside AIMEAT (auth by JWT + organism membership; persist the Y.Doc, e.g. to the memory draft).
2. **Editor swap** Toast UI → Quill+y-quill (Toast UI has no Yjs binding).
3. **Document-model decision:** documents are **markdown** today (that powers `[[links]]`, image markdown, the safe `Markdown.js` view). Yjs/Quill use a **CRDT/rich-text** model — so either store the Y.Doc and derive markdown, or rework the model. **This is a real architecture decision — scope it (a design note from the Spechops refs) before rebuilding the editor stack.** Do NOT start this blind.

## How to work here (operator's standing preferences)

- **Verify by reproducing the operator's REAL flow; never claim "fixed" without their confirmation.** (This is the #1 trust issue right now.)
- **Restart `pnpm dev` after every frontend commit** (BUILD_ID), then poll `/v1/portal` 200.
- Frontend = Preact + HTM, **no build step**, ESM; tabs in `public/views/profile/`; `t()` i18n in `locales/{en,fi}.json` (keep BOTH in sync — Rule 4); CSS in `public/css/views/profile.css` (`pj-*`/`adm-*` prefixes, theme vars, no inline styles — Rule 7). Absolute `/js|/components|/lib` imports need a `spa.html` importmap entry; relative imports are auto cache-busted.
- Identity: GHII `owner@node` vs GAII `agent#owner@node`; `resolveIdentity()`. Organism membership keyed by **bare owner name**.
- Backend = Node 24 ESM, Express 5 (`req.params` cast `as string`), SQLite + MongoDB (update BOTH). E2E: `pnpm test:e2e:sqlite` / `:mongodb` (NOT the memory backend). Lint: `pnpm lint`. OpenAPI must stay in sync (Rule 3).
- Browser-verify per CLAUDE.md Rule 1b (Playwright MCP, not the `.spec.ts` suite). See `[[frontend-browser-verify-procedure]]` memory — **but note the shared-browser file-chooser interception above.** Profile tab nav: click `.pf-side-item:has-text("Organisms")` (twice on a fresh load); list loads async.
- Don't push to origin or open PRs unless the operator asks. `main` is currently ahead of `origin/main` by the merged commits (un-pushed).

## Key files

- `public/views/profile/organisms-tab.js` — the whole workspace UI: `Workspace` component, `renderDocSpace`, `DocumentEditor` (Toast UI + image flow + `save()`), `SchemaForm`, `renderGenerator`, sections handlers.
- `public/js/services/organisms.js` — `getWorkspace`/`writeDraft`/`publishDraft`/`getAllSections`/`saveSections`/`uploadImage`/`fetchStorageObjectUrl`/`blobToDataUrl`/`generateRaw`/`applyGeneratedWorkspace`/`addSpace`/`removeSpace`/`deleteWorkspace`/`saveManifest`.
- `public/components/Markdown.js` — safe GFM renderer + `[[wiki]]`/`![img]` + `slugifyHeading`.
- `public/lib/toastui/` — vendored Toast UI Editor (MIT).
- `src/routes/organisms.ts` — workspace read, publish/gates/approvals, `DELETE /:id/workspace`, `memberRole`/`canWriteNamespace`/`publishDraft`.
- `src/services/{manifest-schema,gate-policy,template-bundles}.ts`; `src/routes/storage-files.ts` (`/v1/storage`); `src/server.ts` (body-limit middleware).
