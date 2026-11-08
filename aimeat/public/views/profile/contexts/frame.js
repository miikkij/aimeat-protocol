/**
 * @file public/views/profile/contexts/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Contexts page's views share: the words (x), the REST calls the page makes
 *   (the existing memory routes: GET /v1/memory?prefix=context., PUT /v1/memory/:key with the
 *   record's version, DELETE /v1/memory/:key to the bin and POST /v1/memory/:key/restore), and the
 *   helpers that turn one context record into the reader's words: its status line, who can read it,
 *   and the sentence a person gives their own AI to go on with it.
 *
 *   A context is one memory record under `context.<slug>` kept under the person (built-in skill
 *   aimeat-context, src/data/builtin-skills.context.ts). The marks follow the context index the AI
 *   reads on connecting (src/services/context/index-line.ts): stale after CONTEXT_STALE_DAYS without
 *   shaping, large when the core passes CONTEXT_CORE_LARGE characters, archived when
 *   lifecycle.archivedAt is set.
 * @structure x · xn · CONTEXT_PREFIX · CONTEXT_TYPE · CONTEXT_STALE_DAYS · CONTEXT_CORE_LARGE · api (list,
 *   write, remove, restore) · slugOf · contextOf · marksOf · readersWords · OWN_READERS ·
 *   chatSentence · crumb
 * @usage import { x, api, contextOf, marksOf } from './frame.js';
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import { t, tn } from '/js/i18n.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { num } from '/js/format.js';

/** One word of this page. */
export const x = (key, vars) => t('contexts.' + key, vars);
/** A count of this page in the language's plural form (`<key>_one`, `<key>_other`), the number formatted. */
export const xn = (key, n, vars) => tn('contexts.' + key, n, { ...vars, n: num(n) });

export const CONTEXT_PREFIX = 'context.';
export const CONTEXT_TYPE = 'aimeat.context/v1';
/** The same limits as src/services/context/index-line.ts, so the page and the AI see the same marks. */
export const CONTEXT_STALE_DAYS = 90;
export const CONTEXT_CORE_LARGE = 6000;
const DAY_MS = 86_400_000;

const enc = encodeURIComponent;

/** The memory routes this page calls. Each resolves to the envelope's data. */
export const api = {
  /** The person's own records under context. (the owner session lists the owner scope). */
  list: async () => (await apiGet(`/v1/memory?prefix=${enc(CONTEXT_PREFIX)}&limit=200`))?.data?.items || [],
  /** The whole record written back on its version: a newer version answers 409 VERSION_CONFLICT. */
  write: async (key, body) => (await apiPut(`/v1/memory/${enc(key)}`, body))?.data,
  /** To the bin: the answer carries restorable_until. */
  remove: async (key) => (await apiDelete(`/v1/memory/${enc(key)}`))?.data,
  restore: async (key) => (await apiPost(`/v1/memory/${enc(key)}/restore`, {}))?.data,
};

/** The slug of a context key: context.lisbon-trip → lisbon-trip. */
export const slugOf = (key) => String(key || '').slice(CONTEXT_PREFIX.length);

const text = (v) => (typeof v === 'string' ? v : '');
const list = (v) => (Array.isArray(v) ? v.filter((it) => it !== null && it !== undefined) : []);

/**
 * One listed memory item as a context, or null when the item is not one (another record under the
 * prefix). Only type, name, summary and core are guaranteed; everything else may be missing.
 */
export function contextOf(item) {
  const v = item?.value;
  if (!v || typeof v !== 'object' || v.type !== CONTEXT_TYPE) return null;
  const lifecycle = v.lifecycle && typeof v.lifecycle === 'object' ? v.lifecycle : {};
  return {
    key: item.key,
    slug: slugOf(item.key),
    version: item.version,
    visibility: item.visibility || 'private',
    value: v,
    name: text(v.name).trim() || slugOf(item.key),
    summary: text(v.summary),
    kind: ['factual', 'creative', 'mixed'].includes(v.kind) ? v.kind : '',
    core: text(v.core),
    concepts: list(v.concepts).filter((c) => typeof c === 'object' && text(c.term)),
    references: list(v.references).filter((r) => typeof r === 'object' && (text(r.ref) || text(r.what))),
    includes: list(v.includes).filter((s) => typeof s === 'string'),
    excludes: list(v.excludes).filter((s) => typeof s === 'string'),
    views: list(v.views).filter((w) => typeof w === 'object' && text(w.ask)),
    createdAt: text(lifecycle.createdAt) || item.created_at || '',
    shapedAt: text(lifecycle.shapedAt) || item.updated_at || '',
    readAt: text(lifecycle.readAt),
    archivedAt: text(lifecycle.archivedAt),
  };
}

/** The marks of one context: archived, months without shaping (past CONTEXT_STALE_DAYS), large. */
export function marksOf(c, now = Date.now()) {
  const shaped = Date.parse(c.shapedAt);
  const idle = Number.isFinite(shaped) ? now - shaped : 0;
  return {
    archived: !!c.archivedAt,
    staleMonths: idle > CONTEXT_STALE_DAYS * DAY_MS ? Math.floor(idle / (30 * DAY_MS)) : 0,
    large: c.core.length > CONTEXT_CORE_LARGE,
  };
}

/** The two levels this page sets: only the person, or the person and their own AIs. */
export const OWN_READERS = ['private', 'owner'];

/** Who can read a record at this visibility, in words. `orgNames` maps an organism id to its name. */
export function readersWords(visibility, orgNames) {
  const vis = String(visibility || 'private');
  if (vis.startsWith('organism:')) {
    const name = orgNames?.[vis.slice('organism:'.length)];
    return name ? x('readers.organism', { name }) : x('readers.organismUnnamed');
  }
  if (['private', 'owner', 'members', 'public'].includes(vis)) return x('readers.' + vis);
  return x('readers.other');
}

/** The sentence a person pastes to their own AI to go on with one context. */
export const chatSentence = (c) => x('chatSentence', { name: c.name, key: c.key });

/** The crumb's steps: Settings / Information / Contexts. */
export const crumb = () => [t('nav.profile'), t('profile.landing.menuInformation'), t('profile.tabs.contexts')];
