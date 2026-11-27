/**
 * @file src/config/operator-services.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The setting agents.operator_services (AIMEAT_OPERATOR_SERVICES): the outside services
 *   the operator switches on for every account of this node. One entry names the service, the agent
 *   name each person gets, the operator's agent that may ask for those agents, and the permissions
 *   the agents may hold. Off by default: an empty list.
 *
 *   THE STATIC RULE. operatorServiceProblem() is the check every write of the setting runs (the
 *   environment at start, the admin Config tab, aimeat_admin_config_set, REST). It answers the first
 *   problem with the field it is in, or null. What depends on the running node (the node's maximum
 *   agent scopes and the words the node knows) is checked again whenever the setting is read
 *   (services/operator-services/entries.ts), because the node's maximum can change after the write.
 *
 *   WHICH PERMISSIONS AN ENTRY MAY NAME: ordinary words only. Never `*`, never a domain wildcard
 *   (`memory:*`), and never a word outside every wildcard (utils/scope-coverage.ts) but the ONE in
 *   OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED: memory:read-as-owner, the private read, which the
 *   developer allowed on 2026-11-26 with `private_read_reason` required and every person told why. That
 *   rule is ownTickWordProblem(), so a later ruling on it changes one function. Never a word in
 *   NEVER_IN_OPERATOR_SERVICE (a word whose holder creates, approves or changes another principal), and
 *   never a word the node does not know.
 *
 *   WHO AND HOW FIRMLY (phase 2). `audience` names the accounts the service covers ("all" by default);
 *   `required` makes the person unable to turn it off or limit its agent; `how_to_help` tells a person
 *   what to give the service. All three are read at request time from the present setting.
 *
 *   WRITING AS THE PERSON. memory:write-as-owner for every account with nobody approving is the largest
 *   power an entry can hold, so an entry that names it must name `write_prefixes`: 1 to 8 key prefixes,
 *   each at least 4 characters and ending in "." or "/", none a pattern and none overlapping a reserved
 *   or system namespace. The service's agent then writes as the person only under those prefixes
 *   (services/operator-services/write-fence.ts).
 *
 *   WHOSE CREDENTIAL. `credential_agent` is an agent NAME, and the node accepts it under ANY operator
 *   account of the node: the request is approved when its caller is an agent of that name whose account
 *   holds the operator role and which holds operator:service-provision. That is accepted because every
 *   operator can change this setting itself, so binding the entry to one operator account would protect
 *   nothing an operator could not undo; what it requires is the operator's own tick on that agent.
 * @structure OperatorServiceEntry · OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED · PRIVATE_READ_WORD ·
 *   RESERVED_AGENT_NAMES · RESERVED_AGENT_PREFIXES · reservedAgentName ·
 *   MAX_OPERATOR_SERVICES · ownTickWordProblem · NEVER_IN_OPERATOR_SERVICE ·
 *   operatorServiceProblem · isOperatorServiceList · parseOperatorServicesEnv
 * @usage
 *   const problem = operatorServiceProblem(value);
 *   if (problem) return refuse(problem);
 * @version-history
 *   v1.5.0 — 2026-11-26 — RESERVED_AGENT_NAMES and RESERVED_AGENT_PREFIXES: a name the node manages in every
 *     account is refused as an entry's id and credential_agent (operator services review, S3).
 *   v1.4.0 — 2026-11-26 — Phase 2: `audience`, `required`, `private_read_reason` (required with
 *     memory:read-as-owner, the one outside-wildcard word an entry may name: OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED)
 *     and `how_to_help`.
 *   v1.3.0 — 2026-11-26 — `description` is required, 20 to 300 characters: the one place a person learns
 *     what the service does for them and why it is on.
 *   v1.2.0 — 2026-11-26 — A known word is a word of the scope vocabulary (utils/scope-vocabulary.ts),
 *     not of the MCP tool table, which left out memory:write-as-owner; seven more words in
 *     NEVER_IN_OPERATOR_SERVICE; `write_prefixes`, required with memory:write-as-owner.
 *   v1.1.0 — 2026-11-26 — NEVER_IN_OPERATOR_SERVICE and the known-word check (security review, D1a);
 *     the credential_agent paragraph.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { validateAgentName } from '../utils/gaii.js';
import { isOutsideWildcard } from '../utils/scope-coverage.js';
import { SCOPE_VOCABULARY } from '../utils/scope-vocabulary.js';
import {
  RESERVED_OWNER_KEY_PREFIXES, SERVER_WRITTEN_KEY_PREFIXES, SERVICE_OWNED_KEY_PREFIXES, SERVER_WRITTEN_KEYS, SERVICE_OWNED_KEYS,
} from '../utils/reserved-keys.js';
import { logger } from '../utils/logger.js';

/** One outside service the operator switched on for every account. */
export interface OperatorServiceEntry {
  /** The agent name each person gets: `<id>#<person>@<node>`. */
  id: string;
  /** The service's name as a person reads it. */
  display_name: string;
  /**
   * What the service does for a person and why it is on, in the operator's own words (20 to 300
   * characters). Required: each person reads it in the notice, on the agent's mark and card, as the one
   * explanation of an agent they did not approve.
   */
  description: string;
  /** The operator's agent that may ask for these agents: `<credential_agent>#<operator>@<node>`. */
  credential_agent: string;
  /** The permissions each person's agent may hold. */
  scopes: string[];
  /**
   * The key prefixes the service's agent may write under as the person (`memory:write-as-owner`), and
   * nothing else (services/operator-services/write-fence.ts). Required when `scopes` names that word.
   */
  write_prefixes?: string[];
  /** Who the service covers: every active person (`"all"`, the default) or the named accounts only. */
  audience?: 'all' | { accounts: string[] };
  /** True: the person cannot turn the service off or limit its agent (services/operator-services/required.ts). */
  required?: boolean;
  /** Why the service reads every covered person's private records (20 to 300 characters); required with memory:read-as-owner. */
  private_read_reason?: string;
  /** What a person can tell or give the service so it works better for them (20 to 300 characters). */
  how_to_help?: string;
  /** False keeps the entry in the list and switches the service off for everyone. */
  enabled: boolean;
}

