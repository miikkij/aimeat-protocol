/**
 * @file agent-allow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allows what their agent asked for, at /v1/allow?agent=<name>&need=<words>.
 *   The agent hands this address to its person when it lacks a permission (services/permission-ask.ts),
 *   the bell notice links here, and so does the email. One question in the person's language, what the
 *   agent wants to do in plain sentences, and Allow and Don't allow. No permission word is shown.
 *
 *   Allow is POST /v1/agents/:name/allow, which adds and never replaces; Don't allow is
 *   POST /v1/agents/:name/refusals/decline, the agent card's decline. A word one press may not give
 *   (outside every wildcard, or powerful) sends the person to the agent's own page instead.
 * @structure default export AgentAllow() — signed out: sign in; gone; ready: the question; done
 * @usage routed at /v1/allow?agent=<name>&need=<words> by spa.html (and a spaRoute in routes/portal.ts)
 * @version-history
 *   v1.1.0 — 2026-10-19 — The square beside the agent's name shows the agent's own picture (components/AgentAvatar.js leadProps) when it has set one; otherwise its first letter, as before.
 *   v1.0.0 — 2026-10-17 — Initial (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { scopeSentence } from '/js/consent-vocab.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { leadProps } from '/components/AgentAvatar.js';

const html = htm.bind(h);

export default function AgentAllow() {
  const q = new URLSearchParams(window.location.search);
  const agentName = q.get('agent') || '';
  const need = q.get('need') || '';
  const session = useSession();
  const [view, setView] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (!session) { setView({ status: 'signin', data: null }); return undefined; }
    if (!agentName || !need) { setView({ status: 'gone', data: null }); return undefined; }
    let live = true;
    api(`/v1/agents/${encodeURIComponent(agentName)}/allow?need=${encodeURIComponent(need)}`, { retries: 0 })
      .then((res) => { if (live) setView({ status: 'ready', data: res?.data || null }); })
      .catch((err) => { swallowed('agent-allow: load', err); if (live) setView({ status: 'gone', data: null }); });
    return () => { live = false; };
  }, [agentName, need, session]);

  const answer = useCallback(async (allow) => {
    const words = (view.data?.words || []).filter((w) => !w.held).map((w) => w.scope);
    setBusy(true); setFailed('');
    try {
      if (allow) {
        await api(`/v1/agents/${encodeURIComponent(agentName)}/allow`, { method: 'POST', body: JSON.stringify({ scopes: words }) });
      } else {
        await api(`/v1/agents/${encodeURIComponent(agentName)}/refusals/decline`, { method: 'POST', body: JSON.stringify({ needed: words }) });
      }
      setView((v) => ({ ...v, status: allow ? 'allowed' : 'declined' }));
    } catch (err) {
      swallowed('agent-allow: answer', err);
      setFailed(t('agentAllow.failed'));
    }
    setBusy(false);
  }, [agentName, view.data]);

  const tag = html`<${Mark} tone="coral">${t('agentAllow.badge')}<//>`;
  const toAgents = html`<${Action} href="/v1/profile?tab=agents">${t('agentAllow.toAgents')}<//>`;

  if (view.status === 'loading') return html`<${AskPage} message=${t('common.loading')} />`;
  if (view.status === 'signin') {
    return html`
      <${AskPage} tag=${tag} title=${t('agentAllow.signInTitle')}
        doors=${html`<${Loud} onClick=${() => showLoginModal({})}>${t('agentAllow.signIn')}<//>`}>
        <${Note} kind="lead">${t('agentAllow.signInLead')}<//>
      <//>`;
  }
  if (view.status === 'gone' || !view.data) {
    return html`
      <${AskPage} tag=${tag} title=${t('agentAllow.goneTitle')} doors=${toAgents}>
        <${Note} kind="lead">${t('agentAllow.gone')}<//>
      <//>`;
  }

  const d = view.data;
  const name = d.agent?.display_name || d.agent?.name || agentName;
  // AskPage's `who` takes `picture` (an <img>) or `text`; leadProps decides which from the agent's avatar.
  const mark = leadProps(d.agent, (name[0] || 'A').toUpperCase());
  const who = { name, meta: d.agent?.gaii || '', ...(mark.picture ? { picture: mark.picture } : { text: mark.text }) };
  const title = t('agentAllow.title', { agent: name });
  const open = (d.words || []).filter((w) => !w.held);
  const sentences = html`
    <${Box} tone="dim">
      ${(d.words || []).map((w) => html`<${Note} key=${w.scope} kind="lead">${scopeSentence(w.scope, t)}<//>`)}
    <//>`;

  if (view.status === 'allowed' || view.status === 'declined') {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toAgents}>
        ${sentences}
        <${Note} kind="lead">${t(view.status === 'allowed' ? 'agentAllow.done' : 'agentAllow.declined')}<//>
      <//>`;
  }
  if (open.length === 0) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toAgents}>
        ${sentences}
        <${Note} kind="lead">${t('agentAllow.already')}<//>
      <//>`;
  }
  if (open.some((w) => !w.one_press)) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title}
        doors=${html`<${Loud} href=${d.agent_page}>${t('agentAllow.openAgentPage')}<//>`}>
        ${sentences}
        <${Note} kind="lead">${t('agentAllow.agentPage')}<//>
      <//>`;
  }
  return html`
    <${AskPage} who=${who} tag=${tag} title=${title}
      doors=${html`
        <${Action} onClick=${() => answer(false)} disabled=${busy}>${t('agentAllow.deny')}<//>
        <${Loud} onClick=${() => answer(true)} disabled=${busy}>${t('agentAllow.allow')}<//>`}>
      ${sentences}
      <${Note}>${t('agentAllow.lead')}<//>
      ${failed ? html`<${Note} kind="message" error>${failed}<//>` : null}
    <//>`;
}
