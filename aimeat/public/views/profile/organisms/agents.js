/**
 * @file agents.js
 * @description Organism Agents tab — attached agents listed first; "+ Attach agent" opens a picker
 *   of the user's OWN agents (free-text GAII attach behind "Advanced"), with per-agent activity
 *   context aggregated from the accessible workspaces. Extracted from organisms-tab.js, no behaviour
 *   change.
 * @structure OrgAgentsPanel
 * @usage import { OrgAgentsPanel } from '/views/profile/organisms/agents.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Agent activity context comes from one getAgentsActivity(orgId) call instead
 *     of a per-workspace getWorkspaceActivity fan-out.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from '/views/profile/shared.js';
import { EmptyState } from '/components/EmptyState.js';
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
        <button class="btn-primary btn-sm" onClick=${() => setShowAttach(s => !s)}>${'+ '}${t('organisms.attachAgent') || 'Attach agent'}</button>
      </div>

      ${showAttach ? html`
        <div class="pj-attach">
          ${mine === null ? html`<${Spinner} />` : (pickable.length > 0 ? html`
            <div class="flex-row-wrap">
              <select class="input-field input-sm" value=${pick} onChange=${e => setPick(e.target.value)}>
                <option value="">${t('organisms.pickAgent') || 'Choose one of your agents…'}</option>
                ${pickable.map(a => html`<option value=${a.gaii} key=${a.gaii}>${(a.display_name || a.name) + (offersWorkspaceContract(a) ? ` · 📜 ${t('organisms.contractTag') || 'contract'}` : '')}</option>`)}
              </select>
              <button class="btn-outline btn-sm" disabled=${busy || !pick} onClick=${() => attach(pick)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : html`
            <div class="section-desc">${t('organisms.noOwnAgentsLeft') || 'All your agents are already attached (or you have none yet).'}</div>`)}
          <button class="pj-linklike" onClick=${() => setShowAdvanced(s => !s)}>${t('organisms.advancedAttach') || 'Advanced: attach by ID'}</button>
          ${showAdvanced ? html`
            <div class="flex-row-wrap">
              <input class="input-field input-sm" placeholder=${t('organisms.agentGaiiPlaceholder') || 'agent#owner@node'} value=${agentId}
                onInput=${(e) => setAgentId(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') attach(agentId); }} />
              <button class="btn-outline btn-sm" disabled=${busy || !agentId.trim()} onClick=${() => attach(agentId)}>${t('organisms.attach') || 'Attach'}</button>
            </div>` : null}
        </div>` : null}

      ${attached.length === 0 ? html`<${EmptyState} icon="🤖" text=${t('organisms.noAgents') || 'No agents attached.'} />` : null}
      ${attached.map(g => {
        const p = parseGaii(g);
        const own = ownByGaii.get(g);
        const act = acted[p.name];
        return html`
          <div class="pj-org-row" key=${'ag-' + g}>
            <div class="pj-org-avatar" aria-hidden="true">${'🤖'}</div>
            <div class="pj-org-main pj-org-main-static">
              <div class="pj-org-titlerow">
                <span class="pj-org-name">${(own?.display_name || p.name)}</span>
                ${p.node ? html`<span class="badge badge-info">${(p.node)}</span>` : null}
                ${own && offersWorkspaceContract(own) ? html`<span class="badge badge-success" title=${(t('organisms.contractAgentHint') || 'Advertises a workspace contract') + (contractNamesOf(own).length ? `: ${contractNamesOf(own).join(', ')}` : '')}>${'📜 '}${t('organisms.contractTag') || 'contract'}</span>` : null}
              </div>
              <div class="pj-org-desc" title=${g}>
                <span class="mono">${(p.owner ? `${p.name}#${p.owner}` : g)}</span>
                ${act ? html` · ${t('organisms.agentActedIn') || 'active in'} ${([...act.ws].join(', '))} (${act.count}) · ${relTime(act.lastAt)}`
                  : (own?.last_seen ? html` · ${t('organisms.lastActive') || 'last active'} ${relTime(own.last_seen)}` : null)}
              </div>
            </div>
            ${(canManage || g.includes('#' + ghii + '@'))
              ? html`<button class="btn-outline btn-sm" disabled=${busy} onClick=${() => detach(g)}>${t('organisms.detach') || 'Detach'}</button>`
              : null}
          </div>`;
      })}
    </div>`;
}
