/**
 * @file src/services/build-atelier-recipe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier spec's RECIPE half: how a component that is nearly right is made right
 *   through the kit's four doors, and the five patterns a builder copies to get a finished screen.
 *
 *   A PURE EXTRACTION from build-atelier-prompt.ts, which reached the 800-line ceiling when these
 *   sections landed. Nothing here is rendered from a registry the way the catalogue, the looks, the
 *   patterns, the ambients and the effects are: these are the words themselves, and they are held
 *   to the kit by the variant and token lists being copied from `sdk-libs/atelier/describe-data.js`
 *   (generated from the components' own source) rather than remembered. When a component gains a
 *   variant, `pnpm build:atelier-parts` regenerates that file and this text is what follows it.
 * @structure
 *   - renderCustomisation() — the four doors, the fork's price, the dialog family's exception
 *   - renderPatterns() — the five copy-paste patterns, each running as written on this node's kit
 * @usage
 *   import { renderCustomisation, renderPatterns } from './build-atelier-recipe.js';
 *   body += renderCustomisation() + renderPatterns();
 * @version-history
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
 * The five patterns. Each was pasted into a running Atelier page on a node built from this tree
 * and driven in a real browser: zero console errors, and the effect the words claim visible on
 * screen. Copying one is the shortest road from an idea to a finished screen.
 */
export function renderPatterns(): string {
  return '## Five patterns to copy\n\n'
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
    + '```\n\n';
}
