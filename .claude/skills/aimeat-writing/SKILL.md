---
name: aimeat-writing
description: How prose is written on this project: the AI tells that give a text away and how to remove them, and how Finnish and Spanish are composed rather than translated. Use before writing or editing any user-visible text: UI copy, locale strings, documentation, a handbook page, a changelog entry, a commit message, an organism document, a prompt's human-facing parts, or a longer chat answer.
---

# Writing

Two jobs. Remove the tells that make a text read as machine-written, and write each language as
that language rather than as translated English.

## The tells

They are not a style preference. Every one of them is generic, adds length without adding clarity,
and signals that nobody decided anything. A reader who spots two stops trusting the third.

**Words to strike on sight:** delve · crucial · pivotal · tapestry · foundational · robust ·
seamless · landscape · realm · leverage (as a verb) · underscore · testament to · navigate (when
nothing is being steered).

**Openers and fillers:** "Here's the thing" · "Hope this helps" · "After careful consideration" ·
"I wanted to provide a quick update" · "It's worth noting that" · "Most people…" as a lead-in to a
claim nobody measured.

**Three patterns matter more than the word list, because they survive a find-and-replace:**

1. **Negative parallelism.** "It's not X, it's Y." "Not a bug, a feature." It fakes insight by
   pushing away a claim nobody made. Say Y. If X genuinely needs rejecting, reject it in its own
   sentence with a reason.
2. **The grand pronouncement.** A short final line that reframes what was just said as something
   larger: "This isn't a budget. It's a statement of intent." Cut it. The paragraph already said the
   thing; the flourish only announces that the writer wanted an ending.
3. **Adverb abuse.** "quietly runs", "simply add", "essentially the same", "actually works",
   "seamlessly integrates". The adverb is doing the work the verb should do, or hiding that no
   measurement was made. Strike it or replace the verb.

Two more this project keeps producing: **em-dashes** (use a comma, a colon or two sentences) and
**decorative emoji** (only ✓ ✗ → ↩ carry meaning; the rest are noise, and in an app UI they read as
AI slop; the same rule applies there).

**Speak human.** A term from the system's own vocabulary carries its meaning in the same sentence, or it does not appear. "agentAutonomy is L3 and meta.decisions is alwaysGate" tells the reader nothing; "the agent may write on its own, but decisions and gaps wait for your approval" says the same thing and can be acted on. This applies hardest when reporting to the developer: an identifier, a config key or a status enum is evidence, and the sentence still has to work without it. The same goes for a number: say what it means, not only what it is.

**The self-edit pass**, once the draft exists: read it once for the three patterns above, once for
adverbs, and once asking of each sentence whether deleting it would lose information. Most
first-draft closing paragraphs lose nothing.

## Finnish

**Compose in Finnish. Do not write English and translate it.** A translated sentence reads as
translated, Jouni sees it immediately, and it costs a correction round every time. Spending the extra
minutes on the first pass is cheaper than the iteration it saves. This is a standing instruction, not
a preference.

What gives a translation away, in the order it shows up here:

- **Genitive chains.** "järjestelmän käyttäjän oikeuksien hallinta" is English noun-stacking in
  Finnish clothing. Restructure to a clause or a compound: "miten käyttäjien oikeuksia hallitaan".
- **Missing commas.** A subordinate clause opened by *joka, että, kun, jos, vaikka, mikä* takes a
  comma. This is grammar, not style, and one Finnish pass on this project found about forty real
  errors of exactly this kind.
- **English passive.** "It was decided that…" becomes agentless mush in Finnish. Name a subject, or
  use the Finnish passive deliberately when the actor genuinely does not matter.
- **-ing constructions.** English participles do not map onto Finnish; a finite clause usually does.
- **Anglicisms and calques.** renderöityy → näkyy or muodostuu · grid → taulukko · doktriini →
  pelisäännöt · "mobiili edellä" → "mobiili ensin" · "ulos menevä" → lähtevä. If a word looks like a
  Finnish suffix bolted onto an English stem, it probably is.
- **Invented compounds.** If you cannot find the word in real use, you made it up. Rephrase.
- **Idioms never translate.** Find the Finnish thought, not the Finnish words.
- **ä and ö always.** The node is UTF-8 throughout, and append-only namespaces make an orthography
  slip permanent.

**Deliberate exception: machine and protocol tokens stay English in both languages.** Status names,
stage labels and identifiers a person reads as a machine's vocabulary (`AUTH`, `DELIVR`, `SNIF`,
`FRESH`, `done`, `failed`) are not translated. Everything a person reads as a sentence is.

## Spanish

**Compose in Spanish**, the same standing instruction the Finnish carries. Two decisions were made
once, and every string on the node follows them:

- **Latin American Spanish (es-419), written for Bogotá.** Not peninsular. `computadora` not
  `ordenador` · `celular` not `móvil` · `presiona` / `haz clic` not `pulsa` · `agregar` not `añadir`
  · `felicitaciones` not `enhorabuena` · `carro`-free, plain register.
