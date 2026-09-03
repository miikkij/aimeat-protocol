/**
 * @file gaii.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Identity parsing/validation for the three AIMEAT principal types: GHII (human owner,
 *   `owner@node`), GAII (AI agent, `agent#owner@node`), and GEAI (ecosystem application,
 *   `eco:{app}#{owner}@{node}`). Provides the regexes, parsers, validators, builders, and the
 *   `resolveIdentity()` storage-identity resolver used across every identity-keyed route. The
 *   `eco:` prefix is the GEAI discriminator: GAII helpers MUST refuse `eco:`-prefixed strings so the
 *   two namespaces never collide.
 * @structure
 *   - GAII: parseGAII / buildGAII / isValidGAII / validateAgentName
 *   - GEAI: parseGEAI / buildGEAI / isValidGEAI / validateAppName / isGEAI / ECO_PREFIX
 *   - resolveIdentity (owner→GHII, agent/ecosystem→sub verbatim), parseGaiiLoose, isSameOwner
 *   - Chat instance + device-auth user-code helpers
 * @usage import { resolveIdentity, parseGEAI, isGEAI } from '../utils/gaii.js';
 * @version-history
 *   v1.5.0 — 2026-08-24 — Node-id grammar loses the hardcoded `aimeat-` prefix: any 3-64 chars of
 *     lowercase alphanumerics in two or more hyphen-separated segments. The prefix made every
 *     strict parse fail on the first organisation node (innokas-finland-001-genesis), which broke
 *     MCP task_create for callers the same server had authenticated.
 *   v1.4.0 — 2026-08-13 — `isExternalPrincipal`: does this identity act FOR a person, or is it the
 *     person. Session rows share an owner column, so the device list and "sign out everywhere" need
 *     to tell the human's own sign-ins from their agents'.
 *   v1.3.0 — 2026-07-28 — `callerPrincipal` + `appSlug`: a hosted app is named `eco:{app}#{owner}@{node}`
 *     where the question is who acted. Storage identity is untouched, so no app's data moves.
 *   v1.2.0 — 2026-07-27 — `ownerGhiiOf`: the identity anything about MONEY keys on, since the wallet
 *     already collapses every agent to its owner. Rights that keyed on the exact caller instead went
 *     out of step with the balance paying for them.
 *   v1.1.0 — 2026-06-14 — Add GEAI (ecosystem app) identity helpers; harden GAII parsers to reject
 *     `eco:`; make parseGaiiLoose/resolveIdentity GEAI-aware (ecosystem-apps foundation, chunk 1).
 */
import { randomBytes } from 'node:crypto';

// GAII format: agent#owner@node
// agent: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// owner: ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
// node:  3-64 chars of lowercase alphanumerics in TWO OR MORE hyphen-separated segments.
//   The grammar required a literal `aimeat-` brand prefix until 2026-08-24, and the first
//   organisation node (innokas-finland-001-genesis) proved that wrong in production: every strict
//   parse on that node returned null, so MCP task_create told a caller holding a token the same
//   server had minted "Could not resolve caller identity", while the loose parsers kept working.
//   The fleet's `aimeat-{region}-{nnn}-{role}` shape is a naming convention now, not grammar.
//   The two-segment minimum is load-bearing: it is what keeps a bare mail host (`alice@gmail`)
//   from parsing as a federated identity — see isValidGHII.
// GEAI format: eco:{app}#{owner}@{node}  (the `eco:` prefix is the discriminator)

const AGENT_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const OWNER_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const NODE_RE = /^(?=[a-z0-9-]{3,64}$)[a-z0-9]+(?:-[a-z0-9]+)+$/;
const GAII_RE = /^([a-z0-9][a-z0-9-]{1,62}[a-z0-9])#([a-z0-9][a-z0-9-]{1,62}[a-z0-9])@(?=[a-z0-9-]{3,64}$)([a-z0-9]+(?:-[a-z0-9]+)+)$/;

