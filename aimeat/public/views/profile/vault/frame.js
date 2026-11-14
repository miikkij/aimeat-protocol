/**
 * @file public/views/profile/vault/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Vault page, the pickup page and the deposit page share: the words (x), the
 *   REST calls (the routes of src/routes/secret-shares.ts, which call the same service functions as
 *   the MCP tools), and the helpers that turn a share view (services/secret-shares/view.ts) into the
 *   reader's words: its format, protection, how long it lasts, who may pick it up, its state and
 *   its tone, one event, a check result and a refusal code.
 *
 *   A secret share is a key, a password, a configuration or a file that one person gives to named
 *   people, their agents, an organism's members or whoever holds a pickup code; a request is the
 *   same with the content still to come, filled by the person asked.
 * @structure x · api · accountOf · formatWord · protectionWord · retentionWords · whoWords ·
 *   statusWord · statusTone · actorWords · eventWords · checkFacts · refusalWords · errWords ·
 *   crumb · pageLinks · LIMITS
 * @usage import { x, api, whoWords, errWords } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { t } from '/js/i18n.js';
import { api as call } from '/js/api.js';
import { date, num, fmtBytes } from '/js/format.js';

/** One word of the Vault pages. */
export const x = (key, vars) => t('secretShares.' + key, vars);

const enc = encodeURIComponent;
const post = (path, body, headers) => call(path, { method: 'POST', body: JSON.stringify(body || {}), ...(headers ? { headers } : {}) });

/** The routes of src/routes/secret-shares.ts. Each resolves to the envelope's data. */
export const api = {
  list: async () => (await call('/v1/secret-shares'))?.data || { made: [], for_me: [], to_fill: [], organisms: [] },
  get: async (id) => (await call(`/v1/secret-shares/${enc(id)}`, { retries: 0 }))?.data || null,
  create: async (body) => (await post('/v1/secret-shares', body))?.data,
  revoke: async (id) => (await post(`/v1/secret-shares/${enc(id)}/revoke`))?.data,
  card: async (id) => (await call(`/v1/secret-shares/${enc(id)}/card`, { retries: 0 }))?.data || null,
  depositCard: async (id, token) => (await call(`/v1/secret-shares/${enc(id)}/deposit-card`, { retries: 0, headers: { 'X-Deposit-Token': token } }))?.data || null,
  deposit: async (id, body) => (await post(`/v1/secret-shares/${enc(id)}/deposit`, body))?.data,
  depositWithToken: async (id, body) => (await post(`/v1/secret-shares/${enc(id)}/deposit-with-token`, body))?.data,
  pickup: async (id, body) => (await post(`/v1/secret-shares/${enc(id)}/pickup`, body))?.data,
  pickupWithCode: async (id, body) => (await post(`/v1/secret-shares/${enc(id)}/pickup-with-code`, body))?.data,
  deviceKeys: async () => (await call('/v1/vault/device-keys'))?.data || [],
  registerKey: async (body) => (await post('/v1/vault/device-keys', body))?.data,
  removeKey: async (keyId) => (await call(`/v1/vault/device-keys/${enc(keyId)}`, { method: 'DELETE' }))?.data,
  keysOf: async (who) => (await call(`/v1/vault/device-keys/of/${enc(who)}`))?.data || { ghii: who, keys: [] },
};

/** The limits the server takes (services/secret-shares/rules.ts). */
export const LIMITS = Object.freeze({ maxPickups: 1000, untilDays: 365, requestDays: 90, requestDaysDefault: 14, maxPeople: 50, nameMax: 128, noteMax: 2000 });

/** A share's name as the server takes it (NAME_RE). */
export const validName = (s) => /^[\p{L}\p{N} _.-]{1,128}$/u.test(String(s || '').trim());

/** A vault name as the vault takes it (owner-secrets.ts SECRET_NAME_RE). */
export const validVaultName = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(String(s || ''));

