/**
 * @file ai-call-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The files of a text call (the `files` capability, System 2 plan V5; docs/internal/
 *   llmproviderintegrations/07 section 5 and 11 section 3b), read into what the gateway sends: a file
 *   in the caller's own storage by its key, or a data: URL. The model reads the file itself; the node
 *   converts nothing.
 *
 *   A storage key is resolved in the CALLER's own namespace, as /v1/ai/transcribe does, and a key
 *   that is not there answers 404: whether someone else's file exists is not something this says.
 *   An https URL is not accepted: the provider would fetch an address a caller chose, from outside.
 * @structure CALL_FILE_LIMITS · readCallFiles(storage, reader, callerGaii, files) · readCallerAudio(storage, reader, callerGaii, key)
 * @version-history
 *   v1.1.0 — 2026-09-29 — Both read through readAiFile (services/ai-inputs.ts) with the caller's
 *     classification reader, so a file a model may not read is refused before the call (TARGET-082).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import type { Storage } from '../storage/interface.js';
import { AiCompletionError } from './ai/errors.js';
import type { TextFile } from './ai/gateway.js';
import { readAiFile } from './ai-inputs.js';
import type { ContentReader } from './classification/reader.js';

/** At most this many files, and this many bytes in all: a few documents, inside one request. */
export const CALL_FILE_LIMITS = { maxFiles: 5, maxTotalBytes: 20 * 1024 * 1024 } as const;

/** One file as a caller names it. */
export interface CallFileInput {
  storage_key?: string;
  /** `data:<mime>;base64,<bytes>`. */
  data_url?: string;
  filename?: string;
  mime?: string;
}

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * An audio file in the caller's own storage, for a transcription: POST /v1/ai/transcribe and
 * aimeat_ai_transcribe read it here, so the lookup is one implementation. Null when it is not there,
 * which the caller answers as 404: whether someone else's file exists is not something it says.
 */
export async function readCallerAudio(
  storage: Storage, reader: ContentReader, callerGaii: string, storageKey: string, opts: { mime?: string; filename?: string } = {},
): Promise<{ data: Buffer; mime: string; filename: string } | null> {
  // The one loader of content a model reads (services/ai-inputs.ts): classification first.
  const file = await readAiFile(storage, reader, callerGaii, storageKey, { capability: 'transcription' });
  if (!file) return null;
  return {
    data: file.data,
    mime: opts.mime || file.mimeType || 'application/octet-stream',
    filename: opts.filename || storageKey.split('/').pop() || 'audio',
  };
}

export async function readCallFiles(storage: Storage, reader: ContentReader, callerGaii: string, files: unknown): Promise<TextFile[]> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new AiCompletionError('INVALID_BODY', 400, 'files must be a list of { storage_key } or { data_url } objects.');
  }
  if (files.length > CALL_FILE_LIMITS.maxFiles) {
    throw new AiCompletionError('INVALID_BODY', 400, `files: at most ${CALL_FILE_LIMITS.maxFiles} per call.`);
  }
  const out: TextFile[] = [];
  let total = 0;
  for (const raw of files as CallFileInput[]) {
    if (!raw || typeof raw !== 'object') throw new AiCompletionError('INVALID_BODY', 400, 'files: each entry is an object.');
    let data: Buffer;
    let mediaType: string;
    let filename = typeof raw.filename === 'string' && raw.filename ? raw.filename.slice(0, 200) : undefined;
    if (typeof raw.storage_key === 'string' && raw.storage_key) {
      const file = await readAiFile(storage, reader, callerGaii, raw.storage_key, { capability: 'text' });
      if (!file) throw new AiCompletionError('NOT_FOUND', 404, `No such file in your storage: ${raw.storage_key}.`);
      data = file.data;
      mediaType = (typeof raw.mime === 'string' && raw.mime) || file.mimeType || 'application/octet-stream';
      filename ??= raw.storage_key.split('/').pop();
    } else if (typeof raw.data_url === 'string' && raw.data_url) {
      const m = DATA_URL.exec(raw.data_url);
      if (!m) throw new AiCompletionError('INVALID_BODY', 400, 'files: data_url must be data:<mime>;base64,<bytes>. An https URL is not accepted; store the file and pass storage_key.');
      data = Buffer.from(m[2], 'base64');
      mediaType = m[1];
    } else {
      throw new AiCompletionError('INVALID_BODY', 400, 'files: each entry needs storage_key (preferred) or data_url.');
    }
    total += data.length;
    if (total > CALL_FILE_LIMITS.maxTotalBytes) {
      throw new AiCompletionError('FILES_TOO_LARGE', 400, `files: at most ${CALL_FILE_LIMITS.maxTotalBytes / 1048576} MB in one call.`);
    }
    out.push({ data: new Uint8Array(data), mediaType, ...(filename ? { filename } : {}) });
  }
  return out;
}
