/**
 * @file public/views/shared-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page a person opens from a share link, with no account (design canvas "Data ulos",
 *   board Vastaanottaja; /v1/shared-data?invite=<code>). It says who shared what, until when and for
 *   what; what the person gets (read, not change or pass on; when it ends; how often it updates); and
 *   three steps: 1 accept the terms, 2 take the key (shown once), 3 connect (the connection file, and
 *   the steps for Power BI, Excel, DuckDB and pandas with the person's own name and key). Under them:
 *   change the key, and "I no longer need this", which ends the share.
 *
 *   THE CODE. POST /v1/parties/invites/preview reads the link and changes nothing; the press of step 1
 *   is POST /v1/parties/invites/redeem, once, which makes the key at that moment and answers it with
 *   the connection file and a party token (services/parties/invite.ts). The page keeps the key and the
 *   token in memory only, never in storage: a reload shows that the link was used.
 *
 *   A PARTY IS NOT A SESSION. The page's later calls (/v1/parties/me/...) carry the party token, sent
 *   by this page's own fetch, because js/api.js would put a signed-in visitor's session in its place.
 *   Made of the component kit: it passes data and never a class.
 * @structure SharedData (default) · call · partyFetch · fileOf
 * @usage routed at /v1/shared-data?invite=<code> by spa.html
 * @version-history
 *   v1.0.1 — 2026-11-01 — A share with no purpose shows terms of its own (recipient.termsNoPurpose), not a
 *     purpose placeholder inside the purpose sentence (WP10d).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b).
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { date as fmtDate } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { PageFrame } from '/components/PageFrame.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PageSection } from '/components/PageSection.js';
import { Box } from '/components/Box.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Mark, Code } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Beside } from '/components/Layout.js';
import { AskPage } from '/components/AskPage.js';
import { d, scheduleWords, scheduleOf } from './profile/offers/data-model.js';
import { ConnectSteps } from './profile/offers/data-connect.js';

const r = (key, vars) => d('recipient.' + key, vars);

/**
 * A JSON call with no session: the answer's data, or a thrown Error carrying the node's code.
 * @param {string} path
 * @param {{ body?: unknown, token?: string, method?: string }} [opts]
 */
async function call(path, { body, token, method } = {}) {
  const res = await fetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null;
  try { json = await res.json(); } catch (err) { swallowed('shared-data: answer', err); }
  if (!res.ok) {
    const e = new Error(json?.error?.message || json?.error_description || `HTTP ${res.status}`);
    e.code = json?.error?.code || json?.error || String(res.status);
    throw e;
  }
  return json?.data ?? json;
}

/** A call as the party, with the token the redemption gave (or a new one from the key). */
const partyFetch = (path, token, body) => call(path, { token, body: body ?? {} });

/** The connection file as the person downloads it. */
const fileOf = (connection) => JSON.stringify(connection, null, 2);

/** The words for a refusal of the link, by the node's code. */
function refusalWords(code) {
  const known = ['INVITE_NOT_FOUND', 'INVITE_USED', 'INVITE_EXPIRED', 'SHARE_ENDED', 'PARTY_STOPPED'];
  return r('refused.' + (known.includes(code) ? code : 'other'));
}

