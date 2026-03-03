# Prompt Troubleshooting Instructions — Update Plan

**Date:** 2026-03-03  
**Status:** Draft  
**Goal:** Add user-friendly troubleshooting/debugging guidance to ALL user-facing prompts where users copy a prompt and get back an HTML app or downloadable artifact. If something doesn't work, the user should know how to report the issue back to the AI, so the AI can fix and retry.

---

## Scope

**IN SCOPE — Prompts that generate apps/artifacts for users (anonymous + dev):**
These are the prompts where a user copies text, pastes it to an AI chat, gets an HTML file back, and opens it in a browser. If the app doesn't work, the user needs to know what to do.

**OUT OF SCOPE — Agent prompts (Tier 1+, OpenClaw, MCP integrations):**
Agent-level prompts (like system prompts for registered agents) do NOT need this update — agents and tools like OpenClaw are expected to handle debugging autonomously.

---

## What to Add

Every affected prompt needs a **troubleshooting block** appended at the end, right after the "download/save the file" instruction. The block should instruct the AI to:

1. Tell the user the file is ready and how to open it
2. Tell the user: **"If it doesn't work, let me know and we'll figure it out together"**
3. Guide the user to check the browser console for errors (F12 → Console)
4. Tell the user to copy-paste the error messages back to the AI chat
5. The AI should then analyze the error, fix the code, and provide an updated file

### Template Text (English)

```
## If Something Doesn't Work

After giving the user the download link or HTML file, always add this message:

"If the app doesn't work as expected or you see errors, don't worry — tell me what happened and we'll fix it together!

Here's how to check for errors:
1. Open the app in your browser
2. Press F12 (or right-click → Inspect) to open Developer Tools
3. Click the 'Console' tab
4. If you see red error messages, copy them and paste them here
5. I'll analyze the errors and give you a fixed version

Even if you don't see console errors — just describe what's wrong (e.g. 'the button doesn't do anything', 'I see a blank page', 'the data doesn't save') and I'll investigate."
```

### Template Text (Finnish)

```
## Jos jokin ei toimi

Latauslinkin tai HTML-tiedoston antamisen jälkeen lisää aina tämä viesti:

"Jos sovellus ei toimi odotetusti tai näet virheitä, ei hätää — kerro minulle mitä tapahtui, niin selvitetään asia yhdessä!

Näin tarkistat virheet:
1. Avaa sovellus selaimessa
2. Paina F12 (tai oikea klikkaus → Tutki elementtiä) avataksesi kehittäjätyökalut
3. Klikkaa 'Console' / 'Konsoli' -välilehteä
4. Jos näet punaisia virheilmoituksia, kopioi ne ja liitä ne tänne
5. Analysoin virheet ja annan sinulle korjatun version

Vaikka et näkisi konsolivirheitä — kuvaile vain mikä menee pieleen (esim. 'nappi ei tee mitään', 'näen tyhjän sivun', 'data ei tallennu') niin tutkin asian."
```

---

## Files to Update

### 1. `aimeat/src/routes/portal-human.ts` — App Builder Prompts (8 categories)

**Location:** `prompts` object in the JavaScript section (~line 1754–1879)  
**What:** Each category prompt ends with `baseEnd`. The troubleshooting block should be appended after `baseEnd`.

**Change:** Update the `baseEnd` variable to include the troubleshooting instruction:

```javascript
// BEFORE:
var baseEnd = '\\nMake the HTML a downloadable file. This is a live API — the URLs work right now.';

// AFTER:
var baseEnd = '\\nMake the HTML a downloadable file. This is a live API — the URLs work right now.' +
  '\\n\\n## If Something Doesn\\'t Work\\n' +
  'After giving the user the download link or HTML file, always add this message:\\n' +
  '"If the app doesn\\'t work as expected or you see errors, don\\'t worry — tell me what happened and we\\'ll fix it together!\\n\\n' +
  'Here\\'s how to check for errors:\\n' +
  '1. Open the app in your browser\\n' +
  '2. Press F12 (or right-click → Inspect) to open Developer Tools\\n' +
  '3. Click the \\'Console\\' tab\\n' +
  '4. If you see red error messages, copy them and paste them here\\n' +
  '5. I\\'ll analyze the errors and give you a fixed version\\n\\n' +
  'Even if there are no console errors — just describe what\\'s wrong (e.g. \\'the button doesn\\'t do anything\\', \\'I see a blank page\\', \\'the data doesn\\'t save\\') and I\\'ll investigate."';
```

**Affected prompts (all inherit via `baseEnd`):**
- `games` — Multiplayer game builder  
- `notes` — Note-taking app  
- `trackers` — Habit/expense tracker  
- `family` — Shared family tools  
- `creative` — Drawing/art tools  
- `custom` — Free-form custom app

**NOTE:** The `games` prompt does NOT use `baseEnd` — it has its own inline ending. That one must be updated separately.

---

### 2. `aimeat/src/routes/portal.ts` — Prompt Package (Tier D platforms)

**Location:** `buildPromptPackage()` function (~line 114–333)  
**What:** The "After Generating the HTML" section at the bottom of the prompt.

**Change:** Add the troubleshooting section after the existing step 5 ("You can also upload this app…"):

