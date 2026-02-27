# AIME AT Portal Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the developer-focused portal with a human-first "try it now" experience in Finnish/English, while preserving the current developer portal behind a toggle.

**Architecture:** New file `src/routes/portal-human.ts` renders the human-facing view. The existing `portal.ts` is preserved as-is (developer view). A shared `src/i18n.ts` module provides translations from `locales/fi.json` and `locales/en.json`. The portal router detects the `?view=dev` param to switch views, defaulting to the human view. Anonymous mode (`MEAT_ANONYMOUS=true`) must be enabled for try-before-signup features.

**Tech Stack:** Express 5, TypeScript (ESM), custom i18n (~50 lines, zero deps), existing AIMEAT memory API, HTML template literals.

---

## Phase 0: i18n Foundation

### Task 0.1: Create Translation JSON Files

**Files:**
- Create: `aimeat/locales/en.json`
- Create: `aimeat/locales/fi.json`

**Step 1: Create `locales/en.json`**

Start with the keys needed for Phase 1 (hero + cards). Add more keys in later phases.

```json
{
  "nav": {
    "try": "Try it",
    "devView": "For Developers",
    "signIn": "Sign In",
    "profile": "Profile",
    "logout": "Log Out",
    "loggedInAs": "logged in as"
  },
  "hero": {
    "title": "Your memory. For your AIs.",
    "subtitle": "Tell things once — all your AIs remember. You decide what's shared and with whom. Try now, no signup needed.",
    "anonNote": "You're trying this anonymously — your data expires over time.",
    "upgradeNudge": "Want to keep your data permanently?",
    "createAccount": "Create a free account"
  },
  "cards": {
    "memories": {
      "title": "Memories",
      "tagline": "Tell once, all your AIs remember",
      "desc": "Save things about yourself — what you like, where you live, what you do. Share them with your AI assistants so you don't have to explain the same things every time.",
      "inputPlaceholder": "Write something you want your AIs to remember...",
      "saveBtn": "Save to memory",
      "saved": "Memory saved!",
      "savedNote": "This memory is now available to AIs you connect here.",
      "exampleChips": ["I'm vegetarian", "I live in Espoo", "I like jazz"],
      "cost": "This memory cost one heart morsel. You have {{remaining}} left."
    },
    "apps": {
      "title": "Apps",
      "tagline": "Answer questions, get an app",
      "desc": "No coding skills needed. Pick what you'd like to do, answer a few questions, and an AI builds you an app. Open it right in your browser — your data is stored so it's available from anywhere.",
      "categories": {
        "games": "Games",
        "gamesDesc": "Challenge a friend to multiplayer",
        "notes": "Notes",
        "notesDesc": "Keep a journal or checklist",
        "trackers": "Trackers",
        "trackersDesc": "Track habits, budget, or anything",
        "family": "Family tools",
        "familyDesc": "Shared calendar, shopping list, messages",
        "creative": "Creative",
        "creativeDesc": "Make images, stories, or fun stuff",
        "custom": "Your idea",
        "customDesc": "Tell what you want and AI builds it"
      },
      "anyAiWorks": "You can build apps with any AI — Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek, all of them work! Try with different AIs and see which makes the best result.",
      "tryNow": "Try now: Tic-Tac-Toe",
      "tryNowDesc": "Create a game, send the link to a friend, play. Under 30 seconds.",
      "createGame": "Create new game"
    },
    "services": {
      "title": "Services",
      "tagline": "Help others or ask for help",
      "desc": "Need an image made, a text translated, or help with something? Post a request and someone — human or AI — can deliver it. Good at something? Offer it as a service and appear in the directory.",
      "needHelp": "I need help",
      "needHelpDesc": "Tell what you need",
      "offerHelp": "I want to help",
      "offerHelpDesc": "Tell what you can do"
    }
  },
  "morsels": {
    "name": "heart morsel",
    "namePlural": "heart morsels",
    "summary": "Heart morsels are AIME AT's way of saying thanks. You get 100 to start — for free. The more you share and help, the more you get."
  },
  "compat": {
    "title": "Which AIs can read your memories automatically?",
    "works": "Works directly",
    "worksNote": "Grok and Claude (paid versions) — they fetch your memories automatically when you give them the address.",
    "sometimes": "Works sometimes",
    "sometimesNote": "DeepSeek — succeeds occasionally.",
    "notYet": "Not yet",
    "notYetNote": "ChatGPT (free), Gemini — they don't understand the request yet.",
    "workaround": "Workaround for all",
    "workaroundNote": "Copy your memories and paste directly into any AI chat — always works, everywhere."
  },
  "more": {
    "title": "What else can you do?",
    "aiNews": "Subscribe to AI news digest",
    "aiNewsDesc": "Get the latest news summarized by AI every morning",
    "monitor": "Monitor your server",
    "monitorDesc": "See your server health on a real-time dashboard",
    "multiAgent": "Connect multiple AI agents",
    "multiAgentDesc": "Let all your AIs share the same memory",
    "directory": "Browse the directory",
    "directoryDesc": "Find services and offer your own",
    "buildApps": "Build your own apps",
    "buildAppsDesc": "All you need is HTTP — no backend, no database"
  }
}
```

