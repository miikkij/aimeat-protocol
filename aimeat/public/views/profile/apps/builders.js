/**
 * @file public/views/profile/apps/builders.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who, other than you, may build your apps: the section on the Apps page where a
 *   development right is given, read and taken back.
 *
 *   The controls genuinely need a screen. Giving somebody else's agents the right to publish under
 *   your name is a decision a person makes once and then wants to be able to SEE, and a right that
 *   can only be read back by asking an AI is a right whose holder you eventually forget. The chat
 *   path does the same thing through the app tools; this is the machine room where the state shows.
 *
 *   Two lists, because there are two grants and they answer different questions. "Any app of mine"
 *   is one record and one revoke, and it is here rather than repeated on forty apps for exactly that
 *   reason. Per-app rights are grouped under the app they are on.
 *
 *   EVERY CLASS HERE IS ONE THIS PAGE'S OWN STYLESHEET DEFINES (`ap-*` in css/views/apps-poster.css,
 *   `og-*` in css/views/organism.css). The first cut used `og-form`, `og-row` and `og-fineprint`,
 *   which nothing styles: the browser check found a form of default-rendered controls whose labels
 *   sat on the line above the control they named. A class name that no stylesheet answers looks
 *   exactly like one that does, until somebody opens the page.
 * @structure secBuilders(ctx) — the section · rungRow · GrantForm
 * @usage import { secBuilders } from './builders.js';
 * @version-history
 *   v1.11.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.10.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.9.0 — 2026-09-25 — The two lists of builders are the Listing (listing, listing-row and its name and doors cells, the rung's tag in a plain cell), a unification: the look most tabs use.
 *   v1.8.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.6.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.2.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 — 2026-09-08 — The browser check: the lead is a paragraph in the body (Section takes no
 *     `lead` prop and dropped it in silence), the classes are the ones this page defines, the level
 *     select returns to its default after an invite so a second one cannot silently reuse the first
 *     one's level, and a failed load says so instead of rendering as "nobody".
 *   v1.0.0 — 2026-09-08 — Initial. Phase 7 of the shared-app work.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { PageSection } from '/components/PageSection.js';
import { a, nameOf } from './frame.js';
import { Hint } from '/components/Hint.js';

/** The three rungs, in the order the node publishes them: most power first. */
const RUNGS = ['full', 'publisher', 'drafter'];
const DEFAULT_RUNG = 'drafter';

/**
 * One person on one app, or on everything. `onRevoke` is given what it needs to name the right
 * rather than an id, because taking a right away is two different calls and the row says which.
 */
function rungRow({ who, rung, where, onRevoke, busy }) {
  return html`
    <div class="listing-row">
      <div class="listing-name">${who}<small>${where}</small></div>
      <div><span class="poster-chip">${a('bldRung_' + rung) || rung}</span></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" disabled=${busy} onClick=${onRevoke}>${a('bldRevoke')}</button>
      </div>
    </div>`;
}

/** Give somebody a right: who, which rung, and on what. */
function GrantForm({ apps, onGrant, busy }) {
  const [who, setWho] = useState('');
  const [rung, setRung] = useState(DEFAULT_RUNG);
  const [scope, setScope] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const name = who.trim();
    if (!name) return;
    onGrant({ account: name, level: rung, appId: scope || null });
    // Both fields back to their defaults, not just the name. Leaving the level behind is how the
    // second invitation silently carries the first one's power.
    setWho('');
    setRung(DEFAULT_RUNG);
    setScope('');
  };

  return html`
    <form class="ap-form" onSubmit=${submit}>
      <label class="ap-field">
        <span class="poster-label">${a('bldWho')}</span>
        <input class="og-input" type="text" value=${who} onInput=${(e) => setWho(e.target.value)}
               placeholder=${a('bldWhoHint')} autocomplete="off" />
      </label>
      <label class="ap-field">
        <span class="poster-label">${a('bldRung')}</span>
        <select class="select-field" value=${rung} onChange=${(e) => setRung(e.target.value)}>
          ${RUNGS.map((r) => html`<option value=${r}>${a('bldRung_' + r) || r}</option>`)}
        </select>
      </label>
      <label class="ap-field">
        <span class="poster-label">${a('bldWhere')}</span>
        <select class="select-field" value=${scope} onChange=${(e) => setScope(e.target.value)}>
          <option value="">${a('bldWhereAll')}</option>
          ${apps.map((x) => html`<option value=${`${x.owner}/${x.filename}`}>${nameOf(x)}</option>`)}
        </select>
      </label>
      <div class="ap-field ap-field--send">
        <button type="submit" class="poster-slab poster-slab--control" disabled=${busy || !who.trim()}>${a('bldGrant')}</button>
      </div>
    </form>`;
}

/**
 * The section. `ctx.builders` is what the page loaded: `{ blanket, perApp }`, `false` when the load
 * failed, and null while it is in flight; `ctx.onGrantBuilder` / `ctx.onRevokeBuilder` are what it
 * does about it.
 */
export function secBuilders(ctx) {
  const apps = ctx.apps || [];
  const b = ctx.builders;
  const failed = b === false;
  const loading = b === null || b === undefined;
  const blanket = (b && b.blanket) || [];
  const perApp = (b && b.perApp) || {};
  const perAppRows = Object.entries(perApp).flatMap(([appId, list]) =>
    (list || []).map((g) => ({ ...g, appId })));
  const nothing = !loading && !failed && blanket.length === 0 && perAppRows.length === 0;

  const nameForApp = (appId) => {
    const [, filename] = String(appId).split('/');
    const found = apps.find((x) => x.filename === filename);
    return found ? nameOf(found) : filename;
  };

  return html`
    <${PageSection} id="ap-builders" num="06" title=${a('secBuilders')}>
      <p class="og-lead">${a('secBuildersLead')}</p>
      ${loading ? html`<p class="poster-quiet ap-empty loading-mark">${a('bldLoading')}</p>` : null}
      ${failed ? html`<p class="poster-quiet ap-empty">${a('bldFailed')}</p>` : null}
      ${nothing ? html`<p class="poster-quiet ap-empty">${a('bldNone')}</p>` : null}

      ${blanket.length ? html`
        <p class="ap-form-label poster-label">${a('bldAllTitle')}</p>
        <div class="listing listing--cols listing--name-tag-doors">
          ${blanket.map((g) => rungRow({
            who: g.grantee,
            rung: g.levelName || 'full',
            where: a('bldAllWhere'),
            busy: ctx.buildersBusy,
            onRevoke: () => ctx.onRevokeBuilder({ account: g.grantee, appId: null }),
          }))}
        </div>` : null}

      ${perAppRows.length ? html`
        <p class="ap-form-label poster-label">${a('bldAppTitle')}</p>
        <div class="listing listing--cols listing--name-tag-doors">
          ${perAppRows.map((g) => rungRow({
            who: g.account,
            rung: g.levelName || 'full',
            where: nameForApp(g.appId),
            busy: ctx.buildersBusy,
            onRevoke: () => ctx.onRevokeBuilder({ account: g.account, appId: g.appId }),
          }))}
        </div>` : null}

      <${GrantForm} apps=${apps} busy=${ctx.buildersBusy} onGrant=${ctx.onGrantBuilder} />
      <${Hint}>${a('bldNever')}<//>
    <//>`;
}
