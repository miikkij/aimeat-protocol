/**
 * @file agent-solo.js
 * @description Standalone single-agent view, served at /v1/profile?solo=<name>.
 *   Opened in its own window by the agent "pop out" button so the owner can
 *   place several agents side by side. Reuses the AgentCard component in
 *   soloMode (always expanded, no collapse, no pop-out button) and shares the
 *   logged-in session via localStorage (same origin). Opens its own SSE
 *   connection so the card live-updates independently.
 * @structure AgentSolo (default export)
 * @version-history
 *   v1.0.0 -- 2026-05-31 -- Initial creation for the agent pop-out window
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { getSession } from '/js/services/auth.js';
import { connect, disconnect, onUpdate, offUpdate } from '/lib/live-updates.js';
import { listAgents } from '/js/services/agents.js';
import { getOnboarding } from '/js/services/agent-integration.js';
import { listTasks } from '/js/services/agent-tasks.js';
import AgentCard from './profile/agents/agent-card.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

function getSoloName() {
  try { return new URLSearchParams(window.location.search).get('solo') || ''; }
  catch (err) { swallowed('agent-solo', err); return ''; }
}

export default function AgentSolo() {
  const session = getSession();
  const name = getSoloName();
  const [agent, setAgent] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [allAgents, setAllAgents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(cur => (cur && cur.msg === msg ? null : cur)), 3000);
  }, []);

  const load = useCallback(async () => {
    if (!session || !name) return;
    try {
      const list = await listAgents(session.owner);
      setAllAgents(list);
      const a = list.find(x => x.name === name);
      if (!a) { setError(t('profile.agents.solo.notFound')); setLoading(false); return; }
      // Enrich with today's task stats, same as the list view does.
      let taskStats = null;
      try {
        const [doneResp, activeResp] = await Promise.all([
          listTasks(name, { status: 'done', per_page: 100 }),
          listTasks(name, { status: 'active', per_page: 100 }),
        ]);
        const today = new Date().toISOString().slice(0, 10);
        taskStats = {
          done: (doneResp?.data?.tasks || []).filter(tk => tk.completedAt?.startsWith(today)).length,
          active: (activeResp?.data?.tasks || []).length,
        };
      } catch (err) { swallowed('agent-solo: active', err); }
      setAgent({ ...a, taskStats });
      try { const ob = await getOnboarding(name); setOnboarding(ob?.data?.onboarding || null); }
      catch (err) { swallowed('agent-solo', err); setOnboarding(null); }
      setError(null);
    } catch (e) {
      setError(e.message || 'Error');
    }
    setLoading(false);
  }, [session, name]);

  useEffect(() => { load(); }, [load]);

  // Title the window after the agent so multiple pop-outs are distinguishable.
  useEffect(() => { if (name) document.title = `${name} — AIMEAT`; }, [name]);

  // This is a standalone window — profile.js (which normally bridges SSE to the
  // `aimeat-live-update` event the tabs listen for) is not mounted here, so we
  // open our own connection and dispatch the event ourselves.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!session) return;
    const notify = () => {
      window.dispatchEvent(new CustomEvent('aimeat-live-update'));
      loadRef.current();
    };
    connect(() => getSession()?.jwt);
    onUpdate(notify);
    return () => { offUpdate(notify); disconnect(); };
    // Keyed on the stable owner id: getSession() returns a fresh object each render,
    // so depending on `session` itself would tear down and reopen the SSE connection
    // every render. loadRef.current always holds the latest load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.owner]);

  if (!session) {
    return html`<div class="pf pf-agd-solo"><div class="pf-agd-empty">${t('profile.agents.solo.loginRequired')}</div></div>`;
  }
  if (loading && !agent) {
    return html`<div class="pf pf-agd-solo"><div class="pf-agd-empty">${t('profile.loading')}</div></div>`;
  }
  if (error) {
    return html`<div class="pf pf-agd-solo"><div class="pf-agd-empty">${error}</div></div>`;
  }

  return html`
    <div class="pf pf-agd-solo">
      <${AgentCard}
        agent=${agent}
        onboarding=${onboarding}
        expanded=${true}
        soloMode=${true}
        onToggle=${() => {}}
        session=${session}
        showToast=${showToast}
        allAgents=${allAgents}
      />
      ${toast && html`<div class="pf-agd-solo-toast ${toast.isErr ? 'pf-agd-solo-toast--err' : ''}">${toast.msg}</div>`}
    </div>
  `;
}