- **`tú`, never `usted` and never `vos`.** Spoken Bogotá leans on `usted`, but software addresses
  the reader as `tú` across the region, and the whole UI has to pick one and hold it.

Vocabulary is fixed so 8000 strings agree with each other:

| English | Spanish | Note |
|---|---|---|
| memory | memoria | |
| workspace | espacio de trabajo | |
| organism | organismo | |
| node | nodo | |
| agent | agente | |
| app | aplicación | `app` only where a button has no room |
| home (the product metaphor) | hogar | a person's own space here |
| skill | habilidad | |
| consent | consentimiento | |
| provenance | procedencia | |
| trust score | puntuación de confianza | |
| owner (the role) | propietario | the human who owns the account |
| deal (CRM) | oportunidad | |
| viewer / contributor | lector / colaborador | |

**Never translated**, in any language: `AIMEAT`, `morsel` / `morsels`, `MCP`, `GHII` / `GAII` /
`GEAI`, `cortex`, `EXCHANGE`, `TURBO`, product names, and machine tokens (`done`, `failed`, `AUTH`).

What gives a translation away here:

- **Gendered address.** "Welcome" is not `Bienvenido`, which assumes a man reads it. `Te damos la
  bienvenida`. Same for `tranquilo`, `listo`, `seguro` used about the reader: rephrase.
- **English word order kept.** `Puedes copiar el prompt de arriba y pegarlo` is fine; a chain of
  `de`s (`la configuración de los permisos de los agentes del usuario`) is English noun-stacking
  wearing Spanish. Break it into a clause.
- **Missing `¿` and `¡`.** They open the sentence, not just close it.
- **`el enlace` vs `el link`, `el correo` vs `el email`.** Pick the Spanish one, both times.
- **Calques.** `soportar` for support → `admitir` · `aplicar` for apply a setting → `aplicar` is
  fine, but `aplicar para` a job is not · `remover` → `quitar` / `eliminar` · `accesar` is not a
  word.
- **Accents always.** The node is UTF-8 throughout and an append-only namespace makes a missing
  tilde permanent. `á é í ó ú ñ ü ¿ ¡`.

**Length.** Spanish runs 15–25 % longer than English. A string that fits a button in English may not
in Spanish, and that is checked in a browser at three viewports, not guessed.

## Adding a language, and filling one in

Three commands, repeated until the coverage line says 100 %. There is no fourth step and no other
file to remember.

```bash
pnpm locale:extract es --prefix profile.agents.   # → locales/.todo-es.json, the English to work from
#   … replace every value with the target-language text …
pnpm locale:merge es locales/.todo-es.json        # → back into es.json, in en.json's shape
pnpm check:locales                                # the gate; --list for coverage only
```

**A NEW language is the same loop plus two lines:** add the tag to `LOCALES` in `src/i18n.ts`, create
`locales/<tag>.json` containing `{}`, then extract → translate → merge. Nothing else in the code
needs touching, because every locale-aware surface (the two language switches, the sign-in modal,
the served header, the email and notification templates, the static privacy/terms/connect pages, the
EU AI Act disclosure declaration) reads that one list.

Four things worth knowing about the loop:

- **Slice by `--prefix`, not by `--limit` alone.** A translator needs one screen's strings together
  or the same noun comes out three ways. `--prefix profile.agents.` is a screen; the first 200 keys
  alphabetically are four half-screens.
- **A missing key is not a defect.** It falls back to English per key, which is how a language gets
  filled in over several passes without ever shipping a half-Spanish screen. Leaving a key out is
  cleaner than a `[TODO:xx]` placeholder, and far cleaner than a calque.
- **`locale:merge` refuses before it writes.** Unknown key, string where English has a list, dropped
  `{n}`, shipped `[TODO:xx]`: it checks the merged result first and writes nothing if any of it
  fails. A half-merged file is worse than an unmerged one, because the next extract no longer knows
  what is outstanding.
- **Nothing calls a model and nothing is billed.** The extract file is filled in by whoever is doing
  the language, reading the rules above. A machine translation merged unread is exactly the
  "translated English" this skill exists to prevent.

## Where each kind of text lands

- **UI text** goes through `t()` and into `locales/en.json` first; that file is the source of truth
  for what keys exist. The other languages follow through the loop above, in the same change when
  the text is ready and in a later pass when it is not.
- **A prompt string** is English, and follows `docs/coding-guidelines/prompt-writing.md`: say what
  TO do rather than what to avoid. Do not rewrite a prompt that works; additive changes only.
- **A changelog entry** says what a person gets, not what the code does, and only for platform-level
  work.
- **A commit message** explains why the change exists and what it costs, in the same voice as the
  rest of this. It is the one piece of writing that is read years later by someone with no context.
