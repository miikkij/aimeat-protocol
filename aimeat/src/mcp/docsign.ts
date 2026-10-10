/**
 * @file src/mcp/docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for document signing and signature validation.
 *
 *   THEY HOLD NO LOGIC OF THEIR OWN. Every tool calls the function the REST route calls
 *   (services/docsign/records.ts, validate-input.ts) with the session's caller, so who may read,
 *   create, sign or cancel is decided in one place. What this file adds is the convenience an AI
 *   needs: a document named by its storage key is hashed here, so the bytes never pass through the
 *   model.
 *
 *   AN MCP SESSION IS AN AGENT, so aimeat_docsign_sign signs as the agent. A person signs in the
 *   signing app with a passkey; the tool's description says so, and the refusal does too.
 * @structure registerDocsignTools(mcp, storage, config, caller)
 * @usage registerDocsignTools(mcp, storage, config, caller);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — aimeat_docsign_wallet_start and _wallet_status (services/docsign/eudi.ts):
 *     the AI prepares a wallet signature for the person, who confirms it in their own wallet
 *     (wish-allekirjoitus-eudi-lompakolla).
 *   v1.2.0 — 2026-10-10 — aimeat_docsign_wallet_start without storage_key uses the PDF the node
 *     already holds for the request.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import {
  createRequest, getRequest, listRequests, signRequest, cancelRequest, verifyRecordSignatures, lookupWithNodeKey,
  nextPdfToSign, DocsignError,
} from '../services/docsign/records.js';
import { validateDocument } from '../services/docsign/validate-input.js';
import { ValidationInputError } from '../services/docsign/validate.js';
import { documentFromStorage, readOwnFile } from '../services/docsign/files.js';
import { startWalletSignature, walletSessionStatus } from '../services/docsign/eudi.js';

export function registerDocsignTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  const ctx = { storage, config };
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
  const fail = (err: unknown) => {
    if (err instanceof DocsignError || err instanceof ValidationInputError) return toolError(err.code, err.message);
    return toolError('DOCSIGN_ERROR', err instanceof Error ? err.message : String(err));
  };
  const off = () => (config.docsignEnabled ? null : toolError('FEATURE_DISABLED', 'Document signing is switched off on this node.'));
  const appLink = (id: string) => (config.docsignAppUrl ? `${config.docsignAppUrl}/?request=${encodeURIComponent(id)}` : null);

  mcp.tool('aimeat_docsign_validate', descriptionFor('aimeat_docsign_validate'), zodShapeFor('aimeat_docsign_validate'),
    annotationsFor('aimeat_docsign_validate'),
    async ({ storage_key, document_storage_key, content_base64, online }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        return ok(await validateDocument(ctx, caller(), {
          storageKey: storage_key, documentStorageKey: document_storage_key,
          content: content_base64 ? Buffer.from(String(content_base64), 'base64') : undefined,
          online: online !== false,
        }));
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_lookup', descriptionFor('aimeat_docsign_lookup'), zodShapeFor('aimeat_docsign_lookup'),
    annotationsFor('aimeat_docsign_lookup'),
    async ({ sha256 }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        return ok(await lookupWithNodeKey(ctx, String(sha256)));
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_request_create', descriptionFor('aimeat_docsign_request_create'), zodShapeFor('aimeat_docsign_request_create'),
    annotationsFor('aimeat_docsign_request_create'),
    async ({ title, message, storage_key, document: doc, parties }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        let document: { sha256: string; name: string; size: number; mediaType: string | null; source?: { owner: string; key: string } };
        if (storage_key && !doc) {
          document = await documentFromStorage(ctx, caller(), String(storage_key));
        } else if (doc && !storage_key) {
          document = { sha256: doc.sha256, name: doc.name, size: doc.size, mediaType: doc.media_type ?? null };
        } else {
          return toolError('INVALID_INPUT', 'Name the document once: storage_key, or document { sha256, name, size }.');
        }
        const request = await createRequest(ctx, caller(), { title: String(title ?? ''), message: message ? String(message) : null, document, parties: parties as string[] });
        return ok({ request, sign_link: appLink(request.id), next: 'Each person signs in the signing app with a passkey; an agent party signs with aimeat_docsign_sign.' });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_requests', descriptionFor('aimeat_docsign_requests'), zodShapeFor('aimeat_docsign_requests'),
    annotationsFor('aimeat_docsign_requests'),
    async ({ state }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        return ok({ requests: await listRequests(ctx, caller(), { state: state as never }) });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_request_get', descriptionFor('aimeat_docsign_request_get'), zodShapeFor('aimeat_docsign_request_get'),
    annotationsFor('aimeat_docsign_request_get'),
    async ({ id }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        const request = await getRequest(ctx, caller(), String(id));
        return ok({ request, checks: await verifyRecordSignatures(ctx, request), sign_link: appLink(request.id) });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_sign', descriptionFor('aimeat_docsign_sign'), zodShapeFor('aimeat_docsign_sign'),
    annotationsFor('aimeat_docsign_sign'),
    async ({ id, method, signature }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        const request = await signRequest(ctx, caller(), String(id), { method: method as 'session' | 'key', ...(signature ? { signature: String(signature) } : {}) });
        return ok({ request, checks: await verifyRecordSignatures(ctx, request) });
      } catch (err) {
        if (err instanceof DocsignError && err.code === 'NOT_A_PARTY') {
          const link = appLink(String(id));
          return toolError('NOT_A_PARTY', `${err.message}${link ? ` The person signs here: ${link}` : ' The person signs in the signing app with their passkey.'}`);
        }
        return fail(err);
      }
    });

  mcp.tool('aimeat_docsign_cancel', descriptionFor('aimeat_docsign_cancel'), zodShapeFor('aimeat_docsign_cancel'),
    annotationsFor('aimeat_docsign_cancel'),
    async ({ id }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        return ok({ request: await cancelRequest(ctx, caller(), String(id)) });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_wallet_start', descriptionFor('aimeat_docsign_wallet_start'), zodShapeFor('aimeat_docsign_wallet_start'),
    annotationsFor('aimeat_docsign_wallet_start'),
    async ({ id, storage_key }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        const c = caller();
        // Without storage_key, the PDF this node already holds for the request (its stored
        // document, or the newest wallet-signed one).
        const file = storage_key
          ? await readOwnFile(ctx, c, String(storage_key)).then((f) => ({ data: f.data, name: f.name }))
          : await nextPdfToSign(ctx, c, String(id));
        if (!file) return toolError('DOCUMENT_NEEDED', 'This node does not hold the PDF of this request (it was made from a hash). Upload the PDF and pass it as storage_key.');
        const started = await startWalletSignature(ctx, c, String(id), { bytes: file.data, name: file.name });
        // The QR image is for a page; in a chat it is kilobytes of base64 nobody reads.
        return ok({
          session_id: started.session_id, wallet_link: started.wallet_link, request_uri: started.request_uri,
          expires_at: started.expires_at, signer: started.signer, test_roots_trusted: config.docsignEudiTestRoots,
          next: 'Give the person wallet_link to open on the phone with the wallet (or as a QR code the wallet scans). Then check aimeat_docsign_wallet_status.',
        });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_docsign_wallet_status', descriptionFor('aimeat_docsign_wallet_status'), zodShapeFor('aimeat_docsign_wallet_status'),
    annotationsFor('aimeat_docsign_wallet_status'),
    async ({ id, session_id }) => {
      const disabled = off(); if (disabled) return disabled;
      try {
        return ok(walletSessionStatus(caller(), String(id), String(session_id)));
      } catch (err) { return fail(err); }
    });
}
