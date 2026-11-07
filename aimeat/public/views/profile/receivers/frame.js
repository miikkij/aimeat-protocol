/**
 * @file public/views/profile/receivers/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Receivers page's views share: the words (x), the REST calls the page makes
 *   (the /v1/receivers routes of src/routes/receivers.ts, the same service functions the MCP tool
 *   aimeat_receiver calls), and the helpers that turn a receiver view (receiverView in
 *   src/services/receivers/contract.ts) into the reader's words: where it writes, its state and its
 *   tone, who made it, a delivery's line, the curl example and the sentence for one's own AI.
 *   A receiver is an address and a key through which an outside program (a Lambda, a home sensor, a
 *   CRM export) writes into exactly one place of the owner's data over plain REST.
 * @structure x · api (list, get, deliveries, create, decide, patch, pause, resume, rotate, remove,
 *   csms) · targetWords · stateWord · stateTone · byWords · limitsWords · verbsWords · deliveryWords ·
 *   statusTone · addressPath · subFor · curlFor · dryRun · refusalWords · validName · validKey ·
 *   crumb · pageLinks · LIMITS
 * @usage import { x, api, targetWords, curlFor } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht;
 *     design canvas "Vastaanottimet", artboards Settings, Create, Detail and Chat).
 */
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
import { num, fmtBytes } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';

/** One word of this page. */
export const x = (key, vars) => t('receivers.' + key, vars);

const enc = encodeURIComponent;

/** The owner's receiver routes (src/routes/receivers.ts). Each resolves to the envelope's data. */
export const api = {
  list: async () => (await apiGet('/v1/receivers'))?.data || { receivers: [], mode: 'self', total: 0 },
  get: async (name) => (await apiGet(`/v1/receivers/${enc(name)}`))?.data || null,
  deliveries: async (name) => (await apiGet(`/v1/receivers/${enc(name)}/deliveries`))?.data || { deliveries: [], total: 0, failed_attempts: 0, days: [] },
  create: async (body) => (await apiPost('/v1/receivers', body))?.data,
  decide: async (name, decision) => (await apiPost(`/v1/receivers/${enc(name)}/decide`, { decision }))?.data,
  patch: async (name, body) => (await apiPatch(`/v1/receivers/${enc(name)}`, body))?.data,
  pause: async (name) => (await apiPost(`/v1/receivers/${enc(name)}/pause`, {}))?.data,
  resume: async (name) => (await apiPost(`/v1/receivers/${enc(name)}/resume`, {}))?.data,
  rotate: async (name) => (await apiPost(`/v1/receivers/${enc(name)}/rotate`, {}))?.data,
  remove: async (name) => (await apiDelete(`/v1/receivers/${enc(name)}`))?.data,
  /** The CSMs this account may read (GET /v1/csm), each { name, version, service_type }. */
  csms: async () => (await apiGet('/v1/csm'))?.data?.services || [],
};

/** The limits the server takes (RECEIVER_DEFAULTS and RECEIVER_MAXIMA in contract.ts). */
export const LIMITS = Object.freeze({
  perMinute: { dflt: 60, max: 600 },
  maxKb: { dflt: 64, max: 1000 },
  expiresDays: { dflt: 365, max: 730 },
  maxKeys: { dflt: 50, max: 500 },
});

/** A receiver name as the server takes it (RECEIVER_NAME_RE), and the word the routes use. */
export const validName = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s) && s !== 'proposals';

/** A memory key or prefix as a receiver may target it: dotted lowercase parts (TARGET_KEY_RE). */
export const validKey = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*){0,7}$/.test(s);

/** A display name turned into a receiver name: lowercase letters, digits and dashes. */
export const slugOf = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Where the receiver writes, in words: "Memory key living.solar", "Keys under ruuvit. (at most 50)". */
export function targetWords(target) {
  if (!target) return '';
  if (target.kind === 'key') return x('target.keyLine', { key: target.key });
  if (target.kind === 'prefix') return x('target.prefixLine', { prefix: target.prefix, n: num(target.max_keys) });
  return x('target.spaceLine', { space: target.space, ws: target.ws });
}

/** The CSM line: "csm.ruuvi v2", or "no shape". */
export const shapeWords = (r) => (r?.schema ? x('shape.line', { csm: r.schema.csm, v: r.schema.version }) : x('shape.none'));

/** The state in words (the effective state: an active receiver past its end reads as expired). */
export const stateWord = (state) => x('state.' + (state || 'active'));

/** The Status tone of a state. */
export function stateTone(state) {
  if (state === 'active') return 'fine';
  if (state === 'proposed' || state === 'awaiting_operator') return 'attention';
  if (state === 'stopped' || state === 'expired') return 'danger';
  return 'off';
}

/** Who made or proposed it: you, your agent by its name, or the principal as it is. */
export function byWords(principal, ownerGhii) {
  const p = String(principal || '');
  if (!p) return '';
  if (ownerGhii && p === ownerGhii) return x('by.you');
  const hash = p.indexOf('#');
  if (hash > 0) return x('by.agent', { agent: p.slice(0, hash) });
  if (p.indexOf('@') > 0 && p.indexOf('#') < 0 && !p.includes(':')) return x('by.you');
  return p;
}

