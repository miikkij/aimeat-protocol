/**
 * @file src/services/build-atelier-recipe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier spec's RECIPE half: how a component that is nearly right is made right
 *   through the kit's four doors, when a screen is written as a living record instead of code, and
 *   the six patterns a builder copies to get a finished screen.
 *
 *   A PURE EXTRACTION from build-atelier-prompt.ts, which reached the 800-line ceiling when these
 *   sections landed. Nothing here is rendered from a registry the way the catalogue, the looks, the
 *   patterns, the ambients and the effects are: these are the words themselves, and they are held
 *   to the kit by the variant and token lists being copied from `sdk-libs/atelier/describe-data.js`
 *   (generated from the components' own source) rather than remembered. When a component gains a
 *   variant, `pnpm build:atelier-parts` regenerates that file and this text is what follows it.
 *
 *   The living section is held the same way, to `sdk-libs/living/describe-data.js`: the node types
 *   it names and every `type:` in its worked record are that file's list, and the record itself is
 *   run through `AIMEAT.living.validate()` by test/unit/atelier-recipe.test.ts.
 * @structure
 *   - renderCustomisation() — the four doors, the fork's price, the dialog family's exception
 *   - renderLiving(base) — the record a calculation sheet is, and the seven node types
 *   - renderPatterns() — the six copy-paste patterns, each running as written on this node's kit
 * @usage
 *   import { renderCustomisation, renderLiving, renderPatterns } from './build-atelier-recipe.js';
 *   body += renderCustomisation() + renderLiving(base) + renderPatterns();
 * @version-history
 *   v1.3.0 — 2026-09-06 — The living section says what `aimeat-light` is for: a genre that
 *     hardcodes its palette declares `fixed`, a fork inherits it, and the fork deletes it when
 *     its colours become tokens. genre-living is the one that says `follows`, and every app
 *     forked from it had a dead light/dark switch until the signal moved off the register prefix.
 *   v1.3.0 — 2026-09-06 — One paragraph on the living section: a label is a language map, so a
 *     bilingual sheet is one record rather than two (aimeat-living 0.4.0).
 *   v1.2.0 — 2026-09-05 — A LIVING DOCUMENT joins the recipe (the living document, stage 3a): the
 *     record a sheet whose numbers stand on each other is written as, the seven node types, the
 *     two spellings that bite first, and a sixth pattern — a paint sheet that recomputes, mounted
 *     with one line — proven by running it in a browser.
 *   v1.1.0 — 2026-09-05 — The per-component token count follows the kit: thirty-three more became
 *     thirty-five when the form's range gained --ak-range-track and --ak-range-thumb.
 *   v1.0.0 — 2026-09-05 — Extracted from build-atelier-prompt.ts v1.25.0
 *     (wish-atelier-always-excellent, part 4).
 */

/**
 * The customisation model: four doors on every component, `describe()` as the way to ask which
 * ones this component has, and the fork priced so it stays the last resort it is meant to be.
 */
