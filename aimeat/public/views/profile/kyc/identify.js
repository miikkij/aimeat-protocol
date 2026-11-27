/**
 * @file public/views/profile/kyc/identify.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The identify link's page (profile tab 'identify', not in the menu; reached by
 *   ?tab=identify&token=…): a firm asked its customer to give their verified identity. The page names
 *   the firm and exactly what it will receive, shows the person's own strongest verification, sends a
 *   person without one to verify with their bank ID first (and back to this link after), and gives it
 *   once with a press (GET and POST /v1/kyc/links/{token}). After it says what was given and that the
 *   firm keeps it as the law says. A used, expired or unknown link, or a session that is not the
 *   person in person, gets its own plain sentence.
 * @structure IdentifyTab() · tokenOf · refusal
 * @usage registered in profile.js TABS as id 'identify' (hidden)
 * @version-history
 *   v1.0.2 — 2026-11-27 — The two section headings that were sentences are noun phrases ("Identity
 *     request from …", "Identity given"). The page stays one task with no figure strip and no page
 *     start: the person arrives from the firm's link, the section says who asks and what it gets, and
 *     its one loud action is the next step. Nothing else changed: the order of the steps, the
 *     in-person rule, the retention line before the press and every refusal are as they were.
 *   v1.0.1 — 2026-11-19 — The title's question mark explains the customer's side (concept.kyc_identify:
 *     why a firm asks, what it gets, how long it keeps it), not the firm's duty (concept.kyc).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { api } from '/js/api.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { x, word, errWords, dateWord, crumb, kycApi } from './frame.js';
import { sharedWords } from './mine.js';

const html = htm.bind(h);

/** The refusals the link answers, each with its own sentence. */
const REFUSALS = new Set(['LINK_USED', 'LINK_EXPIRED', 'LINK_NOT_FOUND', 'IN_PERSON_ONLY', 'NOT_VERIFIED']);

/** The token in the address, or ''. */
function tokenOf() {
  return new URLSearchParams(window.location.search).get('token') || '';
}

/** A refusal in words: the link's own sentences, else the page's shared ones. */
function refusal(e) {
  return REFUSALS.has(e?.code) ? x('id.err.' + e.code) : errWords(e);
}

export default function IdentifyTab() {
  const [token] = useState(tokenOf);
  const [view, setView] = useState(null);
  const [err, setErr] = useState(token ? '' : x('id.err.LINK_NOT_FOUND'));
  const [given, setGiven] = useState(null);
  const [busy, setBusy] = useState(false);
  const [giveErr, setGiveErr] = useState('');

  const load = useCallback(async () => {
    if (!token || given) return;
    try { setView(await kycApi.link(token)); setErr(''); } catch (e) { setErr(refusal(e)); }
  }, [token, given]);
  useEffect(() => { load(); }, [load]);
  // The person may verify in another tab and come back: the page reads again on a live update.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const give = async () => {
    setBusy(true); setGiveErr('');
    try { setGiven(await kycApi.give(token)); } catch (e) { setGiveErr(refusal(e)); }
    setBusy(false);
  };

  /**
   * The bank ID sign-in: the server answers the bank's address (it needs this session's key, so a
   * plain link cannot start it), and the page goes there. The bank sends the person back to Settings
   * & Controls, and the same link from the firm works again.
   */
  const verify = async () => {
    setBusy(true); setGiveErr('');
    try {
      const r = await api(view?.verifyPath || '/v1/ghii/verify/ftn/authorize', { method: 'GET', retries: 0 });
      const url = r?.data?.authorizationUrl;
      if (url) { window.location.href = url; return; }
      setGiveErr(x('id.err.noBank'));
    } catch (e) { setGiveErr(e?.code === 'FEATURE_DISABLED' ? x('id.err.noBank') : errWords(e)); }
    setBusy(false);
  };

  const body = () => {
    if (given) {
      return html`
        <${Section} id="kyc-id" num="01" title=${x('id.doneHead')} first=${true}>
          <${Note} kind="state" tone="fine">${x('id.done', { organism: given.organism })}<//>
          <${Facts} rows=${[{ k: x('id.given'), v: sharedWords(given.given) }]} />
          <${Note} kind="hint">${x('id.kept')}<//>
          <${Actions}><${Action} small href="/v1/profile?tab=kyc">${x('id.seeMine')}<//><//>
        <//>`;
    }
    if (err) return html`<${Section} id="kyc-id" num="01" title=${x('id.title')} first=${true}><${Note} kind="aside">${err}<//><//>`;
    if (!view) return html`<${Note} kind="loading">${x('loading')}<//>`;
    const v = view.verification;
    return html`
      <${Section} id="kyc-id" num="01" title=${x('id.request', { organism: view.organism.name })} first=${true}>
        <${Note} kind="lead">${x('id.lead', { organism: view.organism.name })}<//>
        <${Facts} rows=${[
          { k: x('id.willGet'), v: sharedWords(view.shared) },
          { k: x('id.yours'), v: v ? `${word('method', v.method)} · ${x('mine.eidas', { level: word('level', v.level) })}` : x('id.noneYet'), sub: v ? dateWord(v.at) : undefined, warn: !v },
        ]} />
        ${v ? html`
          <${Note} kind="hint">${x('id.kept')}<//>
          <${Actions}>
            <${Loud} control disabled=${busy} onClick=${give}>${busy ? x('saving') : x('id.give', { organism: view.organism.name })}<//>
          <//>`
        : html`
          <${Note} kind="aside">${x('id.verifyFirst')}<//>
          <${Actions}>
            <${Loud} control disabled=${busy} onClick=${verify}>${x('id.verify')}<//>
          <//>
          <${Note} kind="hint">${x('id.comeBack')}<//>`}
        ${giveErr ? html`<${Note} kind="message" error>${giveErr}<//>` : null}
      <//>`;
  };

  return html`
    <${SettingsPage} crumb=${[...crumb().slice(0, 2), x('id.crumb')]} title=${x('id.pageTitle')} help="concept.kyc_identify" desc=${x('id.desc')}>
      ${body()}
    <//>`;
}