/** The literal prefix that distinguishes a GEAI (ecosystem app) from a GAII (agent). */
export const ECO_PREFIX = 'eco:';
const GEAI_RE = /^eco:([a-z0-9][a-z0-9-]{1,62}[a-z0-9])#([a-z0-9][a-z0-9-]{1,62}[a-z0-9])@(?=[a-z0-9-]{3,64}$)([a-z0-9]+(?:-[a-z0-9]+)+)$/;

// 'support' and 'operators' are the two halves of `support@operators`, the named address that
// reaches whoever runs this node (services/message-alias.ts). An owner or agent registered under
// either name would make the address ambiguous, so neither is available.
export const RESERVED_NAMES = new Set([
  'admin', 'system', 'root', 'operator', 'operators', 'support', 'meat', 'aimeat', 'node', 'network',
  'registry', 'anonymous', 'null', 'undefined', 'test', 'debug', 'internal',
  'public', 'private', 'shared', 'all', 'none', 'any', 'self', 'global',
]);

export interface ParsedGAII {
  agent: string;
  owner: string;
  node: string;
  full: string;
}

export function parseGAII(gaii: string): ParsedGAII | null {
  if (gaii.startsWith(ECO_PREFIX)) return null; // GEAIs are not GAIIs — never half-accept them
  const match = GAII_RE.exec(gaii);
  if (!match) return null;
  return { agent: match[1], owner: match[2], node: match[3], full: gaii };
}

export function buildGAII(agent: string, owner: string, node: string): string {
  return `${agent}#${owner}@${node}`;
}

export function validateAgentName(name: string): string | null {
  if (!AGENT_RE.test(name)) return 'Agent name must be 3-64 lowercase alphanumeric characters with hyphens';
  if (RESERVED_NAMES.has(name)) return `Name "${name}" is reserved`;
  return null;
}

// ── GEAI (ecosystem application) identity ────────────────────────────────
// A GEAI is a per-user, owner-approved external principal: `eco:{app}#{owner}@{node}`.
// Structurally the `{app}#{owner}@{node}` tail mirrors a GAII, which is why the tunnel and
// memory write paths treat a GEAI as "an agent-shaped principal with a different role". The
// `eco:` prefix is what keeps the two namespaces from ever colliding.

export interface ParsedGEAI {
  app: string;
  owner: string;
  node: string;
  full: string;
}

/** True iff the identity is GEAI-shaped (carries the `eco:` discriminator prefix). */
export function isGEAI(id: string): boolean {
  return id.startsWith(ECO_PREFIX);
}

export function parseGEAI(id: string): ParsedGEAI | null {
  const match = GEAI_RE.exec(id);
  if (!match) return null;
  return { app: match[1], owner: match[2], node: match[3], full: id };
}

export function isValidGEAI(id: string): boolean {
  return GEAI_RE.test(id);
}

export function buildGEAI(app: string, owner: string, node: string): string {
  return `${ECO_PREFIX}${app}#${owner}@${node}`;
}

/** Validate an ecosystem app's global short name (same charset + reserved rules as an agent name). */
export function validateAppName(name: string): string | null {
  if (!AGENT_RE.test(name)) return 'App name must be 3-64 lowercase alphanumeric characters with hyphens';
  if (RESERVED_NAMES.has(name)) return `Name "${name}" is reserved`;
  return null;
}

export function validateOwnerName(name: string): string | null {
  if (!OWNER_RE.test(name)) return 'Owner name must be 3-64 lowercase alphanumeric characters with hyphens';
  if (RESERVED_NAMES.has(name)) return `Name "${name}" is reserved`;
  return null;
}

export function validateNodeId(nodeId: string): string | null {
  if (!NODE_RE.test(nodeId)) return 'Node ID must be 3-64 lowercase alphanumeric characters in two or more hyphen-separated segments, e.g. aimeat-fi-001-genesis';
  return null;
}