```
### After Generating the HTML
Tell the user:
1. "Save this as a file, for example: my-aimeat-app.html"
2. "Open it in your web browser (Chrome, Firefox, Edge)"
3. ...existing steps...

### If Something Doesn't Work
Always add this after the download instructions:
"If the app doesn't work as expected or you see errors, don't worry — tell me what happened and we'll fix it together!
...the full troubleshooting block..."
```

---

### 3. `aimeat/src/routes/portal-human.ts` — Memory Save Instruction

**Location:** Memory card's copy-instruction block (~line 1300–1310)  
**What:** The instruction the user copies to save data to memory.

**Assessment:** This is a simpler instruction (just saving to memory, not building a full app). A shorter troubleshooting note could be added, like: "If you get an error, paste the error message here and I'll help fix it."

**Priority:** Low — memory save is simple and less likely to fail than full app generation.

---

### 4. `aimeat/src/routes/prompts.ts` — Anonymous Share Prompt

**Location:** Share prompt at `/v1/prompts/anonymous/share` (~line 251–300)  
**What:** The prompt another AI gets when invited to the node.

**Assessment:** This is an agent-to-agent prompt (AI reads the URLs and uses them directly). The AI should handle its own errors. **No change needed** — this is an agent prompt, not a user-facing app builder.

---

### 5. `aimeat/locales/en.json` + `aimeat/locales/fi.json` — i18n Strings

**What:** If the troubleshooting text should be translatable (recommended), add i18n keys.

**New keys to add:**

```json
// en.json
{
  "cards": {
    "apps": {
      "troubleshootingTitle": "If Something Doesn't Work",
      "troubleshootingBody": "If the app doesn't work as expected or you see errors, don't worry — tell me what happened and we'll fix it together!\n\nHere's how to check for errors:\n1. Open the app in your browser\n2. Press F12 (or right-click → Inspect) to open Developer Tools\n3. Click the 'Console' tab\n4. If you see red error messages, copy them and paste them here\n5. I'll analyze the errors and give you a fixed version\n\nEven if there are no console errors — just describe what's wrong (e.g. 'the button doesn't do anything', 'I see a blank page', 'the data doesn't save') and I'll investigate."
    }
  }
}
```

```json
// fi.json
{
  "cards": {
    "apps": {
      "troubleshootingTitle": "Jos jokin ei toimi",
      "troubleshootingBody": "Jos sovellus ei toimi odotetusti tai näet virheitä, ei hätää — kerro minulle mitä tapahtui, niin selvitetään asia yhdessä!\n\nNäin tarkistat virheet:\n1. Avaa sovellus selaimessa\n2. Paina F12 (tai oikea klikkaus → Tutki elementtiä) avataksesi kehittäjätyökalut\n3. Klikkaa 'Console' / 'Konsoli' -välilehteä\n4. Jos näet punaisia virheilmoituksia, kopioi ne ja liitä ne tänne\n5. Analysoin virheet ja annan sinulle korjatun version\n\nVaikka et näkisi konsolivirheitä — kuvaile vain mikä menee pieleen (esim. 'nappi ei tee mitään', 'näen tyhjän sivun', 'data ei tallennu') niin tutkin asian."
    }
  }
}
```

**Priority:** Medium — if portal-human.ts uses i18n for the prompts (it currently doesn't for app prompts — they're hardcoded in JS). Could be done as a follow-up to move app prompts into i18n.

---

## Summary Table

| # | File | Section | Change Type | Priority |
|---|------|---------|-------------|----------|
| 1 | `aimeat/src/routes/portal-human.ts` | `baseEnd` variable (6 app categories) | Extend `baseEnd` with troubleshooting text | **High** |
| 1b | `aimeat/src/routes/portal-human.ts` | `games` prompt (standalone ending) | Add troubleshooting after game-specific ending | **High** |
| 2 | `aimeat/src/routes/portal.ts` | `buildPromptPackage()` "After Generating" | Add troubleshooting section | **High** |
| 3 | `aimeat/src/routes/portal-human.ts` | Memory save instruction | Add short error-paste note | Low |
| 4 | `aimeat/src/routes/prompts.ts` | Anonymous share prompt | **No change** — agent prompt | N/A |
| 5 | `aimeat/locales/en.json` + `fi.json` | New i18n keys for troubleshooting | Add translatable strings | Medium |

---

## Implementation Order

1. **Update `baseEnd`** in portal-human.ts — this covers 5 of 6 app builder categories in one change
2. **Update `games` prompt** in portal-human.ts — fix the one category that doesn't use `baseEnd`
3. **Update `buildPromptPackage()`** in portal.ts — covers Tier D prompt package
4. **(Optional)** Add i18n keys to locales
5. **(Optional)** Add short note to memory save instruction
6. **Test:** Run `npx tsc --noEmit` to verify builds clean
7. **Test:** Open portal pages in browser and verify copy functionality still works

---

## Testing Checklist

- [ ] `pnpm build` succeeds
- [ ] Dev portal (`/v1/portal`) → Prompt Package panel → copied text includes troubleshooting block
- [ ] Human portal (`/v1/portal/human`) → each app category → copied prompt includes troubleshooting block
- [ ] Troubleshooting text appears AFTER the download instruction, not before
- [ ] Copy-to-clipboard still works correctly (no JS escaping issues)
- [ ] The troubleshooting text renders cleanly when pasted into ChatGPT/Claude/Gemini
