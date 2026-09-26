/**
 * @file agents.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism Agents tab — attached agents listed first; "+ Attach agent" opens a picker
 *   of the user's OWN agents (free-text GAII attach behind "Advanced"), with per-agent activity
 *   context aggregated from the accessible workspaces. Extracted from organisms-tab.js, no behaviour
 *   change.
 * @structure OrgAgentsPanel
 * @usage import { OrgAgentsPanel } from '/views/profile/organisms/agents.js';
 * @version-history
 *   v1.10.0 — 2026-09-26 — The line under an agent's name is the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.9.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.8.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.7.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — "Advanced: attach by ID" is the action link (.poster-action) (a unification: Jouni's decision "Action link").
 *   v1.5.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — A picture of a person or a thing is the Object box's avatar cut (.poster-box--avatar), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Agent activity context comes from one getAgentsActivity(orgId) call instead
 *     of a per-workspace getWorkspaceActivity fan-out.
 *   v1.2.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { LoadingLine } from '/views/profile/shared.js';
import { QuietNote } from '/components/QuietNote.js';
import * as orgService from '/js/services/organisms.js';
import { listAgents, offersWorkspaceContract, contractNamesOf } from '/js/services/agents.js';
import { relTime } from '/views/profile/organisms/helpers.js';
import { swallowed } from '/js/swallowed.js';

/**
 * Agents tab — attached agents listed first; "+ Attach agent" opens a picker of the user's OWN
 * agents (the node knows them — no GAII syntax needed), with free-text attach-by-ID behind an
 * "Advanced" link for cross-node agents. Each row shows where the agent has acted (aggregated
 * from the accessible workspaces' activity feeds) or, for own agents, when it was last active.
 */