export function renderCustomisation(): string {
  return '## A COMPONENT THAT IS NEARLY RIGHT IS CUSTOMISED, NEVER COPIED\n\n'
    + 'Four doors, the same four on every component; `AIMEAT.atelier.describe("list")` tells '
    + 'you which ones a component has, and `describe()` names every component that answers.\n\n'
    + '1. **Named parts.** Every element the kit builds carries `data-ak-part="<name>"`; your own '
    + 'CSS reaches it by name — `[data-ak-part="aside"] { … }` — so the rule keeps working when '
    + 'the markup around it changes, which a selector written by DOM depth does not.\n'
    + '2. **Slots.** `parts: { <name>: value }` on the spec; a value is a string, a DOM node, an '
    + 'array of those, or a function of the row returning one of those. `extra`, `aside`, '
    + '`before` and `after` are rendered EMPTY and appear the moment you fill them, so a row that '
    + 'needs a third line and a value on the right is `AIMEAT.atelier.list({ items, onPick, '
    + 'parts: { extra: function (r) { return r.note; }, aside: function (r) { return r.amount; } '
    + '} })` and nothing more. A slot returning `null` removes that part. `parts.row` (`item` on '
    + 'timeline, `card` on kanban) replaces the whole row, and it is still keyed, entered and '
    + 'picked.\n'
    + '3. **Variants.** `variant: "dense"` stamps `data-ak-variant` and the stylesheet reads it, '
    + 'so you PICK a legitimate shape: `dense` and `plain` on list, listDetail, table, timeline, '
    + 'cardGrid, mediaCard, queue, health, kanban, section and searchBar; `numbered` on list and '
    + 'listDetail; `wide` on cardGrid; `lined` on table; `tall`, `compact` and `center` on hero; '
    + '`compact`, `trend` and `plain` on statRow; `compact` and `center` on figure; `compact` on '
    + 'rating; `dense` on tabs and bottomNav; `pill` on tabs; `quiet` on section. An unknown name '
    + 'is refused with a console line naming the real ones.\n'
    + '4. **Per-component tokens.** `--ak-list-aside-size`, `--ak-stat-figure-size`, '
    + '`--ak-card-aspect`, `--ak-hero-title-size` and thirty-five more, each defaulting to the '
    + 'value the component already had. Set one on YOUR OWN element and exactly that part '
    + 'changes, in every look and both modes.\n\n'
    + 'A statRow tile and a figure also take `unit` (what the number is measured in) and '
    + '`direction: "up"|"down"|"flat"` with `delta` (how far it went, in your own words).\n\n'
    + 'EVERYTHING CUSTOMISED STILL MOVES: a slot fills the row the kit already built and keyed, so '
    + 'the entrance, the glide, the exit, the pick and the selection mark are unchanged.\n\n'
    + 'Style through those four doors and the app keeps every later fix: leave the `.ak-*` '
    + 'selectors to the kit, and put the piece you would have bolted on with wrapper markup into '
    + 'the slot that is waiting for it.\n\n'
    + 'FORK ONLY AS A LAST RESORT: copy the component\'s markup out of its module and its '
    + '`.ak-<name>*` rules out of `/lib/aimeat-atelier/*.css`. You keep the tokens, the look and '
    + 'the motion helpers; you give up the keyed reconcile, the designed empty state, the '
    + 'accessibility wiring and every later fix. `describe(id).fork` says what that one costs. '
    + 'The dialog family stays whole whatever happens — the focus trap, Escape and focus return '
    + 'are the browser\'s through native `<dialog>` — so your own markup goes in its '
    + '`body(host)`.\n\n';
}

/**
 * The living document: when a screen's numbers stand on each other, the sheet is ONE record and
 * the arithmetic is a formula node, so the person can change what it works out by asking their own
 * AI to edit the record. Every node type named here is one `sdk-libs/living/describe-data.js`
 * carries, and the unit test holds this text to that file.
 * @param base  This node's public base URL, for the genre fetch.
 */
