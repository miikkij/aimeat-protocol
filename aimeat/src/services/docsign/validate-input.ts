/**
 * @file src/services/docsign/validate-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One entry for "check this document", shared by POST /v1/docsign/validate and the
 *   aimeat_docsign_validate MCP tool: takes the bytes (sent, or read from the caller's own storage),
 *   decides what kind of file it is, validates the signatures it carries, and adds the AIMEAT
 *   signatures this node holds for the same document hash.
 *
 *   ANY FILE CAN BE CHECKED. A PDF is read for its embedded signatures; a CMS file (.p7m, or a .p7s
 *   with the document beside it) for its own; anything else (a Word file, a text, an image) has no
 *   signature inside and is reported as unsigned, which is still a useful answer, because its hash
 *   may carry AIMEAT signatures.
 * @structure ValidateInput · ValidateResult · validateDocument
 * @usage const { report, aimeat } = await validateDocument(ctx, caller, { content: bytes });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { createHash } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { validatePdf, validateCmsFile, ValidationInputError, type ValidationReport } from './validate.js';
import { lookupByHash, DocsignError, type DocsignCtx, type PublicRequestView } from './records.js';
import { readOwnFile } from './files.js';
import { docsignMaxBytes } from '../../config-docsign.js';

export interface ValidateInput {
  /** The file: a PDF, an attached CMS (.p7m), or any document to look up by hash. */
  content?: Buffer;
  /** A detached CMS signature (.p7s), with `document` beside it. */
  signature?: Buffer;
  document?: Buffer;
  /** Read the file from the caller's own storage instead. */
  storageKey?: string;
  documentStorageKey?: string;
  /** false: no network (trusted lists, OCSP, CRL) for this check, whatever the node allows. */
  online?: boolean;
}

export interface ValidateResult {
  report: ValidationReport;
  /** AIMEAT signing requests on this node for the same document, with their signatures checked. */
  aimeat: PublicRequestView[];
}

const isPdf = (b: Buffer) => b.subarray(0, 1024).indexOf('%PDF-') >= 0;

export async function validateDocument(ctx: DocsignCtx, caller: CallerContext | null, input: ValidateInput): Promise<ValidateResult> {
  let content = input.content;
  let document = input.document;
  if (input.storageKey) {
    if (!caller) throw new DocsignError('UNAUTHORIZED', 401, 'A stored file is read as you: sign in.');
    content = (await readOwnFile(ctx, caller, input.storageKey)).data;
  }
  if (input.documentStorageKey) {
    if (!caller) throw new DocsignError('UNAUTHORIZED', 401, 'A stored file is read as you: sign in.');
    document = (await readOwnFile(ctx, caller, input.documentStorageKey)).data;
  }
  const signature = input.signature ?? (document ? content : undefined);
  const max = docsignMaxBytes(ctx.config);
  for (const b of [content, document, signature]) {
    if (b && b.length > max) throw new DocsignError('TOO_LARGE', 413, `The file is ${b.length} bytes; this node validates files up to ${max} bytes.`);
  }
  const opts = { online: input.online !== false };

  let report: ValidationReport;
  if (signature && document) {
    report = await validateCmsFile(ctx.config, signature, document, opts);
  } else if (content && content.length) {
    if (isPdf(content)) {
      report = await validatePdf(ctx.config, content, opts);
    } else {
      try {
        report = await validateCmsFile(ctx.config, content, null, opts);
      } catch (err) {
        if (!(err instanceof ValidationInputError) || err.code !== 'NOT_A_SIGNATURE') throw err;
        report = {
          document: { sha256: createHash('sha256').update(content).digest('hex'), size: content.length, mediaType: 'application/octet-stream' },
          verdict: 'unsigned', checkedAt: new Date().toISOString(), online: opts.online && ctx.config.docsignOnlineChecks,
          signatures: [], limits: [],
        };
      }
    }
  } else {
    throw new DocsignError('INVALID_INPUT', 400, 'Send the file (a PDF, a .p7m, or any document), or a .p7s signature with the document it signs.');
  }
  return { report, aimeat: await lookupByHash(ctx, report.document.sha256) };
}
