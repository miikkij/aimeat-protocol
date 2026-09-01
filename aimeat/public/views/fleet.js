/**
 * @file fleet.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agents section: every agent this account has, in one place, with the one reading
 *   that did not exist anywhere before it — whether each one can still sign in.
 *
 *   WHY THIS PAGE. The profile's Agents tab shows what an agent IS: its tags, its trust, its tasks.
 *   It cannot show what an agent's owner most needs to know, which is that twelve of them stopped
 *   working three weeks ago and nothing said so. A v1 agent's credential runs out silently: the row
 *   still renders, the trust score is still there, and the agent is simply gone. So the fleet's
 *   heading is a count of what needs attention, and the default filter is that count.
 *
 *   IT ADDS NOTHING AND REMOVES NOTHING FROM THE PROFILE. Every row links into the existing agent
 *   card, which is where the per-agent detail already lives and stays. This page answers "which
 *   one should I look at"; that one answers "what about it".
 *
 *   TWO CREDENTIAL FAMILIES, SHOWN AS TWO. A key-and-card agent has no expiry to report — it mints
 *   a credential when it needs one — and a device-token agent has a date. Showing one word for both
 *   would hide the difference that decides what a person does next.
 *
 * @structure note(credential) · ConnectedDot · FleetView (default)
 * @usage routed at /v1/fleet by spa.html and routes/portal.ts. The menu calls it Agents; the
 *   address is /v1/fleet because /v1/agents is the API.
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V3).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { hasSession, getSession, onAuthChange } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { Spinner } from '/components/Spinner.js';
import { EmptyState } from '/components/EmptyState.js';
import { swallowed } from '/js/swallowed.js';

/** The states that mean a person has something to do. The heading counts these. */
const NEEDS_ATTENTION = new Set(['dead', 'expiring', 'never', 'unreadable']);

/**
 * The row's sentence, in the reader's language. The node decides the STATE and sends an English
 * `summary` for readers with no locale file (an agent over MCP, a log line); a browser has to say
 * the same thing in Finnish or Spanish, so it composes it from the same three values rather than
 * printing the node's English.
 */
function note(c) {
  if (!c) return '';
  const n = c.days_left;
  if (c.kind === 'key-and-card') {
    if (c.state === 'never') return t('fleet.note.keyNever');
    if (c.state === 'dead') return t('fleet.note.keyDead');
    if (c.state === 'unreadable') return t('fleet.note.keyUnreadable');
    return c.connected ? t('fleet.note.keyConnected') : t('fleet.note.keyOk');
  }
  if (c.state === 'never') return t('fleet.note.never');
  if (c.state === 'dead') return t('fleet.note.dead');
  if (c.state === 'expiring') {
    if (n === 0) return t('fleet.note.expiringToday');
    if (n === 1) return t('fleet.note.expiringOne');
    return t('fleet.note.expiring').replace('{n}', String(n));
  }
  if (n === 0) return t('fleet.note.okToday');
  if (n === 1) return t('fleet.note.okOne');
  return t('fleet.note.ok').replace('{n}', String(n));
}

/** A dot, not a word: the row already carries a sentence and two words would compete. */
const ConnectedDot = ({ on }) => html`
  <span class="flt-dot ${on ? 'flt-dot--on' : ''}" title=${on ? t('fleet.connectedNow') : t('fleet.notConnected')}></span>
`;