**Step 2: Create `locales/fi.json`**

Same structure, Finnish translations:

```json
{
  "nav": {
    "try": "Kokeile",
    "devView": "Kehittajille",
    "signIn": "Kirjaudu",
    "profile": "Profiili",
    "logout": "Kirjaudu ulos",
    "loggedInAs": "kirjautuneena"
  },
  "hero": {
    "title": "Sinun muistisi. Sinun AI:llesi.",
    "subtitle": "Kerro asiat kerran — kaikki AI:si muistavat. Sina paatat mita jaetaan ja kenelle. Kokeile heti, ei tarvitse rekisteroitya.",
    "anonNote": "Kokeilet tata anonyymisti — tietosi vanhenevat ajan myota.",
    "upgradeNudge": "Haluatko pitaa tietosi pysyvasti?",
    "createAccount": "Luo ilmainen tili"
  },
  "cards": {
    "memories": {
      "title": "Muistot",
      "tagline": "Kerro kerran, kaikki AI:si muistavat",
      "desc": "Tallenna asioita itsestasi — mita tykkaat, missa asut, mita teet. Jaa ne AI-avustajillesi niin sinun ei tarvitse selittaa samoja asioita joka kerta.",
      "inputPlaceholder": "Kirjoita jotain mita haluat AI:si muistavan...",
      "saveBtn": "Tallenna muistiin",
      "saved": "Muisto tallennettu!",
      "savedNote": "Tama muisto on nyt saatavilla AI:lle jotka kytket tahan.",
      "exampleChips": ["Olen kasvissyoja", "Asun Espoossa", "Pidan jazz-musiikista"],
      "cost": "Tama muisto maksoi yhden sydanmurusen. Sinulla on {{remaining}} jaljella."
    },
    "apps": {
      "title": "Sovellukset",
      "tagline": "Vastaa kysymyksiin, saat sovelluksen",
      "desc": "Et tarvitse koodaustaitoja. Valitse mita haluaisit tehda, vastaa muutamaan kysymykseen, ja AI rakentaa sinulle sovelluksen. Avaat sen suoraan selaimesta — ja tieto tallentuu niin etta se on saatavilla mista tahansa.",
      "categories": {
        "games": "Pelit",
        "gamesDesc": "Haasta kaverisi moninpeliin",
        "notes": "Muistiinpanot",
        "notesDesc": "Pida paivakirjaa tai muistilistaa",
        "trackers": "Seurantatyokalut",
        "trackersDesc": "Seuraa tapoja, budjettia tai mita vain",
        "family": "Perhetyokalut",
        "familyDesc": "Jaettu kalenteri, ostoslista, viestit",
        "creative": "Luovat",
        "creativeDesc": "Tee kuvia, tarinoita tai muuta hauskaa",
        "custom": "Oma idea",
        "customDesc": "Kerro mita haluat ja AI rakentaa sen"
      },
      "anyAiWorks": "Sovelluksia voi rakentaa milla tahansa AI:lla — Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek, kaikki toimivat! Kokeile eri AI:lla ja naet mika tekee parhaan tuloksen.",
      "tryNow": "Kokeile heti: Ristinolla",
      "tryNowDesc": "Luo peli, laheta linkki kaverille, pelaa. Alle 30 sekuntia.",
      "createGame": "Luo uusi peli"
    },
    "services": {
      "title": "Palvelut",
      "tagline": "Auta muita tai pyyda apua",
      "desc": "Tarvitsetko kuvan tekemista, tekstin kaantamista, tai apua jonkin tekemisessa? Laita pyynto ja joku — ihminen tai AI — voi toimittaa sen sinulle. Osaatko itse jotain erityista? Tarjoa se palveluna ja nay keltaisilla sivuilla.",
      "needHelp": "Tarvitsen apua",
      "needHelpDesc": "Kerro mita tarvitset",
      "offerHelp": "Haluan auttaa",
      "offerHelpDesc": "Kerro mita osaat"
    }
  },
  "morsels": {
    "name": "sydanmurunen",
    "namePlural": "sydanmurusta",
    "summary": "Sydanmuruset ovat AIME AT:n tapa sanoa kiitos. Saat 100 murusta alkuun — ilmaiseksi. Mita enemman jaat ja autat, sita enemman saat."
  },
  "compat": {
    "title": "Mitka AI:t osaavat lukea muistisi automaattisesti?",
    "works": "Toimii suoraan",
    "worksNote": "Grok ja Claude (maksulliset versiot) — hakevat muistosi automaattisesti kun annat niille osoitteen.",
    "sometimes": "Toimii joskus",
    "sometimesNote": "DeepSeek — onnistuu toisinaan.",
    "notYet": "Eivat osaa viela",
    "notYetNote": "ChatGPT (ilmainen), Gemini — eivat ymmarra pyyntoa.",
    "workaround": "Kiertotie kaikille",
    "workaroundNote": "Kopioi muistosi ja liita se suoraan AI-keskusteluun — toimii aina, kaikkialla."
  },
  "more": {
    "title": "Mita muuta voit tehda?",
    "aiNews": "Tilaa AI-uutiskooste",
    "aiNewsDesc": "Saa joka aamu tuoreimmat uutiset tiivistettyna AI:lla",
    "monitor": "Seuraa palvelintasi",
    "monitorDesc": "Nae serverisi terveys dashboardilta reaaliajassa",
    "multiAgent": "Yhdista useita AI-agentteja",
    "multiAgentDesc": "Anna kaikkien AI:desi jakaa sama muisti",
    "directory": "Selaa keltaisia sivuja",
    "directoryDesc": "Loyda palveluita ja tarjoa omiasi",
    "buildApps": "Rakenna omia sovelluksia",
    "buildAppsDesc": "Kaikki mita tarvitset on HTTP — ei backendia, ei tietokantaa"
  }
}
```

**Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add i18n translation files (en, fi)"
```

---

### Task 0.2: Create i18n Module

**Files:**
- Create: `aimeat/src/i18n.ts`

**Step 1: Write the i18n module**

```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Dict = Record<string, string | string[] | Dict>;

export type Locale = 'en' | 'fi';
export const LOCALES: readonly Locale[] = ['en', 'fi'] as const;
export const DEFAULT_LOCALE: Locale = 'fi';

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

// Load translations at startup
const translations = new Map<Locale, Dict>();
for (const loc of LOCALES) {
  const raw = readFileSync(join(__dirname, '..', 'locales', `${loc}.json`), 'utf-8');
  translations.set(loc, JSON.parse(raw) as Dict);
}

function resolve(dict: Dict, key: string): string | string[] | undefined {
  const parts = key.split('.');
  let cur: string | string[] | Dict = dict;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Dict)[p];
  }
  if (typeof cur === 'string') return cur;
  if (Array.isArray(cur)) return cur;
  return undefined;
}

function interpolate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`
  );
}

/** Create a bound t() function for a locale. Falls back to DEFAULT_LOCALE, then returns key. */
export function createT(locale: Locale): TFunction {
  const dict = translations.get(locale);
  const fallback = locale !== DEFAULT_LOCALE ? translations.get(DEFAULT_LOCALE) : undefined;
  return (key: string, vars?: Record<string, string | number>): string => {
    let val = dict ? resolve(dict, key) : undefined;
    if (val === undefined && fallback) val = resolve(fallback, key);
    if (val === undefined) return key;
    const str = Array.isArray(val) ? val.join(', ') : val;
    return vars ? interpolate(str, vars) : str;
  };
}

/** Detect best locale from Accept-Language header. */
export function detectLocale(acceptLang: string | undefined): Locale {
  if (!acceptLang) return DEFAULT_LOCALE;
  const parsed = acceptLang.split(',').map(e => {
    const [tag] = e.trim().split(';');
    return tag.trim().split('-')[0].toLowerCase();
  });
  for (const lang of parsed) {
    if (LOCALES.includes(lang as Locale)) return lang as Locale;
  }
  return DEFAULT_LOCALE;
}

/** Validate a locale string. */
export function toLocale(val: unknown): Locale {
  if (typeof val === 'string' && LOCALES.includes(val as Locale)) return val as Locale;
  return DEFAULT_LOCALE;
}
```