export function OrgAgentsPanel({ org, ghii, canManage, showToast, onChanged }) {
  const orgId = org.id;
  const attached = org.agentGaiis || [];
  const [mine, setMine] = useState(null);            // own agents (picker) — null = loading
  const [pick, setPick] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [acted, setActed] = useState({});            // agent name → { count, lastAt, ws: Set }

  useEffect(() => {
    listAgents(ghii).then(a => setMine((a || []).filter(x => !String(x.name || '').startsWith('session-')))).catch(() => setMine([]));
  }, [ghii]);

  // Best-effort activity context: which workspaces each agent has touched, and when last. ONE
  // aggregated request replaces the old per-workspace getWorkspaceActivity fan-out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agents = await orgService.getAgentsActivity(orgId);
        const map = {};
        for (const [name, v] of Object.entries(agents)) map[name] = { count: v.count, lastAt: v.lastAt, ws: new Set(v.workspaces || []) };
        if (!cancelled) setActed(map);
      } catch (err) { swallowed('agents: OrgAgentsPanel', err); }
    })();
    return () => { cancelled = true; };
  }, [orgId, attached.length]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.ok === false) showToast(r?.error?.message || (t('organisms.agentFailed') || 'Failed'));
      else { if (okMsg) showToast(okMsg); onChanged?.(); }
    } catch (e) { showToast((e && e.message) || (t('organisms.agentFailed') || 'Failed')); }
    finally { setBusy(false); }
  };
  const attach = (g) => {
    const id = (g || '').trim();
    if (!id) return;
    setPick(''); setAgentId(''); setShowAttach(false);
    run(() => orgService.attachAgent(orgId, id), t('organisms.agentAttached') || 'Agent attached');
  };
  const detach = (g) => run(() => orgService.detachAgent(orgId, g), t('organisms.agentDetached') || 'Agent detached');

  const attachedSet = new Set(attached);
  const pickable = (mine || []).filter(a => a.gaii && !attachedSet.has(a.gaii));
  const parseGaii = (g) => { const m = /^([^#]+)#([^@]+)@(.+)$/.exec(g) || []; return { name: m[1] || g, owner: m[2] || '', node: m[3] || '' }; };
  const ownByGaii = new Map((mine || []).map(a => [a.gaii, a]));

  return html`
    <div class="card-detail">
      <div class="pj-tabhead">
        <div class="section-desc pj-tabhead-desc">${t('organisms.agentsDesc') || 'An attached agent works in this organism with its owner’s member rights — it shows up in workspace participants and activity.'}</div>
        <button class="poster-slab poster-slab--control" onClick=${() => setShowAttach(s => !s)}>${'+ '}${t('organisms.attachAgent') || 'Attach agent'}</button>
      </div>

      ${showAttach ? html`
        <div class="pj-attach poster-box">
          ${mine === null ? html`<${LoadingLine} />` : (pickable.length > 0 ? html`
            <div class="flex-row-wrap">
              <select class="select-field" value=${pick} onChange=${e => setPick(e.target.value)}>
                <option value="">${t('organisms.pickAgent') || 'Choose one of your agents…'}</option>
                ${pickable.map(a => html`<option value=${a.gaii} key=${a.gaii}>${(a.display_name || a.name) + (offersWorkspaceContract(a) ? ` · 📜 ${t('organisms.contractTag') || 'contract'}` : '')}</option>`)}
              </select>
              <button class="poster-action poster-action--small" disabled=${busy || !pick} onClick=${() => attach(pick)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : html`
            <div class="section-desc">${t('organisms.noOwnAgentsLeft') || 'All your agents are already attached (or you have none yet).'}</div>`)}
          <button type="button" class="poster-action poster-action--small" aria-expanded=${showAdvanced ? 'true' : 'false'} onClick=${() => setShowAdvanced(s => !s)}>${t('organisms.advancedAttach') || 'Advanced: attach by ID'}</button>
          ${showAdvanced ? html`
            <div class="flex-row-wrap">
              <input class="og-input" placeholder=${t('organisms.agentGaiiPlaceholder') || 'agent#owner@node'} value=${agentId}
                onInput=${(e) => setAgentId(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') attach(agentId); }} />
              <button class="poster-action poster-action--small" disabled=${busy || !agentId.trim()} onClick=${() => attach(agentId)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : null}
        </div>` : null}

      ${attached.length === 0 ? html`<${QuietNote}>${t('organisms.noAgents') || 'No agents attached.'}<//>` : null}
      ${attached.map(g => {
        const p = parseGaii(g);
        const own = ownByGaii.get(g);
        const act = acted[p.name];
        return html`
          <div class="pj-org-row" key=${'ag-' + g}>
            <div class="pj-org-avatar poster-box poster-box--avatar poster-box--small" aria-hidden="true">${'🤖'}</div>
            <div class="pj-org-main pj-org-main-static">
              <div class="pj-org-titlerow">
                <span class="pj-org-name">${(own?.display_name || p.name)}</span>
                ${p.node ? html`<span class="poster-chip">${(p.node)}</span>` : null}
                ${own && offersWorkspaceContract(own) ? html`<span class="poster-chip" title=${(t('organisms.contractAgentHint') || 'Advertises a workspace contract') + (contractNamesOf(own).length ? `: ${contractNamesOf(own).join(', ')}` : '')}>${'📜 '}${t('organisms.contractTag') || 'contract'}</span>` : null}
              </div>
              <div class="pj-org-desc listing-meta" title=${g}>
                <span class="mono">${(p.owner ? `${p.name}#${p.owner}` : g)}</span>
                ${act ? html` · ${t('organisms.agentActedIn') || 'active in'} ${([...act.ws].join(', '))} (${act.count}) · ${relTime(act.lastAt)}`
                  : (own?.last_seen ? html` · ${t('organisms.lastActive') || 'last active'} ${relTime(own.last_seen)}` : null)}
              </div>
            </div>
            ${(canManage || g.includes('#' + ghii + '@'))
              ? html`<button class="poster-action poster-action--small" disabled=${busy} onClick=${() => detach(g)}>${t('organisms.detach') || 'Detach'}</button>`
              : null}
          </div>`;
      })}
    </div>`;
}
