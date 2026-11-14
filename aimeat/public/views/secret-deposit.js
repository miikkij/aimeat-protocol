/**
 * @file public/views/secret-deposit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The deposit page of a secret request, at /v1/secret-deposit?share=<id>#t=<token>. The
 *   person asked fills the request here: with the link's token and no account (the token sits after
 *   #, so it never reaches a server log), or signed in as a depositor the request names (the bell
 *   notice leads here without a token).
 *
 *   With the token it reads GET /v1/secret-shares/:id/deposit-card (header X-Deposit-Token): who asks,
 *   their note and the terms they set; signed in, GET /v1/secret-shares/:id. The terms are read-only:
 *   the maker decides them (services/secret-shares/rules.ts). The person picks the format and gives
 *   the content; an end-to-end request is sealed in this browser for the recipients' registered
 *   devices (public/js/vault-crypto.js) before it is sent. POST .../deposit-with-token or .../deposit
 *   answers with the check result when the node knows the service (its account tag and what the
 *   service reported), and the page says Saved.
 * @structure default export SecretDeposit() — loading · gone · sign in · not waiting · form · saved
 * @usage routed at /v1/secret-deposit by spa.html (and SPA_PAGE_PATHS in src/data/spa-page-paths.ts)
 * @version-history
 *   v1.0.1 — 2026-11-14 — The token view shows who may pick it up and how long (the deposit card
 *     carries them now); a new token after # reloads the card.
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { dateTime } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal, getSession, getNodeId } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Stack } from '/components/Layout.js';
import {
  x, api, accountOf, protectionWord, retentionWords, whoWords, errWords, checkFacts,
} from './profile/vault/frame.js';
import { emptyContent, contentFields, contentReady, plainBody, e2eBody } from './profile/vault/content.js';

const html = htm.bind(h);

/** The token after # in the link. */
const tokenOf = () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') || '';