/**
 * The one word from outside every wildcard an entry may name: reading every covered person's private
 * records. The developer ruled on 2026-11-26 (private-read ruling B) that an operator may give a
 * service this right with no approval by the person, because some environments must be able to check
 * everything that is stored (a legal duty, misuse, threat analysis), and that it is done in the open:
 * the entry carries `private_read_reason`, and each person is told that this service reads their
 * private records too, and why. Every other such word stays refused.
 */
export const OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED: readonly string[] = ['memory:read-as-owner'];
/** The private read. */
export const PRIVATE_READ_WORD = 'memory:read-as-owner';

/**
 * Agent names the node itself makes or treats specially in every account, refused as an entry's `id`
 * and as its `credential_agent` (S3): an entry under one of them would turn an agent the node manages,
 * and the key the node mints or rotates for it, into a service's. One list, a reason per name. Held to
 * its sources by test/unit/operator-services-reserved.test.ts.
 */
export const RESERVED_AGENT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  app: 'the agent the node makes for a person\'s apps and rekeys at each identity verification (routes/ghii/web-verify.ts, routes/setup.ts)',
  chat: 'the agent of the node\'s own chat, whose token the node mints itself (services/chat/agent.ts CHAT_AGENT_NAME)',
  shared: 'the shared anonymous agent (services/anonymous-principal-records.ts)',
  concierge: 'a basic agent the node offers every account (data/basic-agents.ts)',
  'workflow-manager': 'a basic agent the node offers every account (data/basic-agents.ts)',
  'workflow-inspector': 'the workflow engine\'s own reader (services/workflow/engine-inspector.ts)',
});

/** Name prefixes the node gives agents it makes (an access token's sandboxed agent: routes/access-tokens.ts). */
export const RESERVED_AGENT_PREFIXES: Readonly<Record<string, string>> = Object.freeze({
  'apptester-': 'the sandboxed agent of a scoped access token (routes/access-tokens.ts)',
});