/** A vault name from a share's name, as the server makes one (pickup.ts vaultNameOf). */
export const vaultNameOf = (name) => String(name || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'SECRET';

/** An account on this node shown by its name; one from elsewhere shown whole. */
export function accountOf(ghii, nodeId) {
  const g = String(ghii || '');
  const tail = nodeId ? `@${nodeId}` : '';
  return tail && g.endsWith(tail) && !g.includes('#') ? g.slice(0, -tail.length) : g;
}

export const formatWord = (f) => x('format.' + (f === 'pairs' || f === 'file' ? f : 'text'));
export const protectionWord = (p) => x('protection.' + (p === 'open' || p === 'e2e' ? p : 'sealed'));

/** "Once", "3 pickups (1 used)", "Until 1.12.2026", "Until revoked". */
export function retentionWords(s) {
  if (s.retention === 'count') return x('retention.countLine', { n: num(s.max_pickups || 0), used: num(s.pickups || 0) });
  if (s.retention === 'until') return x('retention.untilLine', { date: date(s.expires_at) });
  if (s.retention === 'keep') return x('retention.keepLine');
  return x('retention.onceLine');
}

/** Who may pick it up, in words: "second, their agents, anyone with the code (signed in)". */
export function whoWords(s, nodeId, organismName, me) {
  const r = s.recipients || {};
  const parts = (r.people || []).map((p) => (me && p === me ? x('who.you') : accountOf(p, nodeId)));
  if (r.agents) parts.push(x('who.agents'));
  if (r.organism) parts.push(x('who.organism', { name: organismName || s.organism || '' }));
  if (r.code) parts.push(r.code_login ? x('who.codeLogin') : x('who.code'));
  return parts.join(', ') || x('who.nobody');
}

/** The state in words: a request that waits for its deposit reads as waiting. */
export const statusWord = (status) => x('status.' + (['waiting', 'ready', 'ended', 'revoked'].includes(status) ? status : 'ready'));
export function statusTone(status) {
  if (status === 'ready') return 'fine';
  if (status === 'waiting') return 'attention';
  if (status === 'revoked') return 'danger';
  return 'off';
}

/**
 * Who acted, in words: you, your agent, another person, their agent, someone with the code or the
 * link, or this AIMEAT itself.
 */
export function actorWords(e, ownerGhii, nodeId) {
  const a = String(e.actor || '');
  if (a === 'node') return x('actor.node');
  if (a === 'code') return e.kind === 'deposited' ? x('actor.link') : x('actor.code');
  const hash = a.indexOf('#');
  if (hash > 0) {
    const agent = a.slice(0, hash);
    return e.on_behalf_of === ownerGhii ? x('actor.yourAgent', { agent }) : x('actor.theirAgent', { agent, who: accountOf(e.on_behalf_of, nodeId) });
  }
  if (a === ownerGhii) return x('actor.you');
  return accountOf(a, nodeId) || x('actor.someone');
}

/** What one event did, in words: "Picked up into a vault (ELEVENLABS_API_KEY)". */
export function eventWords(e) {
  const d = e.detail || {};
  switch (e.kind) {
    case 'picked_up':
      if (d.to === 'vault') return x('event.toVault', { name: d.vault_name || '' });
      if (d.to === 'device') return x('event.toDevice');
      return x('event.revealed');
    case 'refused': return d.reason === 'wrong_code' ? x('event.wrongCode') : x('event.refused');
    case 'ended': return d.reason === 'pickups' ? x('event.endedPickups') : x('event.endedTime');
    case 'checked': return d.ok === 'true' ? x('event.checkedOk', { service: d.service || '' }) : x('event.checkedFail', { service: d.service || '' });
    case 'created': case 'requested': case 'deposited': case 'revoked':
      return x('event.' + e.kind);
    default: return e.kind;
  }
}

/** A check result as Facts rows: the service, whether it works, the account tag and what the service reported. */
export function checkFacts(check) {
  if (!check) return [];
  /** @type {Array<{ key: string, k: string, v: string, warn?: boolean, mono?: boolean, sub?: string }>} */
  const rows = [
    { key: 'service', k: x('check.service'), v: check.service },
    { key: 'ok', k: x('check.works'), v: check.ok ? x('check.yes') : x('check.no', { status: check.status || '-' }), warn: !check.ok },
  ];
  if (check.account) rows.push({ key: 'account', k: x('check.account'), v: check.account, mono: true, sub: x('check.accountSub') });
  for (const [k, v] of Object.entries(check.facts || {})) {
    const label = t('secretShares.check.fact.' + k);
    rows.push({ key: 'f-' + k, k: label === 'secretShares.check.fact.' + k ? k : label, v: String(v), mono: true });
  }
  return rows;
}

/** Every refusal code the secret-share services answer that this page has its own sentence for. */
const KNOWN = new Set([
  'NOT_FOUND', 'NOT_AVAILABLE', 'TOO_MANY_TRIES', 'WRONG_CODE', 'SIGN_IN_REQUIRED', 'CODE_REQUIRED', 'AGENTS_NOT_ALLOWED',
  'E2E_NO_VAULT', 'E2E_PERSON_ONLY', 'NO_DEVICE_KEY', 'TOO_LARGE_FOR_VAULT', 'INVALID_SECRET_NAME', 'INVALID_SECRET_HOST',
  'INVALID_SECRET_VALUE', 'SEALED', 'SECRET_STORE_UNAVAILABLE', 'SCOPE_DENIED', 'INVALID_NAME', 'INVALID_NOTE',
  'INVALID_PROTECTION', 'TOO_MANY_PEOPLE', 'ORGANISM_REQUIRED', 'E2E_NAMED_ONLY', 'INVALID_RETENTION', 'INVALID_MAX_PICKUPS',
  'INVALID_EXPIRES_AT', 'NO_RECIPIENTS', 'INVALID_FORMAT', 'INVALID_CONTENT', 'SECRET_TOO_LARGE', 'INVALID_REQUEST_DAYS',
  'UNKNOWN_PERSON', 'E2E_REQUEST_NO_CODE', 'NOT_A_MEMBER', 'INVALID_ENVELOPE', 'INVALID_E2E_KEYS', 'INVALID_CODE_VERIFIER',
  'NOT_WAITING', 'REQUEST_ENDED', 'NOT_MAKER', 'IN_PERSON_ONLY', 'INVALID_PUBLIC_KEY', 'TOO_MANY_DEVICE_KEYS',
  'NOT_A_RECIPIENT', 'INVALID_KIND', 'NETWORK_ERROR', 'OPEN_FAILED', 'NO_LOCAL_KEY', 'SEAL_FAILED',
]);

/** The page's sentence for a refusal code, or '' when it has none. */
export function refusalWords(code) {
  return code && KNOWN.has(code) ? x('err.' + code) : '';
}

/** A thrown call in the reader's words: the page's sentence for its code, else the server's own. */
export function errWords(e) {
  const code = e?.code || e?.response?.error?.code;
  return refusalWords(code) || e?.message || x('err.failed');
}

/** The size of a share in words, or '' when the node does not know it (an end-to-end share may not say). */
export const sizeWords = (s) => (s.size_bytes ? fmtBytes(s.size_bytes) : '');

/** The crumb's steps: Settings / Account / Vault. */
export function crumb() {
  return [t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.vault')];
}

/** The sibling pages in the rail (components/Rail.js): each opens its Settings tab. */
export const pageLinks = () => [
  { tab: 'access', label: t('profile.tabs.access') },
  { tab: 'agents', label: t('profile.tabs.agents') },
  { tab: 'organisms', label: t('profile.tabs.organisms') },
];
