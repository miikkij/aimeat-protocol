/**
 * @file public/views/secret-pickup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pickup page of a secret share, at /v1/secret-pickup?share=<id> (the link a maker
 *   passes on, the bell notice and the Vault page lead here). It reads the share's card
 *   (GET /v1/secret-shares/:id/card: the name, the maker, whether a code and a sign-in are needed,
 *   never the content) and, when someone is signed in, whether they are named on it
 *   (GET /v1/secret-shares/:id).
 *
 *   A named person picks it up signed in: Reveal shows the content with Copy (a file downloads), and
 *   Move to my vault puts it into their vault under a name, optionally bound to one address, where an
 *   extension uses it without seeing it. A code holder enters the code (POST .../pickup-with-code, with
 *   the session when there is one). An end-to-end share opens only here, in a browser that holds a
 *   registered device key or with the code: the node hands over what it cannot open, and this page
 *   opens it with public/js/vault-crypto.js. Every refusal the services answer
 *   (services/secret-shares/pickup.ts) is said as a sentence (vault/frame.js refusalWords).
 * @structure default export SecretPickup() — loading · gone · not ready · done · named · code · sign in
 * @usage routed at /v1/secret-pickup by spa.html (and SPA_PAGE_PATHS in src/data/spa-page-paths.ts)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { date } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { showLoginModal, getSession, getNodeId } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { relayLiveUpdates, onLiveUpdate } from '/lib/live-updates.js';
import { loadDeviceKey, unwrapWithDevice, deriveCode, unwrapWithCode, openContent } from '/js/vault-crypto.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Stack } from '/components/Layout.js';
import {
  x, api, accountOf, formatWord, protectionWord, errWords, validVaultName, vaultNameOf,
} from './profile/vault/frame.js';
import { revealBlock, downloadFile } from './profile/vault/content.js';

const html = htm.bind(h);
const localErr = (code) => { const e = new Error(code); e.code = code; return e; };

export default function SecretPickup() {
  const id = new URLSearchParams(window.location.search).get('share') || '';
  const session = useSession();
  const nodeId = getNodeId();
  const [card, setCard] = useState(undefined);
  const [me, setMe] = useState(null);
  const [code, setCode] = useState('');
  const [vaultName, setVaultName] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const done = useRef(false);

  const load = useCallback(async () => {
    if (!id) { setCard(null); return; }
    let c = null;
    try { c = await api.card(id); } catch (e) { swallowed('secret-pickup: card', e); }
    let mine = null;
    if (c && getSession()) {
      try { mine = await api.get(id); } catch (e) { swallowed('secret-pickup: share', e); }
    }
    if (done.current) return;
    setCard(c);
    setMe(mine);
    setVaultName((v) => v || (c ? vaultNameOf(c.name) : ''));
  }, [id]);

  useEffect(() => { load(); }, [load, session]);
  // A route of its own opens the stream itself (frontend.md); a pickup or a revoke elsewhere arrives as an event.
  useEffect(() => (session ? relayLiveUpdates(() => getSession()?.jwt) : undefined), [session]);
  useEffect(() => onLiveUpdate(['secret-shares'], () => { if (!done.current) load(); }), [load]);

  const named = !!me?.you?.pickup;
  const e2e = card?.protection === 'e2e';

  /** Open an end-to-end answer: the wrapped key for this browser, or the one for the code. */
  const openE2e = async (res, codeKey) => {
    let raw;
    if (codeKey) {
      const entry = (res.wrapped_keys || [])[0];
      if (!entry) throw localErr('OPEN_FAILED');
      raw = await unwrapWithCode(entry.wrapped, codeKey);
    } else {
      const local = await loadDeviceKey(getSession()?.ghii);
      const entry = (res.wrapped_keys || []).find((k) => k.key_id === local?.keyId);
      if (!local || !entry) throw localErr('OPEN_FAILED');
      raw = await unwrapWithDevice(entry.wrapped, local.privateKey, entry.key_id);
    }
    return openContent(res.envelope, raw);
  };

  const pick = async (to) => {
    setBusy(true); setError('');
    try {
      const extra = to === 'vault' ? { name: vaultName, ...(host.trim() ? { host: host.trim() } : {}) } : {};
      let content = null;
      let vault = null;
      if (e2e) {
        if (named) {
          // Checked before the pickup is spent: without this browser's key nothing here could open it.
          if (!(await loadDeviceKey(getSession()?.ghii))) throw localErr('NO_LOCAL_KEY');
          content = await openE2e(await api.pickup(id, { to: 'reveal' }));
        } else {
          const c = await deriveCode(code, card.code_salt);
          content = await openE2e(await api.pickupWithCode(id, { code_verifier: c.verifier }), c.key);
        }
      } else {
        const res = named ? await api.pickup(id, { to, ...extra }) : await api.pickupWithCode(id, { code, to, ...extra });
        content = res.content || null;
        vault = res.vault || null;
      }
      if (content?.format === 'file') downloadFile(content);
      done.current = true;
      setResult({ content, vault });
    } catch (e) {
      swallowed('secret-pickup: pick up', e);
      setError(errWords(e));
    } finally { setBusy(false); }
  };

  const tag = html`<${Label}>${x('pickup.tag')}<//>`;
  const toVault = html`<${Action} control href="/v1/profile?tab=vault">${x('pickup.toVault')}<//>`;

  if (card === undefined) return html`<${AskPage} message=${x('loading')} />`;
  if (!card) {
    return html`<${AskPage} tag=${tag} title=${x('pickup.goneTitle')} doors=${session ? toVault : null}>
      <${Note} kind="lead">${x('pickup.gone')}<//>
    <//>`;
  }

  const who = { name: accountOf(card.maker, nodeId), meta: x('pickup.from'), text: (accountOf(card.maker, nodeId)[0] || 'A').toUpperCase() };
  const facts = html`<${Facts} rows=${[
    { key: 'format', k: x('f.format'), v: [formatWord(card.format), card.file_name || ''].filter(Boolean).join(' · ') },
    { key: 'protection', k: x('f.protection'), v: protectionWord(card.protection) },
    card.expires_at ? { key: 'until', k: x('f.until'), v: date(card.expires_at) } : null,
  ].filter(Boolean)} />`;

  if (result) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${card.name} doors=${session ? toVault : null}>
        <${Stack} gap="medium">
          ${result.vault
            ? html`<${Note} kind="lead">${x('pickup.inVault', { name: result.vault.name || vaultName })}<//>`
            : html`<${Note} kind="lead">${x('pickup.revealed')}<//>${revealBlock(result.content)}`}
          <${Note}>${x('pickup.after')}<//>
        <//>
      <//>`;
  }

  if (card.status !== 'ready') {
    const why = card.status === 'revoked' ? 'pickup.revokedNote' : card.status === 'waiting' ? 'pickup.waitingNote' : 'pickup.endedNote';
    return html`<${AskPage} who=${who} tag=${tag} title=${card.name} doors=${session ? toVault : null}>
      <${Stack} gap="medium">${facts}<${Note} kind="lead">${x(why)}<//><//>
    <//>`;
  }

  const err = error ? html`<${Note} kind="message" error>${error}<//>` : null;
  const vaultFields = !e2e && card.format !== 'file' && session ? html`<${Stack} gap="small">
    <${Label} block>${x('pickup.vaultTitle')}<//>
    <${Note}>${x('pickup.vaultLead')}<//>
    <${Fields}>
      <${TextField} label=${x('pickup.vaultName')} code value=${vaultName} maxLength=${64} invalid=${!!vaultName && !validVaultName(vaultName)}
        hint=${x('pickup.vaultNameHint')} onInput=${setVaultName} />
      <${TextField} label=${x('pickup.host')} code value=${host} maxLength=${253} placeholder="api.elevenlabs.io"
        hint=${x('pickup.hostHint')} onInput=${setHost} />
    <//>
  <//>` : null;
  const doors = (ready) => html`
    ${vaultFields ? html`<${Action} control disabled=${busy || !ready || !validVaultName(vaultName)} onClick=${() => pick('vault')}>${x('pickup.moveToVault')}<//>` : null}
    <${Loud} control disabled=${busy || !ready} onClick=${() => pick('reveal')}>${busy ? x('form.working') : e2e ? x('pickup.openHere') : x('pickup.reveal')}<//>`;

  // A named person, signed in.
  if (named) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${card.name} doors=${doors(true)}>
        <${Stack} gap="medium">
          ${facts}
          <${Note} kind="lead">${e2e ? x('pickup.namedE2e') : x('pickup.named')}<//>
          ${vaultFields}
          ${!e2e ? html`<${Note} kind="hint">${x('pickup.askAi', { name: card.name })}<//>` : null}
          ${err}
        <//>
      <//>`;
  }

  // A code: the maker may also have asked that it is used signed in.
  if (card.code) {
    const needLogin = card.code_login && !session;
    return html`
      <${AskPage} who=${who} tag=${tag} title=${card.name}
        doors=${needLogin ? html`<${Loud} control onClick=${() => showLoginModal({})}>${x('pickup.signIn')}<//>` : doors(!!code.trim())}>
        <${Stack} gap="medium">
          ${facts}
          <${Note} kind="lead">${needLogin ? x('pickup.codeLogin') : e2e ? x('pickup.codeE2e') : x('pickup.code')}<//>
          ${needLogin ? null : html`
            <${Fields}>
              <${TextField} label=${x('pickup.codeLabel')} code value=${code} autoComplete="off" spellCheck=${false} placeholder="KARHU-7215-SUMU-VALO"
                onInput=${setCode} onEnter=${() => code.trim() && !busy && pick('reveal')} />
            <//>
            ${vaultFields}`}
          ${err}
        <//>
      <//>`;
  }

  if (!session) {
    return html`
      <${AskPage} who=${who} tag=${tag} title=${card.name}
        doors=${html`<${Loud} control onClick=${() => showLoginModal({})}>${x('pickup.signIn')}<//>`}>
        <${Stack} gap="medium">${facts}<${Note} kind="lead">${x('pickup.signInLead')}<//><//>
      <//>`;
  }

  return html`
    <${AskPage} who=${who} tag=${tag} title=${card.name} doors=${toVault}>
      <${Stack} gap="medium">${facts}<${Note} kind="lead">${me?.you?.manage ? x('pickup.yours') : x('pickup.notYours')}<//><//>
    <//>`;
}
