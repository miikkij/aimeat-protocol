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
 *   The section is composed from the shared component set (components/poster-parts.js) and writes
 *   no class of its own. The first cut used class names that nothing styled and rendered a form of
 *   default controls; composing named parts is what keeps that from happening again.
 * @structure secBuilders(ctx) — the section · rungRow · GrantForm
 * @usage import { secBuilders } from './builders.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: ListRow for a right, Field for the form,
 *     a danger text action for revoke; no own CSS. The invite is an underlined action, because the
 *     page's one loud slab is the launcher.
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
import { Section, Stack, Columns, ListRow, Field, Action, Chip, Text } from '/components/poster-parts.js';
import { a, nameOf } from './frame.js';

/** The three rungs, in the order the node publishes them: most power first. */
const RUNGS = ['full', 'publisher', 'drafter'];
const DEFAULT_RUNG = 'drafter';

/**
 * One person on one app, or on everything. `onRevoke` is given what it needs to name the right
 * rather than an id, because taking a right away is two different calls and the row says which.
 */
function rungRow({ who, rung, where, onRevoke, busy, key }) {
  return html`<${ListRow} key=${key} density="compact" name=${who} detail=${where} detailKind="text"
    actions=${html`<${Chip}>${a('bldRung_' + rung) || rung}<//>
      <${Action} kind="text" tone="danger" disabled=${busy} onClick=${onRevoke}>${a('bldRevoke')}<//>`} />`;
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
    <form onSubmit=${submit}>
      <${Stack}>
        <${Columns} collapse=${640}>
          <${Field} label=${a('bldWho')} value=${who} onInput=${(e) => setWho(e.target.value)}
            placeholder=${a('bldWhoHint')} autoComplete="off" />
          <${Field} type="select" label=${a('bldRung')} value=${rung} onChange=${(e) => setRung(e.target.value)}
            options=${RUNGS.map((r) => ({ value: r, label: a('bldRung_' + r) || r }))} />
        <//>
        <${Columns} collapse=${640}>
          <${Field} type="select" label=${a('bldWhere')} value=${scope} onChange=${(e) => setScope(e.target.value)}
            options=${[{ value: '', label: a('bldWhereAll') }, ...apps.map((x) => ({ value: `${x.owner}/${x.filename}`, label: nameOf(x) }))]} />
          <${Stack} direction="horizontal" align="end">
            <${Action} type="submit" disabled=${busy || !who.trim()}>${a('bldGrant')}<//>
          <//>
        <//>
      <//>
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
    <${Section} id="ap-builders" title=${a('secBuilders')}>
      <${Stack}>
        <${Text}>${a('secBuildersLead')}<//>
        ${loading ? html`<${Text} tone="muted">${a('bldLoading')}<//>` : null}
        ${failed ? html`<${Text} tone="muted">${a('bldFailed')}<//>` : null}
        ${nothing ? html`<${Text} tone="muted">${a('bldNone')}<//>` : null}

        ${blanket.length ? html`
          <${Text} kind="label">${a('bldAllTitle')}<//>
          <${Stack} density="compact">
            ${blanket.map((g) => rungRow({
              key: 'all:' + g.grantee,
              who: g.grantee,
              rung: g.levelName || 'full',
              where: a('bldAllWhere'),
              busy: ctx.buildersBusy,
              onRevoke: () => ctx.onRevokeBuilder({ account: g.grantee, appId: null }),
            }))}
          <//>` : null}

        ${perAppRows.length ? html`
          <${Text} kind="label">${a('bldAppTitle')}<//>
          <${Stack} density="compact">
            ${perAppRows.map((g) => rungRow({
              key: g.appId + ':' + g.account,
              who: g.account,
              rung: g.levelName || 'full',
              where: nameForApp(g.appId),
              busy: ctx.buildersBusy,
              onRevoke: () => ctx.onRevokeBuilder({ account: g.account, appId: g.appId }),
            }))}
          <//>` : null}

        <${GrantForm} apps=${apps} busy=${ctx.buildersBusy} onGrant=${ctx.onGrantBuilder} />
        <${Text} kind="caption" tone="muted">${a('bldNever')}<//>
      <//>
    <//>`;
}