/** "60 a minute · 64 kB · 5 000 a day". */
export function limitsWords(limits) {
  if (!limits) return '';
  return x('limitsLine', { perMinute: num(limits.per_minute), size: fmtBytes(limits.max_bytes), perDay: num(limits.per_day) });
}

/** The verbs as the HTTP methods a program sends: "POST, PUT · PATCH". */
export function verbsWords(verbs) {
  return (verbs || ['write']).map((v) => x('verb.' + v + 'Short')).join(' · ');
}

/** The tone of a delivery's status code. */
export const statusTone = (status, dry) => (dry ? 'off' : status < 300 ? 'fine' : status === 429 ? 'attention' : 'danger');

/** What one delivery did, or why it was refused, in words; `sub` is the server's own sentence. */
export function deliveryWords(e) {
  if (e.status >= 400) {
    const words = refusalWords(e.code);
    return { text: words || e.reason || e.code || String(e.status), sub: words ? (e.reason || '') : '' };
  }
  const size = fmtBytes(e.bytes || 0);
  if (e.dryRun) return { text: x('d.dry'), sub: size };
  if (e.verb === 'read') return { text: x('d.read'), sub: '' };
  if (e.verb === 'delete') return { text: e.key ? x('d.deletedKey', { key: e.key }) : x('d.deleted'), sub: '' };
  if (Array.isArray(e.rowIds) && e.rowIds.length) return { text: x('d.rows', { n: num(e.rowIds.length) }), sub: size };
  if (e.key) return { text: e.verb === 'merge' ? x('d.merged', { key: e.key }) : x('d.wrote', { key: e.key }), sub: size };
  return { text: x('d.done'), sub: size };
}

/** The page's own sentence for a refusal code the receive route answers, or '' for one it has none for. */
export function refusalWords(code) {
  if (!code) return '';
  const known = ['SCHEMA_INVALID', 'SCHEMA_VALIDATION_FAILED', 'TOO_LARGE', 'RATE_LIMITED', 'DAILY_LIMIT', 'VERB_NOT_ALLOWED',
    'UNSUPPORTED_MEDIA_TYPE', 'PREFIX_FULL', 'VERSION_CONFLICT', 'SUB_REQUIRED', 'INVALID_SUB', 'INVALID_INPUT',
    'METHOD_NOT_ALLOWED', 'NOT_FOUND', 'PAUSED', 'STOPPED', 'EXPIRED', 'NOT_APPROVED', 'RECEIVERS_OFF', 'UNAUTHORIZED'];
  const c = code === 'SCHEMA_VALIDATION_FAILED' ? 'SCHEMA_INVALID' : code;
  return known.includes(code) ? x('code.' + c) : '';
}

/** The address's path on this node: the page calls it on its own origin, whatever base the server names. */
export function addressPath(address) {
  return String(address || '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
}

/** The last part a program adds for a prefix target, in an example. */
export const subFor = (target) => (target?.kind === 'prefix' ? '/example' : '');

/** An example message for the curl line: one row of a row space, or one record. */
const sampleOf = () => '{"temperature": 21.4, "at": "2026-11-07T10:40:00Z"}';

/** The curl a program's maker copies: the key comes from an environment variable, never from the page. */
export function curlFor(r) {
  return [
    `curl -X POST "${r.address}${subFor(r.target)}" \\`,
    '  -H "Authorization: Bearer $AIMEAT_RECEIVER_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  --data '${sampleOf()}'`,
  ].join('\n');
}

/**
 * One test POST to the receiver's own address with `?dry_run=true` and the key just shown: the
 * server checks everything a real message is checked against and stores nothing. Resolves to
 * { ok, status, code, message, fields }.
 */
export async function dryRun(r, key, body) {
  const path = `${addressPath(r.address)}${subFor(r.target)}?dry_run=true`;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
    });
    // A body that is not JSON (a proxy's error page) is answered by its status alone.
    const json = await res.json().catch((err) => { swallowed('receivers: dry run answer', err); return null; });
    if (json?.ok) return { ok: true, status: res.status };
    const err = json?.error || {};
    return { ok: false, status: res.status, code: err.code || '', message: err.message || '', fields: err.details?.fields || [] };
  } catch (e) {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: e?.message || '', fields: [] };
  }
}

/** The sentence a person says to their own AI to have it propose a receiver. */
export const sayToAi = () => x('ai.sentence');

/** The crumb's steps: Settings / Automation / Receivers, and the receiver's name on its own page. */
export function crumb(ctx, name) {
  const page = t('profile.tabs.receivers');
  return [t('nav.profile'), t('profile.landing.menuAutomation'),
    name ? { label: page, onClick: () => ctx.openCover() } : page,
    ...(name ? [{ label: name, here: true }] : [])];
}

/** The sibling pages in the rail (components/Rail.js): each opens its Settings tab. */
export const pageLinks = () => [
  { tab: 'agents', label: t('profile.tabs.agents') },
  { tab: 'access', label: t('profile.tabs.access') },
  { tab: 'memory', label: t('profile.tabs.memory') },
  { tab: 'organisms', label: t('profile.tabs.organisms') },
];
