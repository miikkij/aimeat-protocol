/**
 * @file src/services/connections/write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing TO a connected account: a file into a SharePoint folder, a replaced file, a new
 *   folder, a list row. The third direction after publishing and reading (read.ts), on the same
 *   sealed credential, refresh and revocation.
 *
 *   A PROVIDER DECLARES WHAT MAY BE WRITTEN, and nothing else can be. `writeResources` on the
 *   descriptor maps a name to the URL, the method, the body and the headers this node builds itself.
 *   A caller supplies parameters and, for a file, the bytes; never an address and never a verb.
 *
 *   THE BYTES PASS THE CLASSIFICATION GATE BEFORE THEY LEAVE, when they come from a stored file: a
 *   file marked as one that may not leave the node is refused here exactly as a publish refuses it
 *   (publish-run.ts), with nothing sent.
 *
 *   A CONFLICT IS AN ANSWER, NOT A FAILURE. Graph answers 412 when an etag no longer matches (somebody
 *   changed the file or the row since it was read) and 409 when a name is taken under `fail`. Both say
 *   what to do, and neither is retried.
 * @structure WriteResult · writeResource() · loadStoredBytes()
 * @usage const r = await writeResource(ctx, connectionId, 'upload', { drive_id, filename }, { bytes, mimeType });
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import type { ConnectContext } from './oauth.js';
import { ensureFreshCredential } from './refresh.js';
import { findProvider } from './providers.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readBodyCapped, readText } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import { systemReader, type ContentReader } from '../classification/reader.js';
import { fileTarget } from '../classification/labels.js';

/** How long the provider gets for one write. A file of the node's largest size takes a while. */
const TIMEOUT_MS = 120_000;
/** The provider's answer to a write is a small JSON document; anything past this is not one. */
const ANSWER_MAX_BYTES = 1024 * 1024;

export type WriteResult =
  | { ok: true; resource: string; provider: string; data: unknown }
  | { ok: false; status: number; code: string; message: string };

/** The bytes a `bytes` write sends, and their type. */
export interface WritePayload {
  bytes: Buffer;
  mimeType: string;
}

/**
 * The bytes of one of `owner`'s stored files, after the classification gate for sending them to the
 * connection, or a refusal. The same order publish-run.ts keeps: the file is resolved and allowed to
 * leave before anything is asked of the provider.
 */
export async function loadStoredBytes(
  ctx: ConnectContext, owner: string, key: string, connectionId: string, reader?: ContentReader,
): Promise<{ ok: true; payload: WritePayload; name: string } | { ok: false; status: number; code: string; message: string }> {
  const stored = await ctx.storage.getStorageFile(owner, key);
  if (!stored) return { ok: false, status: 404, code: 'NO_SUCH_FILE', message: `You have no stored file named '${key}'.` };
  const gate = reader ?? systemReader(ctx, owner);
  const { left } = await gate.leave([key], (k) => fileTarget(owner, k, stored.workspaceRef),
    { kind: 'external', to: `connection:${connectionId}` });
  if (left.length) {
    return { ok: false, status: 403, code: 'CLASSIFIED', message: `'${key}' is ${left[0]!.reason}, so it is not sent.` };
  }
  return { ok: true, payload: { bytes: stored.data, mimeType: stored.mimeType }, name: key.split('/').pop() ?? key };
}

/**
 * Write one named resource to a connected account. Every failure is a returned value with an HTTP
 * status, for the reason read.ts gives: each one has to become a sentence the person can act on.
 */
