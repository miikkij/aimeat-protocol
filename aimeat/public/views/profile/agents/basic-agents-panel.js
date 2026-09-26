/**
 * @file public/views/profile/agents/basic-agents-panel.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "create my basic agents" section: one press, two working agents.
 *
 *   It exists because the alternative is the road every other agent takes — install a connector,
 *   run a command, paste a prompt into a chat, approve a code — and someone who has just arrived
 *   should be able to have agents before learning any of that.
 *
 *   THE ONE PRECONDITION IS STATED UP FRONT, not discovered by pressing. The agents run in the
 *   person's own `aimeat connect serve`, so with nothing connected there is nothing to run them; the
 *   section says that and disables the action rather than letting the press fail. The state comes
 *   from the node (GET /v1/agents/v2/basic-agents), which is also where the SET is defined — this
 *   panel carries no list of its own, so the names can change on the node without touching it.
 *
 *   THE SECTION FOLDS. Open while there is something to press; once both agents exist it closes to
 *   one line, and whichever way the person leaves it, this browser remembers (tab-helpers loadFold).
 *
 * @structure BasicAgentsPanel({ session, showToast, onCreated, first })
 * @usage <${BasicAgentsPanel} session=${session} showToast=${showToast} onCreated=${loadData} />
 * @version-history
 *   v2.12.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.11.0 — 2026-09-26 — A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v2.10.0 — 2026-09-25 — The sentence under the two agents is a lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v2.9.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger), a unification: Jouni's decision Status.
 *   v2.8.0 — 2026-09-25 — The one line a folded section shows is its lead (.og-lead); it keeps only its margin (a unification: the look most tabs use).
 *   v2.7.0 — 2026-09-25 — The two agents are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v2.6.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.5.0 — 2026-09-25 — A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v2.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v2.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   v2.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v2.0.0 — 2026-09-14 — The poster face (design canvas "Your Agents"): a numbered B1 section with
 *     an Open/Close door the browser remembers, the two agents as numbered rows, one slab.
 *   2026-09-13 -- V2y: compose the section headline with the shared B1 class.
 *   2026-09-03 — An `emphasis` prop so the Agents section can render the button as an outline, and
 *     the acts-alone notice agrees with itself when there is one name. Default unchanged.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { areaLine } from '/js/consent-vocab.js';
import { PageSection } from '/components/PageSection.js';
import { loadFold, saveFold } from './tab-helpers.js';
import { Hint } from '/components/Hint.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';

const p = (key, vars) => t('profile.agents.page.' + key, vars);

export default function BasicAgentsPanel({ session, showToast, onCreated, first = false }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  // null until the person chooses: open while there is still something to press, closed once
  // both agents exist. The choice, once made, is this browser's.
  const [fold, setFold] = useState(() => loadFold(session?.owner, 'basic', null));

  async function load() {
    try {
      const resp = await apiGet('/v1/agents/v2/basic-agents');
      setState(resp?.data ?? null);
    } catch (err) { swallowed('basic-agents-panel: load', err); setState(null); }
  }

  useEffect(() => { if (session) { load(); setFold(loadFold(session.owner, 'basic', null)); } }, [session]);

  // The connector connecting or dropping is an `agents` change, so this panel re-reads on the same
  // event the fleet list does — otherwise the line would still say "not connected" a minute after
  // the person started their connector.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail?.domains;
      if (d && !d.has('agents')) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function create() {
    setBusy(true);
    try {
      const resp = await apiPost('/v1/agents/v2/basic-agents', {});
      const made = resp?.data?.enrolled?.length ?? 0;
      showToast(made > 0
        ? t('profile.agents.basic.done').replace('{count}', String(made))
        : t('profile.agents.basic.alreadyThere'));
      await load();
      onCreated?.();
    } catch (err) {
      showToast(err?.message || t('profile.agents.basic.failed'), true);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const list = state.agents ?? [];
  const missing = list.filter(a => !a.exists || !a.enrolled);
  const allThere = missing.length === 0;
  const connected = state.daemon_connected === true;
  const open = fold === null ? !allThere : fold;
  const toggle = () => { const next = !open; setFold(next); saveFold(session?.owner, 'basic', next); };
  // `task-runner` is, in the node's own words, "the person saying start without asking me each
  // time" — services/agent-task-rules.ts activates a queued task for one without the owner. That
  // is the single most consequential thing about this button, so it is named rather than left in
  // a mode string nobody outside the code reads.
  const actsAlone = list.filter(a => a.mode === 'task-runner');
  const names = list.map(a => a.display_name || a.name).join(', ');
  const connectorWord = connected
    ? html`<span class="poster-status poster-status--fine">✓ ${t('profile.agents.basic.connected')}</span>`
    : html`<span class="poster-status poster-status--attention">✗ ${t('profile.agents.basic.notConnected')}</span>`;
  const door = html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${toggle}>${open ? p('close') : p('open')}</button>`;

  return html`
    <${PageSection} id="agp-basic" num="01" title=${t('profile.agents.basic.title')}
      count=${allThere ? t('profile.agents.basic.allThere') : null} doors=${door} first=${first}>
      ${!open ? html`
        <p class="og-lead agp-folded">
          ${allThere ? p('basicHaveLine', { names }) : p('basicMissingLine', { n: missing.length })}
          ${' '}${connectorWord}
        </p>` : html`
        <p class="og-lead">${t('profile.agents.basic.desc')}</p>
        <div>${connectorWord}</div>
        ${!connected && html`<${Hint}>${t('profile.agents.basic.notConnectedHint')}<//>`}
        <${IndexList} steps className="agp-basic-list">
          ${list.map((a) => html`
            <${IndexStep} key=${a.name}
              line=${html`${a.description}
                ${(a.scopes ?? []).length > 0 && html`<small>${t('profile.agents.basic.reaches')} ${areaLine(a.scopes, t)}</small>`}`}
              end=${a.enrolled ? html`<span class="og-fold-r">${t('profile.agents.basic.have')}</span>` : null}>
              ${a.display_name || a.name}<span class="poster-chips">
                <span class="poster-chip">${t(`profile.agents.runMode.${a.run_mode}`)}</span>
                ${a.mode === 'task-runner' && html`<span class="poster-chip poster-chip--coral" title=${t('profile.agents.basic.actsAloneWhy')}>${t('profile.agents.basic.actsAlone')}</span>`}
              </span>
            <//>
          `)}
        <//>
        ${actsAlone.length > 0 && html`
          <p class="og-lead agp-basic-notice">
            ${/* One name took the plural verb: "Workflow manager start work as soon as it
                  arrives". The template was written for a list and there is usually one. */''}
            ${t(actsAlone.length === 1 ? 'profile.agents.basic.actsAloneNoticeOne' : 'profile.agents.basic.actsAloneNotice')
              .replace('{names}', actsAlone.map(a => a.display_name || a.name).join(', '))}
          </p>`}
        ${!allThere && html`
          <div class="agp-basic-actions">
            <button type="button" class="poster-slab poster-slab--control" disabled=${!connected || busy} onClick=${create}>
              ${busy ? t('profile.agents.basic.working') : t('profile.agents.basic.button')}
            </button>
          </div>`}
      `}
    <//>
  `;
}
