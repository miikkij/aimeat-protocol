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
import { Section } from '/views/profile/organisms/poster-parts.js';
import { a, nameOf } from './frame.js';

/** The three rungs, in the order the node publishes them: most power first. */
const RUNGS = ['full', 'publisher', 'drafter'];
const DEFAULT_RUNG = 'drafter';

/**
 * One person on one app, or on everything. `onRevoke` is given what it needs to name the right
 * rather than an id, because taking a right away is two different calls and the row says which.
 */
function rungRow({ who, rung, where, onRevoke, busy }) {
  return html`
    <div class="ap-row">
      <div class="ap-row-main">
        <b>${who}</b>
        <small>${where}</small>
      </div>
      <div class="ap-row-ctl">
        <span class="og-chip">${a('bldRung_' + rung) || rung}</span>
        <button type="button" class="btn-ghost" disabled=${busy} onClick=${onRevoke}>${a('bldRevoke')}</button>
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
        <span class="og-label">${a('bldWho')}</span>
        <input class="og-input" type="text" value=${who} onInput=${(e) => setWho(e.target.value)}
               placeholder=${a('bldWhoHint')} autocomplete="off" />
      </label>
      <label class="ap-field">
        <span class="og-label">${a('bldRung')}</span>
        <select class="og-input" value=${rung} onChange=${(e) => setRung(e.target.value)}>
          ${RUNGS.map((r) => html`<option value=${r}>${a('bldRung_' + r) || r}</option>`)}
        </select>
      </label>
      <label class="ap-field">
        <span class="og-label">${a('bldWhere')}</span>
        <select class="og-input" value=${scope} onChange=${(e) => setScope(e.target.value)}>
          <option value="">${a('bldWhereAll')}</option>
          ${apps.map((x) => html`<option value=${`${x.owner}/${x.filename}`}>${nameOf(x)}</option>`)}
        </select>
      </label>
      <div class="ap-field ap-field--send">
        <button type="submit" class="btn-primary" disabled=${busy || !who.trim()}>${a('bldGrant')}</button>
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
    <${Section} id="ap-builders" num="06" title=${a('secBuilders')}>
      <p class="og-lead">${a('secBuildersLead')}</p>
      ${loading ? html`<p class="ap-empty">${a('bldLoading')}</p>` : null}
      ${failed ? html`<p class="ap-empty">${a('bldFailed')}</p>` : null}
      ${nothing ? html`<p class="ap-empty">${a('bldNone')}</p>` : null}

      ${blanket.length ? html`
        <p class="ap-form-label og-label">${a('bldAllTitle')}</p>
        <div class="ap-rows">
          ${blanket.map((g) => rungRow({
            who: g.grantee,
            rung: g.levelName || 'full',
            where: a('bldAllWhere'),
            busy: ctx.buildersBusy,
            onRevoke: () => ctx.onRevokeBuilder({ account: g.grantee, appId: null }),
          }))}
        </div>` : null}

      ${perAppRows.length ? html`
        <p class="ap-form-label og-label">${a('bldAppTitle')}</p>
        <div class="ap-rows">
          ${perAppRows.map((g) => rungRow({
            who: g.account,
            rung: g.levelName || 'full',
            where: nameForApp(g.appId),
            busy: ctx.buildersBusy,
            onRevoke: () => ctx.onRevokeBuilder({ account: g.account, appId: g.appId }),
          }))}
        </div>` : null}

      <${GrantForm} apps=${apps} busy=${ctx.buildersBusy} onGrant=${ctx.onGrantBuilder} />
      <p class="ap-hint">${a('bldNever')}</p>
    <//>`;
}
