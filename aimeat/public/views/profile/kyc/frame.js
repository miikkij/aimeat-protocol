/**
 * @file public/views/profile/kyc/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the customer due diligence page's parts share: the words (x), the words of each
 *   value the server sends as a code (a customer's kind, risk, sanctions state, PEP status, card
 *   status, identity level and method, a version's change, a risk reason, a suspicion's state), the
 *   tone a status mark takes, a refusal said in words (errWords: the error codes of routes/kyc/routes.ts),
 *   dates, the crumb, the rail's page links, and the REST calls under /v1/kyc as one small client.
 * @structure x · word · tone · errWords · reasonWords · reasonDetail · hitReasonWords · dateWord ·
 *   endOfLocalDay · timeWord · today · crumb · pageLinks · kycApi · ORG_ROLES
 * @usage import { x, word, kycApi } from './frame.js';
 * @version-history
 *   v1.1.0 — 2026-11-19 — Browser check: a bare day reads as the reader's own day (dateWord), the "as
 *     of" read sends the end of the local day (endOfLocalDay), a risk reason shows only locale words
 *     (reasonDetail), and a hit's reasons are words (hitReasonWords).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut, apiPatch } from '/js/api.js';
import { date as fmtDate, dateTime as fmtDateTime } from '/js/format.js';

/** The page's words: every key sits under `kyc.`. */
export const x = (key, vars) => t('kyc.' + key, vars);

/** A locale word for a code the server sends, under kyc.<group>.<code>; the code itself on a miss. */
export function word(group, code) {
  if (code === null || code === undefined || code === '') return x(group + '.none');
  const key = `kyc.${group}.${code}`;
  const v = t(key);
  return v && v !== key ? v : String(code);
}

/** The status tone of a mark: fine (green), attention (coral), danger, off (grey). */
const TONES = {
  risk: { low: 'fine', medium: 'attention', high: 'danger', prohibited: 'danger' },
  sanctions: { clear: 'fine', 'not-screened': 'off', possible: 'attention', confirmed: 'danger' },
  pep: { no: 'fine', unknown: 'off', yes: 'attention', family: 'attention', 'close-associate': 'attention', former: 'attention' },
  status: { active: 'fine', open: 'off', blocked: 'attention', ended: 'off' },
  verdict: { open: 'attention', 'false-positive': 'fine', confirmed: 'danger' },
  report: { marked: 'attention', draft: 'attention', submitted: 'fine', 'not-reported': 'off' },
};

/** @param {string} group @param {string | null | undefined} code @returns {string} */
export const tone = (group, code) => (TONES[group] && code ? TONES[group][code] : undefined) || 'off';

/** The roles that reach the cards; 'none' reaches nothing. */
export const ORG_ROLES = ['officer', 'staff', 'manager'];

/**
 * A risk reason or a blocking code in words: the code's own key, else the server's sentence.
 * @param {string} code
 * @param {string} [text] the server's English sentence
 */
export function reasonWords(code, text) {
  const key = `kyc.reason.${code}`;
  const v = t(key);
  return v && v !== key ? v : (text || code);
}

/** The codes whose own sentence says what the person must know; the rest keep the server's message. */
const OWN_WORDS = new Set([
  'KYC_NOT_OFFICER', 'KYC_OFFICER_IN_PERSON', 'KYC_DECISION_IN_PERSON', 'KYC_NOT_MANAGER',
  'CUSTOMER_ENDED', 'CUSTOMER_CHANGED', 'CUSTOMER_NOT_FOUND', 'NOT_A_PERSON', 'NO_APPROVAL_NEEDED', 'CUSTOMER_NOT_ENDED',
  'KYC_AI_OFF', 'REPORT_CLOSED', 'REPORT_NOT_FOUND', 'KYC_VISITOR', 'AGENT_NOT_ADMITTED', 'HIT_NOT_FOUND',
]);

/**
 * A refusal in words. KYC_NOT_ENABLED and INVALID_INPUT keep the server's message, which names
 * what is missing; CUSTOMER_BLOCKED lists what to resolve, each code in words.
 * @param {any} e the error api.js throws ({ code, message })
 * @returns {string}
 */
export function errWords(e) {
  const code = e?.code || '';
  const msg = e?.message || '';
  if (code === 'CUSTOMER_BLOCKED') {
    const list = (msg.split(':')[1] || '').replace(/\.$/, '').split(',').map((s) => s.trim()).filter(Boolean);
    return x('err.CUSTOMER_BLOCKED', { what: list.map((c) => reasonWords(c)).join(', ') });
  }
  // The server says KYC_NOT_STAFF also to a person named in the settings who is not an active member.
  if (code === 'KYC_NOT_STAFF') return x('err.notStaffMember');
  if (OWN_WORDS.has(code)) return x('err.' + code);
  return msg || x('err.generic');
}

/** A bare YYYY-MM-DD read as that day in the reader's own time zone (Date reads it as UTC midnight). */
function localDay(s) {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : s;
}
/**
 * A day in the reader's own format, or a dash. A bare day (YYYY-MM-DD) is a calendar day, not a
 * moment: it is formatted in UTC, where Date put it, so it stays the same day in every time zone
 * (js/format.js withZone: a caller that names a zone wins).
 */
