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
 *   ONE SENTENCE IS SAID ONCE. Fifty-two agents whose credential ran out carry the same three lines
 *   fifty-two times, and a person reading that is reading one fact rendered fifty-two ways. The
 *   rows are grouped by the state they are in; the sentence sits on the group, and the row carries
 *   only what differs from its neighbours. The same argument retires the per-row GAII: it is the
 *   agent's name plus an owner and node identical on every row, so it is on the name's tooltip and
 *   the account line, not stamped in monospace sixty-eight times.
 *
 * @structure groupNote/rowDetail · ConnectedDot · MigrateBanner · StateGroup · FleetView (default)
 * @usage routed at /v1/fleet by spa.html and routes/portal.ts, and embedded as the "Your agents"
 *   section of Settings & Controls via views/profile/fleet-tab.js, which passes `embedded`.
 * @version-history
 *   v1.3.0 — 2026-09-03 — A row opens the agent. The href is an address and was never an
 *     instruction: embedded in Settings & Controls it pushed a query onto the URL the profile had
 *     already read, so the location bar changed and nothing else did. It primes the name and asks
 *     the mounted profile to open the tab, which is the road the home dashboard's card has used
 *     since June. The sheet wears the poster face rather than the classic shell (fleet.css v2).
 *   v1.2.0 — 2026-09-03 — A design review's findings, measured: the alarm sits above the starter
 *     card (at 1280x460 the first screen was an invitation to make MORE agents while eighteen were
 *     locked out); the banner is titled by what the press DOES, because "18 cannot sign in" was
 *     wrong about the six that had never connected; the unlabelled 8px dot is a word on the rows
 *     where it is true; the INTERACTIVE badge shows only when it is not the default, and the
 *     credential kind only on an account with both; the filter says what it hid.
 *   v1.1.0 — 2026-09-03 — `embedded` so Settings & Controls can hold this rather than link away to
 *     it. Rows grouped by state, so the shared sentence is said once. The migration banner is
 *     composed HERE from the numbers the node sends, in the reader's language: it used to print
 *     `next_step`, the node's English, which no Finnish or Spanish reader could read and which said
 *     "move them to their own key" — a phrase nobody uses about their own software.
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
 * Open one agent's card, from a row.
 *
 * THE HREF ALONE DID NOTHING WHEN THIS IS EMBEDDED. Every row pointed at
 * `/v1/profile?tab=agents&agent=<name>`, which is the right ADDRESS and the wrong instruction:
 * inside Settings & Controls the person is already on `/v1/profile`, the SPA pushes the new query
 * and stops, and the profile reads `?tab=` once on mount (`useEffect(..., [])` in views/profile.js).
 * So the location bar changed and the page did not, sixty-eight times.
 *
 * The in-app way in already existed and is what the home dashboard's Agents card uses: prime the
 * name in sessionStorage, then ask the mounted profile to open the tab. agents-tab.js reads both
 * on mount, expands that agent and scrolls it into view.
 *
 * The link keeps its `href` so it is still an address — middle-click, open-in-new-tab and the
 * standalone /v1/fleet page all need a real one, and on that page nothing is listening for the
 * event, so the navigation is the correct behaviour rather than a fallback.
 */
function openAgent(e, name, embedded) {
  if (!embedded) return;                                  // standalone page: let the link navigate
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;   // a new tab is not our call
  e.preventDefault();
  try { sessionStorage.setItem('aimeat.agents.open', name); } catch (err) { swallowed('fleet: prime agent', err); }
  window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId: 'agents' } }));
}

/* The 8x8 grey dot that used to sit after every name is gone. Unlabelled, the same grey on all 19
   rows including the healthy one, and its meaning was in a `title` — so it said nothing at all on a
   phone, where there is no hover. A design review read it as a bullet or a rendering artefact.
   "Connected right now" is worth saying, so it is said, as a word, on the rows where it is true. */

/** The order the groups read in: what needs doing first, what is fine last. */
const STATE_ORDER = ['dead', 'unreadable', 'never', 'expiring', 'ok', 'unknown'];

