/**
 * @file public/views/shared-data-rotate.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Changing a share's key on the recipient page after its link was used (design canvas
 *   "Data ulos", board Vastaanottaja). The page promises the key can be changed there at any time, and a
 *   used link opens the page only once; so the person gives the user and the key from their connection
 *   file, the page asks a token with them (POST /v1/parties/token, the client credentials any program
 *   of theirs uses) and changes the key with it (POST /v1/parties/me/keys/rotate). The key in use is the
 *   proof, as it is for every read: no session, no account. The new key is shown once.
 *   Made of the component kit.
 * @structure RotateByKey
 * @usage html`<${RotateByKey} />`   // on the page that says the link was used
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e B12).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { swallowed } from '/js/swallowed.js';
import { d } from './profile/offers/data-model.js';

const r = (key, vars) => d('recipient.' + key, vars);

/** A JSON POST with no session; throws an Error carrying the node's code. */
async function post(path, body, token) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (err) { swallowed('shared-data-rotate: answer', err); }
  if (!res.ok) {
    const e = new Error(json?.error?.message || json?.error_description || `HTTP ${res.status}`);
    e.code = json?.error?.code || json?.error || String(res.status);
    throw e;
  }
  return json?.data ?? json;
}

export function RotateByKey() {
  const [user, setUser] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState('');
  const [asking, setAsking] = useState(false);

  const rotate = async () => {
    setBusy(true); setError(''); setAsking(false);
    try {
      const tok = await post('/v1/parties/token', { grant_type: 'client_credentials', client_id: user.trim(), client_secret: key.trim() });
      const out = await post('/v1/parties/me/keys/rotate', {}, tok.access_token);
      setFresh(out.key); setKey('');
    } catch (err) {
      setError(['invalid_client', 'INVALID_PARTY_CREDENTIAL', '401'].includes(err.code) ? r('byKeyWrong') : err.message);
    }
    setBusy(false);
  };

  if (fresh) {
    return html`<${Box} name=${r('byKeyTitle')}>
      <${Note} kind="message">${r('rotated')}<//>
      <${Code} block scroll>${fresh}<//>
      <${Actions}><${Action} small copy=${fresh}>${r('copyKey')}<//><//>
      <${Note}>${r('byKeyAfter')}<//>
    <//>`;
  }
  const ready = user.trim().includes('/') && key.trim().length > 8;
  return html`<${Box} name=${r('byKeyTitle')}>
    <${Note}>${r('byKeyLead')}<//>
    <${Fields} cols=${2}>
      <${TextField} label=${r('byKeyUser')} code value=${user} placeholder="owner/party" onInput=${setUser} />
      <${TextField} label=${r('byKeyKey')} type="password" code value=${key} onInput=${setKey} />
    <//>
    ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
    ${asking ? html`<${Box} tone="attention" doors=${html`
        <${Loud} control danger disabled=${busy} onClick=${rotate}>${r('rotateYes')}<//>
        <${Action} onClick=${() => setAsking(false)}>${r('rotateNo')}<//>`}>
      <${Note}>${r('rotateConfirm')}<//>
    <//>` : html`<${Actions}><${Action} disabled=${!ready || busy} onClick=${() => setAsking(true)}>${r('rotate')}<//><//>`}
  <//>`;
}
