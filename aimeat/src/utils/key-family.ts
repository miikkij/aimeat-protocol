/**
 * @file key-family.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure key-family classifier for the data map. Turns ONE memory key into the family it
 *   belongs to plus the basis on which we can say what that family is. A data-map row is a FAMILY,
 *   never a key: `uutiset.elokuu.*` is one row holding 300 keys, not 300 rows, and a view that
 *   forgets this is unreadable the moment a schedule has run for a month.
 *
 *   It lives in utils/ rather than services/ so the write-tally recorder can call it on the hot path,
 *   and the derivation, the backfill script and the coverage route can all call the SAME
 *   implementation, without any of them dragging `Storage` in. Same reason reserved-keys.ts is here.
 *   Nothing in this file does I/O; everything it cannot know is passed in as `hints`.
 *
 *   The tier is the point. "This is a workspace record whose shape the store enforces" and "something
 *   wrote this and nobody has said what it is" are different statements about the same key, and the
 *   second one is a finding rather than a blank.
 * @structure IdentificationTier · KeyFamily · KeyFamilyHints · PLATFORM_WRITTEN_PREFIXES ·
 *   classifyKey(key, hints?) · familyOf(key, hints?) · baseKeyOf(key)
 * @usage import { classifyKey } from '../utils/key-family.js';
 * @version-history
 *   v1.1.1 — 2026-08-24 — SECURITY (CodeQL js/loop-bound-injection): split() scanned to the caller's
 *     key length; bounded by MAX_KEY_LEN so an over-long string cannot force O(n) work. No change for
 *     a real key, which runs to tens of characters.
 *   v1.1.0 — 2026-08-24 — `agentNames` and the `crews.<agent>.*` rule, found by running v1.0.0 over
 *     the production owner's WHOLE keyspace (18 446 keys) rather than the 1000-key sample it was
 *     written against. `crews.` is the convention an agent's deliverables land under, no node code
 *     writes it, and 1094 of its 1098 keys name one of that owner's own agents — the single largest
 *     block of avoidably unexplained keys on the node.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 (data map), step 1. The prefix list was
 *     measured against production rather than read off the source: `changelog.` (23 keys in the
 *     sample), `listing.`, `news.` and `salesboard.` look like platform families and are written by
 *     no node code at all, so a list assembled by eye would have mislabelled them.
 */
import { RESERVED_OWNER_KEY_PREFIXES } from './reserved-keys.js';

/**
 * On what basis can we say what a family is — strongest first.
 *
 * The order is load-bearing: a coverage view sorts by it, and a lint can say "the weakest basis in
 * this map is X". A locked shape is a promise the store keeps; a guess is a guess.
 */
export type IdentificationTier =
  /** A workspace record or a locked schema. The store refuses anything that does not fit the shape. */
  | 'schema-locked'
  /** A place the program named in advance, in its manifest or its data map. */
  | 'declared-space'
  /** A part of AIMEAT itself writes here and decides what goes in. */
  | 'platform-prefix'
  /** The name matches something this owner owns — an app, an extension. Nothing enforces it. */
  | 'owner-named'
  /** Nothing says what this is. This is the class the coverage view exists to show. */
  | 'none';

/** Which store the family lives in. `memory` is the default; the others are addressed differently. */
export type KeyFamilyArea = 'memory' | 'organism' | 'extension' | 'ecosystem';

export interface KeyFamily {
  /** The family this key belongs to, with the varying part collapsed, e.g. `news.<date>.*`. */
  family: string;
  tier: IdentificationTier;
  /**
   * The evidence, in a form a person can check: the prefix constant, `schema:{keyPattern}`,
   * `space:{organismId}/{ws}/{space}`, `app:{name}`. Empty string when the tier is 'none' — there is
   * nothing to cite, and inventing a citation is how a guess starts reading as a fact.
   */
  by: string;
  area: KeyFamilyArea;
}

export interface KeyFamilyHints {
  /** Locked schemas, from SchemaRecord. `applyTo` mirrors the stored record. */
  schemas?: { keyPattern: string; applyTo: 'exact' | 'prefix' }[];
  /** Patterns a program declared in its own data map, with who declared them. */
  declared?: { pattern: string; by: string }[];
  /** App filenames without `.html`, for the owner-named tier. */
  appNames?: string[];
  /** Installed extension names, for the owner-named tier. */
  extNames?: string[];
  /**
   * This owner's agent names. Worth its own hint because of `crews.<agent>.*`, the convention an
   * agent's deliverables land under — it is documented in the browser SDK and written into the
   * app-building prompt, and no node code writes it, so nothing else can identify it.
   *
   * Measured 2026-08-24 on the production owner: 1094 of 1098 `crews.*` keys carry the name of one
   * of that owner's own 86 agents. Without this hint every one of them is unexplained.
   */
  agentNames?: string[];
}

