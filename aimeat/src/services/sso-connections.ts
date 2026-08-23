/**
 * @file src/services/sso-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SSO connection management (BR-04), as ONE implementation. The admin HTTP routes
 *   (routes/admin-sso.ts) and the operator MCP tools (mcp/core-admin.ts) both call these
 *   functions, so validation, the connections_locked freeze, the show-the-secret-once rule and
 *   the redacted read shape are written once — the same reason provisionOwner and eraseOwner
 *   exist. Results are discriminated unions the caller maps onto its own envelope.
 * @structure SsoAdminRefusal; viewSsoConnection(); the CRUD verbs (create/update/delete);
 *   mintScimToken(); setIdpMetadata().
 * @usage const r = await createSsoConnection(config, storage, input, 'operator-name');
 *        if (!r.ok) return res.status(r.status).json(error(config.nodeId, r.code, r.message));
 * @version-history
 *   v1.0.0 — 2026-08-24 — Extracted from routes/admin-sso.ts when the MCP tools became the second
 *     caller (BR-04 phase 1's MCP batch).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, SsoConnectionRecord } from '../storage/interface.js';
import { SSO_CONNECTION_ID_PATTERN } from '../storage/interface.js';
import { safeFetch } from '../utils/url-validator.js';
import { spEntityId, spAcsUrl, parseIdpMetadata } from './saml-sp.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** Raw SCIM bearer prefix — recognisable in an IdP console and in a leaked log alike. */
const SCIM_TOKEN_PREFIX = 'aimeat_scim_';

export interface SsoAdminRefusal { ok: false; status: number; code: string; message: string }
const refuse = (status: number, code: string, message: string): SsoAdminRefusal => ({ ok: false, status, code, message });

export type SsoConnectionView = ReturnType<typeof viewSsoConnection>;

/** What a connection read returns: everything the operator set, never a secret. */
export function viewSsoConnection(config: AimeatConfig, c: SsoConnectionRecord) {
  return {
    id: c.id,
    name: c.name,
    organism_id: c.organismId ?? null,
    domains: c.domains,
    login_visibility: c.loginVisibility,
    allow_idp_initiated: c.allowIdpInitiated,
    saml_configured: !!c.saml,
    saml_idp_entity_id: c.saml?.idpEntityId ?? null,
    scim_token_configured: !!c.scimTokenHash,
    scim_token_created_at: c.scimTokenCreatedAt ?? null,
    last_scim_request_at: c.lastScimRequestAt ?? null,
    last_login_at: c.lastLoginAt ?? null,
    created_by: c.createdBy,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    // What the IdP console asks for, ready to paste.
    sp: {
      entity_id: spEntityId(config, c.id),
      acs_url: spAcsUrl(config, c.id),
      metadata_url: spEntityId(config, c.id),
      scim_base_url: `${config.baseUrl}/v1/scim/v2/${c.id}`,
    },
  };
}

/** The connections_locked freeze, read per call so sealing takes effect without a restart. */
function lockedRefusal(config: AimeatConfig): SsoAdminRefusal | null {
  return config.ssoConnectionsLocked
    ? refuse(403, 'SEALED_CONFIG', 'SSO connection management is locked on this node (sso.connections_locked)')
    : null;
}