/**
 * The sentence for a whole group, in the plural.
 *
 * A group is keyed on STATE AND KIND because those two decide which sentence applies, and nothing
 * else does: a `dead` device-token agent and a `dead` key-and-card agent are in the same state for
 * different reasons and need different words. Building the group's line from one row's own sentence was
 * wrong twice over — it said "Its sign-in has run out" above twelve of them, and it would have
 * described a whole group by whichever kind happened to sort first.
 *
 * What it deliberately leaves out is the number of days, because that is the one thing that DOES
 * differ inside a group. It goes on the row.
 */
function groupNote(state, kind) {
  const key = kind === 'key-and-card'
    ? { never: 'keyNever', dead: 'keyDead', unreadable: 'keyUnreadable' }[state] ?? 'keyOk'
    : state;
  return t(`fleet.group.${key}`);
}

/** The part of a row that is NOT true of its neighbours. Empty when the group's sentence said it
 *  all, which is every state except the two that count down. */
function rowDetail(c) {
  if (!c || c.kind === 'key-and-card') return '';
  if (c.state !== 'ok' && c.state !== 'expiring') return '';
  const n = c.days_left;
  if (n === 0) return t('fleet.daysToday');
  if (n === 1) return t('fleet.daysOne');
  return t('fleet.days').replace('{n}', String(n));
}

/**
 * What can be done about the agents that cannot sign in.
 *
 * IT USED TO PRINT THE NODE'S ENGLISH. `next_step` is written for a reader with no locale file —
 * an agent over MCP, a log line — and a browser printed it verbatim, so a Finnish reader got
 * English and everyone got "move them to their own key". Nobody says "own key" about their own
 * software. The node still decides the numbers; the sentence is composed here, from those numbers,
 * in the language the reader chose.
 *
 * Four things a person needs, in the order they need them: what is wrong, what the button does,
 * what it needs to work, and what it costs the agent. The last one is the one that stops a person
 * hesitating, so it is not left to be inferred.
 */
function MigrateBanner({ migration, migrating, outcome, onPress }) {
  const n = (migration.would_move ?? []).length;
  const ready = (migration.daemons ?? []).length > 0;
  const plural = (one, many) => (n === 1 ? t(one) : t(many).replace('{n}', String(n)));
  return html`
    <div class="flt-migrate">
      ${/* TITLED BY WHAT THE PRESS DOES, not by a diagnosis. It used to read "18 of your agents
            cannot sign in", and then the list below it showed a group of 12 called "Cannot sign
            in" and a group of 6 called "Never connected" — so the heading was wrong about a third
            of its own number, and a reader was left reconciling 18, 12, 6 and 19. The two reasons
            are the groups' to tell; this box is about the one press that fixes both. */''}
      <h3 class="flt-migrate-head">${plural('fleet.migrate.headOne', 'fleet.migrate.head')}</h3>
      <p class="flt-migrate-line">${plural('fleet.migrate.whatOne', 'fleet.migrate.what')}</p>
      <p class="flt-migrate-line flt-migrate-keeps">${t('fleet.migrate.keeps')}</p>
      ${/* Directly above the button, because it is the answer to "why can I not press this". */''}
      <p class="flt-migrate-line ${ready ? 'is-ready' : 'is-blocked'}">
        ${ready ? t('fleet.migrate.ready') : t('fleet.migrate.needConnector')}
      </p>
      <button class="btn-primary" disabled=${migrating || !ready} onClick=${onPress}>
        ${migrating ? t('fleet.migrate.working') : plural('fleet.migrate.actionOne', 'fleet.migrate.action')}
      </button>
      ${outcome && html`<p class="flt-migrate-outcome ${outcome.ok ? '' : 'is-bad'}">${outcome.text}</p>`}
    </div>
  `;
}

/**
 * `embedded` is how one implementation serves both addresses. The standalone page owns the browser
 * tab, so it carries an h1; inside Settings & Controls the section header is already on screen and
 * a second heading of the same words is the thing a reader has to work out is not a mistake.
 */