/** `crews.<agent>.<whatever>` — where an agent's deliverables land, by convention rather than by rule. */
const CREWS_KEY = /^crews\.([^.]+)\./;

/**
 * Owner-namespace prefixes a part of the node itself writes and reads.
 *
 * DIFFERENT LIST, DIFFERENT QUESTION from RESERVED_OWNER_KEY_PREFIXES. Reserved means "the server
 * changes what it DOES because of what it finds here", and it costs a granted app a capability.
 * This list only means "the node wrote it, so we can describe it without asking anyone". Adding to
 * this one takes away nothing; it just moves a family out of the unexplained column.
 *
 * Every entry names the code that writes it, because the failure mode here is silent: a family
 * wrongly called platform is described with a sentence nobody wrote, and it stops appearing in the
 * one view whose whole job is to show what nobody has described. Measured against production on
 * 2026-08-24 — `changelog.` (23 keys in a 1000-key sample), `listing.`, `news.` and `salesboard.`
 * read like platform families and are written by NO node code, so they are deliberately absent.
 */
export const PLATFORM_WRITTEN_PREFIXES: readonly { prefix: string; writtenBy: string }[] = [
  { prefix: 'agents.', writtenBy: 'services/agent-statistics.ts, services/agent-offers-write.ts' },
  { prefix: 'apps.', writtenBy: 'services/app-tool-interfaces.ts (apps.{appId}.tools)' },
  { prefix: 'apptool.', writtenBy: 'services/app-tool-interfaces.ts' },
  { prefix: 'app-catalog.', writtenBy: 'routes/apps (promoted + favourites docs)' },
  { prefix: 'skills.', writtenBy: 'services/skills.ts, services/skill-seeds.ts' },
  { prefix: 'workflows.', writtenBy: 'services/workflow/store.ts, engine.ts, lifecycle.ts' },
  { prefix: 'exchange.', writtenBy: 'services/exchange-market.ts, exchange-projection.ts and 11 more' },
  { prefix: 'onboarding.', writtenBy: 'services/onboarding-funnel.ts and 10 more' },
  { prefix: 'compliance.', writtenBy: 'services/compliance-register.ts (under system@{nodeId})' },
  { prefix: 'calibrator.', writtenBy: 'routes/calibrator.ts, services/db/calibrator-detail-db-service.ts' },
  { prefix: 'template.catalog.', writtenBy: 'services/app-template-proposals.ts' },
  { prefix: 'packages', writtenBy: 'services/component-registrar.ts' },
  { prefix: 'ecosystem.', writtenBy: 'services/ecosystem-events.ts' },
  { prefix: 'security.', writtenBy: 'services/security-incident.ts' },
  { prefix: 'notif.', writtenBy: 'services/notify.ts' },
  { prefix: 'presence.', writtenBy: 'services/presence.ts' },
  { prefix: 'portfolio.', writtenBy: 'routes/portfolio.ts' },
  { prefix: 'network-policy.', writtenBy: 'services/network-policy.ts' },
  { prefix: 'federation-book.', writtenBy: 'services/federation-book.ts' },
  { prefix: 'link-invite.', writtenBy: 'services/link-invites.ts' },
  { prefix: 'living.template.', writtenBy: 'services/living-pulse.ts' },
  { prefix: 'tracked-response', writtenBy: 'services/tracked-response.ts' },
  { prefix: 'open-items.', writtenBy: 'services/open-items.ts' },
  { prefix: 'message-flag.', writtenBy: 'services/security-incident.ts' },
  { prefix: 'libpack.proofs.', writtenBy: 'services/contribution-proofs.ts' },
  { prefix: 'notebook.inbox.', writtenBy: 'services/notify.ts' },
  { prefix: 'settings.', writtenBy: 'services/proactive-mode.ts (settings.proactive, settings.ui_track)' },
] as const;

/** A version-history row: the immutable snapshot of an earlier value of the key it hangs off. */
const VERSION_ROW = /\.version\.\d+$/;

