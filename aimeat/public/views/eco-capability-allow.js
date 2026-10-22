/**
 * @file eco-capability-allow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allows another account's capability to have their outside app run one of
 *   its actions, at /v1/eco-capability-allow?app=<app>&capability=<id>. The refusal the call met names
 *   this address, the bell notice links here, and so may the AI that met the refusal. The page reads
 *   the question from the node (GET /v1/ecosystem-apps/:app/capability-approval), never from its own
 *   address, so a link someone else wrote cannot put words in it: who registered the capability, the
 *   action and what the call sent are the ones the node recorded when it refused the call.
 *
 *   Allow is POST /v1/ecosystem-apps/:app/capability-approvals; Don't allow is POST
 *   .../capability-approvals/decline. Both are the account holder's own, signed in: an agent or an app
 *   gets a refusal from the node.
 * @structure default export EcoCapabilityAllow() — signed out: sign in; gone; ready: the question; done
 * @usage routed at /v1/eco-capability-allow by spa.html (and a spaRoute in routes/portal.ts)
 * @version-history
 *   v1.1.0 — 2026-10-22 — Browser check: a decline the node did not record (allowed meanwhile) reloads
 *     the question instead of saying "Not allowed"; the avatar letter comes from the name beside it;
 *     the sent input reads at the lead size, as secret-allow's purpose line does.
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, capability-invoke.ts ecosystem source; pattern of
 *     secret-allow.js).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

export default function EcoCapabilityAllow() {
  const q = new URLSearchParams(window.location.search);
  const app = q.get('app') || '';
  const capability = q.get('capability') || '';
  const session = useSession();
  const [view, setView] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const path = `/v1/ecosystem-apps/${encodeURIComponent(app)}`;

  const load = useCallback(() => api(`${path}/capability-approval?capability=${encodeURIComponent(capability)}`, { retries: 0 })
    .then((res) => ({ status: 'ready', data: res?.data || null }))
    .catch((err) => { swallowed('eco-capability-allow: load', err); return { status: 'gone', data: null }; }), [path, capability]);

  useEffect(() => {
    if (!session) { setView({ status: 'signin', data: null }); return undefined; }
    if (!app || !capability) { setView({ status: 'gone', data: null }); return undefined; }
    let live = true;
    load().then((v) => { if (live) setView(v); });
    return () => { live = false; };
  }, [app, capability, session, load]);

  const answer = useCallback(async (allow) => {
    setBusy(true); setFailed('');
    try {
      const res = await api(`${path}/capability-approvals${allow ? '' : '/decline'}`, { method: 'POST', body: JSON.stringify({ capability }) });
      // A decline the node did not record (allowed meanwhile in another tab or from the bell, or no
      // longer waiting) shows the question as the node holds it now, never "Not allowed".
      if (!allow && res?.data?.declined === false) setView(await load());
      else setView((v) => ({ ...v, status: allow ? 'allowed' : 'declined' }));
    } catch (err) {
      swallowed('eco-capability-allow: answer', err);
      setFailed(t('ecoCapabilityAllow.failed'));
    }
    setBusy(false);
  }, [path, capability, load]);

  const tag = html`<${Label}>${t('ecoCapabilityAllow.badge')}<//>`;
  // The Outside apps tab, where the app and what it may do are.
  const toApps = html`<${Action} control href="/v1/profile?tab=ecosystem">${t('ecoCapabilityAllow.toApps')}<//>`;

  if (view.status === 'loading') return html`<${AskPage} message=${t('common.loading')} />`;
  if (view.status === 'signin') {
    return html`
      <${AskPage} tag=${tag} title=${t('ecoCapabilityAllow.signInTitle')}
        doors=${html`<${Loud} control onClick=${() => showLoginModal({})}>${t('ecoCapabilityAllow.signIn')}<//>`}>
        <${Note} kind="lead">${t('ecoCapabilityAllow.signInLead')}<//>
      <//>`;
  }
  if (view.status === 'gone' || !view.data) {
    return html`
      <${AskPage} tag=${tag} title=${t('ecoCapabilityAllow.goneTitle')} doors=${toApps}>
        <${Note} kind="lead">${t('ecoCapabilityAllow.gone')}<//>
      <//>`;
  }

  const d = view.data;
  const vars = { registrant: d.registrant, name: d.name, app: d.app_name || d.app, action: d.action };
  const who = { name: d.name, meta: t('ecoCapabilityAllow.by', vars), text: (String(d.name || '')[0] || 'A').toUpperCase() };
  const title = t('ecoCapabilityAllow.title', vars);
  const facts = html`
    <${Box} tone="dim">
      <${Note} kind="lead">${t('ecoCapabilityAllow.lead', vars)}<//>
      ${d.input ? html`<${Note} kind="lead">${t('ecoCapabilityAllow.sent', { input: d.input })}<//>` : null}
      ${d.action_declared ? null : html`<${Note}>${t('ecoCapabilityAllow.undeclared', vars)}<//>`}
    <//>`;

  if (view.status === 'allowed' || view.status === 'declined') {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toApps}>
        ${facts}
        <${Note} kind="lead">${t(view.status === 'allowed' ? 'ecoCapabilityAllow.done' : 'ecoCapabilityAllow.declined', vars)}<//>
      <//>`;
  }
  if (d.approved_at) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toApps}>
        ${facts}
        <${Note} kind="lead">${t('ecoCapabilityAllow.already', vars)}<//>
      <//>`;
  }
  // The capability changed since it asked: this page must not answer the new question.
  if (!d.still_asks) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toApps}>
        ${facts}
        <${Note} kind="lead">${t('ecoCapabilityAllow.changed', vars)}<//>
      <//>`;
  }
  return html`
    <${AskPage} who=${who} tag=${tag} title=${title}
      doors=${html`
        <${Action} control onClick=${() => answer(false)} disabled=${busy}>${t('ecoCapabilityAllow.deny')}<//>
        <${Loud} control onClick=${() => answer(true)} disabled=${busy}>${t('ecoCapabilityAllow.allow')}<//>`}>
      ${facts}
      <${Note}>${t('ecoCapabilityAllow.after', vars)}<//>
      ${failed ? html`<${Note} kind="message" error>${failed}<//>` : null}
    <//>`;
}
