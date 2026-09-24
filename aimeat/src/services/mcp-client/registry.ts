/**
 * @file registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see and use a remote MCP server, and what attaching one does.
 *
 *   TWO SENTENCES, ONE PLACE. "List the servers this caller may use" and "this server is one the
 *   caller may use" are the whole authorization model of this subsystem. Writing them inline in the
 *   REST route and then again in the MCP tools is the drift the August 2026 audit measured 315
 *   instances of, including agents deleting another owner's extension. Both doors call these.
 *
 *   ABSENT AND NOT-YOURS ANSWER ALIKE. `requireUsableServer` returns null for both, deliberately:
 *   naming another owner's server id must not confirm that it exists.
 *
 *   USING IS NOT MANAGING. `requireManageableServer` is the third sentence, and every door that
 *   changes or removes a server asks it instead: a node-wide server is offered to many owners and
 *   belongs to none of them.
 *
 *   ATTACHING PROBES BEFORE IT SAVES. A server that cannot be reached, or that refuses the
 *   credential, is reported at the moment the owner is still looking at the form — not later, as a
 *   tool that mysteriously never answers. The probe also fills the tool cache, so the first real
 *   call does not pay for a list.
 *
 *   THE SLUG IS THE NAME AND IT NEVER CHANGES. It is what a caller says instead of a URL and what
 *   prefixes a flattened tool, so renaming it would silently break every grant naming it. Attach
 *   validates it; nothing updates it.
 * @structure attachMcpServer · listUsableServers · requireUsableServer · requireManageableServer ·
 *   detachMcpServer
 * @usage const server = await requireUsableServer(storage, ownerGhii, idOrSlug);
 * @version-history
 *   v1.4.0 — 2026-09-24 — An attach whose first look finds a tool list larger than this node keeps
 *     is refused as TOOL_LIST_TOO_LARGE rather than UNREACHABLE, because the server did answer.
 *   v1.3.0 — 2026-09-24 — requireManageableServer: the write doors resolve a server through it, so a
 *     node-wide server the operator offers is no longer changed or removed by the owners it admits.
 *   v1.2.0 — 2026-09-17 — All three attach doors refuse this AIMEAT's own address (SELF_ADDRESS),
 *     and a first look that comes back here by another spelling (LOOP_DETECTED) removes the row it
 *     just made, because an address cannot be edited and that row could never answer.
 *   v1.1.0 — 2026-09-16 — attachNodeServer and setNodeServerPolicy read the price themselves and
 *     refuse a morsel price with BAD_PRICE, before anything is written. The check was at each door
 *     first, and check:field-reach then paired the operator's policy tool with the ATTACH route
 *     through that shared validator; in the service, the doors share only the real job.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy. Owner-owned servers only; node-wide is phase 4
 *     and organism-bound is phase 5, and both refuse by name until then rather than half-working.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  MCP_SLUG_RE, toPublicMcpServer, normalizeMcpPrice,
  type McpServerRecord, type McpServerCredential, type McpTransport,
  type McpCallerIdentity, type McpExposure, type PublicMcpServer,
  type McpAvailability,
} from '../../models/mcp-server-schemas.js';
import { sealMcpCredential, requireEncryptionKey } from './credential.js';
import { listRemoteTools, type RemoteCallRefusal } from './invoke.js';
import { selfAddressRefusal } from './hops.js';
import { mcpClientPool } from './pool.js';
import { recordAccountEvent } from '../account-events.js';
import { organismOwners } from '../organism-ownership.js';
import { listWorkspaceMemberRoles } from '../workspace-roles.js';
import { emitChange } from '../event-bus.js';

export interface AttachInput {
  storage: Storage;
  config: AimeatConfig;
  /** The owner this server belongs to. Always a GHII, from resolveIdentity(). */
  ownerGhii: string;
  /** The exact principal that attached it, for provenance. */
  createdBy: string;
  slug: string;
  title: string;
  description?: string;
  transport: McpTransport;
  /** Omitted means the server needs no credential. */
  credential?: McpServerCredential;
  callerIdentity?: McpCallerIdentity;
  exposure?: McpExposure;
  /**
   * Attach it now and sign in afterwards, for a server that uses OAuth.
   *
   * The row is created parked in `needs_reauth` and the probe is SKIPPED, because a server
   * that needs a token will refuse an anonymous tools/list and the owner would be told their
   * address was wrong when it was right. The round hangs the credential on this row.
   */
  deferCredential?: boolean;
}

