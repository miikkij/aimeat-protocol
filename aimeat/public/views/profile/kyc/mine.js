/**
 * @file public/views/profile/kyc/mine.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's own verification, for everyone who opens the page: each time their
 *   identity was verified (when, how, the eIDAS level it gives, who issued it), and each firm they
 *   gave it to through an identify link (to whom, when, what), with the note that a firm keeps what it
 *   was given for as long as the law says (GET /v1/kyc/me).
 * @structure useMine · mineHas · secMine · sharedWords
 * @usage const me = useMine(); ... mineHas(me) && secMine(me, num, first)
 * @version-history
 *   v1.1.0 — 2026-11-27 — mineHas: the page draws the section once there is a verification or a
 *     disclosure; secMine takes `first` (the page's first section has no rule on top). The lists,
 *     their order and the note on what a firm keeps are unchanged.
 *   v1.0.1 — 2026-11-19 — Both lists stack on a phone (no keepCols), each cell saying its column.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import { useState, useCallback, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, When } from '/components/List.js';
import { Note } from '/components/Note.js';
import { x, word, errWords, timeWord, kycApi } from './frame.js';

const html = htm.bind(h);

/** The four things an identify link gives, as the service names them (services/kyc/identify.ts SHARED). */
const SHARED = { 'verified name': 'name', 'verification level': 'level', 'verification method and issuer': 'method', 'time of verification': 'time', 'account address': 'account' };

/** What was given, in the reader's words. @param {string[]} what */
export function sharedWords(what) {
  return (what || []).map((w) => {
    const key = SHARED[w] ? `kyc.shared.${SHARED[w]}` : '';
    const v = key ? t(key) : '';
    return v && v !== key ? v : w;
  }).join(', ');
}

/** The person's own verification history and disclosures. */
export function useMine() {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setMe(await kycApi.mine()); setErr(''); } catch (e) { setErr(errWords(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { me, err, load };
}

/**
 * True when the person has a verification or gave one to a firm, or the read failed: the section has
 * something to show.
 * @param {ReturnType<typeof useMine>} m
 */
export const mineHas = (m) => !!m.err || (!!m.me && ((m.me.verifications || []).length + (m.me.disclosures || []).length) > 0);

/**
 * The section "Your own verification".
 * @param {ReturnType<typeof useMine>} m
 * @param {string} num
 * @param {boolean} [first] the page's first section: no rule on top
 */
export function secMine(m, num, first = false) {
  const me = m.me;
  const ver = me ? [...me.verifications].reverse() : [];
  const dis = me ? [...me.disclosures].reverse() : [];
  return html`
    <${Section} id="kyc-mine" num=${num} title=${x('secMine')} count=${me ? String(ver.length) : ''} first=${first}>
      ${m.err ? html`<${Note} kind="quiet">${m.err}<//>` : !me ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        <${Note} kind="lead">${x('mine.verLead')}<//>
        <${List} cols="when-name-who" labels head=${[x('col.when'), x('mine.how'), x('mine.issuer')]} empty=${x('mine.noVer')}>
          ${ver.map((v, i) => html`
            <${Row} key=${i}>
              <${When}>${timeWord(v.at)}<//>
              <${Name} meta=${x('mine.eidas', { level: word('level', v.eidasLevel) })}>${word('method', v.method)}<//>
              <${Who}>${v.issuer || '–'}<//>
            <//>`)}
        <//>
        <${Note} kind="lead">${x('mine.disLead')}<//>
        <${List} cols="when-name-who" labels head=${[x('col.when'), x('mine.toWhom'), x('mine.what')]} empty=${x('mine.noDis')}>
          ${dis.map((d, i) => html`
            <${Row} key=${i}>
              <${When}>${timeWord(d.at)}<//>
              <${Name}>${d.organismName || d.organism}<//>
              <${Who}>${sharedWords(d.what)}<//>
            <//>`)}
        <//>
        <${Note} kind="hint">${x('mine.note')}<//>`}
    <//>`;
}
