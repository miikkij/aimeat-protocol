/**
 * @file public/views/admin/ghii-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin GHII Users page in the poster face (design canvas "AIMEAT Admin GHII Users",
 *   list direction A). Three sections in the order an operator asks: what is true of these people
 *   right now, the people themselves behind a search and seven filter chips, and what a level
 *   means. The four writes go through the same routes as before; nothing new is fetched, and the
 *   sign-in count the route has always returned is on the screen for the first time.
 *
 * @structure
 *   - GhiiTab({ data, reload, switchPage }) — the three sections, the strip and the actions
 *   - tally(): every count the page shows, from the one list the dashboard already loaded
 *   - person(): one person as a row of the shared table (label-value pairs on a phone)
 *   - setLevel / doDelete / doRemoveEmail / doResetTotp: call admin service
 *
 * @version-history
 *   v2.3.0 — 2026-09-22 — Composed from the shared component set (Section, NumeralBand, Toolbar,
 *     Table, Action tabs for the level): no page sheet and no class of its own, so a theme change
 *     reaches it.
 *   v2.2.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v2.1.0 — 2026-09-12 — The row prints the name before the @ and keeps the whole identity in the
 *     hover and in the stacked view: at 1280 the person column had 4px to spare on a local node's
 *     ids, and a production one is six characters longer, so the identity would have wrapped on
 *     every row. Sixty-four repetitions of the node id is not information.
 *   v2.0.0 — 2026-09-12 — The poster face: the explanation card and its three accordions become
 *     section 03, the stat cards become the numeral strip, and the eight-column table that was
 *     766px wide inside a sideways-scrolling box becomes grid rows that stack on a phone. The red
 *     CRITICAL chip leaves the list (it was drawn 128 times for the ordinary fact that somebody
 *     registered with a password) and the level becomes three chips with the current one on the
 *     sun, in place of a select that wrote on change. Search and filters arrive because 64 rows
 *     cannot be read; login_count arrives because the route has always sent it.
 *   v1.2.0 — 2026-09-05 — The remove-email button says its words instead of two glyphs: no emoji anywhere in the interface.
 *   v1.1.0 — 2026-09-04 — The two-step sign-in reset, on the rows that have it armed. Removing it
 *     the normal way needs a code from the device the person lost, so this was the account's only
 *     way back and it did not exist. The table gained its scroll box in the same change: at 390px
 *     it is 766px wide against a page that clips, so the actions column was unreachable on a phone
 *     and the reset button is the last control in it.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, when, Row, Badge, Empty, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Toolbar, Table, Action, Text } from '/components/poster-parts.js';
import { updateGhiiLevel, deleteGhii, removeGhiiEmail, resetGhiiTotp } from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';

const G = (key, vars) => t('dashboard.ghiiPage.' + key, vars);

/** The name to call somebody by: what they chose, then their username, then the identity itself. */
const nameOf = (u) => u.display_name || u.username || u.ghii;

/** An account the chat opened for somebody who never registered. index-start.ts names them
 *  `anon-<four hex>`; the node's own first one is plain `anonymous`. Twelve of sixty-four on
 *  aimeat.io, and the reason "64 people" is not sixty-four people. */
const isAnon = (u) => u.username === 'anonymous' || /^anon-/.test(String(u.username || ''));

const FILTERS = ['all', 'l0', 'l1', 'l2', 'totp', 'cold', 'anon'];

/** Every count the page shows, read off the list the dashboard already holds. No second fetch. */
function tally(users) {
  const c = { all: users.length, l0: 0, l1: 0, l2: 0, totp: 0, cold: 0, anon: 0, mail: 0, seen: 0 };
  for (const u of users) {
    if (u.verification_level === 2) c.l2++;
    else if (u.verification_level === 1) c.l1++;
    else c.l0++;
    if (u.totp_enabled) c.totp++;
    if (u.last_login_at) c.seen++; else c.cold++;
    if (isAnon(u)) c.anon++;
    if (u.masked_email) c.mail++;
  }
  return c;
}

/** True when this person is in the chosen filter. */
function inFilter(u, filter) {
  if (filter === 'l0') return (u.verification_level || 0) === 0;
  if (filter === 'l1') return u.verification_level === 1;
  if (filter === 'l2') return u.verification_level === 2;
  if (filter === 'totp') return !!u.totp_enabled;
  if (filter === 'cold') return !u.last_login_at;
  if (filter === 'anon') return isAnon(u);
  return true;
}