export function renderLiving(base: string): string {
  return '## A LIVING DOCUMENT: A SHEET WHOSE NUMBERS STAND ON EACH OTHER IS A RECORD\n\n'
    + 'When what the person asked for is a calculation sheet, a survey, a dosing record, a '
    + 'reading log or a spec that recomputes — anything where moving one number should move the '
    + 'rest — the arithmetic belongs in the document. Fork the genre with `GET ' + base
    + '/v1/app-templates/genre-living` and write ONE JSON record on `aimeat-living`: '
    + '`{ v: 1, register, look, layout, model }`, where `layout` is an ordinary mosaic arrangement '
    + '(the same blocks and spans you already write, and the person can rearrange them) and '
    + '`model.nodes` is one dependency graph. `AIMEAT.living.mount(host, record)` is the only line '
    + 'of code on the page.\n\n'
    + 'ASK THE LIBRARY, RATHER THAN TRUSTING ANY LIST. `AIMEAT.living.describe()` names every node '
    + 'type and `AIMEAT.living.describe("formula")` gives its inputs, outputs, options and a '
    + 'worked example, read out of the node modules\' own source so it says what this build does. '
    + '`AIMEAT.living.validate(record)` reads a document WITHOUT running it and answers with every '
    + 'refusal in words — an unknown node, a circle naming the two ids, a unit that will not add, '
    + 'a block that is not there. Call it before you save.\n\n'
    + 'THE SEVEN NODE TYPES, one line each so you know what to ask about: `value` (a named '
    + 'quantity, the writable ground the rest stands on), `formula` (a spreadsheet expression over '
    + 'other node ids, worked out with its units and printed as mathematics), `control` (a slider, '
    + 'toggle, pick, number or text field on ONE value), `binding` (one block prop reads one '
    + 'node), `text` (a sentence that changes when the numbers do), `machine` (a statechart in '
    + 'XState\'s vocabulary, whose output is the state it is in) and `source` (a live value from a '
    + 'memory key).\n\n'
    + 'WHERE A NODE LANDS ON THE SCREEN, two roads: a `binding` feeds a kit component — a '
    + 'figure\'s value, a gauge\'s reading, a chart\'s series — and the refresh goes through the '
    + 'mosaic\'s own door, so the count-up and the glide run for you; and a `block` field on a '
    + 'control, formula, text, machine or value node draws it into a `section` block of the same '
    + 'arrangement, which is where a node goes when the kit has no component for it.\n\n'
    + 'THREE THINGS THAT KEEP IT A DOCUMENT. The arithmetic lives in a formula node, so the person '
    + 'changes what the sheet works out by asking their own AI to edit the record. It computes in '
    + 'the browser and persists as the record, which is a memory key — a slider moves faster than '
    + 'a request returns. And the record names a register the same as any other Atelier page, so '
    + 'the sheet arrives wearing a look somebody designed.\n\n'
    + 'ONE LINE IN THE HEAD DECIDES WHETHER THE READER MAY CHANGE THE LIGHT. A genre that '
    + 'hardcodes its palette carries `<meta name="aimeat-light" content="fixed">` beside its '
    + 'register line, and the login pill\'s light/dark control stands down there rather than '
    + 'doing nothing; a fork inherits that line, so DELETE it (or write `content="follows"`, '
    + 'which genre-living does) as soon as your page\'s colours are `--ak-*` tokens and it '
    + 'follows the theme — otherwise the switch is dead and the reader\'s operating system '
    + 'decides light or dark for them.\n\n'
    + 'A LABEL IS A LANGUAGE MAP. Any human-facing string in the record may be written as '
    + '`{ "fi": "Ilma ovella", "en": "Air at the door" }` rather than as a plain string — a label, '
    + 'a hint, a pick\'s option, a text node\'s whole template, the words a machine\'s entry action '
    + 'writes, and a layout block\'s `title`, `sub` or `caption` — so ONE record is the document in '
    + 'every language it was written for. The page\'s language decides which is read (the login '
    + 'pill sets it), the record\'s own `lang` is the fallback and the map\'s first key the last '
    + 'resort; `describe("control").languages` names the fields a given type takes as a map. Write '
    + 'each language as itself rather than translating one into the other, and give a sentence the '
    + 'SAME `{{ }}` holes in every language — validate() refuses one that reads a node in Finnish '
    + 'and not in English, and refuses a map with no language keys, naming both. Changing language '
    + 'moves the words only: the value a person moved stays where they left it and the machine '
    + 'stays in the state it reached.\n\n'
    + 'TWO SPELLINGS THAT DECIDE WHETHER THE NUMBERS COME OUT RIGHT. A PERCENTAGE IS A LABEL ON A '
    + 'FACE NUMBER: `{ value: 72, unit: "%" }` computes as 72, so `rh / 100` is 0.72 and `ln(rh)` '
    + 'is the logarithm of 72, and the two conversions are asked for out loud — `fraction(rh)` '
    + 'gives 0.72 and `percent(x)` gives a hundred times x. A reading in something the library has '
    + 'no unit for is happiest as a plain number with what it is measured in written into its '
    + '`label`. And `°C` and `°F` are SCALES WITH AN OFFSET, so multiplying one gives a plain '
    + 'number and the formula\'s own `unit` names the result, which is what makes '
    + '`{ expr: "t * 9/5 + 32", unit: "°F" }` mean what its author meant; `convert(t, "K")` is '
    + 'how a real conversion is written. Where a statechart stands at the moment it mounts moved '
    + 'between builds, so `AIMEAT.living.version` and `describe("machine")` are the answer for the '
    + 'library THIS node serves.\n\n';
}