export default function SharedData() {
  const code = new URLSearchParams(window.location.search).get('invite') || '';
  const [view, setView] = useState(null);       // the preview, then the redemption's answer
  const [failed, setFailed] = useState(code ? '' : 'INVITE_NOT_FOUND');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [got, setGot] = useState(null);         // { key, token, connection, basicUser }
  const [showSteps, setShowSteps] = useState(false);
  const [ended, setEnded] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [asking, setAsking] = useState(false);  // "I no longer need this" pressed once, waiting for the yes

  useEffect(() => {
    if (!code) return;
    call('/v1/parties/invites/preview', { body: { code } })
      .then(setView)
      .catch((err) => setFailed(err.code || 'other'));
  }, [code]);

  const file = got ? fileOf(got.connection) : '';
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(new Blob([file], { type: 'application/json' })) : ''), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  if (failed) {
    return html`<${AskPage} tag=${html`<${Mark} tone="coral">${r('tag')}<//>`} title=${r('refusedTitle')}>
      <${Note} kind="lead">${refusalWords(failed)}<//>
    <//>`;
  }
  if (!view) return html`<${PageFrame} loading><${Note} kind="loading" /><//>`;

  const share = view.share || {};
  const pkg = view.package || {};
  const termsNeeded = !!view.terms;
  const until = share.expires ? fmtDate(share.expires) : r('untilEnd');
  const fresh = pkg.freshness;
  // The figure is one short word (the board's "maanantaisin"); the whole schedule is its tooltip.
  const plan = fresh?.schedule ? scheduleOf(fresh.schedule) : null;
  const updates = fresh?.on_change ? r('every.change')
    : !plan ? (fresh?.schedule ? scheduleWords({ cron: fresh.schedule }) : r('updatesNone'))
      : plan.freq === 'weekly' ? r('every.weekly.' + plan.day) : r('every.' + plan.freq);
  const updatesTitle = fresh ? scheduleWords(fresh.on_change ? { on: 'change' } : { cron: fresh.schedule }) : undefined;
  const party = view.party || {};

  const redeem = async () => {
    setBusy(true); setError('');
    try {
      const out = await call('/v1/parties/invites/redeem', { body: { code, ...(termsNeeded ? { accept_terms: true } : {}) } });
      setView(out);
      setGot({ key: out.key, token: out.access_token, connection: out.connection, basicUser: out.basic_user });
    } catch (err) {
      if (['INVITE_USED', 'INVITE_EXPIRED', 'SHARE_ENDED', 'INVITE_NOT_FOUND'].includes(err.code)) setFailed(err.code);
      else setError(err.message);
    }
    setBusy(false);
  };

  /** A new key: the one in use stops working at once, and a new token is asked with the new key. */
  const rotate = async () => {
    setBusy(true); setError('');
    try {
      const out = await partyFetch('/v1/parties/me/keys/rotate', got.token);
      const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: got.basicUser, client_secret: out.key } });
      const connection = await call(`/v1/parties/me/shares/${encodeURIComponent(share.id)}/connection`, { token: tok.access_token })
        .catch((err) => { swallowed('shared-data: connection after rotation', err); return null; });
      setGot({ ...got, key: out.key, token: tok.access_token, connection: { ...(connection?.connection || got.connection), key: out.key } });
      setRotated(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  /** End the share: the owner's list says the recipient declined it, and the next read is refused. */
  const decline = async () => {
    setBusy(true); setError(''); setAsking(false);
    try {
      if (got) {
        await partyFetch(`/v1/parties/me/shares/${encodeURIComponent(share.id)}/decline`, got.token);
        setEnded(true);
      }
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (ended) {
    return html`<${AskPage} tag=${html`<${Mark} tone="coral">${r('tag')}<//>`} title=${r('endedTitle')}>
      <${Note} kind="lead">${r('ended', { owner: view.owner_name, title: pkg.title })}<//>
    <//>`;
  }

  const strip = html`<${FigureStrip} items=${[
    { key: 'get', n: r('getWord'), label: r('get'), sub: r('getSub') },
    { key: 'ends', n: until, label: r('ends'), sub: r('endsSub', { owner: view.owner_name }) },
    { key: 'updates', n: updates, label: r('updates'), sub: r('updatesSub'), title: updatesTitle },
  ]} />`;

  const keyBlock = got
    ? html`<${Code} block scroll>${r('keyLines', { id: party.party_ref, user: got.basicUser, key: got.key })}<//>
        <${Actions}><${Action} small copy=${got.key}>${r('copyKey')}<//><//>
        ${rotated ? html`<${Note} kind="message">${r('rotated')}<//>` : null}`
    : html`<${Note} kind="quiet">${r('keyLater')}<//>`;

  return html`<${PageFrame}>
    <${SettingsPage} name="shared-data"
      label=${r('label', { owner: view.owner_name })}
      title=${pkg.title}
      marks=${[{ label: r('noAccount') }]}
      desc=${share.purpose ? r('lead', { until, purpose: share.purpose }) : r('leadNoPurpose', { until })}
      strip=${strip}>
      ${pkg.description ? html`<${Note}>${pkg.description}<//>` : null}
      <${Box} tone="raised">
        <${PageSection} step first num="1" title=${r('step1')}>
          ${got && view.terms_accepted
            ? html`<${Note}>${r('termsAccepted', { date: fmtDate(view.terms_accepted) })}<//>`
            : termsNeeded
            ? html`<${Check} checked=${accepted || !!got} disabled=${!!got} onChange=${setAccepted}>
                ${share.purpose
                    ? r('terms', { purpose: share.purpose, licence: pkg.licence || r('noLicence'), owner: view.owner_name })
                    : r('termsNoPurpose', { licence: pkg.licence || r('noLicence'), owner: view.owner_name })}<//>`
            : html`<${Note}>${got ? r('termsNone') : r('termsNoneYet')}<//>`}
          ${got ? null : html`<${Actions}>
            <${Loud} control disabled=${busy || (termsNeeded && !accepted)} onClick=${redeem}>${termsNeeded ? r('acceptAndShow') : r('show')}<//>
          <//>`}
        <//>
        <${PageSection} step num="2" title=${r('step2')}>
          <${Note}>${r('keyOnce')}<//>
          ${keyBlock}
        <//>
        <${PageSection} step num="3" title=${r('step3')}>
          <${Actions}>
            <${Loud} control disabled=${!got} href=${got ? fileUrl : undefined} download=${got ? `${pkg.name}-${party.name}.json` : undefined}>${r('download')}<//>
            <${Action} disabled=${!got} expanded=${showSteps} onClick=${() => setShowSteps(!showSteps)}>${r('instructions')}<//>
          <//>
          ${got && showSteps ? html`<${ConnectSteps} owner=${view.owner} name=${pkg.name}
            pkg=${{ descriptor: { resources: (pkg.resources || []).map((x) => ({ name: x.name })) } }}
            cred=${{ user: got.basicUser, key: got.key }} />` : null}
        <//>
      <//>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      <${Beside} side=${html`<${Actions}>
          <${Action} disabled=${!got || busy} onClick=${rotate}>${r('rotate')}<//>
          <${Action} disabled=${!got || busy} expanded=${asking} onClick=${() => setAsking(!asking)}>${r('decline')}<//>
        <//>`} above="section">
        <${Note} kind="aside" size="small">${got ? r('rotateWhy') : r('rotateLater')}<//>
      <//>
      ${asking ? html`<${Box} tone="attention" doors=${html`
          <${Loud} control danger disabled=${busy} onClick=${decline}>${r('declineYes')}<//>
          <${Action} onClick=${() => setAsking(false)}>${r('declineNo')}<//>`}>
        <${Note}>${r('declineConfirm', { owner: view.owner_name })}<//>
      <//>` : null}
    <//>
  <//>`;
}
