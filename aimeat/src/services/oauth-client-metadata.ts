/**
 * @file oauth-client-metadata.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A client that is a URL: OAuth Client ID Metadata Documents.
 *
 *   WHAT IT REPLACES. Dynamic Client Registration asks every client to POST itself to this node
 *   first and hold a `client_id` we minted. That means a row per client forever, an unauthenticated
 *   write endpoint, and a registration that goes stale the day the client changes its redirect URI.
 *   MCP recommended this mechanism in 2025-11-25 and DEPRECATED DCR in 2026-07-28, so building it
 *   now replaces something we already run rather than adding a surface beside it.
 *
 *   HOW IT WORKS. The client's `client_id` IS an https URL, and the document at that URL says who
 *   the client is and where it may be redirected. Nothing is stored here: the URL is the identity,
 *   and the document is fetched when it is needed.
 *
 *   THE ONE CHECK EVERYTHING RESTS ON. The document's own `client_id` must equal the URL it was
 *   fetched from. Without it, anybody who can host a file can claim to be any client whose metadata
 *   they can copy — the URL would name a location and the document would name an identity, and the
 *   two would not have to agree. With it, a client's identity is a place it controls.
 *
 *   AND IT IS AN OUTBOUND FETCH TO AN ADDRESS A STRANGER CHOSE, which is the SSRF shape exactly:
 *   `client_id=http://169.254.169.254/…` is the attack, and it arrives through a public endpoint.
 *   So it goes through `safeFetch` — which validates every hop, not just the first — the scheme is
 *   https only, the body is capped, and the answer is cached so a redirect loop cannot be used to
 *   make this node hammer somebody.
 * @structure
 *   - isClientIdUrl(id) — is this client_id the URL form?
 *   - resolveClientIdMetadata(id) — fetch, validate, cache; null when it is not usable
 * @usage
 *   const doc = isClientIdUrl(clientId) ? await resolveClientIdMetadata(clientId) : null;
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial: MCP 2025-11-25's recommended registration, and the successor to
 *     the DCR endpoint 2026-07-28 deprecates.
 */
import { safeFetch } from '../utils/url-validator.js';
import { cached, TTL } from './cache.js';
import { logger } from '../utils/logger.js';

/** A client metadata document, in the fields this node acts on. */
export interface ClientIdMetadata {
  /** The URL it was fetched from. Equal to the document's own `client_id` or it is not usable. */
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/** Bigger than any honest client document, small enough that a hostile one cannot be a payload. */
const MAX_BYTES = 32 * 1024;

/**
 * Is this `client_id` the URL form?
 *
 * https ONLY, and not merely as good practice: the document is the client's identity, so fetching it
 * over a channel somebody can rewrite means the identity is somebody else's to choose.
 */
export function isClientIdUrl(clientId: string): boolean {
  // `URL.canParse` rather than a try/catch that swallows the throw: this is a QUESTION, and a
  // malformed string is a "no" rather than a failure. Written the other way first, and the
  // no-silent-catch rule was right to refuse it — a catch returning false here would have read the
  // same as a network error returning false somewhere else.
  if (!clientId.startsWith('https://') || !URL.canParse(clientId)) return false;
  const u = new URL(clientId);
  // A fragment would make two different `client_id` strings name one document, and the code that
  // compares them is the code that decides who a caller is.
  return u.protocol === 'https:' && u.hash === '';
}

/**
 * The document's bytes, judged. PURE, and separate from the fetch on purpose.
 *
 * Every security decision this mechanism makes is here — the self-consistency comparison above all
 * — and none of it needs a network. Left inside the fetch, the only way to test "a document naming
 * a different client is refused" would have been to stand up an https server with a certificate the
 * node under test trusts, and the version of that test written over plain http passed without
 * reaching this code at all: the https fence refused it first, so it proved the fence twice and the
 * mechanism never. A pure function is the difference between a test and a green tick.
 */
export function parseClientDocument(clientId: string, body: string): ClientIdMetadata | null {
  if (body.length > MAX_BYTES) {
    logger.warn('client-id metadata: the document is too large to be one', { clientId, bytes: body.length });
    return null;
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body) as Record<string, unknown>;
  } catch {
    logger.info('client-id metadata: not JSON', { clientId });
    return null;
  }

  // THE SELF-CONSISTENCY CHECK. Everything else here is hygiene; this is the mechanism. A document
  // naming a different client_id is one somebody copied, and serving it would let whoever hosts a
  // file borrow another client's identity.
  if (doc.client_id !== clientId) {
    logger.warn('client-id metadata: the document names a different client', {
      clientId, claimed: typeof doc.client_id === 'string' ? doc.client_id : typeof doc.client_id,
    });
    return null;
  }

  const uris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((u): u is string => typeof u === 'string' && u !== '')
    : [];
  if (uris.length === 0) {
    logger.info('client-id metadata: no redirect_uris, so there is nowhere to send the owner back to', { clientId });
    return null;
  }

  return {
    clientId,
    clientName: typeof doc.client_name === 'string' && doc.client_name.trim() !== ''
      ? doc.client_name
      // The URL, never a blank. This name is what the OWNER reads on the approval screen, and an
      // empty one there is a consent dialog asking them to trust nobody in particular.
      : clientId,
    redirectUris: uris,
  };
}

/** The document at this URL, or null when it is missing, malformed, or claims to be somebody else. */
export async function resolveClientIdMetadata(clientId: string): Promise<ClientIdMetadata | null> {
  if (!isClientIdUrl(clientId)) return null;
  return cached(`oauth:cimd:${clientId}`, TTL.dashboard, async () => {
    let body: string;
    try {
      const res = await safeFetch(clientId, {
        headers: { Accept: 'application/json' },
        // A client document is a small static file. A client that cannot serve one in five seconds
        // is one an owner is about to be asked to approve, and waiting longer helps nobody.
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        logger.info('client-id metadata: the document did not answer', { clientId, status: res.status });
        return null;
      }
      body = await res.text();
    } catch (err) {
      // Includes safeFetch's own refusal, which is the one that matters: `Fetch blocked: …` means a
      // caller pointed this node at an address it may not reach.
      logger.warn('client-id metadata: could not be fetched', { clientId, error: String(err) });
      return null;
    }
    return parseClientDocument(clientId, body);
  });
}