/** Opaque identifiers that must collapse, or 169 organisms become 169 families. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WS_LIKE = /^ws-[a-z0-9]{6,}$/i;
const ALL_DIGITS = /^\d+$/;
const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?$/;
/**
 * A generated id, recognised by its gibberish chunk: eight or more characters carrying BOTH letters
 * and digits. `prj-mpmmry7v-wposa`, `doc-msovrfkwgxa8` and `t_48be5aae81ef` all match; `my-fractals`,
 * `mroom-weather` and `btc-cost-basis-tracker` do not.
 *
 * DELIBERATELY NARROW, and the cost is stated rather than hidden. A generated id that happens to be
 * all letters — `cal-mpgvmtlj-2weoj` is the real example on this node — does NOT collapse, so that
 * family splits per id. Every rule wide enough to catch it also caught `my-fractals`, and the two
 * failures are not equal: a family split too finely is still readable and still true, while two real
 * families merged into one row is a wrong answer that nobody can see is wrong. When a split family
 * matters, the owner names it, which is one sentence and moves it to the named tier anyway.
 */
const GENERATED_CHUNK = /(^|[-_])(?=[a-z0-9]{8,}(?:[-_]|$))(?=[a-z0-9]*\d)[a-z0-9]{8,}(?=[-_]|$)/i;

/** How many leading segments a family may name before the tail becomes `*`. */
const MAX_FAMILY_SEGMENTS = 4;

/**
 * A memory key is a storage ADDRESS, short by construction — real ones run to tens of characters.
 * Bounding the scan here keeps an over-long caller-supplied string from turning family grouping into
 * O(n) work on demand; a genuine key is far under the cap, so this changes nothing for real input.
 */
const MAX_KEY_LEN = 1024;

/** A key is dotted, but some apps use slashes. Both separate; both are preserved in the family. */
function split(key: string): { text: string; sep: string }[] {
  const out: { text: string; sep: string }[] = [];
  let start = 0;
  // Bound the scan by a constant, not by the caller's key length (js/loop-bound-injection).
  const scanLen = Math.min(key.length, MAX_KEY_LEN);
  for (let i = 0; i < scanLen; i++) {
    const ch = key[i];
    if (ch === '.' || ch === '/') {
      out.push({ text: key.slice(start, i), sep: ch });
      start = i + 1;
    }
  }
  out.push({ text: key.slice(start, MAX_KEY_LEN), sep: '' });
  return out;
}

/**
 * The key a version row is a snapshot OF, or the key itself.
 *
 * History belongs to the family it is history of. Without this, a trackable key with 40 versions
 * would show up as 40 unexplained families beside the one family that explains all of them.
 */
export function baseKeyOf(key: string): string {
  return key.replace(VERSION_ROW, '');
}

/** Collapse a segment that only ever varies, so a family stays one row. */
function collapse(seg: string): string {
  if (!seg) return seg;
  if (UUID_LIKE.test(seg) || WS_LIKE.test(seg)) return '<id>';
  if (ISO_DATE.test(seg)) return '<date>';
  if (ALL_DIGITS.test(seg)) return '<n>';
  if (GENERATED_CHUNK.test(seg)) return '<id>';
  return seg;
}

/** Build the family string: collapse the varying parts, keep at most MAX_FAMILY_SEGMENTS, end in `*`. */
function familyFrom(key: string, keepSegments: number): string {
  const parts = split(baseKeyOf(key));
  const keep = Math.min(keepSegments, parts.length, MAX_FAMILY_SEGMENTS);
  let out = '';
  for (let i = 0; i < keep; i++) {
    out += collapse(parts[i].text);
    out += parts[i].sep || '.';
  }
  // Already the whole key and it ended without a separator: it is one record, not a family.
  if (keep >= parts.length) return out.slice(0, -1);
  return `${out}*`;
}

/** `organism.<uuid>.w.<ws>.<space>.<id>.<state>` — a workspace record, the commonest key on the node. */
const WORKSPACE_KEY = /^organism\.([^.]+)\.w\.(ws-[^.]+)\.([^.]+)\./;
/** `organism.<uuid>.meta.*` / `.shared.*` / `.member.<name>.*` — the node's own organism plumbing. */
const ORGANISM_PLUMBING = /^organism\.([^.]+)\.(meta|shared|member)\./;

function matchesPattern(key: string, pattern: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return key === pattern;
  return key.startsWith(pattern.slice(0, star));
}