export function isValidGAII(gaii: string): boolean {
  if (gaii.startsWith(ECO_PREFIX)) return false; // GEAIs are not GAIIs
  return GAII_RE.test(gaii);
}

/**
 * Is this a well-formed HUMAN identity, `owner@node`, on any node?
 *
 * Shape only, and deliberately NOT `validateOwnerName`: that one also refuses the reserved words,
 * which is a registration policy. An account that exists under a name the reserved list gained
 * later is still a real person, and a shape test that refuses them would make them unaddressable.
 *
 * The node half is what does the work. Its grammar demands two or more hyphen-separated segments
 * and refuses dots, and a mail host (`gmail`, `gmail.com`) fits neither, so this is what separates
 * a federated identity from an email address that merely contains an `@`.
 */
export function isValidGHII(id: string): boolean {
  if (id.startsWith(ECO_PREFIX) || id.includes('#')) return false;
  const at = id.lastIndexOf('@');
  if (at <= 0) return false;
  return OWNER_RE.test(id.slice(0, at)) && NODE_RE.test(id.slice(at + 1));
}

/**
 * Resolve the effective storage identity from a request's auth context.
 * - Owner sessions (GHII): JWT sub is bare username → returns `owner@nodeId` (GHII format)
 * - Agent sessions (GAII): JWT sub is already full GAII → returns it as-is
 * - Ecosystem sessions (GEAI): JWT sub is already the full `eco:` identity → returns it as-is.
 *   This is intentional and load-bearing: a GEAI writes into its OWN `eco:` memory namespace,
 *   exactly like an agent writes into its GAII namespace, so its writes never collide with the
 *   owner's keyspace. The owner owns that data via owner-session aggregation (see owner-memory.ts),
 *   NOT by remapping the GEAI's writes to GHII. Do not add an "ecosystem → GHII" branch here.
 *
 * This MUST be used everywhere data is stored/retrieved by identity (memory, files,
 * consent, knowledge, etc.) to ensure owner sessions use GHII and agents/ecosystem apps use their sub.
 */
/**
 * An agent identifier from a URL, as the identity it names.
 *
 * A `:name` path segment may be a BARE NAME (`concierge`, which needs the caller's owner and this
 * node to mean anything) or an identity already whole (`concierge#alice@node`). Nine route files
 * each had their own `resolveAgentGaii` that called `buildGAII` unconditionally, so handing one a
 * GAII produced `concierge#alice@node#alice@node` — an identity that names nobody, and a 403 or a
 * 404 with a message about ownership that was not the problem.
 *
 * That is the same defect as the `/v1/agents/me` rewrite this was found through: taking an identity
 * apart to put it back together, when it was already there. An identifier that carries a `#` is
 * already an identity; nothing needs assembling.
 *
 * It does NOT check that the identity belongs to the caller. That is each route's own check, and
 * each route has one — which is why the broken cases refused rather than leaked.
 */
export function agentGaiiFromIdentifier(identifier: string, owner: string, nodeId: string): string {
    return identifier.includes('#') ? identifier : buildGAII(identifier, owner, nodeId);
}

export function resolveIdentity(auth: { sub: string; owner: string; roles: string[] }, nodeId: string): string {
  const isOwnerSession = auth.roles.includes('owner') &&
    !auth.roles.includes('agent') && !auth.roles.includes('ecosystem');
  return isOwnerSession ? `${auth.owner}@${nodeId}` : auth.sub;
}

/**
 * An app id (`nuotta.html`) as a name the `eco:` grammar accepts.
 *
 * App ids are FILENAMES and carry an extension; GEAI names are `[a-z0-9][a-z0-9-]{1,62}[a-z0-9]`,
 * with no dot. Runs of anything else collapse to a single hyphen, so `nuotta.html` is `nuotta-html`
 * and the mapping is stable without storing anything.
 *
 * Two app ids that differ only in a character this flattens would collide (`a.b` and `a-b`). That is
 * accepted here rather than hidden: the alternative is a stored slug, and a stored slug is a
 * migration and a second source of truth for a name the filename already fixes.
 */
