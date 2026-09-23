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
 *   v1.2.1 -- 2026-09-22 -- Detach carries the danger tone.
 *   v1.2.0 -- 2026-09-22 -- Composed from the shared set (ListRow, Chip, Field, Surface): no class of its
 *     own; the robot and scroll emoji are gone.
 *   v1.0.0 — 2026-06-19 — Extracted from organisms-tab.js during the module split.
 *   v1.1.0 — 2026-06-22 — Agent activity context comes from one getAgentsActivity(orgId) call instead
 *     of a per-workspace getWorkspaceActivity fan-out.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Stack, ListRow, Chip, Action, Field, Surface, Text } from '/components/poster-parts.js';
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

  return html`<${Stack}>
    <${Stack} direction="wrap" align="between">
      <${Text} tone="muted">${t('organisms.agentsDesc') || 'An attached agent works in this organism with its owner’s member rights — it shows up in workspace participants and activity.'}<//>
      <${Action} kind="tab" selected=${showAttach} expanded=${showAttach} onClick=${() => setShowAttach(s => !s)}>${t('organisms.attachAgent') || 'Attach agent'}<//>
    <//>

    ${showAttach ? html`
      <${Surface} kind="box" density="compact">
        <${Stack}>
          ${mine === null ? html`<${Text} tone="muted">${t('profile.loading')}<//>` : (pickable.length > 0 ? html`
            <${Stack} direction="horizontal" align="end">
              <${Field} type="select" value=${pick} onChange=${e => setPick(e.target.value)} options=${[
                { value: '', label: t('organisms.pickAgent') || 'Choose one of your agents…' },
                ...pickable.map(a => ({ value: a.gaii, label: (a.display_name || a.name) + (offersWorkspaceContract(a) ? ` · ${t('organisms.contractTag') || 'contract'}` : '') })),
              ]} />
              <${Action} disabled=${busy || !pick} onClick=${() => attach(pick)}>${t('organisms.attach') || 'Attach'}<//>
            <//>` : html`
            <${Text} kind="caption" tone="muted">${t('organisms.noOwnAgentsLeft') || 'All your agents are already attached (or you have none yet).'}<//>`)}
          <${Stack} direction="wrap"><${Action} kind="text" expanded=${showAdvanced} onClick=${() => setShowAdvanced(s => !s)}>${t('organisms.advancedAttach') || 'Advanced: attach by ID'}<//><//>
          ${showAdvanced ? html`
            <${Stack} direction="horizontal" align="end">
              <${Field} placeholder=${t('organisms.agentGaiiPlaceholder') || 'agent#owner@node'} value=${agentId}
                onInput=${(e) => setAgentId(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') attach(agentId); }} />
              <${Action} disabled=${busy || !agentId.trim()} onClick=${() => attach(agentId)}>${t('organisms.attach') || 'Attach'}<//>
            <//>` : null}
        <//>
      <//>` : null}

    ${attached.length === 0 ? html`<${Text} tone="muted">${t('organisms.noAgents') || 'No agents attached.'}<//>` : null}
    ${attached.length > 0 ? html`<${Stack} density="compact">${attached.map(g => {
      const p = parseGaii(g);
      const own = ownByGaii.get(g);
      const act = acted[p.name];
      const where = act ? ` · ${t('organisms.agentActedIn') || 'active in'} ${([...act.ws].join(', '))} (${act.count}) · ${relTime(act.lastAt)}`
        : (own?.last_seen ? ` · ${t('organisms.lastActive') || 'last active'} ${relTime(own.last_seen)}` : '');
      return html`
        <${ListRow} key=${'ag-' + g} density="compact" name=${own?.display_name || p.name}
          detail=${`${p.owner ? `${p.name}#${p.owner}` : g}${where}`}
          actions=${html`
            ${p.node ? html`<${Chip} tone="muted">${p.node}<//>` : null}
            ${own && offersWorkspaceContract(own) ? html`<${Chip} tone="sun" title=${(t('organisms.contractAgentHint') || 'Advertises a workspace contract') + (contractNamesOf(own).length ? `: ${contractNamesOf(own).join(', ')}` : '')}>${t('organisms.contractTag') || 'contract'}<//>` : null}
            ${(canManage || g.includes('#' + ghii + '@'))
              ? html`<${Action} tone="danger" disabled=${busy} onClick=${() => detach(g)}>${t('organisms.detach') || 'Detach'}<//>`
              : null}`} />`;
    })}<//>` : null}
  <//>`;
}