/** Free text against the four things an operator would type: name, username, GHII, mail. */
function matches(u, q) {
  if (!q) return true;
  const hay = [u.display_name, u.username, u.ghii, u.masked_email].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

export default function GhiiTab({ data, reload, switchPage }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const users = data.ghiiUsers || [];
  const nodeId = (data.dash || {}).node_id || '';
  const c = tally(users);

  // Oldest first, which is what the foot says. The route returns storage order, and on a page
  // where the question is "who has been here since the start" that order is nobody's.
  const shown = users
    .filter((u) => inFilter(u, filter) && matches(u, q.trim().toLowerCase()))
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const oldest = users.reduce((min, u) => (!min || String(u.created_at) < min ? String(u.created_at) : min), '');

  async function setLevel(u, level) {
    try {
      await updateGhiiLevel(u.ghii, level);
      showOk(G('levelSet', { name: nameOf(u), level: 'L' + level }));
      reload();
    } catch (e) { showErr(e.message); }
  }

  function doDelete(u) {
    confirm(G('deleteAsk', { name: nameOf(u) }), async () => {
      try { await deleteGhii(u.ghii); showOk(G('deleteDone', { name: nameOf(u) })); reload(); }
      catch (e) { showErr(e.message); }
    }, { title: G('deleteTitle'), confirmLabel: G('deleteBtn'), danger: true });
  }

  // The answer to "I lost my phone and my backup codes". It hands the operator nothing: the
  // password still stands, and the person is told on their own feed who did this.
  function doResetTotp(u) {
    confirm(t('dashboard.ghiiTotpResetConfirm').replace('{name}', nameOf(u)), async () => {
      try { await resetGhiiTotp(u.username); showOk(t('dashboard.ghiiTotpResetDone')); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  function doRemoveEmail(u) {
    confirm(t('dashboard.ghiiRemoveEmailConfirm').replace('{name}', nameOf(u)), async () => {
      try { await removeGhiiEmail(u.ghii); showOk(t('dashboard.ghiiEmailRemoved')); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  /** The status line under the big number, and it has to stay true of whatever is here. One
   *  verified person is the case a plural template gets wrong, and the first one always is one. */
  const statusLine = c.l2 === 1
    ? G('lineOne', { rest: num(c.all - 1) })
    : (c.l2 > 1
      ? G('lineSome', { verified: num(c.l2), rest: num(c.all - c.l2) })
      : (c.totp > 0 ? G('lineNoneVerified', { n: num(c.all) }) : G('lineNothing', { n: num(c.all) })));

  const filters = FILTERS.map((id) => ({
    id, label: `${G('f' + id.charAt(0).toUpperCase() + id.slice(1))} · ${num(c[id])}`,
    selected: filter === id, disabled: c[id] === 0 && id !== 'all', onClick: () => setFilter(id),
  }));

  const level = (u) => html`
    <${Stack} direction="horizontal" density="compact">
      ${[0, 1, 2].map((n) => html`
        <${Action} key=${n} kind="tab" selected=${(u.verification_level || 0) === n}
          disabled=${(u.verification_level || 0) === n}
          title=${G('levelSetHint', { level: 'L' + n })}
          onClick=${() => setLevel(u, n)}>L${n}<//>`)}
    <//>`;

  // Every GHII on this page ends in the same node id, so the row prints the name before the @ and
  // keeps the whole thing for the hover. Sixty-four repetitions of "@aimeat-finland-001-genesis" is
  // not information, and at 1280 it is what pushed the row's own columns off the side. A GHII that
  // does NOT end in this node's id is printed in full.
  const shortId = (u) => (u.ghii.endsWith('@' + nodeId) ? u.username || u.ghii : u.ghii);

  const none = html`<${Text} kind="mono" tone="muted">–<//>`;

  const person = (u) => [
    html`<${Stack} density="compact">
      <strong>${nameOf(u)}</strong>
      <${Text} kind="mono" tone="muted" title=${u.ghii}>${shortId(u)}<//>
    <//>`,
    u.masked_email
      ? html`<${Text} kind="mono" tone=${u.email_verified ? 'plain' : 'muted'}>${u.masked_email}<//>`
      : none,
    level(u),
    u.totp_enabled ? html`<${Badge} type="healthy" label=${G('on')} />` : none,
    html`<${Stack} density="compact">
      ${u.last_login_at ? html`<${Text} kind="mono">${when(u.last_login_at)}<//>` : html`<${Text} kind="mono" tone="muted">${G('never')}<//>`}
      ${u.login_count ? html`<${Text} kind="caption" tone="muted">${u.login_count === 1 ? G('timesOne') : G('times', { n: num(u.login_count) })}<//>` : null}
    <//>`,
    html`<${Text} kind="mono" tone="muted">${when(u.created_at)}<//>`,
    html`<${Stack} direction="wrap" density="compact">
      ${u.masked_email
    ? html`<${Action} kind="text" onClick=${() => doRemoveEmail(u)}>${G('doMail')}<//>`
    : null}
      ${u.totp_enabled
    ? html`<${Action} kind="text" title=${t('dashboard.ghiiTotpResetHint')} onClick=${() => doResetTotp(u)}>${G('doTotp')}<//>`
    : null}
      <${Action} kind="text" tone="danger" onClick=${() => doDelete(u)}>${G('doDelete')}<//>
    <//>`,
  ];

  return html`
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${G('now')} count="01"
        actions=${html`<${Action} onClick=${() => switchPage('owners')}>${G('nowToOwners')}<//>`}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading">${c.all === 1 ? G('statusPerson') : G('statusPeople', { n: num(c.all) })}<//>
            <${Text}>${statusLine}<//>
            <${Text} kind="mono" tone="muted">${nodeId}<//>
            ${oldest ? html`<${Text} kind="mono" tone="muted">${G('oldest', { when: when(oldest) })}<//>` : null}
          <//>
          <div>
            <${Row} title=${G('rowL0')} why=${G('rowL0Why')} chip=${html`<${Badge} type="critical" label="L0" />`}
              value=${G('ofAll', { n: num(c.l0), all: num(c.all) })} />
            <${Row} title=${G('rowL1')} why=${G('rowL1Why')} chip=${html`<${Badge} type="watch" label="L1" />`}
              value=${G('ofAll', { n: num(c.l1), all: num(c.all) })} />
            <${Row} title=${G('rowL2')} why=${G('rowL2Why')} chip=${html`<${Badge} type="healthy" label="L2" />`}
              value=${G('ofAll', { n: num(c.l2), all: num(c.all) })} />
            <${Row} title=${G('rowTotp')} why=${G('rowTotpWhy')}
              chip=${html`<${Badge} type=${c.totp ? 'healthy' : 'critical'} label=${G('armedN', { n: num(c.totp) })} />`}
              value=${G('ofAll', { n: num(c.totp), all: num(c.all) })} />
            <${Row} title=${G('rowSeen')} why=${G('rowSeenWhy')}
              chip=${html`<${Badge} type="muted" label=${G('liveN', { n: num(c.seen) })} />`}
              value=${G('ofAll', { n: num(c.seen), all: num(c.all) })} />
          </div>
        <//>
      <//>

      <${NumeralBand} tone="plain" items=${[
    { label: G('stripPeople'), value: num(c.all), note: G('stripPeopleSub') },
    { label: G('stripL0'), value: num(c.l0), note: G('stripL0Sub'), tone: 'coral' },
    { label: G('stripTotp'), value: num(c.totp), note: G('ofAll', { n: num(c.totp), all: num(c.all) }) },
    { label: G('stripCold'), value: num(c.cold), note: G('stripColdSub') },
  ]} />

      <${Section} title=${G('people')} count="02" description=${G('peopleLead')}
        actions=${html`<${Action} onClick=${() => switchPage('agents')}>${G('peopleToAgents')}<//>`}>
        <${Stack}>
          <${Toolbar} label=${G('people')} filters=${filters}
            search=${{ ariaLabel: G('searchPlaceholder'), placeholder: G('searchPlaceholder'), value: q, onInput: (e) => setQ(e.target.value) }} />

          ${!users.length
    ? html`<${Empty} text=${t('dashboard.noGhiiUsers')} />`
    : html`
          ${shown.length
    ? html`<${Table} density="compact" collapse=${600} label=${G('people')}
              headers=${[G('colPerson'), G('colMail'), G('colLevel'), G('colTotp'), G('colSeen'), G('colMade'), '']}
              rows=${shown.map(person)} />`
    : html`<${Empty} text=${G('noMatch')} />`}
          <${Stack} direction="horizontal" align="between">
            <${Text} kind="caption" tone="muted">${G('footShown', { n: num(shown.length), all: num(c.all) })}<//>
            <${Text} kind="caption" tone="muted">${G('footOrder')}<//>
          <//>`}
        <//>
      <//>

      <${Section} title=${G('levels')} count="03">
        <${Row} title=${G('lvl0')} why=${G('lvl0Why')} chip=${html`<${Badge} type="critical" label="L0" />`}
          value=${G('nPeople', { n: num(c.l0) })} />
        <${Row} title=${G('lvl1')} why=${G('lvl1Why')} chip=${html`<${Badge} type="watch" label="L1" />`}
          value=${G('nPeople', { n: num(c.l1) })} />
        <${Row} title=${G('lvl2')} why=${G('lvl2Why')} chip=${html`<${Badge} type="healthy" label="L2" />`}
          value=${G('nPeople', { n: num(c.l2) })} />
        <${Row} title=${G('lvlTotp')} why=${G('lvlTotpWhy')}
          chip=${html`<${Badge} type=${c.totp ? 'healthy' : 'critical'} label=${G('armedN', { n: num(c.totp) })} />`}
          value=${G('nPeople', { n: num(c.totp) })} />
        <${Text} kind="caption" tone="muted">${G('levelsNote')}<//>
      <//>

      <${ConfirmUI} />
    <//>
  `;
}