export default function FleetView({ embedded = false, starter = null } = {}) {
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
  /**
   * `only` names ONE agent; without it the whole stuck fleet moves.
   *
   * The route has taken `{ agents: [...] }` since it was written and this page never sent it, so
   * the only control on screen was "move all eighteen" — and a person who wanted one agent moved
   * had no button at all. Asked for by name on 2026-09-03, hunted for on the page, not there.
   */
  async function migrate(only) {
    if (migrating) return;
    setMigrating(true);
    setOutcome(null);
    try {
      const resp = await apiPost('/v1/agents/v2/migrate', only ? { agents: [only] } : {});
      // Composed here for the same reason the banner is: `next_step` is the node's English. The
      // numbers are the node's, the sentence is the reader's.
      const moved = (resp?.data?.moved ?? []).length;
      const stuck = (resp?.data?.still_stuck ?? []).length;
      setOutcome({
        ok: true,
        text: stuck === 0
          ? t('fleet.migrate.doneAll')
          : t('fleet.migrate.donePartial').replace('{n}', String(moved)).replace('{stuck}', String(stuck)),
      });
    } catch (err) {
      swallowed('fleet: migrate', err);
      setOutcome({ ok: false, text: t('fleet.migrate.failed') });
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

  const heading = embedded ? '' : html`<h1 class="flt-title">${t('fleet.title')}</h1>`;

  if (!signedIn) {
    return html`<div class="flt">
      ${heading}
      <${EmptyState} title=${t('fleet.signedOut')} text=${t('fleet.signedOutText')} />
    </div>`;
  }
  if (!agents) return html`<div class="flt"><${Spinner} text=${t('fleet.loading')} /></div>`;

  const problems = agents.filter(a => NEEDS_ATTENTION.has(a.credential?.state));
  const shown = onlyProblems ? problems : agents;

  // WHICH ROWS GET A MOVE BUTTON, answered by the node rather than re-derived here. `would_move` is
  // what POST would actually act on; a second opinion computed from the state word would eventually
  // disagree with it, and the row that disagrees is the one offering a button that refuses.
  const movable = new Set((migration?.would_move ?? []).map(m => m.name));
  const connectorReady = (migration?.daemons ?? []).length > 0;

  // Grouped by the state they are in, because the state is what the sentence is about. A group of
  // one still gets a header: a lone row with its sentence above it reads the same as the others,
  // and a list whose shape changes with its length is harder to scan than one that does not.
  // "Stored sign-in" was on all three group headings, so it separated nothing and cost a reader a
  // phrase they have never met. It appears only on an account that actually has both families.
  const kindsPresent = new Set(shown.map(a => (a.credential?.kind === 'key-and-card' ? 'key-and-card' : 'device-token')));
  const showKind = kindsPresent.size > 1;

  const groups = [];
  for (const state of STATE_ORDER) {
    for (const kind of ['device-token', 'key-and-card']) {
      const rows = shown.filter(a => (a.credential?.state || 'unknown') === state
        && (a.credential?.kind === 'key-and-card' ? 'key-and-card' : 'device-token') === kind);
      if (rows.length > 0) groups.push({ state, kind, rows });
    }
  }

  return html`
    <div class="flt">
      ${heading}
      ${!embedded && html`<p class="flt-desc">${t('fleet.desc')}</p>`}

      ${agents.length === 0
        ? html`${starter}<${EmptyState} title=${t('fleet.emptyTitle')} text=${t('fleet.emptyText')} />`
        : html`
          ${/* THE ALARM COMES FIRST. The starter card ("create two agents") used to be above this,
                so at 1280x460 the whole first screen invited a person to make MORE agents while
                eighteen of theirs were locked out, and the warning began 660px down. When nothing
                is broken there is no banner and the starter card is the top card, which is the
                right order for that case and the reason this is a slot rather than a fixed spot. */''}
          ${migration && (migration.would_move ?? []).length > 0 && html`
            <${MigrateBanner} migration=${migration} migrating=${migrating} outcome=${outcome} onPress=${migrate} />
          `}
          ${starter}
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
            ${/* PRESSING THE FILTER LOOKED LIKE IT DID NOTHING. On this account it hides one healthy
                  agent, 1300px down, so the visible list was byte-identical before and after and a
                  person concluded the control was broken. It says what it took away. */''}
            ${onlyProblems && html`
              <span class="flt-hidden">${agents.length - problems.length === 1
                ? t('fleet.hiddenOne')
                : t('fleet.hidden').replace('{n}', String(agents.length - problems.length))}</span>
              <button class="btn-ghost btn-sm" onClick=${() => setOnlyProblems(false)}>${t('fleet.showAll')}</button>
            `}
          </div>

          ${groups.map(g => html`
            <section class="flt-group" key=${`${g.state}-${g.kind}`}>
              ${/* The sentence, once. Every row under this header is in the same state AND of the
                    same credential kind, so the sentence is true of all of them — it would
                    otherwise be repeated verbatim, fifty-two times on this developer's account. */''}
              ${/* The colour is on the STATE WORD, not the heading. `never` and `unknown` resolve to
                    --text-muted, and as a heading colour that made "Never connected" — six agents'
                    worth — the palest text on the page, paler than the body copy above it. */''}
              <h2 class="flt-group-head">
                <span class="flt-group-state flt-state--${g.state}">${t(`fleet.state.${g.state}`)}</span>
                ${showKind && html`<span class="flt-group-kind">${g.kind === 'key-and-card' ? t('fleet.kindKey') : t('fleet.kindToken')}</span>`}
                <span class="flt-group-count">${g.rows.length === 1
                  ? t('fleet.groupCountOne')
                  : t('fleet.groupCount').replace('{n}', String(g.rows.length))}</span>
              </h2>
              <p class="flt-group-note">${groupNote(g.state, g.kind)}</p>
              <ul class="flt-list">
                ${g.rows.map(a => html`
                  <li class="flt-row" key=${a.gaii}>
                    <div class="flt-row-main">
                      ${/* The GAII lives here, on the name it belongs to. As a column it was the
                            agent's name followed by an owner and node identical on all 68 rows. */''}
                      <a class="flt-name" title=${a.gaii}
                         href=${`/v1/profile?tab=agents&agent=${encodeURIComponent(a.name)}`}
                         onClick=${(e) => openAgent(e, a.name, embedded)}>
                        ${a.display_name || a.name}
                      </a>
                      ${a.credential?.connected && html`<span class="flt-live">${t('fleet.connectedNow')}</span>`}
                      ${/* INTERACTIVE was on 16 of 19 rows: a badge on almost every row separates
                            nothing and just puts a second grey block after every name. It is the
                            default, so only a departure from it is worth a badge. */''}
                      ${a.mode && a.mode !== 'interactive' && html`<span class="flt-badge">${t(`profile.agents.mode.${a.mode}`)}</span>`}
                      ${a.run_mode && html`<span class="flt-badge flt-badge--run">${t(`profile.agents.runMode.${a.run_mode}`)}</span>`}
                      ${/* MOVE THIS ONE. The banner above moves everything at once, which is right
                            when a person wants the fleet fixed and useless when they want one agent
                            fixed — and one agent is what a person wants while they are testing, or
                            watching a particular daemon, or unwilling to touch seventeen others.
                            Only on the rows it can act on: a row this button would refuse must not
                            carry it, and `movable` is the node's own answer, not a guess from the
                            state word. Sits at the end of the row so the name still leads. */''}
                      ${movable.has(a.name) && html`
                        <button class="btn-ghost btn-sm flt-row-move"
                                disabled=${migrating || !connectorReady}
                                title=${connectorReady ? '' : t('fleet.migrate.needConnector')}
                                onClick=${() => migrate(a.name)}>
                          ${migrating ? t('fleet.migrate.working') : t('fleet.migrate.actionRow')}
                        </button>
                      `}
                      ${/* The credential kind moved to the group header: it is now part of what
                            DEFINES the group, so a badge repeating it on every row said nothing.
                            What is left here is the countdown, which differs row to row. */''}
                      ${rowDetail(a.credential) && html`<span class="flt-days">${rowDetail(a.credential)}</span>`}
                    </div>
                    ${(a.platform || a.stats?.tasks?.active > 0 || a.stats?.messages?.total > 0) && html`
                      <div class="flt-row-meta">
                        ${a.platform ? html`<span>${a.platform}</span>` : ''}
                        ${a.stats?.tasks?.active > 0 ? html`<span>${t('fleet.openWork').replace('{n}', String(a.stats.tasks.active))}</span>` : ''}
                        ${a.stats?.messages?.total > 0 ? html`<span>${a.stats.messages.total === 1
                          ? t('fleet.messagesOne')
                          : t('fleet.messages').replace('{n}', String(a.stats.messages.total))}</span>` : ''}
                      </div>
                    `}
                  </li>
                `)}
              </ul>
            </section>
          `)}
        `}
    </div>
  `;
}