**Step 2: Verify it compiles**

```bash
cd aimeat && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add aimeat/src/i18n.ts
git commit -m "feat: add lightweight i18n module with FI/EN support"
```

---

### Task 0.3: Add Language Detection to Portal Router

**Files:**
- Modify: `aimeat/src/routes/portal.ts` (router function, add `?lang=` and `?view=` params)

No cookie-parser dependency. Use `?lang=fi` query params + client-side `localStorage` to persist preference. The language toggle links append `?lang=xx` to the current URL. Client JS stores the preference and appends it to future navigations.

**Step 1: Modify portalRouter to detect locale and view**

In the `router.get('/v1/portal')` handler, add locale detection:

```typescript
// At the top of the handler:
const viewParam = req.query.view as string | undefined;
const langParam = req.query.lang as string | undefined;
const locale = langParam ? toLocale(langParam) : detectLocale(req.headers['accept-language']);

if (viewParam === 'dev' || !viewParam) {
  // existing dev portal (when explicitly requested or for backwards compat during transition)
}
```

The human view will be served by default once Phase 1 is complete. During development, keep the current portal as default and serve human view at `?view=human`.

**Step 2: Import i18n in portal.ts**

Add at top:
```typescript
import { createT, detectLocale, toLocale, LOCALES, type Locale, type TFunction } from '../i18n.js';
```

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal.ts
git commit -m "feat: add locale detection to portal router"
```

---

## Phase 1: Hero Section + Three Cards + Anonymous Memory Save

### Task 1.1: Create the Human Portal Page

**Files:**
- Create: `aimeat/src/routes/portal-human.ts`

This is the core deliverable. A new file that exports `humanPortalHtml(config, t, locale, stats)` generating the full human-facing page.

**Structure:**
1. CSS — reuse the space theme colors from current portal, mobile-first
2. Top nav — AIME AT logo, language toggle (FI/EN), view toggle (Kokeile/Kehittajille), auth area
3. Hero — big headline from `t('hero.title')`, subtitle from `t('hero.subtitle')`
4. Three cards — Muistot, Sovellukset, Palvelut (clickable, expand inline)
5. Memory card expanded state — text input + save button + example chips
6. Morsels summary — one line at bottom
7. "What else" — expandable section with more options
8. Client-side JS — memory save via fetch, language persistence via localStorage

**Key implementation details:**

- Memory save uses `POST /v1/memory` (requires anonymous mode or auth)
- Language toggle: `<a href="?lang=en">EN</a> | <a href="?lang=fi">FI</a>`
- View toggle: `<a href="?view=dev">Kehittajille</a>`
- Cards start collapsed (title + tagline visible), expand on click
- After first memory save, show AI compatibility notice inline
- After any anonymous action, show gentle upgrade nudge

**Step 1: Write the `portal-human.ts` file**

Export two things:
```typescript
export function humanPortalHtml(config: MeatConfig, t: TFunction, locale: Locale, stats: NodeStats): string
export function humanPortalRouter(config: MeatConfig, storage: Storage): Router
```

The router handles:
- `POST /v1/portal/try-memory` — anonymous memory save endpoint (wraps the memory API for the "try it" UI, auto-generates a key like `try.{timestamp}`)

Full HTML/CSS/JS in template literal, following the same pattern as `portal.ts` and `profile.ts`.

**Step 2: Verify it compiles**

```bash
cd aimeat && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add human-facing portal page with hero + three cards"
```

---

### Task 1.2: Wire Human Portal into Server

**Files:**
- Modify: `aimeat/src/server.ts` (add import + mount)
- Modify: `aimeat/src/routes/portal.ts` (add view switching logic)

**Step 1: Update portal router to serve human view by default**

In the `/v1/portal` GET handler:

```typescript
router.get('/v1/portal', async (req, res) => {
  const view = req.query.view as string | undefined;
  const langParam = req.query.lang as string | undefined;
  const locale = langParam ? toLocale(langParam) : detectLocale(req.headers['accept-language']);
  const t = createT(locale);

  const [agents, actions, boards] = await Promise.all([
    storage.listAgents(),
    storage.listActions(),
    storage.listBoards(),
  ]);
  const stats = { agents: agents.length, actions: actions.length, boards: boards.length };

  if (view === 'dev') {
    // Existing developer portal
    res.type('text/html').send(portalHtml(config, stats));
  } else {
    // Human-facing portal (default)
    res.type('text/html').send(humanPortalHtml(config, t, locale, stats));
  }
});
```

**Step 2: Mount the human portal's API routes in server.ts**

```typescript
import { humanPortalRouter } from './routes/portal-human.js';
// ...
app.use(humanPortalRouter(config, storage));
```

**Step 3: Verify and test manually**

```bash
cd aimeat && npx tsc --noEmit
# Start server, visit http://localhost:40050/v1/portal — should show human view
# Visit http://localhost:40050/v1/portal?view=dev — should show developer view
# Visit http://localhost:40050/v1/portal?lang=en — should show English
```

**Step 4: Commit**

```bash
git add aimeat/src/server.ts aimeat/src/routes/portal.ts aimeat/src/routes/portal-human.ts
git commit -m "feat: wire human portal as default view, dev portal behind ?view=dev"
```

---

### Task 1.3: Implement Anonymous Memory Save

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (add POST handler)

**Step 1: Add a lightweight endpoint for the "try it" memory save**

```typescript
// POST /v1/portal/try-memory
// Body: { "text": "I'm vegetarian" }
// Requires anonymous mode to be enabled
router.post('/v1/portal/try-memory', requireAuth(), async (req, res) => {
  const text = req.body?.text;
  if (!text || typeof text !== 'string' || text.length > 500) {
    res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Text required (max 500 chars)'));
    return;
  }
  const gaii = req.auth!.sub;
  const key = `try.${Date.now()}`;
  await storage.setMemory(gaii, key, { text }, 'public', [], 24); // 24h TTL
  const wallet = await storage.getWallet(gaii);
  res.json(success(config.nodeId, {
    key,
    remaining: wallet?.balance ?? 0,
  }));
});
```

The client-side JS in the human portal calls this via `fetch('/v1/portal/try-memory', { method: 'POST', ... })`.

**Step 2: Verify it works**

```bash
cd aimeat && npx tsc --noEmit
# Start server with MEAT_ANONYMOUS=true
# Visit portal, type a memory, click save — should work
```

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add anonymous memory save endpoint for try-it experience"
```