export function appSlug(appId: string): string {
  const base = appId.includes('/') ? (appId.split('/').pop() as string) : appId;
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug.length >= 3 ? slug : `app-${slug}`.slice(0, 64);
}

/**
 * WHO is making this request, as opposed to whose data space it acts in.
 *
 * For everything except a hosted app these are the same string, and this returns what
 * {@link resolveIdentity} does. For an H-2 app grant they are NOT the same and never were: the token's
 * `sub` is the OWNER's GHII, because a hosted app deliberately reads and writes the owner's namespace
 * rather than a fenced one of its own. That makes the app invisible — at the money layer a call from
 * an app the user once connected is indistinguishable from the user's own, so nobody can be told
 * afterwards which of the two spent their morsels.
 *
 * So the app gets the identity the node already has a grammar for, `eco:{app}#{owner}@{node}`, and it
 * is used where the QUESTION is "who did this": attribution, metering, consent. Storage keeps using
 * `resolveIdentity`, so no app's data moves.
 *
 * Safe to bill against: `resolveGhii` walks an `eco:` name back to its owner exactly as it does a
 * GAII, so the human still pays.
 */
export function callerPrincipal(
  auth: { sub: string; owner: string; roles: string[]; app_grant?: string; app?: string },
  nodeId: string,
  appId?: string | null,
): string {
  if (!auth.roles.includes('app')) return resolveIdentity(auth, nodeId);
  const id = appId ?? auth.app ?? '';
  if (!id) return resolveIdentity(auth, nodeId);   // nothing to name it by — fall back rather than invent
  return buildGEAI(appSlug(id), auth.owner, nodeId);
}

/**
 * Lenient identity parser — extracts owner and node without strict validation.
 * Handles `agent#owner@node` (GAII), `owner@node` (GHII), and `eco:{app}#owner@node` (GEAI).
 * For a GEAI the leading `eco:` prefix is stripped so `agent` is the bare app name and `owner`
 * is the owner (never `eco:app`); this keeps isSameOwner(ghii, geai) correct.
 * Returns empty strings for missing parts instead of null.
 */
export function parseGaiiLoose(gaii: string): { agent: string; owner: string; node: string } {
  const stripped = gaii.startsWith(ECO_PREFIX) ? gaii.slice(ECO_PREFIX.length) : gaii;
  const hashIdx = stripped.indexOf('#');
  const atIdx = stripped.lastIndexOf('@');
  if (atIdx < 0) return { agent: '', owner: '', node: '' };
  return {
    agent: hashIdx >= 0 ? stripped.slice(0, hashIdx) : '',
    owner: hashIdx >= 0 ? stripped.slice(hashIdx + 1, atIdx) : stripped.slice(0, atIdx),
    node: stripped.slice(atIdx + 1),
  };
}

/**
 * Check if two GAII/GHII identities belong to the same owner.
 * Handles both GHII ("alice@node") and GAII ("agent#alice@node") formats.
 */
export function isSameOwner(gaiiA: string, gaiiB: string): boolean {
  return parseGaiiLoose(gaiiA).owner === parseGaiiLoose(gaiiB).owner;
}

/**
 * The OWNER GHII behind any principal: `agent#alice@node`, `eco:drum#alice@node` and `alice@node` all
 * resolve to `alice@node`.
 *
 * This is the identity anything about MONEY keys on, because the human is the only principal with a
 * balance — `debitBalance` already collapses every GAII to its owner before touching a row. Anything
 * that keys a spending RIGHT on the exact caller instead ends up out of step with the wallet paying
 * for it: on production one person held two separate contracts for the same product, one under their
 * agent and one under themselves, both drawing on the one balance.
 *
 * Use it for rights and billing. Do NOT use it for attribution — who actually called is the exact
 * principal, and that distinction is the whole point of agents having identities.
 */