/** Normalize a client-supplied domain list: lowercase, trimmed, deduplicated, no empties. */
function normalizeDomains(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Set<string>();
  for (const d of raw) {
    if (typeof d !== 'string') return null;
    const v = d.trim().toLowerCase();
    if (!v || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return null;
    out.add(v);
  }
  return [...out];
}

export interface SsoConnectionInput {
  id?: unknown;
  name?: unknown;
  domains?: unknown;
  organism_id?: unknown;
  login_visibility?: unknown;
  allow_idp_initiated?: unknown;
}

/** Create a connection. The id is permanent: URL segment, externalIdentities key and Audience. */
export async function createSsoConnection(
  config: AimeatConfig, storage: Storage, input: SsoConnectionInput, createdBy: string,
): Promise<SsoAdminRefusal | { ok: true; connection: SsoConnectionView }> {
  const locked = lockedRefusal(config);
  if (locked) return locked;
  const { id, name } = input;
  if (typeof id !== 'string' || !SSO_CONNECTION_ID_PATTERN.test(id)) {
    return refuse(400, 'INVALID_INPUT', 'id must be a slug: 2-31 chars, lowercase letters, digits and dashes, starting with a letter');
  }
  if (typeof name !== 'string' || !name.trim()) {
    return refuse(400, 'INVALID_INPUT', 'name is required');
  }
  const domains = normalizeDomains(input.domains ?? []);
  if (domains === null) {
    return refuse(400, 'INVALID_INPUT', 'domains must be a list of email domains (e.g. ["contoso.com"])');
  }
  if (await storage.getSsoConnection(id)) {
    return refuse(409, 'NAME_TAKEN', `Connection "${id}" already exists`);
  }
  const organismId = typeof input.organism_id === 'string' && input.organism_id.trim() ? input.organism_id.trim() : null;
  if (organismId && !(await storage.getOrganism(organismId))) {
    return refuse(404, 'NOT_FOUND', `Organism not found: ${organismId}`);
  }
  const now = new Date().toISOString();
  const record = await storage.createSsoConnection({
    id,
    name: name.trim(),
    organismId,
    domains,
    saml: null,
    allowIdpInitiated: input.allow_idp_initiated === true,
    loginVisibility: input.login_visibility === 'hidden' ? 'hidden' : 'listed',
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  emitChange('config');
  return { ok: true, connection: viewSsoConnection(config, record) };
}

/** Update the mutable half: name, domains, organism binding, visibility, IdP-initiated. */
export async function updateSsoConnectionAdmin(
  config: AimeatConfig, storage: Storage, id: string, input: SsoConnectionInput,
): Promise<SsoAdminRefusal | { ok: true; connection: SsoConnectionView }> {
  const locked = lockedRefusal(config);
  if (locked) return locked;
  const existing = await storage.getSsoConnection(id);
  if (!existing) return refuse(404, 'NOT_FOUND', 'Connection not found');

  const updates: Partial<SsoConnectionRecord> = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return refuse(400, 'INVALID_INPUT', 'name must be a non-empty string');
    }
    updates.name = input.name.trim();
  }
  if (input.domains !== undefined) {
    const domains = normalizeDomains(input.domains);
    if (domains === null) return refuse(400, 'INVALID_INPUT', 'domains must be a list of email domains');
    updates.domains = domains;
  }
  if (input.organism_id !== undefined) {
    const organismId = typeof input.organism_id === 'string' && input.organism_id.trim() ? input.organism_id.trim() : null;
    if (organismId && !(await storage.getOrganism(organismId))) {
      return refuse(404, 'NOT_FOUND', `Organism not found: ${organismId}`);
    }
    updates.organismId = organismId;
  }
  if (input.login_visibility !== undefined) {
    if (input.login_visibility !== 'listed' && input.login_visibility !== 'hidden') {
      return refuse(400, 'INVALID_INPUT', 'login_visibility must be "listed" or "hidden"');
    }
    updates.loginVisibility = input.login_visibility;
  }
  if (input.allow_idp_initiated !== undefined) {
    updates.allowIdpInitiated = input.allow_idp_initiated === true;
  }
  const updated = await storage.updateSsoConnection(id, updates);
  emitChange('config');
  return { ok: true, connection: viewSsoConnection(config, updated!) };
}

/**
 * Delete a connection — the DOOR, not the people: accounts, their data and organism memberships
 * remain (the same reversibility the Entra allowlist has). Their managedBy keeps naming this id,
 * so recreating the connection restores SCIM authority.
 */
export async function deleteSsoConnectionAdmin(
  config: AimeatConfig, storage: Storage, id: string,
): Promise<SsoAdminRefusal | { ok: true }> {
  const locked = lockedRefusal(config);
  if (locked) return locked;
  const deleted = await storage.deleteSsoConnection(id);
  if (!deleted) return refuse(404, 'NOT_FOUND', 'Connection not found');
  emitChange('config');
  return { ok: true };
}

/**
 * Mint the SCIM bearer. Shown ONCE; only the SHA-256 is stored; minting again replaces the old
 * token (the directory is reconfigured, the old credential dies with the overwrite).
 */
export async function mintScimToken(
  config: AimeatConfig, storage: Storage, id: string,
): Promise<SsoAdminRefusal | { ok: true; scim_token: string; note: string }> {
  const locked = lockedRefusal(config);
  if (locked) return locked;
  const existing = await storage.getSsoConnection(id);
  if (!existing) return refuse(404, 'NOT_FOUND', 'Connection not found');
  const raw = SCIM_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  await storage.updateSsoConnection(id, {
    scimTokenHash: createHash('sha256').update(raw).digest('hex'),
    scimTokenCreatedAt: new Date().toISOString(),
  });
  emitChange('config');
  return {
    ok: true,
    scim_token: raw,
    note: 'Shown once. Paste it into the identity provider\'s provisioning configuration now; generating a new one replaces this one.',
  };
}

/**
 * Read the IdP's metadata (fetched from a URL through safeFetch, or pasted as XML) and store the
 * SAML half. Refuse before write: nothing is saved unless the document yields an entityID, a
 * redirect-binding SSO URL and at least one signing certificate.
 */
export async function setIdpMetadata(
  config: AimeatConfig, storage: Storage, id: string,
  input: { url?: unknown; xml?: unknown; name_id_format?: unknown },
): Promise<SsoAdminRefusal | { ok: true; connection: SsoConnectionView }> {
  const locked = lockedRefusal(config);
  if (locked) return locked;
  const existing = await storage.getSsoConnection(id);
  if (!existing) return refuse(404, 'NOT_FOUND', 'Connection not found');

  let doc: string;
  if (typeof input.xml === 'string' && input.xml.trim()) {
    doc = input.xml;
  } else if (typeof input.url === 'string' && /^https?:\/\//.test(input.url)) {
    try {
      const r = await safeFetch(input.url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return refuse(400, 'INVALID_INPUT', `Metadata URL answered ${r.status}`);
      doc = await r.text();
    } catch (err) {
      logger.warn('IdP metadata fetch failed', { id, error: String(err) });
      return refuse(400, 'INVALID_INPUT',
        'Could not fetch the metadata URL. A private-network IdP needs AIMEAT_ALLOW_PRIVATE_EGRESS on this node, or paste the XML instead.');
    }
  } else {
    return refuse(400, 'INVALID_INPUT', 'Provide either a metadata "url" or the metadata "xml"');
  }

  const parsed = parseIdpMetadata(doc);
  if (!parsed) {
    return refuse(400, 'INVALID_INPUT',
      'That document is not usable IdP metadata: it needs an entityID, an HTTP-Redirect SingleSignOnService and at least one signing certificate');
  }
  const nameIdFormat = typeof input.name_id_format === 'string' && input.name_id_format.trim()
    ? input.name_id_format.trim() : existing.saml?.nameIdFormat;
  const updated = await storage.updateSsoConnection(id, {
    saml: { ...parsed, ...(nameIdFormat ? { nameIdFormat } : {}), ...(existing.saml?.attributeMap ? { attributeMap: existing.saml.attributeMap } : {}) },
  });
  emitChange('config');
  return { ok: true, connection: viewSsoConnection(config, updated!) };
}

/** The operator's list, in read shape. */
export async function listSsoConnectionViews(config: AimeatConfig, storage: Storage): Promise<SsoConnectionView[]> {
  return (await storage.listSsoConnections()).map(c => viewSsoConnection(config, c));
}

/** One connection in read shape, or null. */
export async function getSsoConnectionView(config: AimeatConfig, storage: Storage, id: string): Promise<SsoConnectionView | null> {
  const c = await storage.getSsoConnection(id);
  return c ? viewSsoConnection(config, c) : null;
}