---

## Phase 2: Tic-Tac-Toe Demo

### Task 2.1: Build the Tic-Tac-Toe HTML App

**Files:**
- Create: `aimeat/public/demos/tictactoe.html`

A self-contained HTML+CSS+JS file that:
- Creates a game by writing state to AIMEAT anonymous memory
- Generates a shareable link (the URL with game ID)
- Two players take turns by polling memory for state changes
- Uses `POST /v1/memory` for game state (anonymous mode)
- Beautiful UI matching AIME AT theme (dark, pink accents)
- Works on mobile
- No registration needed

Game state stored in memory key: `games.ttt.{gameId}`
Value: `{ board: [9 cells], turn: 'X'|'O', players: { X: id, O: null|id }, status: 'waiting'|'playing'|'won'|'draw' }`

**Step 1: Write the HTML file**

Self-contained, ~200 lines. Uses fetch() to read/write AIMEAT memory API directly.

**Step 2: Test manually**

Open in browser, create a game, open the share link in another tab, play.

**Step 3: Commit**

```bash
git add aimeat/public/demos/tictactoe.html
git commit -m "feat: add tic-tac-toe demo app using AIMEAT anonymous memory"
```

---

### Task 2.2: Integrate Demo into Human Portal

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (add demo link in apps card)

**Step 1: Add "Try now" section in the apps card**

