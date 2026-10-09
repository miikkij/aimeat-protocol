/**
 * @file oauth-round.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's confirmation of a sign-in round started outside their browser, at
 *   /v1/oauth-round?state=<state> (secrets audit 2026-10-09, chapter 2). An agent that connects an
 *   outside account or signs a remote MCP server in is handed this page's address, not the
 *   provider's. The owner opens it signed in, reads what the round connects and to whom, and
 *   presses Continue: POST /v1/oauth-rounds/:state/approve binds the round to this browser with a
 *   cookie and answers the provider's address, and the page goes there. A round of another account,
 *   an expired one or a used one shows the same "cannot continue" answer.
 * @structure default export OAuthRound() — signed out: sign in; signed in: the round, then Continue
 * @usage routed at /v1/oauth-round?state=<state> by spa.html (and a spaRoute in routes/portal.ts)
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
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
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const fill = (s, vars) => Object.keys(vars).reduce((acc, k) => acc.split(`{${k}}`).join(vars[k]), s);

/** The agent's own name from its identity (`name#owner@node`), or '' for the owner themself. */
function agentNameOf(identity) {
  const local = String(identity || '').split('@')[0];
  return local.includes('#') ? local.split('#')[0] : '';
}

export default function OAuthRound() {
  const state = new URLSearchParams(window.location.search).get('state') || '';
  const session = useSession();
  const [view, setView] = useState({ status: 'loading', round: null });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    if (!session) { setView({ status: 'signin', round: null }); return undefined; }
    if (!state) { setView({ status: 'gone', round: null }); return undefined; }
    let live = true;
    api('/v1/oauth-rounds/' + encodeURIComponent(state), { retries: 0 })
      .then((res) => { if (live) setView({ status: 'ready', round: res?.data?.round || null }); })
      .catch((err) => { swallowed('oauth-round: load', err); if (live) setView({ status: 'gone', round: null }); });
    return () => { live = false; };
  }, [state, session]);

  const proceed = useCallback(async () => {
    setBusy(true); setFailed('');
    try {
      const res = await api('/v1/oauth-rounds/' + encodeURIComponent(state) + '/approve', { method: 'POST', body: '{}' });
      const url = res?.data?.authorize_url;
      if (!url) throw new Error('no authorize_url');
      window.location.href = url;
    } catch (err) {
      swallowed('oauth-round: approve', err);
      setFailed(t('oauthRound.failed'));
      setBusy(false);
    }
  }, [state]);

  const tag = html`<${Mark} tone="coral">${t('oauthRound.badge')}<//>`;
  const leave = html`<${Action} href="/v1/profile">${t('oauthRound.cancel')}<//>`;

  if (view.status === 'loading') return html`<${AskPage} message=${t('common.loading')} />`;
  if (view.status === 'signin') {
    return html`
      <${AskPage} tag=${tag} title=${t('oauthRound.signInTitle')}
        doors=${html`<${Loud} onClick=${() => showLoginModal({})}>${t('oauthRound.signIn')}<//>`}>
        <${Note} kind="lead">${t('oauthRound.signInLead')}<//>
      <//>`;
  }
  if (view.status === 'gone' || !view.round) {
    return html`
      <${AskPage} tag=${tag} title=${t('oauthRound.goneTitle')} doors=${leave}>
        <${Note} kind="lead">${t('oauthRound.gone')}<//>
      <//>`;
  }

  const r = view.round;
  const isAccount = r.kind === 'account';
  const agent = agentNameOf(isAccount ? r.for : r.started_by);
  const vars = { provider: r.provider_label || r.provider || '', server: r.server?.title || r.server?.slug || '', agent };
  const title = fill(t(isAccount ? 'oauthRound.titleAccount' : 'oauthRound.titleServer'), vars);
  const leadKey = isAccount
    ? (agent ? 'oauthRound.leadAccountAgent' : 'oauthRound.leadAccountSelf')
    : (agent ? 'oauthRound.leadServerAgent' : 'oauthRound.leadServerSelf');

  return html`
    <${AskPage} tag=${tag} title=${title}
      doors=${html`
        ${leave}
        <${Loud} onClick=${proceed} disabled=${busy}>${t('oauthRound.continue')}<//>`}>
      <${Box} tone="dim">
        <${Note} kind="lead">${fill(t(leadKey), vars)}<//>
      <//>
      <${Note}>${t('oauthRound.warn')}<//>
      ${failed ? html`<${Note} kind="message" error>${failed}<//>` : null}
    <//>`;
}
