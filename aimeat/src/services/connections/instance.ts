/**
 * @file instance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance-scoped provider support (TARGET-057): normalising a user-supplied instance
 *   address, and registering this node as an application at that instance on first contact.
 *
 *   THE ADDRESS COMES FROM A USER. That single fact drives this whole file. `mastodon.social` is
 *   typed into a box by whoever is connecting, and the node then makes an HTTP request to it. That
 *   is an SSRF vector, and the answer is two layers rather than one: normalise and reject
 *   syntactically here, then let safeFetch apply the network-level rules (private ranges, redirect
 *   re-validation) on every request that follows.
 *
 *   LAZY REGISTRATION. There is no way to know which instance the next user arrives from, and there
 *   are thousands, so the client credentials cannot be configuration. The node registers itself the
 *   first time someone connects from an instance and remembers the result, so the second user
 *   reuses the first user's registration rather than minting a parallel one.
 * @structure normalizeInstance · registerAtInstance
 * @usage import { normalizeInstance, registerAtInstance } from './instance.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1c.
 */

import { randomUUID } from 'node:crypto';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { sealCredential, openCredential } from './credential.js';
import type { Storage } from '../../storage/interface.js';

/** A normalised instance origin, or the reason it was refused. */
export type InstanceResult =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/**
 * Normalise `mastodon.social`, `https://mastodon.social/`, `HTTPS://Mastodon.Social` and friends to
 * one canonical origin, or refuse.
 *
 * Canonicalising matters beyond tidiness: the origin is the storage key for the node's registration
 * at that instance, so two spellings of one instance would register twice and hold two client
 * secrets for the same place.
 *
 * HTTPS is forced rather than accepted-if-offered. An instance reached over http would carry the
 * user's authorization code in the clear, and accepting `http://` from a text box is also the
 * easiest way to reach something that is not on the internet at all.
 */
export function normalizeInstance(raw: string): InstanceResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'instance address is empty' };
  if (trimmed.length > 253) return { ok: false, reason: 'instance address is too long' };

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: 'instance address is not a valid host' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'instance must be reachable over https' };
  // Credentials in the URL would be silently carried into every later request to that instance.
  if (url.username || url.password) return { ok: false, reason: 'instance address must not carry credentials' };
  // A path would make two spellings of one instance look like two instances.
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'instance address must be a bare host, with no path or query' };
  }
  // Hostnames only. An IP literal here is either a mistake or an attempt to reach something
  // internal; safeFetch would refuse the private ranges anyway, and refusing earlier is clearer.
  if (/^\[|^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    return { ok: false, reason: 'instance address must be a hostname, not an IP address' };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(url.hostname)) {
    return { ok: false, reason: 'instance address is not a valid hostname' };
  }

  return { ok: true, origin: `https://${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}` };
}

/** Client credentials this node holds at one instance. */
export interface InstanceClient {
  clientId: string;
  clientSecret: string;
}

/**
 * The node's application registration at `origin`, registering it if this is the first contact.
 *
 * Concurrency is handled by the store rather than here: `upsertProviderClient` is insert-if-new and
 * returns whatever is now there, so two users arriving from one instance at the same moment
 * converge on a single registration. The loser of that race has registered an application at the
 * instance that nothing will ever point at, which is untidy at the instance and harmless to us —
 * the alternative, a lock held across a network call to a stranger's server, is worse.
 */
export async function registerAtInstance(
  storage: Storage,
  key: Buffer,
  provider: string,
  origin: string,
  app: { name: string; redirectUri: string; scopes: string[]; website: string },
): Promise<InstanceClient | { error: string }> {
  const existing = await storage.getProviderClient(provider, origin);
  if (existing) {
    const opened = openCredential(existing.clientSecret, key);
    // A registration whose secret cannot be read is worse than none: every authorization against it
    // would fail at the token exchange with a message from the instance, far from the cause.
    if (!opened) return { error: 'stored registration for this instance cannot be read' };
    return { clientId: existing.clientId, clientSecret: opened.accessToken };
  }

  const body = new URLSearchParams({
    client_name: app.name,
    redirect_uris: app.redirectUri,
    scopes: app.scopes.join(' '),
    website: app.website,
  });

  let res: Response;
  try {
    res = await safeFetch(`${origin}/api/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // safeFetch throws "Fetch blocked: <reason>" for a refused address. That is the SSRF gate
    // reporting, and it is worth surfacing verbatim: it tells the user their instance is unreachable
    // rather than leaving them at a spinner.
    return { error: `could not reach the instance: ${(err as Error).message}` };
  }

  if (!res.ok) return { error: `instance refused the registration (HTTP ${res.status})` };

  const json = await res.json().catch((err: unknown) => {
    // Logged rather than swallowed: an instance answering 200 with something that is not JSON is a
    // different problem from one answering with JSON that lacks the fields, and the message below
    // is the same for both. Without this line the two are indistinguishable in production.
    logger.warn('connections: instance registration returned unparseable JSON', {
      provider, origin, error: String(err),
    });
    return null;
  }) as { client_id?: unknown; client_secret?: unknown } | null;
  const clientId = typeof json?.client_id === 'string' ? json.client_id : '';
  const clientSecret = typeof json?.client_secret === 'string' ? json.client_secret : '';
  if (!clientId || !clientSecret) return { error: 'instance returned no usable client credentials' };

  // Sealed through the same path as a user token. It is not personal data, but a table that holds
  // one secret in the clear teaches the next one to do the same.
  const stored = await storage.upsertProviderClient({
    // The NODE's registration at this instance, shared by everyone who arrives from it.
    principal: null,
    id: randomUUID(),
    provider,
    instance: origin,
    clientId,
    clientSecret: sealCredential({ shape: 'static', accessToken: clientSecret }, key),
    registeredAt: new Date().toISOString(),
  });

  // Read back what the store actually kept: on a race that is the OTHER registration, and using our
  // own local values would authorize against credentials the store does not have.
  if (stored.clientId !== clientId) {
    const opened = openCredential(stored.clientSecret, key);
    if (!opened) return { error: 'stored registration for this instance cannot be read' };
    return { clientId: stored.clientId, clientSecret: opened.accessToken };
  }
  return { clientId, clientSecret };
}