When the apps card is expanded and "Games" category is selected, show a prominent button:
"Try now: Tic-Tac-Toe — Create a game, send the link to a friend, play. Under 30 seconds."

The button links to `/demos/tictactoe.html` (served by express.static from public/).

**Step 2: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: integrate tic-tac-toe demo into apps card"
```

---

## Phase 3: App Category Selection + Prompt Templates

### Task 3.1: Build Category-to-Prompt Flow

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (apps card expanded state)

**Step 1: Implement category selection UI**

When the apps card expands, show 6 category cards (Games, Notes, Trackers, Family, Creative, Custom). Each one, when clicked:
1. Shows a text area with a pre-generated prompt
2. The prompt is fetched from `GET /v1/portal/prompt/{any-platform}?goal={category}`
3. User copies the prompt, pastes into any AI chat
4. The AI generates the app HTML

**Step 2: Add "any AI works" notice**

Below the categories, show the message from `t('cards.apps.anyAiWorks')`.

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add app category selection with prompt templates"
```

---

### Task 3.2: Add "Which AI Built This" Tag Support

**Files:**
- Modify: `aimeat/src/routes/apps.ts` (add optional `built_with` metadata field)
- Modify: `aimeat/src/storage/interface.ts` (add `builtWith` to StorageFileRecord)

**Step 1: Add `built_with` field to app upload**

In POST `/v1/apps`, accept optional `built_with: string` in the body (e.g., "Claude", "ChatGPT", "Grok").

**Step 2: Return it in app listings**

In GET `/v1/apps`, include `built_with` in each app's metadata.

**Step 3: Commit**

```bash
git add aimeat/src/routes/apps.ts aimeat/src/storage/interface.ts aimeat/src/storage/memory.ts
git commit -m "feat: add built_with metadata to app uploads"
```

---

## Phase 4: App Gallery

### Task 4.1: Build App Gallery Section

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (add gallery section below main cards)

**Step 1: Add app gallery UI**

Below the three main cards, show "Apps built on this node":
- Fetch from `GET /v1/apps` on page load
- Display each app as a card: filename, owner, built_with tag, download button
- Sort options: Newest, Most popular

**Step 2: Add "Built with [AI]" badge styling**

Each app card shows a colored badge: "Built with Claude", "Built with Grok", etc.

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add app gallery section to human portal"
```

---

## Phase 5: Services Marketplace

### Task 5.1: Build Services Card Expanded View

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (services card expanded state)

**Step 1: Implement "I need help" flow**

When expanded, show two buttons:
1. "I need help" — opens a text field to describe what they need. Posts to work API.
2. "I want to help" — shows form to describe skill/service. Posts to actions API.

**Step 2: Show examples**

Display 2-3 example scenarios in the card description area.

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add services marketplace to human portal"
```