export const dateWord = (s) => (!s ? '–' : localDay(s) instanceof Date ? fmtDate(s, { timeZone: 'UTC' }) : fmtDate(s));
/** The end of a chosen local day (YYYY-MM-DD) as an ISO time, for a read "as of" that day. */
export function endOfLocalDay(day) {
  const d = localDay(day);
  return d instanceof Date ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString() : day;
}

/** True when the locale has a word for the key. */
const has = (key) => { const v = t(key); return !!v && v !== key; };

/**
 * A risk reason's detail in the reader's words, read off the server's sentence where it carries one
 * (the countries, the number of layers, the PEP kind, the clamped interval); '' when there is none.
 * The server's English sentence itself is shown only for a code the locale has no word for.
 * @param {string} code @param {string} [text]
 */
export function reasonDetail(code, text) {
  const s = text || '';
  if (!has(`kyc.reason.${code}`)) return s;
  if (code === 'high-risk-country') { const m = /:\s*([A-Z, ]+)$/.exec(s); return m ? x('reasonDetail.countries', { list: m[1].trim() }) : ''; }
  if (code === 'ownership-layers') { const m = /^(\d+)/.exec(s); return m ? x('reasonDetail.layers', { n: m[1] }) : ''; }
  if (code === 'pep') { const m = /\(([a-z-]+)\)/.exec(s); return m ? word('pep', m[1]) : ''; }
  if (code === 'review-months-clamped') {
    const m = /^(low|medium|high) review (\d+) months clamped to (\d+)/.exec(s);
    return m ? x('reasonDetail.clamped', { level: word('risk', m[1]), from: m[2], to: m[3] }) : '';
  }
  return '';
}

/** The words a screening hit's reasons come in (services/kyc/screening/match.ts). */
const HIT_REASONS = {
  'name exact': 'nameExact', 'name tokens reordered': 'nameReordered', 'birth date equal': 'birthDateEqual',
  'birth year differs': 'birthYearDiffers', 'birth year equal': 'birthYearEqual', 'country listed': 'countryListed',
  'legal form ignored': 'legalFormIgnored',
};

/** One hit reason in the reader's words; 'name similar 0.93' keeps its number as a percentage. */
export function hitReasonWords(r) {
  const m = /^name similar ([\d.]+)$/.exec(r || '');
  if (m) return x('hitReason.nameSimilar', { n: Math.round(Number(m[1]) * 100) });
  return HIT_REASONS[r] ? x('hitReason.' + HIT_REASONS[r]) : r;
}
/** A day and its time, or a dash. */
export const timeWord = (s) => (s ? fmtDateTime(s) : '–');
/** Today as YYYY-MM-DD in the reader's own day. */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The crumb's steps: Settings / Account / Customer due diligence. */
export const crumb = () => [t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.kyc')];

/** The sibling pages in the rail: each opens a Settings tab. */
export const pageLinks = () => [
  { tab: 'organisms', label: t('profile.tabs.organisms') },
  { tab: 'dataWallet', label: t('profile.tabs.dataWallet') },
  { tab: 'security', label: t('profile.tabs.security') },
];

const enc = encodeURIComponent;
const base = (org) => `/v1/kyc/${enc(org)}`;
const data = (p) => p.then((r) => r?.data);

/**
 * The calls of routes/kyc/routes.ts. Each resolves to the envelope's `data` and throws the api.js error
 * ({ code, message }) on a refusal.
 */
export const kycApi = {
  organisms: () => data(apiGet('/v1/kyc/organisms')),
  mine: () => data(apiGet('/v1/kyc/me')),
  settings: (org) => data(apiGet(`${base(org)}/settings`)),
  saveSettings: (org, patch) => data(apiPut(`${base(org)}/settings`, patch)),
  customers: (org, due) => data(apiGet(`${base(org)}/customers${due ? '?due=1' : ''}`)),
  open: (org, body) => data(apiPost(`${base(org)}/customers`, body)),
  card: (org, id) => data(apiGet(`${base(org)}/customers/${enc(id)}`)),
  asOf: (org, id, day) => data(apiGet(`${base(org)}/customers/${enc(id)}?as_of=${enc(day)}`)),
  update: (org, id, body) => data(apiPatch(`${base(org)}/customers/${enc(id)}`, body)),
  act: (org, id, what, body) => data(apiPost(`${base(org)}/customers/${enc(id)}/${what}`, body || {})),
  mark: (org, body) => data(apiPost(`${base(org)}/suspicions`, body)),
  suspicions: (org) => data(apiGet(`${base(org)}/suspicions`)),
  suspicion: (org, id) => data(apiGet(`${base(org)}/suspicions/${enc(id)}`)),
  saveDraft: (org, id, body) => data(apiPatch(`${base(org)}/suspicions/${enc(id)}`, body)),
  report: (org, id, what, body) => data(apiPost(`${base(org)}/suspicions/${enc(id)}/${what}`, body || {})),
  link: (token) => data(apiGet(`/v1/kyc/links/${enc(token)}`)),
  give: (token) => data(apiPost(`/v1/kyc/links/${enc(token)}`, {})),
};