/** Why `name` is reserved, or null when it is free for an entry. */
export function reservedAgentName(name: string): string | null {  if (Object.prototype.hasOwnProperty.call(RESERVED_AGENT_NAMES, name)) return RESERVED_AGENT_NAMES[name];
  const prefix = Object.keys(RESERVED_AGENT_PREFIXES).find((p) => name.startsWith(p));
  return prefix ? RESERVED_AGENT_PREFIXES[prefix] : null;
}
const TEXT_MIN = 20;
const TEXT_MAX = 300;
const AUDIENCE_MAX = 500;
/** An account name in the account-name form: lower case letters, digits, hyphens inside, 3 to 64. */
const ACCOUNT = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** The first problem of the phase-2 fields (audience, required, private_read_reason, how_to_help), or null. */
function policyProblem(o: Record<string, unknown>, at: string): string | null {
  if (o.audience !== undefined && o.audience !== 'all') {
    const a = o.audience as { accounts?: unknown } | null;
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some((k) => k !== 'accounts')) {
      return `${at}.audience is "all" or { "accounts": [ ... ] }.`;
    }
    if (!Array.isArray(a.accounts) || a.accounts.length === 0 || a.accounts.length > AUDIENCE_MAX) {
      return `${at}.audience.accounts is a list of 1 to ${AUDIENCE_MAX} account names of this node.`;
    }
    for (let j = 0; j < a.accounts.length; j++) {
      const n = a.accounts[j];
      if (typeof n !== 'string' || !ACCOUNT.test(n)) {
        return `${at}.audience.accounts[${j}]: ${JSON.stringify(n)} is no account name of this node (lower case letters, digits and hyphens, 3 to 64; never a name of another node).`;
      }
    }
  }
  if (o.required !== undefined && typeof o.required !== 'boolean') return `${at}.required is true or false.`;
  const scopes = Array.isArray(o.scopes) ? o.scopes : [];
  const reads = scopes.includes(PRIVATE_READ_WORD);
  const text = (v: unknown) => typeof v === 'string' && v.trim().length >= TEXT_MIN && v.length <= TEXT_MAX;
  if (reads && o.private_read_reason === undefined) {
    return `${at}.private_read_reason is required with ${PRIVATE_READ_WORD}: ${TEXT_MIN} to ${TEXT_MAX} characters saying why this service reads every covered person's private records. Each person is told it.`;
  }
  if (o.private_read_reason !== undefined) {
    if (!reads) return `${at}.private_read_reason belongs only to an entry whose scopes name ${PRIVATE_READ_WORD}.`;
    if (!text(o.private_read_reason)) return `${at}.private_read_reason is text of ${TEXT_MIN} to ${TEXT_MAX} characters.`;
  }
  if (o.how_to_help !== undefined && !text(o.how_to_help)) return `${at}.how_to_help is text of ${TEXT_MIN} to ${TEXT_MAX} characters.`;
  return null;
}

/** At most this many entries. */
export const MAX_OPERATOR_SERVICES = 8;

/** The word whose writes the entry fences by key prefix. */
export const WRITE_AS_OWNER_WORD = 'memory:write-as-owner';
const PREFIXES_MAX = 8;
const PREFIX_MIN = 4;
const PREFIX_MAX = 128;
/** The namespaces the node itself writes or trusts, besides the reserved-key lists (utils/reserved-keys.ts). */
const SYSTEM_NAMESPACES = ['operator-service.', 'operator-services.', 'security.', 'system.', 'service.', 'eco:', 'ext:', 'organism.', 'settings.'];

/** The reserved and system namespaces a write prefix may neither cover nor fall inside. */
function systemNamespaces(): string[] {
  return [...RESERVED_OWNER_KEY_PREFIXES, ...SERVER_WRITTEN_KEY_PREFIXES, ...SERVICE_OWNED_KEY_PREFIXES,
    ...SERVER_WRITTEN_KEYS, ...SERVICE_OWNED_KEYS, ...SYSTEM_NAMESPACES];
}

/** The first problem of an entry's `write_prefixes`, or null. */
function prefixesProblem(o: Record<string, unknown>, at: string): string | null {
  const scopes = Array.isArray(o.scopes) ? o.scopes : [];
  const asOwner = scopes.includes(WRITE_AS_OWNER_WORD);
  if (o.write_prefixes === undefined) {
    return asOwner
      ? `${at}.write_prefixes is required with ${WRITE_AS_OWNER_WORD}: name the 1 to ${PREFIXES_MAX} key prefixes the service may write under in each person's memory, so a leaked credential cannot overwrite every record of every person.`
      : null;
  }
  if (!Array.isArray(o.write_prefixes) || o.write_prefixes.length === 0 || o.write_prefixes.length > PREFIXES_MAX) {
    return `${at}.write_prefixes is a list of 1 to ${PREFIXES_MAX} key prefixes.`;
  }
  const system = systemNamespaces();
  for (let j = 0; j < o.write_prefixes.length; j++) {
    const p = o.write_prefixes[j];
    const field = `${at}.write_prefixes[${j}]`;
    if (typeof p !== 'string' || p.length < PREFIX_MIN || p.length > PREFIX_MAX) return `${field} is a key prefix of ${PREFIX_MIN} to ${PREFIX_MAX} characters.`;
    if (!p.endsWith('.') && !p.endsWith('/')) return `${field}: "${p}" must end with "." or "/", so it names a whole area and not part of a word.`;
    if (/[*?\s]/.test(p)) return `${field}: "${p}" is a pattern; name the prefix itself, never a wildcard.`;
    const clash = system.find((s) => s.startsWith(p) || p.startsWith(s));
    if (clash) return `${field}: "${p}" overlaps "${clash}", which the node itself writes or trusts.`;
  }
  return null;
}