---

### Task 5.2: Build Directory View ("Keltaiset Sivut")

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (expandable "more" section)

**Step 1: Add service directory**

In the "What else can you do?" section, the "Browse directory" option loads from `GET /v1/catalogue` and displays available services in a simple list format.

**Step 2: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add service directory to human portal"
```

---

## Phase 6: Morsels Polish + Upgrade Nudges

### Task 6.1: Weave Morsels Into Actions

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (post-action UI feedback)

**Step 1: Add morsel feedback after each action**

- After memory save: show `t('cards.memories.cost', { remaining: N })`
- After service request: "This request reserved 5 heart morsels. They transfer when the work is done."
- Bottom of page: show `t('morsels.summary')`

**Step 2: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: weave morsel feedback into portal actions"
```

---

### Task 6.2: Add Upgrade Nudges

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts` (post-action nudge)

**Step 1: After any anonymous action succeeds, show nudge**

```html
<div class="upgrade-nudge">
  <span>✅ ${t('hero.anonNote')}</span>
  <span>${t('hero.upgradeNudge')}</span>
  <a href="/v1/portal?view=dev">${t('hero.createAccount')}</a>
</div>
```

Not blocking, not aggressive. Just a gentle note below the success message.

**Step 2: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add gentle upgrade nudges after anonymous actions"
```

---

### Task 6.3: Add "What Else" Expandable Section

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts`

**Step 1: Add collapsible section below the three main cards**

Uses the keys from `t('more.title')` etc. Each item is a clickable row that links to a guide or feature.

**Step 2: Commit**

```bash
git add aimeat/src/routes/portal-human.ts
git commit -m "feat: add expandable 'what else' section to human portal"
```

---

### Task 6.4: Final Polish + AI Compatibility Matrix

**Files:**
- Modify: `aimeat/src/routes/portal-human.ts`
- Modify: `aimeat/locales/en.json` (add any missing keys discovered during implementation)
- Modify: `aimeat/locales/fi.json` (same)

**Step 1: Add AI compatibility notice**

After the first memory save, show the compatibility matrix contextually (not as a big table — as a simple list with checkmarks).

**Step 2: Mobile responsiveness check**

Test all card states on mobile viewport. Fix any overflow/spacing issues.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: polish human portal — compat matrix, mobile fixes, final translations"
```

---

## File Summary

| File | Action | Phase |
|------|--------|-------|
| `aimeat/locales/en.json` | Create | 0 |
| `aimeat/locales/fi.json` | Create | 0 |
| `aimeat/src/i18n.ts` | Create | 0 |
| `aimeat/src/routes/portal-human.ts` | Create | 1-6 |
| `aimeat/src/routes/portal.ts` | Modify (view switching) | 1 |
| `aimeat/src/server.ts` | Modify (mount human portal) | 1 |
| `aimeat/public/demos/tictactoe.html` | Create | 2 |
| `aimeat/src/routes/apps.ts` | Modify (built_with field) | 3 |
| `aimeat/src/storage/interface.ts` | Modify (built_with field) | 3 |
| `aimeat/src/storage/memory.ts` | Modify (built_with field) | 3 |

## Testing Strategy

- **Type checking:** `npx tsc --noEmit` after every task
- **Manual browser testing:** After each phase, verify in browser at `http://localhost:40050/v1/portal`
- **Anonymous mode:** Start server with `MEAT_ANONYMOUS=true` for all try-it features
- **E2E tests:** Run `npx tsx test/e2e-full.ts` after Phases 0-1 to ensure nothing is broken
- **Mobile:** Test at 375px width after Phase 1 and Phase 6

## Dependencies

- No new npm packages needed
- i18n is custom (~50 lines)
- Language preference stored in client localStorage (no cookie-parser)
- Anonymous mode must be enabled (`MEAT_ANONYMOUS=true`)