export async function writeResource(
  ctx: ConnectContext, connectionId: string, resourceName: string,
  params: Record<string, unknown>, payload?: WritePayload,
): Promise<WriteResult> {
  const fresh = await ensureFreshCredential(ctx, connectionId);
  if (!fresh.ok) {
    const status = fresh.code === 'NOT_FOUND' ? 404 : 409;
    return { ok: false, status, code: fresh.code, message: `This connection cannot be used right now: ${fresh.reason}. Connect the account again.` };
  }
  const { credential, connection } = fresh;
  const provider = findProvider(ctx.providers, connection.provider);
  const resource = provider?.writeResources?.[resourceName];
  if (!provider || !resource) {
    const offered = Object.keys(provider?.writeResources ?? {});
    return {
      ok: false, status: 400, code: 'NO_SUCH_RESOURCE',
      message: offered.length
        ? `${provider!.label} cannot be asked to write "${resourceName}". These can be written: ${offered.join(', ')}.`
        : `Nothing can be written through ${provider?.label ?? 'this connection'}. Connect the account's writing permission (for SharePoint: microsoft-files-write).`,
    };
  }

  // Against what the connection was GRANTED, so the refusal names the fix rather than relaying a 403.
  const granted = new Set(connection.scopes ?? []);
  if (resource.requiresScopes.some((s) => !granted.has(s))) {
    return {
      ok: false, status: 403, code: 'MISSING_PERMISSION',
      message: `This connection to ${provider.label} was made without permission to write ${resource.label}. Connect it again and approve that.`,
    };
  }

  let url: string;
  let headers: Record<string, string>;
  let body: Uint8Array<ArrayBuffer> | string;
  try {
    url = resource.url(params);
    headers = { Authorization: `Bearer ${credential.accessToken}`, Accept: 'application/json', ...(resource.headers?.(params) ?? {}) };
    if (resource.body === 'bytes') {
      if (!payload) return { ok: false, status: 400, code: 'NO_CONTENT', message: 'Give the file to write: a stored file (from_key) or text.' };
      body = new Uint8Array(payload.bytes);
      headers['Content-Type'] = payload.mimeType || 'application/octet-stream';
    } else {
      body = JSON.stringify(resource.body(params));
      headers['Content-Type'] = 'application/json';
    }
  } catch (err) {
    return { ok: false, status: 400, code: 'BAD_PARAMETERS', message: (err as Error).message };
  }

  try {
    const resp = await safeFetch(url, { method: resource.method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!resp.ok) {
      const detail = (await readText(resp, 64 * 1024).catch((err) => `<body unreadable: ${String(err)}>`)).slice(0, 400);
      logger.warn(`[connections:write] ${provider.id}/${resourceName} answered ${resp.status}: ${detail}`);
      return refusal(resp.status, provider.label);
    }
    const raw = resp.body ? await readBodyCapped(resp, ANSWER_MAX_BYTES) : Buffer.alloc(0);
    return { ok: true, resource: resourceName, provider: provider.id, data: parseAnswer(raw ? raw.toString('utf8') : '') };
  } catch (err) {
    logger.warn(`[connections:write] ${provider.id}/${resourceName} failed: ${(err as Error).message}`);
    return { ok: false, status: 502, code: 'UNREACHABLE', message: `${provider.label} could not be reached. Nothing was written; try again shortly.` };
  }
}

/** The provider's answer as JSON, or as its text when it is not JSON; an empty answer is `{}`. */
function parseAnswer(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    // The write already succeeded (the status said so); a body that is not JSON is handed back whole.
    logger.debug(`[connections:write] the provider answered a write with text, not JSON: ${(err as Error).message}`);
    return text;
  }
}

/** The provider's refusal, said as what the person does about it. */
function refusal(status: number, label: string): WriteResult {
  if (status === 412) {
    return { ok: false, status: 409, code: 'CHANGED_SINCE_READ', message: `Somebody changed it in ${label} after you read it. Read it again, then write.` };
  }
  if (status === 409) {
    return { ok: false, status: 409, code: 'NAME_TAKEN', message: `${label} already has something by that name there. Choose another name, or say to replace it.` };
  }
  if (status === 401 || status === 403) {
    return { ok: false, status: 403, code: 'REFUSED_BY_PROVIDER', message: `${label} refused the write. You may not have the right to write there, or the permission was withdrawn; connect the account again if it was.` };
  }
  if (status === 404) {
    return { ok: false, status: 404, code: 'NOT_FOUND_AT_PROVIDER', message: `${label} has no such folder, file or list there.` };
  }
  if (status === 413) {
    return { ok: false, status: 413, code: 'TOO_LARGE', message: `${label} refused the file as too large for one upload.` };
  }
  return { ok: false, status: 502, code: 'PROVIDER_ERROR', message: `${label} could not take the write just now. Nothing was written; try again shortly.` };
}