/**
 * The six patterns. Each was pasted into a running Atelier page on a node built from this tree
 * and driven in a real browser: zero console errors, and the effect the words claim visible on
 * screen. Copying one is the shortest road from an idea to a finished screen.
 */
export function renderPatterns(): string {
  return '## Six patterns to copy\n\n'
    + 'Each of these runs as written against the kit this node serves. Copy one, change the '
    + 'words and the data, and the screen it makes is finished.\n\n'
    + 'A LIST THAT ARRIVES — keyed rows, a pick that opens the detail beside them:\n\n'
    + '```js\n'
    + 'var jobs = AIMEAT.atelier.listDetail({\n'
    + '  target: a.main,\n'
    + '  items: [],\n'
    + "  empty: { title: 'No jobs yet', hint: 'They appear here as they are booked.' },\n"
    + '  renderDetail: function (item, body) { body.textContent = item.sub; },\n'
    + '});\n'
    + 'loadJobs().then(function (rows) { jobs.set({ items: rows }); });\n'
    + '// The rows rise in, keyed by id. On the next set() a new row rises, a gone row fades\n'
    + '// where it stood, a moved row glides, and a picked row crosses into the detail pane.\n'
    + '```\n\n'
    + 'A PANEL THAT CHANGES — numbers that count to their new value, with what they are '
    + 'measured in and which way they went:\n\n'
    + '```js\n'
    + "var kpis = AIMEAT.atelier.statRow({ target: a.main, variant: 'trend', tiles: [\n"
    + "  { id: 'booked', label: 'Booked', value: 12480, unit: '€', direction: 'up', delta: '+8%',\n"
    + '    trend: [8, 9, 9, 11, 10, 12] },\n'
    + "  { id: 'due', label: 'Overdue', value: 3, unit: 'jobs', direction: 'down', delta: '-2' },\n"
    + '] });\n'
    + 'kpis.set({ tiles: [\n'
    + "  { id: 'booked', label: 'Booked', value: 13120, unit: '€', direction: 'up', delta: '+13%',\n"
    + '    trend: [8, 9, 9, 11, 10, 12, 13] },\n'
    + "  { id: 'due', label: 'Overdue', value: 1, unit: 'jobs', direction: 'down', delta: '-2' },\n"
    + '] });   // each changed figure counts up on its own\n'
    + '```\n\n'
    + 'A SCREEN THAT SWITCHES — two units of work under one tab row, the crossing already '
    + 'wired:\n\n'
    + '```js\n'
    + "var pane = AIMEAT.atelier.section({ target: a.main, title: 'Open' });\n"
    + 'var rows = AIMEAT.atelier.list({ target: pane.body, items: open });\n'
    + 'AIMEAT.atelier.tabs({\n'
    + '  target: a.main,\n'
    + "  items: [{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }],\n"
    + "  value: 'open',\n"
    + '  onChange: function (id) {\n'
    + "    rows.set({ items: id === 'open' ? open : done });   // the swap runs inside the kit's\n"
    + '  },                                                    // own screen transition\n'
    + '});\n'
    + '```\n\n'
    + 'A FORM THAT LANDS — the confirmation as a toast, the refusal as a dialog, the field '
    + 'rule as a throw:\n\n'
    + '```js\n'
    + 'AIMEAT.atelier.form({\n'
    + '  target: pane.body,\n'
    + "  fields: [{ name: 'title', label: 'What', required: true },\n"
    + "           { name: 'due', label: 'When', type: 'date' }],\n"
    + "  submitLabel: 'Add job',\n"
    + '  onSubmit: function (values) {\n'
    + "    if (values.title.length < 3) throw { field: 'title', message: 'Give it a few more words.' };\n"
    + '    return save(values).then(function () {\n'
    + "      AIMEAT.atelier.toast({ title: 'Job added', sub: values.title, tone: 'ok' });\n"
    + '    }, function (err) {\n'
    + '      AIMEAT.atelier.dialog({\n'
    + "        title: 'That did not save', text: String(err.message || err), tone: 'danger',\n"
    + "        actions: [{ id: 'ok', label: 'Close', tone: 'primary' }],\n"
    + '      });\n'
    + '    });\n'
    + '  },\n'
    + '});\n'
    + '```\n\n'
    + 'A NEARLY-RIGHT ROW — the third line and the right-hand figure the list leaves empty, '
    + 'filled from the row itself:\n\n'
    + '```js\n'
    + 'AIMEAT.atelier.list({\n'
    + '  target: pane.body,\n'
    + '  items: rows,\n'
    + '  onPick: open,\n'
    + '  parts: {\n'
    + '    extra: function (r) { return r.note; },     // the third line, rendered empty until now\n'
    + '    aside: function (r) { return r.amount; },   // the value on the right\n'
    + '  },\n'
    + '});\n'
    + '```\n\n'
    + 'A SHEET THAT RECOMPUTES — the whole page as one record: the slider moves the wall, and the '
    + 'figure, the printed maths, the sentence and the state all follow it:\n\n'
    + '```js\n'
    + 'var sheet = {\n'
    + "  v: 1, register: 'genre-living', look: 'vivid',\n"
    + '  layout: { v: 1, nav: \'stack\', blocks: [\n'
    + "    { id: 'controls', component: 'section', span: 'full', props: { title: 'The wall' } },\n"
    + "    { id: 'tin',      component: 'figure',  span: 'half', props: { title: 'Litres of paint' } },\n"
    + "    { id: 'maths',    component: 'section', span: 'half', props: { title: 'How it is worked out' } },\n"
    + "    { id: 'note',     component: 'section', span: 'full', props: { title: 'What that means' } },\n"
    + "    { id: 'stock',    component: 'section', span: 'full', props: { title: 'Tins' } },\n"
    + '  ] },\n'
    + '  model: { nodes: {\n'
    + "    area:   { type: 'value', value: 24, unit: 'm^2', min: 2, max: 120, step: 0.5, label: 'Wall area' },\n"
    + "    coats:  { type: 'value', value: 2, label: 'Coats' },\n"
    + "    spread: { type: 'value', value: 10, unit: 'm^2/L', label: 'Spread rate' },\n"
    + "    wall:   { type: 'control', kind: 'slider', target: 'area', block: 'controls' },\n"
    + "    paint:  { type: 'formula', expr: 'area * coats / spread', unit: 'L',\n"
    + "              label: 'Paint needed', block: 'maths' },\n"
    + "    litres: { type: 'binding', block: 'tin', prop: 'value', from: 'paint' },\n"
    + "    advice: { type: 'text', block: 'note', template:\n"
    + "              '{{ area | 1 }} m2 in {{ coats }} coats takes {{ paint | 1 }} litres. '\n"
    + "              + '{{ if paint > 5 }}Buy two tins.{{ else }}One 5 litre tin covers it.{{ end }}' },\n"
    + "    tins:   { type: 'machine', block: 'stock', initial: 'one',\n"
    + "              states: { one: { on: { SECOND: 'two' } }, two: { on: { ENOUGH: 'one' } } },\n"
    + "              when: [{ expr: 'paint > 5', send: 'SECOND' },\n"
    + "                     { expr: 'paint <= 5', send: 'ENOUGH' }] },\n"
    + '  } },\n'
    + '};\n'
    + 'AIMEAT.living.validate(sheet);        // every refusal in words, before anything is drawn\n'
    + 'AIMEAT.living.mount(a.main, sheet);   // the only line of code this page runs\n'
    + '// m^2 divided by m^2/L is litres, so the unit on `paint` is checked rather than decorative;\n'
    + '// move `area` to 40 and paint passes 5 L, the sentence changes and the machine goes to two.\n'
    + '// A bound figure prints a WHOLE number (it counts up to it, and rounds), so the exact\n'
    + '// reading is the formula\'s own printout and the sentence: 5 in the tile, 4.8 in the words.\n'
    + '```\n\n';
}