const DISPLAY_NAME_MAX = 80;
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 300;
const SCOPES_MAX = 64;
/** A permission word as the node writes one: `domain:action`, lower case, hyphens inside. */
const WORD = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * The rule on words outside every wildcard, in its one place: an entry may not name one. Answers the
 * refusal, or null when the word may stand in an entry.
 */
export function ownTickWordProblem(word: string, field: string): string | null {
  return isOutsideWildcard(word) && !OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED.includes(word)
    ? `${field}: "${word}" is a permission each person gives on their own agent's page, so an operator service cannot hold it for everyone.`
    : null;
}

/**
 * Words an operator service's agent never holds: each lets its holder create, approve or change an
 * agent, an app grant, a personal access token, a receiver, an ecosystem app, a consent, a share or
 * another principal's permissions. With one of them the service's agent could make a sibling agent of
 * the person that no ledger line names, which the person's off switch, the sweep and the setting would
 * then never remove. Read from what each word gates (src/tool-catalog/definitions, the routes'
 * requireScope); several are also outside every wildcard and refused by ownTickWordProblem as well.
 */
export const NEVER_IN_OPERATOR_SERVICE: Readonly<Record<string, string>> = {
  'agent:write': 'approves a sibling agent on POST /v1/agents/device-authorize and changes another agent\'s mode, run state and description',
  'agent:delete': 'removes another agent of the person (DELETE /v1/agents/:name, aimeat_agent_delete)',
  'agent:permissions': 'rewrites or narrows another agent\'s permissions (PATCH /v1/agents/:name/scopes, aimeat_agent_scope_narrow)',
  'agent:permissions-add': 'adds permissions to another agent of the person',
  'consent:manage': 'grants and revokes consents, which decide which principal reads the person\'s data (aimeat_consent_grant)',
  'consent:groups': 'creates sharing groups and decides who is in them',
  'share:manage': 'hands another account a standing right to read part of the person\'s memory (aimeat_share_create)',
  'receivers:read': 'proposes a receiver key through which an outside program writes into the person\'s data (aimeat_receiver)',
  'receivers:manage': 'makes and rotates receiver keys',
  'organism:invite': 'attaches agents to organisms and grants workspace roles to other principals (aimeat_organism_agent_attach, aimeat_workspace_member_grant)',
  'mcp:manage': 'grants and revokes access to attached MCP servers (aimeat_mcp_grant_set)',
  'party:manage': 'makes outside parties and gives them keys',
  'account:security': 'makes personal access tokens and revokes ecosystem apps (requireOwnerPrincipal)',
  'packages:write': 'installs a package, which registers its app, cortex, extension and scheduled work under the person',
  'secrets:manage': 'sets the credentials the person\'s extensions call out with',
  'secrets:share': 'hands secrets to other principals',
  'connections:write': 'starts and attaches connected accounts (an outside credential) and delegates them to other principals (POST /v1/connections/start, /attach, /:id/delegations)',
  'exchange:grant': 'makes and revokes exchange grants to other parties (POST /v1/exchange/grants)',
  'exchange:beneficiary': 'sets who is paid and releases payouts (aimeat_commerce_beneficiary_split_set, _payout)',
  'app:manage': 'gives other accounts developer grants on the person\'s apps and changes an app\'s scope allowance (PUT /v1/apps/:owner/:filename/dev-grants/:account)',
  'ext:write': 'activates extensions and lets an extension read the person\'s data unattended (aimeat_extension_unattended_reader)',
  'csm:write': 'decides which principals read each of the person\'s data descriptions',
  'tunnel:connect': 'anchors a personal node to the person\'s account (POST /v1/personal/anchor)',
};

/** The words this node knows: its scope vocabulary (utils/scope-vocabulary.ts, the agent page's list). */
function knownWords(): ReadonlySet<string> {
  return new Set(SCOPE_VOCABULARY);
}

function scopeProblem(word: unknown, field: string, known: ReadonlySet<string>): string | null {
  if (typeof word !== 'string') return `${field} must be a permission word.`;
  if (word === '*' || word.endsWith(':*')) return `${field}: "${word}" is a wildcard; name each permission instead.`;
  if (!WORD.test(word)) return `${field}: "${word}" is not a permission word (domain:action).`;
  const never = NEVER_IN_OPERATOR_SERVICE[word];
  if (never) return `${field}: "${word}" ${never}, so an operator service's agent never holds it.`;
  const ownTick = ownTickWordProblem(word, field);
  if (ownTick) return ownTick;
  if (!known.has(word)) return `${field}: "${word}" is no permission this node knows.`;
  return null;
}

