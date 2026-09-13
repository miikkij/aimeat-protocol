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
import { Section } from '/views/profile/organisms/poster-parts.js';
import { loadFold, saveFold } from './tab-helpers.js';

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
    ? html`<span class="agp-ok">✓ ${t('profile.agents.basic.connected')}</span>`
    : html`<span class="agp-warn">✗ ${t('profile.agents.basic.notConnected')}</span>`;
  const door = html`<button type="button" class="og-door og-door--quiet" onClick=${toggle}>${open ? p('close') : p('open')}</button>`;

  return html`
    <${Section} id="agp-basic" num="01" title=${t('profile.agents.basic.title')}
      count=${allThere ? t('profile.agents.basic.allThere') : null} doors=${door} first=${first}>
      ${!open ? html`
        <p class="agp-folded">
          ${allThere ? p('basicHaveLine', { names }) : p('basicMissingLine', { n: missing.length })}
          ${' '}${connectorWord}
        </p>` : html`
        <p class="agp-lead">${t('profile.agents.basic.desc')}</p>
        <div>${connectorWord}</div>
        ${!connected && html`<p class="agp-hint">${t('profile.agents.basic.notConnectedHint')}</p>`}
        <ul class="agp-basic-list">
          ${list.map((a, i) => html`
            <li class="agp-basic-row" key=${a.name}>
              <i>${String(i + 1).padStart(2, '0')}</i>
              <span class="agp-basic-who">
                <span class="agp-basic-name">${a.display_name || a.name}</span>
                <span class="og-chip og-chip--dim">${t(`profile.agents.runMode.${a.run_mode}`)}</span>
                ${a.mode === 'task-runner' && html`<span class="og-chip og-chip--coral" title=${t('profile.agents.basic.actsAloneWhy')}>${t('profile.agents.basic.actsAlone')}</span>`}
              </span>
              <span class="agp-basic-desc">
                ${a.description}
                ${(a.scopes ?? []).length > 0 && html`<small>${t('profile.agents.basic.reaches')} ${areaLine(a.scopes, t)}</small>`}
              </span>
              <span class="og-fold-r">${a.enrolled ? t('profile.agents.basic.have') : ''}</span>
            </li>
          `)}
        </ul>
        ${actsAlone.length > 0 && html`
          <p class="agp-basic-notice">
            ${/* One name took the plural verb: "Workflow manager start work as soon as it
                  arrives". The template was written for a list and there is usually one. */''}
            ${t(actsAlone.length === 1 ? 'profile.agents.basic.actsAloneNoticeOne' : 'profile.agents.basic.actsAloneNotice')
              .replace('{names}', actsAlone.map(a => a.display_name || a.name).join(', '))}
          </p>`}
        ${!allThere && html`
          <div class="agp-basic-actions">
            <button type="button" class="og-slab" disabled=${!connected || busy} onClick=${create}>
              ${busy ? t('profile.agents.basic.working') : t('profile.agents.basic.button')}
            </button>
          </div>`}
      `}
    <//>
  `;
}
