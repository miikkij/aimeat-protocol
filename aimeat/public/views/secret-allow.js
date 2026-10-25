/**
 * @file secret-allow.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allows an extension to send one of their secrets to one address, at
 *   /v1/secret-allow?secret=<NAME>&extension=<name>&host=<host>. The refusal an extension's call met
 *   names this address, the bell notice links here, and so may the AI that met the refusal. The page
 *   reads the question from the node (GET /v1/secrets/:name/approval), never from its own address, so
 *   a link someone else wrote cannot put words in it: who installed the extension, the address and
 *   the reason are the ones the node recorded when the call was refused.
 *
 *   Allow is POST /v1/secrets/:name/approvals; Don't allow is POST .../approvals/decline. Both are the
 *   account holder's own, signed in: an agent or an app gets a refusal from the node.
 * @structure default export SecretAllow() — signed out: sign in; gone; ready: the question; done
 * @usage routed at /v1/secret-allow by spa.html (and a spaRoute in routes/portal.ts)
 * @version-history
 *   v1.3.0 — 2026-10-25 — The question is read again on the live `secrets` and `notifications` events,
 *     and an Allow that finds it answered elsewhere shows it as it stands, never a failure (the developer's review).
 *   v1.2.0 — 2026-10-22 — A decline the node did not record (allowed meanwhile) reloads the question
 *     instead of saying "Not allowed" (found by the eco-capability-allow browser check).
 *   v1.1.0 — 2026-10-21 — Browser check: buttons at the control size, the tag at the label size, a
 *     `why` that starts with "to" reads once, and the way back opens the Secrets section.
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up; pattern of agent-allow.js).
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
import { onLiveUpdate } from '/lib/live-updates.js';

const html = htm.bind(h);

/** An extension's `why` as it reads after "to": a leading "to " and a closing full stop dropped. */
const purpose = (why) => String(why).trim().replace(/^to\s+/i, '').replace(/[.\s]+$/, '');

export default function SecretAllow() {
  const q = new URLSearchParams(window.location.search);
  const secret = q.get('secret') || '';
  const extension = q.get('extension') || '';
  const host = q.get('host') || '';
  const session = useSession();
  const [view, setView] = useState({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const path = `/v1/secrets/${encodeURIComponent(secret)}`;

  const load = useCallback(() => api(`${path}/approval?extension=${encodeURIComponent(extension)}&host=${encodeURIComponent(host)}`, { retries: 0 })
    .then((res) => ({ status: 'ready', data: res?.data || null }))
    .catch((err) => { swallowed('secret-allow: load', err); return { status: 'gone', data: null }; }), [path, extension, host]);

  useEffect(() => {
    if (!session) { setView({ status: 'signin', data: null }); return undefined; }
    if (!secret || !extension || !host) { setView({ status: 'gone', data: null }); return undefined; }
    let live = true;
    load().then((v) => { if (live) setView(v); });
    // An answer given elsewhere (the bell, another tab, the Access page) arrives as a live event: the
    // question is read again, so the page never offers buttons for a question already answered.
    const off = onLiveUpdate(['secrets', 'notifications'], () => load().then((v) => {
      if (live) setView((cur) => (cur.status === 'allowed' || cur.status === 'declined' ? cur : v));
    }));
    return () => { live = false; off(); };
  }, [secret, extension, host, session, load]);

  const answer = useCallback(async (allow) => {
    setBusy(true); setFailed('');
    try {
      const res = await api(`${path}/approvals${allow ? '' : '/decline'}`, { method: 'POST', body: JSON.stringify({ extension, host }) });
      // A decline the node did not record (allowed meanwhile in another tab or from the bell, or no
      // longer waiting) shows the question as the node holds it now, never "Not allowed".
      if (!allow && res?.data?.declined === false) setView(await load());
      else setView((v) => ({ ...v, status: allow ? 'allowed' : 'declined' }));
    } catch (err) {
      swallowed('secret-allow: answer', err);
      // Answered elsewhere since this page opened: show the question as it stands now, not a failure.
      if (err?.code === 'APPROVAL_NOT_FOUND' || err?.status === 404) setView(await load());
      else setFailed(t('secretAllow.failed'));
    }
    setBusy(false);
  }, [path, extension, host, load]);

  // The row label at its normal size (browser check: the tag's 10.88px was too small to read).
  const tag = html`<${Label}>${t('secretAllow.badge')}<//>`;
  // Straight to the Secrets section, where the address and the approvals are.
  const toAccess = html`<${Action} control href="/v1/profile?tab=access&section=ac-secrets">${t('secretAllow.toAccess')}<//>`;

  if (view.status === 'loading') return html`<${AskPage} message=${t('common.loading')} />`;
  if (view.status === 'signin') {
    return html`
      <${AskPage} tag=${tag} title=${t('secretAllow.signInTitle')}
        doors=${html`<${Loud} control onClick=${() => showLoginModal({})}>${t('secretAllow.signIn')}<//>`}>
        <${Note} kind="lead">${t('secretAllow.signInLead')}<//>
      <//>`;
  }
  if (view.status === 'gone' || !view.data) {
    return html`
      <${AskPage} tag=${tag} title=${t('secretAllow.goneTitle')} doors=${toAccess}>
        <${Note} kind="lead">${t('secretAllow.gone')}<//>
      <//>`;
  }

  const d = view.data;
  const vars = { extension: d.extension, installer: d.installer, secret: d.secret, host: d.host };
  const who = { name: d.extension, meta: t('secretAllow.by', { installer: d.installer }), text: (d.extension[0] || 'E').toUpperCase() };
  const title = t('secretAllow.title', vars);
  const facts = html`
    <${Box} tone="dim">
      <${Note} kind="lead">${t('secretAllow.lead', vars)}<//>
      ${d.why ? html`<${Note} kind="lead">${t('secretAllow.why', { why: purpose(d.why) })}<//>` : null}
      ${d.host_declared ? null : html`<${Note}>${t('secretAllow.undeclared', vars)}<//>`}
    <//>`;

  if (view.status === 'allowed' || view.status === 'declined') {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toAccess}>
        ${facts}
        <${Note} kind="lead">${t(view.status === 'allowed' ? 'secretAllow.done' : 'secretAllow.declined', vars)}<//>
      <//>`;
  }
  if (d.approved_at) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toAccess}>
        ${facts}
        <${Note} kind="lead">${t('secretAllow.already', vars)}<//>
      <//>`;
  }
  // The extension changed hands since it asked: this page must not answer for the new installer.
  if (d.installer_now !== d.installer) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${title} doors=${toAccess}>
        ${facts}
        <${Note} kind="lead">${t('secretAllow.reinstalled', { ...vars, installerNow: d.installer_now || '-' })}<//>
      <//>`;
  }
  return html`
    <${AskPage} who=${who} tag=${tag} title=${title}
      doors=${html`
        <${Action} control onClick=${() => answer(false)} disabled=${busy}>${t('secretAllow.deny')}<//>
        <${Loud} control onClick=${() => answer(true)} disabled=${busy}>${t('secretAllow.allow')}<//>`}>
      ${facts}
      <${Note}>${t('secretAllow.after', vars)}<//>
      ${failed ? html`<${Note} kind="message" error>${failed}<//>` : null}
    <//>`;
}