/**
 * Classify ONE key. First match wins, strongest tier first.
 *
 * `hints` is everything the caller knows and this function cannot: locked schemas, what a program
 * declared, which apps and extensions this owner has. Called with no hints it still resolves the
 * workspace form, the reserved prefixes and the platform families — which measured 74% of a
 * production sample on 2026-08-24 — and everything else lands in 'owner-named' or 'none'.
 */
export function classifyKey(key: string, hints: KeyFamilyHints = {}): KeyFamily {
  const base = baseKeyOf(key);

  // 1. A workspace record. The space's schema fixes the shape at write time when there is one, so
  //    this is the only tier the store itself enforces.
  const ws = WORKSPACE_KEY.exec(base);
  if (ws) {
    const [, organismId, workspaceId, space] = ws;
    const locked = (hints.schemas ?? []).some(s => matchesPattern(base, s.keyPattern));
    return {
      family: `organism.<id>.w.<id>.${space}.*`,
      tier: locked ? 'schema-locked' : 'declared-space',
      by: locked ? `schema:${space}` : `space:${organismId}/${workspaceId}/${space}`,
      area: 'organism',
    };
  }

  // 2. The node's own organism plumbing — the registry, the shared area, a member's own corner.
  const plumbing = ORGANISM_PLUMBING.exec(base);
  if (plumbing) {
    return {
      family: `organism.<id>.${plumbing[2]}.*`,
      tier: 'platform-prefix',
      by: `organism.${plumbing[2]}.`,
      area: 'organism',
    };
  }

  // 3. Reserved: the server changes what it does because of what it finds here.
  const reserved = RESERVED_OWNER_KEY_PREFIXES.find(p => base.startsWith(p));
  if (reserved) {
    return { family: familyFrom(base, 2), tier: 'platform-prefix', by: reserved, area: 'memory' };
  }

  // 4. Written by a part of the node, so we can describe it without asking anyone.
  const platform = PLATFORM_WRITTEN_PREFIXES.find(p => base.startsWith(p.prefix));
  if (platform) {
    return { family: familyFrom(base, 3), tier: 'platform-prefix', by: platform.prefix, area: 'memory' };
  }

  // 5. A locked schema outside a workspace.
  const schema = (hints.schemas ?? []).find(s => matchesPattern(base, s.keyPattern));
  if (schema) {
    return { family: schema.keyPattern, tier: 'schema-locked', by: `schema:${schema.keyPattern}`, area: 'memory' };
  }

  // 6. A place a program said in advance it would write.
  const declared = (hints.declared ?? []).find(d => matchesPattern(base, d.pattern));
  if (declared) {
    return { family: declared.pattern, tier: 'declared-space', by: declared.by, area: areaOf(base) };
  }

  // 7. An agent's deliverables. `crews.<agent>.*` is a convention the SDK and the app-building prompt
  //    both write, and nothing on the node enforces it — hence owner-named rather than declared.
  const crew = CREWS_KEY.exec(base);
  if (crew && (hints.agentNames ?? []).includes(crew[1])) {
    return {
      family: `crews.${crew[1]}.*`,
      tier: 'owner-named',
      by: `agent:${crew[1]}`,
      area: 'memory',
    };
  }

  // 8. The name matches something this owner owns. A hint, not a promise — nothing enforces it.
  const head = split(base)[0].text;
  if (head && (hints.appNames ?? []).includes(head)) {
    return { family: familyFrom(base, 2), tier: 'owner-named', by: `app:${head}`, area: 'memory' };
  }
  const extHead = base.startsWith('ext:') ? base.slice(4).split(/[.:/]/)[0] : '';
  if (extHead && (hints.extNames ?? []).includes(extHead)) {
    return { family: `ext:${extHead}.*`, tier: 'owner-named', by: `extension:${extHead}`, area: 'extension' };
  }

  // 9. Nothing says what this is. The family is a guess from the shape of the key, and the empty
  //    `by` is the honest part: there is nothing to cite.
  return { family: familyFrom(base, 2), tier: 'none', by: '', area: areaOf(base) };
}

function areaOf(key: string): KeyFamilyArea {
  if (key.startsWith('ext:')) return 'extension';
  if (key.startsWith('eco:') || key.startsWith('eco.')) return 'ecosystem';
  if (key.startsWith('organism.')) return 'organism';
  return 'memory';
}

/** Just the family, for the tally's hot path where the tier is stored separately. */
export function familyOf(key: string, hints: KeyFamilyHints = {}): string {
  return classifyKey(key, hints).family;
}