export default function SecretDeposit() {
  const id = new URLSearchParams(window.location.search).get('share') || '';
  const [token, setToken] = useState(tokenOf);
  // A new link opened in the same tab changes only the part after #, which loads no page.
  useEffect(() => {
    const onHash = () => setToken(tokenOf());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const session = useSession();
  const nodeId = getNodeId();
  const [view, setView] = useState({ status: 'loading', card: null, mode: '' });
  const [content, setContent] = useState(emptyContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  const load = useCallback(async () => {
    if (!id) { setView({ status: 'gone', card: null, mode: '' }); return; }
    if (token) {
      try { setView({ status: 'ready', card: await api.depositCard(id, token), mode: 'token' }); }
      catch (e) { swallowed('secret-deposit: card', e); setView({ status: 'gone', card: null, mode: '' }); }
      return;
    }
    if (!getSession()) { setView({ status: 'signin', card: null, mode: '' }); return; }
    try {
      const v = await api.get(id);
      if (v?.kind !== 'request') setView({ status: 'gone', card: null, mode: '' });
      else setView({ status: 'ready', card: v, mode: v.you?.deposit ? 'named' : 'none' });
    } catch (e) { swallowed('secret-deposit: share', e); setView({ status: 'gone', card: null, mode: '' }); }
  }, [id, token]);

  useEffect(() => { load(); }, [load, session]);

  /** The recipients' registered devices, for an end-to-end request. */
  const devices = async (c) => {
    if (view.mode === 'token') return (c.device_keys || []).map((k) => ({ ghii: k.ghii, key_id: k.key_id, public_key: k.public_key }));
    const out = [];
    for (const who of c.recipients?.people || []) {
      const got = await api.keysOf(who);
      for (const k of got?.keys || []) out.push({ ghii: got.ghii, key_id: k.key_id, public_key: k.public_key });
    }
    return out;
  };

  const submit = async () => {
    const c = view.card;
    setBusy(true); setError('');
    try {
      let body;
      if (c.protection === 'e2e') {
        const list = await devices(c);
        if (!list.length) { const e = new Error(x('deposit.noDevices')); e.code = 'LOCAL'; throw e; }
        body = await e2eBody(content, list, null);
      } else {
        body = plainBody(content);
      }
      const res = view.mode === 'token' ? await api.depositWithToken(id, { token, ...body }) : await api.deposit(id, body);
      setSaved(res?.share || {});
      setContent(emptyContent());
    } catch (e) {
      swallowed('secret-deposit: deposit', e);
      setError(errWords(e));
    } finally { setBusy(false); }
  };

  const tag = html`<${Label}>${x('deposit.tag')}<//>`;
  if (view.status === 'loading') return html`<${AskPage} message=${x('loading')} />`;
  if (view.status === 'gone') {
    return html`<${AskPage} tag=${tag} title=${x('deposit.goneTitle')}>
      <${Note} kind="lead">${token ? x('deposit.goneToken') : x('deposit.gone')}<//>
    <//>`;
  }
  if (view.status === 'signin') {
    return html`<${AskPage} tag=${tag} title=${x('deposit.signInTitle')}
      doors=${html`<${Loud} control onClick=${() => showLoginModal({})}>${x('pickup.signIn')}<//>`}>
      <${Note} kind="lead">${x('deposit.signInLead')}<//>
    <//>`;
  }

  const c = view.card;
  const asker = accountOf(c.maker, nodeId);
  const who = { name: asker, meta: x('deposit.asks'), text: (asker[0] || 'A').toUpperCase() };
  // The terms the maker set: who may pick it up, how long, the protection and when the request ends.
  // The signed-in view and the token's deposit card both carry all of them (services/secret-shares/
  // service.ts depositCard).
  const terms = [
    { key: 'who', k: x('f.who'), v: whoWords(c, nodeId, c.organism || '') },
    { key: 'lasts', k: x('f.lasts'), v: retentionWords(c) },
    { key: 'protection', k: x('f.protection'), v: protectionWord(c.protection) },
    c.request_expires_at ? { key: 'until', k: x('f.requestUntil'), v: dateTime(c.request_expires_at) } : null,
  ];
  const head = html`
    ${c.note ? html`<${Box} tone="dim"><${Label} block>${x('deposit.noteFrom', { who: asker })}<//><${Note} kind="lead">${c.note}<//><//>` : null}
    <${Label} block>${x('deposit.terms')}<//>
    <${Facts} rows=${terms.filter(Boolean)} />
    <${Note}>${x('deposit.termsHint')}<//>`;

  if (saved) {
    const check = checkFacts(saved.check);
    return html`
      <${AskPage} who=${who} tag=${tag} title=${c.name}>
        <${Note} kind="lead"><b>${x('deposit.saved')}</b> ${x('deposit.savedLead', { who: asker })}<//>
        ${check.length ? html`<${Label} block>${x('check.title')}<//><${Facts} rows=${check} />` : null}
      <//>`;
  }
  if (c.status !== 'waiting') {
    return html`<${AskPage} who=${who} tag=${tag} title=${c.name}>
      <${Note} kind="lead">${x('deposit.notWaiting')}<//>
    <//>`;
  }
  if (view.mode === 'none') {
    return html`<${AskPage} who=${who} tag=${tag} title=${c.name}
      doors=${html`<${Action} control href="/v1/profile?tab=vault">${x('pickup.toVault')}<//>`}>
      <${Note} kind="lead">${x('deposit.notAsked')}<//>
    <//>`;
  }

  return html`
    <${AskPage} who=${who} tag=${tag} title=${c.name}
      doors=${html`<${Loud} control disabled=${busy || !contentReady(content)} onClick=${submit}>${busy ? x('form.working') : x('deposit.save')}<//>`}>
      <${Stack} gap="medium">
        <${Note} kind="lead">${x('deposit.lead', { who: asker })}<//>
        ${head}
        ${c.protection === 'e2e' ? html`<${Note} kind="aside" tone="waiting">${x('deposit.e2eNote')}<//>` : null}
        ${contentFields(content, (patch) => setContent((cur) => ({ ...cur, ...patch })), { prefix: 'vs-deposit', disabled: busy })}
        <${Note} kind="hint">${x('deposit.whoSees')}<//>
        ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      <//>
    <//>`;
}