export type AttachResult =
  | { ok: true; server: PublicMcpServer; tools: string[] }
  | { ok: false; code: AttachRefusal; message: string };

export type AttachRefusal =
  | 'BAD_SLUG'
  | 'SLUG_TAKEN'
  | 'NO_ENCRYPTION_KEY'
  /** Attaching to a group is governance: only its owners and admins may. */
  | 'NOT_ALLOWED'
  /** The record names a peer AIMEAT node this one has no routable peering with. */
  | 'NO_SUCH_PEER'
  /** A price that is not money, most often a morsel price. Morsels are a pacer and buy nothing. */
  | 'BAD_PRICE'
  /**
   * The far side answered, and wants a token or a sign-in this node does not have. The address is
   * RIGHT, which is the whole reason this is not UNREACHABLE.
   */
  | 'UPSTREAM_UNAUTHORIZED'
  /** A local process this node does not run, or a command nobody allowlisted. */
  | 'STDIO_DISABLED'
  | 'STDIO_NOT_ALLOWED'
  /** The address is this AIMEAT's own MCP endpoint, or the peer named is this node. */
  | 'SELF_ADDRESS'
  /** The first look at the server came back to this AIMEAT by another spelling of its address. */
  | 'LOOP_DETECTED'
  /** The server answered with a tool list larger than this node keeps; it is parked, not attached. */
  | 'TOOL_LIST_TOO_LARGE'
  | 'UNREACHABLE';

/**
 * What attaching tells a person when the first look at the server failed.
 *
 * ONE MAPPING FOR ALL THREE ATTACH DOORS. There were three copies until 2026-09-16, and the owner's
 * turned every failure but a peer into UNREACHABLE while the node's and the group's turned EVERY
 * failure into it. So a server that answered "authentication required" was reported as not
 * answering, although the address was right and only a token was missing. Found by attaching a
 * sandbox node to itself.
 *
 * The row itself is parked by listRemoteTools either way, with a status the panel renders as the fix.
 */
async function refusalFromProbe(
  storage: Storage, rowId: string, code: RemoteCallRefusal, message: string,
): Promise<{ ok: false; code: AttachRefusal; message: string }> {
  switch (code) {
    case 'LOOP_DETECTED':
      // The one failure where the row is NOT kept. Every other one is something a person fixes on
      // the row (a token, a sign-in); this address leads back to this AIMEAT, the address cannot be
      // edited, and a row that can never answer would only sit in the list. The attach-time address
      // check catches the obvious spelling; this catches every other spelling of the same place.
      await storage.deleteMcpServer(rowId);
      return { ok: false, code: 'LOOP_DETECTED', message };
    case 'PEER_UNKNOWN':
    case 'PEER_NOT_ROUTABLE':
      // A mistyped peer id is a name to correct here, not somebody else's node being down.
      return { ok: false, code: 'NO_SUCH_PEER', message };
    case 'UPSTREAM_UNAUTHORIZED':
    case 'CREDENTIAL_UNREADABLE':
      return { ok: false, code: 'UPSTREAM_UNAUTHORIZED', message };
    // TOOL_LIST_TOO_LARGE is its own answer: the server did answer, with more than this node keeps.
    case 'NO_ENCRYPTION_KEY':
    case 'STDIO_DISABLED':
    case 'STDIO_NOT_ALLOWED':
    case 'TOOL_LIST_TOO_LARGE':
      return { ok: false, code, message };
    default:
      return { ok: false, code: 'UNREACHABLE', message };
  }
}

/**
 * Attach a remote MCP server to an owner.
 *
 * The order matters and is the "refuse before you write" rule: validate, then check the name is
 * free, then require the key, THEN write. A row inserted before the probe would leave a broken
 * server attached whenever the probe failed, and the owner would have to delete something they
 * never successfully created.
 */