export function ownerGhiiOf(principal: string): string {
  const [namePart, host] = principal.split('@');
  if (!namePart) return principal;
  const owner = namePart.includes('#') ? (namePart.split('#').pop() as string) : namePart;
  return host ? `${owner}@${host}` : owner;
}

/**
 * Is this identity something acting FOR a person rather than the person themselves?
 *
 * `bot#alice@node` (GAII) and `eco:drum#alice@node` (GEAI) are; `alice` and `alice@node` are not.
 * The '#' is what separates them, which is why both forms were given one.
 *
 * Used where a surface is about the human's own sign-ins: their device list, and signing out
 * everywhere. Those rows share an `owner` column with every agent session, and treating the two the
 * same turns "sign out of my other browser" into disconnecting a fleet.
 */
export function isExternalPrincipal(id: string): boolean {
  return id.includes('#');
}

// Chat Instance ID format: platform-appname#owner@node
// Same syntax as GAII but semantically different — represents a human-operated AI session
// Examples:
//   Logged in:  claude-myapp#jouni@aimeat-finland-001-genesis
//   Anonymous:  chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis

export interface ParsedChatInstanceId {
  platform: string;
  appName: string;
  ownerName: string;
  nodeId: string;
  full: string;
  isAnonymous: boolean;
}

export function buildChatInstanceId(platform: string, appName: string, owner: string, node: string): string {
  return `${platform}-${appName}#${owner}@${node}`;
}

/**
 * Generate a human-readable user code for device authorization (RFC 8628).
 * Format: XXXX-XXXX using unambiguous characters.
 */
export function generateUserCode(): string {
  const CHARS = 'CDFGHJKMNPQRTVWXYZ2346789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CHARS[bytes[i] % CHARS.length];
    if (i === 3) code += '-';
  }
  return code;
}

export function parseChatInstanceId(id: string): ParsedChatInstanceId | null {
  // Format: platform-appname#owner@node
  const hashIdx = id.indexOf('#');
  if (hashIdx < 0) return null;

  const beforeHash = id.substring(0, hashIdx);
  const afterHash = id.substring(hashIdx + 1);

  const atIdx = afterHash.indexOf('@');
  if (atIdx < 0) return null;

  const ownerName = afterHash.substring(0, atIdx);
  const nodeId = afterHash.substring(atIdx + 1);

  if (!NODE_RE.test(nodeId)) return null;
  if (!OWNER_RE.test(ownerName)) return null;

  // Split beforeHash into platform and appName
  // The appName is the last hyphen-separated segment
  // EXCEPT for anonymous: "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
  const firstHyphen = beforeHash.indexOf('-');
  if (firstHyphen < 0) return null;

  const lastHyphen = beforeHash.lastIndexOf('-');
  const afterLastHyphen = beforeHash.substring(lastHyphen + 1);
  const beforeLastHyphen = beforeHash.substring(0, lastHyphen);

  let platform: string;
  let appName: string;

  if (/^\d+$/.test(afterLastHyphen) && beforeLastHyphen.endsWith('-anon')) {
    // Anonymous: "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
    const anonIdx = beforeLastHyphen.lastIndexOf('-anon');
    platform = beforeLastHyphen.substring(0, anonIdx);
    appName = beforeLastHyphen.substring(anonIdx + 1) + '-' + afterLastHyphen;
  } else {
    // Normal: last hyphen separates platform from appName
    platform = beforeLastHyphen;
    appName = afterLastHyphen;
  }

  if (!platform || !appName) return null;

  return {
    platform,
    appName,
    ownerName,
    nodeId,
    full: id,
    isAnonymous: ownerName === 'anonymous',
  };
}