function entryProblem(e: unknown, i: number, known: ReadonlySet<string>): string | null {
  const at = `agents.operator_services[${i}]`;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return `${at} must be an object.`;
  const o = e as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!['id', 'display_name', 'description', 'credential_agent', 'scopes', 'write_prefixes', 'audience', 'required',
      'private_read_reason', 'how_to_help', 'enabled'].includes(k)) return `${at}.${k} is not a field of an entry.`;
  }
  if (typeof o.id !== 'string') return `${at}.id is required: the agent name each person gets.`;
  const idProblem = validateAgentName(o.id);
  if (idProblem) return `${at}.id: ${idProblem}.`;
  const idReserved = reservedAgentName(o.id);
  if (idReserved) return `${at}.id: "${o.id}" is a name this node manages in every account (${idReserved}), so no service may take it.`;
  if (typeof o.display_name !== 'string' || !o.display_name.trim() || o.display_name.length > DISPLAY_NAME_MAX) {
    return `${at}.display_name is required, at most ${DISPLAY_NAME_MAX} characters.`;
  }
  // The one place a person learns what the service does for them and why it is on: required.
  if (typeof o.description !== 'string' || o.description.trim().length < DESCRIPTION_MIN || o.description.length > DESCRIPTION_MAX) {
    return `${at}.description is required: ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters in your own words saying what the service does for a person and why it is on. Each person reads it in the notice and on the agent, as the only explanation of the agent they did not approve.`;
  }
  if (typeof o.credential_agent !== 'string') return `${at}.credential_agent is required: the name of the operator's agent that asks for the agents.`;
  const credProblem = validateAgentName(o.credential_agent);
  if (credProblem) return `${at}.credential_agent: ${credProblem}.`;
  const credReserved = reservedAgentName(o.credential_agent);
  if (credReserved) return `${at}.credential_agent: "${o.credential_agent}" is a name this node manages in every account (${credReserved}), so it is no service's credential.`;
  if (!Array.isArray(o.scopes) || o.scopes.length === 0 || o.scopes.length > SCOPES_MAX) {
    return `${at}.scopes is required: a list of 1 to ${SCOPES_MAX} permission words.`;
  }
  for (let j = 0; j < o.scopes.length; j++) {
    const p = scopeProblem(o.scopes[j], `${at}.scopes[${j}]`, known);
    if (p) return p;
  }
  const policy = policyProblem(o, at);
  if (policy) return policy;
  const prefixes = prefixesProblem(o, at);
  if (prefixes) return prefixes;
  if (typeof o.enabled !== 'boolean') return `${at}.enabled is required: true or false.`;
  return null;
}

/** The first problem of a value of agents.operator_services, naming its field; null when it may be saved. */
export function operatorServiceProblem(v: unknown): string | null {
  if (!Array.isArray(v)) return 'agents.operator_services must be a JSON list of entries.';
  if (v.length > MAX_OPERATOR_SERVICES) return `agents.operator_services holds at most ${MAX_OPERATOR_SERVICES} entries.`;
  const ids = new Set<string>();
  const known = knownWords();
  for (let i = 0; i < v.length; i++) {
    const p = entryProblem(v[i], i, known);
    if (p) return p;
    const id = (v[i] as OperatorServiceEntry).id;
    if (ids.has(id)) return `agents.operator_services[${i}].id: "${id}" is already the id of another entry.`;
    ids.add(id);
  }
  return null;
}

/** The setting row's check (services/config/schema-access.ts). */
export function isOperatorServiceList(v: unknown): v is OperatorServiceEntry[] {
  return operatorServiceProblem(v) === null;
}

/**
 * AIMEAT_OPERATOR_SERVICES at start: a JSON list. A value the check refuses is logged with its
 * problem and read as no services, so a typo never takes a node down and never switches anything on.
 */
export function parseOperatorServicesEnv(raw: string | undefined): OperatorServiceEntry[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logger.warn('AIMEAT_OPERATOR_SERVICES is not valid JSON; no operator service is switched on', { error: String(err) });
    return [];
  }
  const problem = operatorServiceProblem(parsed);
  if (problem) {
    logger.warn(`AIMEAT_OPERATOR_SERVICES is refused, so no operator service is switched on: ${problem}`);
    return [];
  }
  return parsed as OperatorServiceEntry[];
}