export async function attachMcpServer(input: AttachInput): Promise<AttachResult> {
  const { storage, config, ownerGhii, slug } = input;

  // This AIMEAT attached to itself: refused while the form is still open (see selfAddressRefusal).
  const self = selfAddressRefusal(config, input.transport);
  if (self) return self;

  if (!MCP_SLUG_RE.test(slug)) {
    return {
      ok: false,
      code: 'BAD_SLUG',
      message: 'A server name is 2 to 32 characters of lowercase letters, digits and dashes, '
        + 'starting and ending with a letter or digit. It is what you will say instead of a URL.',
    };
  }

  const clash = await storage.findMcpServerBySlug(slug, 'owner', ownerGhii);
  if (clash) {
    return {
      ok: false,
      code: 'SLUG_TAKEN',
      message: `You already have a server called "${slug}".`,
    };
  }

  let sealed: string | null = null;
  if (input.credential) {
    const key = requireEncryptionKey(config);
    if (!key) {
      // No degraded mode. Storing a token in the clear because a key was missing is worse than
      // not storing it at all.
      return {
        ok: false,
        code: 'NO_ENCRYPTION_KEY',
        message: 'This node has no encryption key configured, so it cannot hold a credential for '
          + 'this server. Set AIMEAT_ENCRYPTION_KEY.',
      };
    }
    sealed = sealMcpCredential(input.credential, key);
  }

  const now = new Date().toISOString();
  const row: McpServerRecord = {
    id: randomUUID(),
    slug,
    title: input.title || slug,
    description: input.description ?? '',
    ownership: 'owner',
    ownerGhii,
    organismId: null,
    ws: null,
    createdBy: input.createdBy,
    transport: input.transport,
    auth: input.credential ? (input.credential.shape === 'oauth2' ? 'oauth' : 'static') : 'none',
    credential: sealed,
    credentialShape: input.credential?.shape ?? null,
    expiresAt: null,
    providerClientId: null,
    callerIdentity: input.callerIdentity ?? 'node-credential',
    exposure: input.exposure ?? 'gateway',
    toolCache: [],
    toolCacheHash: '',
    lastListedAt: null,
    // An owner's own server: none of the node-wide questions apply to it. A person does not
    // allowlist themselves and does not bill themselves.
    availability: null,
    allowlist: [],
    price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true,
    // A deferred credential is not a healthy server yet: it is one waiting for a person to
    // sign in, which is exactly what needs_reauth means everywhere else here, and the panel
    // already renders that as a button rather than an error.
    status: input.deferCredential ? 'needs_reauth' : 'active',
    lastOkAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await storage.createMcpServer(row);

  // A server awaiting sign-in cannot answer a tool list yet, and probing it would report the
  // address as wrong when it is right. The round fills the cache when it completes.
  if (input.deferCredential) {
    emitChange('mcp-servers', ownerGhii);
    return { ok: true, server: toPublicMcpServer(row), tools: [] };
  }

  // Probe. A server that does not answer is reported while the owner is still looking at the form.
  const probed = await listRemoteTools(storage, config, row);
  if (!probed.ok) {
    // The row stays, parked, rather than being rolled back: an owner who mistyped a token wants to
    // fix the token, not retype the whole attachment. listRemoteTools has already set the status
    // and the reason, so the panel can render the fix.
    //
    return refusalFromProbe(storage, row.id, probed.code, probed.message);
  }

  // Attaching a server is news. A CALL through it is not, and there is deliberately no event for
  // one: a tool can be invoked hundreds of times an hour and a row each would fill the owner's
  // window in minutes, while the per-call record already exists in UsageCall. Same ruling as
  // app_tool_first_use. recordAccountEvent handles its own failures and never throws, so there is
  // nothing to catch here.
  await recordAccountEvent(storage, {
    ownerGhii,
    kind: 'mcp_server_connected',
    actorGaii: input.createdBy,
    subject: slug,
    data: { tools: String(probed.tools.length) },
  }, config);

  // The settings panel is a live surface: this is what makes a newly attached server appear
  // without a reload. Emitted HERE rather than in each door, so the REST route and the MCP tool
  // cannot announce differently — which is the same reason the access checks live in this file.
  emitChange('mcp-servers', ownerGhii);

  const stored = await storage.getMcpServer(row.id);
  return {
    ok: true,
    server: toPublicMcpServer(stored ?? row),
    tools: probed.tools.map((t) => t.name),
  };
}

/**
 * The servers this caller may use.
 *
 * Scoped by the query, so there is nothing to filter afterwards. A lookup that can return someone
 * else's row and is then filtered is a lookup that leaks the day somebody forgets the filter.
 */
export async function listUsableServers(
  storage: Storage, ownerGhii: string, config?: AimeatConfig,
): Promise<PublicMcpServer[]> {
  const mine = await storage.listMcpServers({ ownership: 'owner', ownerGhii });
  // Plus whatever the operator offers this owner. Shown in the same list on purpose: from where the
  // person stands these are all "servers I can use", and making them find a second screen to
  // discover the house's offerings would waste the registry.
  const offered = (await storage.listMcpServers({ ownership: 'node', enabled: true }))
    .filter((s) => nodeWideAdmits(s, ownerGhii));

  // And whatever the groups this person belongs to have attached. Asked one at a time because
  // membership is a per-organism question; the list is short, because an organism attaches a
  // server for a reason rather than by the dozen.
  const group: McpServerRecord[] = [];
  if (config) {
    for (const s of await storage.listMcpServers({ ownership: 'organism', enabled: true })) {
      if (await organismAdmits(storage, config, s, ownerGhii, false)) group.push(s);
    }
  }
  return [...mine, ...offered, ...group].map(toPublicMcpServer);
}

/**
 * May this owner reach this node-wide server?
 *
 * `all-owners` means everyone with an account here. `allowlist` means the named ones, and an EMPTY
 * allowlist means NOBODY — which is the safe reading rather than a loophole: an operator who has
 * switched to allowlist and not yet named anybody has closed the door, not opened it.
 */
export function nodeWideAdmits(server: McpServerRecord, ownerGhii: string): boolean {
  if (server.ownership !== 'node') return false;
  if (server.availability === 'all-owners') return true;
  if (server.availability === 'allowlist') return server.allowlist.includes(ownerGhii);
  // No availability set at all: attached but not yet offered to anybody. The operator has to say.
  return false;
}

/**
 * Attach a server to the NODE rather than to a person.
 *
 * Separate from attachMcpServer() rather than a flag on it, because almost nothing is shared: there
 * is no owner to scope the name against, the availability and the price have no meaning on a
 * personal server, and the caller has already been proven to be the operator by the door. What IS
 * shared — the slug rule, the sealing, the probe — is called from here so neither can drift.
 */
export async function attachNodeServer(input: Omit<AttachInput, 'ownerGhii'> & {
  availability?: McpAvailability;
  allowlist?: string[];
  /**
   * The price AS THE CALLER SENT IT. Read here through normalizeMcpPrice rather than at each door,
   * so no door can store a morsel price by forgetting the check, and so the doors share the real
   * job (attaching) instead of a validator that says nothing about which job they do.
   */
  price?: unknown;
}): Promise<AttachResult> {
  const { storage, config, slug } = input;

  // First, before anything is probed or stored: a server priced in morsels must not leave a
  // half-made row behind the refusal.
  const priced = normalizeMcpPrice(input.price);
  if (!priced.ok) return { ok: false, code: 'BAD_PRICE', message: priced.message };

  // This AIMEAT attached to itself: refused while the form is still open (see selfAddressRefusal).
  const self = selfAddressRefusal(config, input.transport);
  if (self) return self;

  if (!MCP_SLUG_RE.test(slug)) {
    return {
      ok: false,
      code: 'BAD_SLUG',
      message: 'A server name is 2 to 32 characters of lowercase letters, digits and dashes, '
        + 'starting and ending with a letter or digit.',
    };
  }
  const clash = await storage.findMcpServerBySlug(slug, 'node');
  if (clash) {
    return { ok: false, code: 'SLUG_TAKEN', message: `This node already offers "${slug}".` };
  }

  let sealed: string | null = null;
  if (input.credential) {
    const key = requireEncryptionKey(config);
    if (!key) {
      return {
        ok: false,
        code: 'NO_ENCRYPTION_KEY',
        message: 'This node has no encryption key configured, so it cannot hold a credential for '
          + 'this server. Set AIMEAT_ENCRYPTION_KEY.',
      };
    }
    sealed = sealMcpCredential(input.credential, key);
  }

  const now = new Date().toISOString();
  const row: McpServerRecord = {
    id: randomUUID(),
    slug,
    title: input.title || slug,
    description: input.description ?? '',
    ownership: 'node',
    // Null, and it is load-bearing: an operator's server belongs to nobody, which is what keeps it
    // out of any one account's billing and out of its deletion cascade.
    ownerGhii: null,
    organismId: null,
    ws: null,
    createdBy: input.createdBy,
    transport: input.transport,
    auth: input.credential ? (input.credential.shape === 'oauth2' ? 'oauth' : 'static') : 'none',
    credential: sealed,
    credentialShape: input.credential?.shape ?? null,
    expiresAt: null,
    providerClientId: null,
    callerIdentity: input.callerIdentity ?? 'node-credential',
    exposure: input.exposure ?? 'gateway',
    toolCache: [],
    toolCacheHash: '',
    lastListedAt: null,
    // Attached is not offered. Until the operator says who may use it, nobody may — a registry that
    // defaulted to everyone would hand the whole node an integration on the strength of a typo.
    availability: input.availability ?? null,
    allowlist: input.allowlist ?? [],
    price: priced.price,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true,
    status: input.deferCredential ? 'needs_reauth' : 'active',
    lastOkAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await storage.createMcpServer(row);
  if (input.deferCredential) {
    return { ok: true, server: toPublicMcpServer(row), tools: [] };
  }

  const probed = await listRemoteTools(storage, config, row);
  if (!probed.ok) return refusalFromProbe(storage, row.id, probed.code, probed.message);

  const stored = await storage.getMcpServer(row.id);
  return {
    ok: true,
    server: toPublicMcpServer(stored ?? row),
    tools: probed.tools.map((t) => t.name),
  };
}

/** What an operator may change about one of the node's own servers. */
export interface NodePolicy {
  availability?: McpAvailability;
  allowlist?: string[];
  /**
   * The price AS THE CALLER SENT IT, read here through normalizeMcpPrice. Present means "set it";
   * absent means "leave it as it is". null and a price of zero both mean free.
   */
  price?: unknown;
  enabled?: boolean;
  exposure?: McpExposure;
}

/**
 * Set who may use one of the node's servers, what it costs, and whether it is on.
 *
 * ONE IMPLEMENTATION, TWO DOORS, the same rule updateMcpServerSettings() follows: the operator's
 * REST route and aimeat_mcp_registry_set both call this, so switching a server off cannot stop the
 * pool on one door and leave it answering on the other.
 *
 * The CALLER proves it is the operator. This function does not, deliberately: "the operator in
 * person" is a property of the request, and a service that tried to decide it from a principal
 * string would be a second answer to a question the middleware already answers properly.
 *
 * The PRICE is checked here and not at the doors, and before anything is written: a morsel price is
 * refused, because morsels are a pacer and buy nothing, and nothing else in the policy is applied
 * when it is.
 */
export async function setNodeServerPolicy(
  storage: Storage, server: McpServerRecord, policy: NodePolicy,
): Promise<{ ok: true; server: McpServerRecord } | { ok: false; code: 'BAD_PRICE'; message: string }> {
  const { price, ...rest } = policy;
  const priced = 'price' in policy ? normalizeMcpPrice(price) : null;
  if (priced && !priced.ok) return { ok: false, code: 'BAD_PRICE', message: priced.message };

  await storage.updateMcpServer(server.id, { ...rest, ...(priced ? { price: priced.price } : {}) });
  // Switching it off has to STOP it. Every owner on the node is holding a pooled client that would
  // otherwise keep answering until the idle sweeper noticed.
  if (policy.enabled === false) await mcpClientPool.invalidate(server.id);
  return { ok: true, server: (await storage.getMcpServer(server.id)) ?? server };
}

/**
 * May this owner reach a server bound to an organism?
 *
 * MEMBERSHIP DECIDES, which is the whole point of binding one to a group: the team's wiki is
 * reachable by the team, and nobody has to hand a token to each person who joins. Owners, admins
 * and members all count — the distinction between them governs the ORGANISM, and using a tool the
 * organism attached is not an act of governance.
 *
 * WHEN THE SERVER NAMES A WORKSPACE, the workspace's own roles decide instead, and they are
 * narrower by design: a contributor may CALL, a viewer may only see that it is there. That mirrors
 * what those two words already mean for everything else in a workspace, and it is why binding to a
 * workspace is worth having beside binding to the organism.
 */
export async function organismAdmits(
  storage: Storage, config: AimeatConfig, server: McpServerRecord,
  ownerGhii: string, wantToCall: boolean,
): Promise<boolean> {
  if (server.ownership !== 'organism' || !server.organismId) return false;

  const organism = await storage.getOrganism(server.organismId);
  if (!organism) return false;

  const bare = ownerGhii.split('@')[0];
  const inOrganism = organismOwners(organism).some((o) => o.split('@')[0] === bare)
    || (organism.admins ?? []).some((a) => a.split('@')[0] === bare)
    || (organism.members ?? []).some((m) => m.split('@')[0] === bare);
  if (!inOrganism) return false;

  // Bound to the organism as a whole: membership is the answer.
  if (!server.ws) return true;

  // Bound to one workspace inside it. The roles live as consents, and listWorkspaceMemberRoles is
  // the one shared implementation of them — asking storage directly here would be the second.
  const roles = await listWorkspaceMemberRoles(storage, config, {
    creatorGhii: organismOwners(organism)[0] ?? '',
    orgId: server.organismId,
    ws: server.ws,
  });
  const role = roles.get(bare)?.role;
  if (!role) return false;
  return wantToCall ? role === 'contributor' : true;
}

/**
 * Attach a server to an ORGANISM, so its members reach it without anybody handing out a token.
 *
 * Only an owner or an admin of the organism may: attaching is an act of governance even though
 * USING the result is not, which is the same split membership already makes everywhere else here.
 * The caller's authority is checked HERE rather than at the door, because the answer depends on the
 * organism record and every door would otherwise have to fetch it and get the test right.
 */
export async function attachOrganismServer(input: Omit<AttachInput, 'ownerGhii'> & {
  organismId: string;
  ws?: string | null;
  /** The bare owner name of whoever is attaching, to test against the organism. */
  callerName: string;
}): Promise<AttachResult> {
  const { storage, config, slug, organismId } = input;

  // This AIMEAT attached to itself: refused while the form is still open (see selfAddressRefusal).
  const self = selfAddressRefusal(config, input.transport);
  if (self) return self;

  if (!MCP_SLUG_RE.test(slug)) {
    return {
      ok: false,
      code: 'BAD_SLUG',
      message: 'A server name is 2 to 32 characters of lowercase letters, digits and dashes, '
        + 'starting and ending with a letter or digit.',
    };
  }

  const organism = await storage.getOrganism(organismId);
  const bare = input.callerName.split('@')[0];
  const mayAttach = !!organism && (
    organismOwners(organism).some((o) => o.split('@')[0] === bare)
    || (organism.admins ?? []).some((a) => a.split('@')[0] === bare)
  );
  // Absent and not-allowed answer alike: naming an organism id must not confirm it exists.
  if (!mayAttach) {
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: 'Only an owner or an admin of that group can attach a server to it.',
    };
  }

  const clash = await storage.findMcpServerBySlug(slug, 'organism', undefined, organismId);
  if (clash) {
    return { ok: false, code: 'SLUG_TAKEN', message: `That group already has "${slug}".` };
  }

  let sealed: string | null = null;
  if (input.credential) {
    const key = requireEncryptionKey(config);
    if (!key) {
      return {
        ok: false,
        code: 'NO_ENCRYPTION_KEY',
        message: 'This node has no encryption key configured, so it cannot hold a credential for '
          + 'this server. Set AIMEAT_ENCRYPTION_KEY.',
      };
    }
    sealed = sealMcpCredential(input.credential, key);
  }

  const now = new Date().toISOString();
  const row: McpServerRecord = {
    id: randomUUID(),
    slug,
    title: input.title || slug,
    description: input.description ?? '',
    ownership: 'organism',
    // Null, and load-bearing: the server belongs to the GROUP. Putting a person here would charge
    // their account for the group's use and erase the group's server with their account, which is
    // the ruling migration 0052 already made for workspace rows.
    ownerGhii: null,
    organismId,
    ws: input.ws ?? null,
    createdBy: input.createdBy,
    transport: input.transport,
    auth: input.credential ? (input.credential.shape === 'oauth2' ? 'oauth' : 'static') : 'none',
    credential: sealed,
    credentialShape: input.credential?.shape ?? null,
    expiresAt: null,
    providerClientId: null,
    callerIdentity: input.callerIdentity ?? 'node-credential',
    exposure: input.exposure ?? 'gateway',
    toolCache: [],
    toolCacheHash: '',
    lastListedAt: null,
    // Not node-wide: membership decides, and neither an allowlist nor a price applies.
    availability: null,
    allowlist: [],
    price: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true,
    status: input.deferCredential ? 'needs_reauth' : 'active',
    lastOkAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await storage.createMcpServer(row);
  if (input.deferCredential) return { ok: true, server: toPublicMcpServer(row), tools: [] };

  const probed = await listRemoteTools(storage, config, row);
  if (!probed.ok) return refusalFromProbe(storage, row.id, probed.code, probed.message);

  const stored = await storage.getMcpServer(row.id);
  return {
    ok: true,
    server: toPublicMcpServer(stored ?? row),
    tools: probed.tools.map((t) => t.name),
  };
}

/** One of the node's own servers, by the short name an operator actually says. */
export async function findNodeServer(
  storage: Storage, slug: string,
): Promise<McpServerRecord | null> {
  return (await storage.findMcpServerBySlug(slug, 'node')) ?? null;
}

/** Every server the node offers, whoever may use it. The operator's own view. */
export async function listNodeServers(storage: Storage): Promise<McpServerRecord[]> {
  return storage.listMcpServers({ ownership: 'node' });
}

/**
 * The owner's own servers, as FULL records.
 *
 * Distinct from listUsableServers() on purpose: that returns the public projection, which is what a
 * response may carry, and this returns the rows. The flattening path needs the cached tool list and
 * the exposure setting, neither of which a projection holds — and it must not reach storage itself,
 * because a tool surface doing its own storage work is the second implementation this project keeps
 * fixing (check:shared-impl).
 */
export async function listOwnedServers(
  storage: Storage, ownerGhii: string, onlyEnabled = true,
): Promise<McpServerRecord[]> {
  return storage.listMcpServers({
    ownership: 'owner',
    ownerGhii,
    ...(onlyEnabled ? { enabled: true } : {}),
  });
}

/**
 * The server, if this caller may use it. Null when they may not, and null when there is none — the
 * same answer for both, so a refusal cannot be used to discover what another owner has.
 *
 * Accepts either the id or the slug, because a person and an AI name it differently: a UI holds the
 * id it was given, and an agent says "jira".
 */
export async function requireUsableServer(
  storage: Storage, ownerGhii: string, idOrSlug: string,
  /**
   * Needed only to resolve an ORGANISM server's workspace roles. Optional so every existing caller
   * keeps working unchanged: without it an organism-bound server is simply not found, which is the
   * safe direction for a missing argument.
   */
  config?: AimeatConfig,
): Promise<McpServerRecord | null> {
  // The caller's OWN server first. A person who names `jira` means theirs, even on a node whose
  // operator happens to offer one under the same name — otherwise attaching your own would be
  // silently shadowed by the house's.
  const bySlug = await storage.findMcpServerBySlug(idOrSlug, 'owner', ownerGhii);
  if (bySlug) return bySlug;

  // Then the node's registry, if it admits this owner.
  const nodeWide = await storage.findMcpServerBySlug(idOrSlug, 'node');
  if (nodeWide && nodeWideAdmits(nodeWide, ownerGhii)) return nodeWide;

  const byId = await storage.getMcpServer(idOrSlug);
  if (!byId) return null;
  if (byId.ownerGhii === ownerGhii) return byId;
  if (byId.ownership === 'node' && nodeWideAdmits(byId, ownerGhii)) return byId;
  if (byId.ownership === 'organism' && config
      && await organismAdmits(storage, config, byId, ownerGhii, true)) {
    return byId;
  }
  // Absent and not-yours answer alike, and a node-wide server this owner is not on the list for is
  // "not yours" — naming it must not confirm that the node offers it.
  return null;
}

/**
 * The server, if this caller may CHANGE it: switch it off, rename it, start its sign-in, detach it.
 * Null when they may not, and null when there is none, for the reason requireUsableServer gives.
 *
 * An owner's server is its owner's. A group's server is its owners' and admins', the people who may
 * attach one there. A node-wide server is nobody's through these doors, although it admits every
 * owner it is offered to: the operator changes it at /v1/mcp-servers/node/:id, which admits the
 * operator in person and nothing acting for them. Until 2026-09-24 the write doors asked
 * requireUsableServer instead, and any owner on the list could switch the server off for everybody.
 */
export async function requireManageableServer(
  storage: Storage, ownerGhii: string, idOrSlug: string, config: AimeatConfig,
): Promise<McpServerRecord | null> {
  const bySlug = await storage.findMcpServerBySlug(idOrSlug, 'owner', ownerGhii);
  if (bySlug) return bySlug;

  const byId = await storage.getMcpServer(idOrSlug);
  if (byId?.ownership === 'owner' && byId.ownerGhii === ownerGhii) return byId;
  if (byId?.ownership === 'organism' && byId.organismId) {
    const organism = await storage.getOrganism(byId.organismId);
    // Whole identities, never bare names: a roll lists this node's accounts, so `alice` on it is
    // alice@<this node>, and an account called alice somewhere else is not on it.
    const asGhii = (n: string): string => (n.includes('@') ? n : `${n}@${config.nodeId}`);
    const governors = organism ? [...organismOwners(organism), ...(organism.admins ?? [])] : [];
    if (governors.some((n) => asGhii(n) === ownerGhii)) return byId;
  }
  return null;
}

/** What either door may change after a server is attached. Not the slug and not the credential. */
export interface McpServerSettings {
  enabled?: boolean;
  title?: string;
  description?: string;
  exposure?: McpExposure;
}

/**
 * Change a server's settings.
 *
 * ONE IMPLEMENTATION, TWO DOORS. The REST route and aimeat_mcp_update both call this, so the
 * pool invalidation and the change announcement cannot happen on one door and not the other — and
 * a tool that reached `storage.updateMcpServer` directly would be the second implementation this
 * project has fixed the same defect in three times.
 *
 * SWITCHING OFF STOPS IT, rather than marking it for later. A pooled client would keep answering
 * through a server the owner has just switched off, for as long as the idle sweeper takes to
 * notice, and "I turned it off and it kept working" is the worst possible answer to somebody
 * cutting an integration.
 */
export async function updateMcpServerSettings(
  storage: Storage, server: McpServerRecord, settings: McpServerSettings,
): Promise<McpServerRecord> {
  await storage.updateMcpServer(server.id, settings);
  if (settings.enabled === false) await mcpClientPool.invalidate(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
  return (await storage.getMcpServer(server.id)) ?? server;
}

/**
 * Detach a server.
 *
 * The pool is invalidated FIRST. A client left open would keep answering calls through a server the
 * owner has just removed, for as long as the idle sweeper takes to notice — and "I deleted it and
 * it kept working" is the worst possible answer to a person removing an integration.
 */
export async function detachMcpServer(
  storage: Storage, server: McpServerRecord,
): Promise<void> {
  await mcpClientPool.invalidate(server.id);
  await storage.deleteMcpServer(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
}