export default function FleetView() {
  useViewCSS('/css/views/fleet.css');
  const [agents, setAgents] = useState(null);
  const [signedIn, setSignedIn] = useState(hasSession());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [migration, setMigration] = useState(null);
  const [migrating, setMigrating] = useState(false);
  const [outcome, setOutcome] = useState(null);

  // The response also carries `credential_summary`, the same counts as one object. This page has the
  // rows in hand and has to filter them anyway, so it counts them itself; the summary is for a
  // reader that wants the number without the list.
  async function load() {
    try {
      const resp = await apiGet('/v1/agents?include=stats,credentials');
      setAgents(resp?.data?.agents ?? []);
    } catch (err) { swallowed('fleet: load', err); setAgents([]); }
    // What could be done about the ones that cannot sign in. Read separately because it is a
    // DECISION rather than a listing: the node answers which agents would move, whether a
    // connector is there to move them, and the sentence to show if it is not.
    try {
      const resp = await apiGet('/v1/agents/v2/migrate');
      setMigration(resp?.data ?? null);
    } catch (err) { swallowed('fleet: migration preview', err); setMigration(null); }
  }

  /**
   * One press for the whole stuck fleet.
   *
   * No confirmation dialog: the agents keep their name, their identity and everything filed against
   * them, and a failure leaves each one exactly as it was. A dialog in front of a reversible,
   * non-destructive action is a step that teaches people to click through steps.
   *
   * THE OUTCOME STAYS ON THE PAGE rather than in a toast. This is a standalone view with no toast
   * host of its own, and more to the point the answer is a state — which agents moved, which did
   * not — and a state belongs where the person is already looking rather than in something that
   * disappears while they read the list it changed.
   */
  async function migrate() {
    if (migrating) return;
    setMigrating(true);
    setOutcome(null);
    try {
      const resp = await apiPost('/v1/agents/v2/migrate', {});
      setOutcome({ ok: true, text: resp?.data?.next_step || t('fleet.migrate.done') });
    } catch (err) {
      swallowed('fleet: migrate', err);
      // The node's own sentence: it already says whether anything changed, and it does that better
      // than a generic line here could.
      setOutcome({ ok: false, text: err?.message || t('fleet.migrate.failed') });
    } finally {
      setMigrating(false);
      await loadRef.current();
    }
  }

  // load() is redeclared every render; the ref is what the mounted-once effects below call.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => { if (hasSession()) loadRef.current(); else setAgents([]); }, []);

  // Signing out has to empty this page. Nothing else navigates away from it, so without this the
  // account's whole agent list stays on screen after Logout, which reads as still being signed in.
  useEffect(() => onAuthChange((s) => {
    setSignedIn(!!s);
    if (s) loadRef.current(); else setAgents([]);
  }), []);

  // The fleet changes when an agent connects, enrols or is created, and all of those ride the
  // 'agents' domain: an event naming other domains is ignored, so memory traffic does not repaint
  // rows somebody is reading.
  //
  // This page is NOT a profile tab, and profile.js is what normally bridges SSE to the
  // `aimeat-live-update` event those tabs listen for. It is not mounted here, so the listener alone
  // would never fire once: this opens its own connection and dispatches, the same way agent-solo.js
  // does for a popped-out agent card.
  const owner = getSession()?.owner;
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !d.has('agents')) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    if (!owner) return () => window.removeEventListener('aimeat-live-update', handler);
    const notify = (domains) => window.dispatchEvent(new CustomEvent('aimeat-live-update', { detail: { domains } }));
    connect(() => getSession()?.jwt);
    onUpdate(notify);
    return () => {
      window.removeEventListener('aimeat-live-update', handler);
      offUpdate(notify);
      disconnect();
    };
    // Keyed on the owner id rather than the session object, which is a fresh object every render
    // and would tear the SSE connection down and back up each time.
  }, [owner]);

  if (!signedIn) {
    return html`<div class="flt">
      <h1 class="flt-title">${t('fleet.title')}</h1>
      <${EmptyState} title=${t('fleet.signedOut')} text=${t('fleet.signedOutText')} />
    </div>`;
  }
  if (!agents) return html`<div class="flt"><${Spinner} text=${t('fleet.loading')} /></div>`;

  const problems = agents.filter(a => NEEDS_ATTENTION.has(a.credential?.state));
  const shown = onlyProblems ? problems : agents;

  return html`
    <div class="flt">
      <h1 class="flt-title">${t('fleet.title')}</h1>
      <p class="flt-desc">${t('fleet.desc')}</p>

      ${agents.length === 0
        ? html`<${EmptyState} title=${t('fleet.emptyTitle')} text=${t('fleet.emptyText')} />`
        : html`
          ${migration && (migration.would_move ?? []).length > 0 && html`
            <div class="flt-migrate">
              <p class="flt-migrate-line">${migration.next_step}</p>
              <button class="btn-primary btn-sm" disabled=${migrating || (migration.daemons ?? []).length === 0}
                      onClick=${migrate}>
                ${migrating ? t('fleet.migrate.working') : t('fleet.migrate.action').replace('{n}', String(migration.would_move.length))}
              </button>
              ${outcome && html`<p class="flt-migrate-outcome ${outcome.ok ? '' : 'is-bad'}">${outcome.text}</p>`}
            </div>
          `}
          ${!(migration && (migration.would_move ?? []).length > 0) && outcome && html`
            <p class="flt-migrate-outcome ${outcome.ok ? '' : 'is-bad'}">${outcome.text}</p>
          `}

          <div class="flt-summary">
            <span class="flt-count">${agents.length === 1
              ? t('fleet.countAgentsOne')
              : t('fleet.countAgents').replace('{n}', String(agents.length))}</span>
            ${problems.length > 0
              ? html`<button class="flt-chip flt-chip--warn ${onlyProblems ? 'is-on' : ''}"
                       onClick=${() => setOnlyProblems(!onlyProblems)}>
                       ${problems.length === 1
                         ? t('fleet.needAttentionOne')
                         : t('fleet.needAttention').replace('{n}', String(problems.length))}
                     </button>`
              : html`<span class="flt-chip flt-chip--ok">${t('fleet.allFine')}</span>`}
            ${onlyProblems && html`<button class="btn-ghost btn-sm" onClick=${() => setOnlyProblems(false)}>${t('fleet.showAll')}</button>`}
          </div>

          <ul class="flt-list">
            ${shown.map(a => html`
              <li class="flt-row" key=${a.gaii}>
                <div class="flt-row-main">
                  <a class="flt-name" href=${`/v1/profile?tab=agents&agent=${encodeURIComponent(a.name)}`}>
                    ${a.display_name || a.name}
                  </a>
                  <${ConnectedDot} on=${!!a.credential?.connected} />
                  <span class="flt-badge">${t(`profile.agents.mode.${a.mode || 'interactive'}`)}</span>
                  ${a.run_mode && html`<span class="flt-badge flt-badge--run">${t(`profile.agents.runMode.${a.run_mode}`)}</span>`}
                  <span class="flt-badge flt-badge--kind">
                    ${a.credential?.kind === 'key-and-card' ? t('fleet.kindKey') : t('fleet.kindToken')}
                  </span>
                  <span class="flt-state flt-state--${a.credential?.state || 'unknown'}">
                    ${t(`fleet.state.${a.credential?.state || 'unknown'}`)}
                  </span>
                </div>
                <div class="flt-row-note">${note(a.credential)}</div>
                <div class="flt-row-meta">
                  ${a.platform ? html`<span>${a.platform}</span>` : ''}
                  ${a.stats?.tasks?.active > 0 ? html`<span>${t('fleet.openWork').replace('{n}', String(a.stats.tasks.active))}</span>` : ''}
                  ${a.stats?.messages?.total > 0 ? html`<span>${a.stats.messages.total === 1
                    ? t('fleet.messagesOne')
                    : t('fleet.messages').replace('{n}', String(a.stats.messages.total))}</span>` : ''}
                  <span class="flt-gaii">${a.gaii}</span>
                </div>
              </li>
            `)}
          </ul>
        `}
    </div>
  `;
}
