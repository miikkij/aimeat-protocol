/**
 * @file ai/call-files.ts
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
 *   · IMAGE_INPUT_LIMITS · readImageInputs(storage, reader, callerGaii, { references, mask }, payerGaii?)
 * @version-history
 *   v1.2.0 — 2026-10-18 — readImageInputs: the reference pictures and the mask of an image call, read
 *     the same way and under the same classification gate (Comicland v3 A-1, A-2).
 *   v1.1.0 — 2026-09-29 — Both read through readAiFile (services/ai-inputs.ts) with the caller's
 *     classification reader, so a file a model may not read is refused before the call (TARGET-082).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import type { Storage } from '../../storage/interface.js';
import { AiCompletionError } from './errors.js';
import type { TextFile } from './gateway.js';
import { readAiFile } from '../ai-inputs.js';
import type { ContentReader } from '../classification/reader.js';
import { sniffImage } from '../openrouter.js';

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

/**
 * At most this many reference pictures in one image call, and this many bytes in all. Sixteen is
 * OpenRouter's own ceiling on `input_references`; a comic page names a few character sheets, a
 * setting, the previous page and a style sample, which is well inside it.
 */
export const IMAGE_INPUT_LIMITS = { maxImages: 16, maxTotalBytes: 40 * 1024 * 1024 } as const;

/** One input picture of an image call, read: its bytes and the format sniffed from them. */
export interface ImageInput {
  data: Buffer;
  mime: string;
}

/** The formats an image model takes as input. A file of another kind is refused before the call. */
const IMAGE_INPUT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Read one picture a caller names for an image call: a file in the caller's own storage by its
 * key, or a data: URL. The format comes from the bytes, never from the name or the caller's word,
 * because a provider refuses a picture whose declared type is wrong. `field` names the parameter
 * in the refusal.
 */
async function readImageInput(
  storage: Storage, reader: ContentReader, callerGaii: string, raw: unknown, field: string, payerGaii: string | undefined,
): Promise<ImageInput> {
  if (!raw || typeof raw !== 'object') throw new AiCompletionError('INVALID_BODY', 400, `${field}: each entry is an object with storage_key or data_url.`);
  const input = raw as CallFileInput;
  let data: Buffer;
  if (typeof input.storage_key === 'string' && input.storage_key) {
    const file = await readAiFile(storage, reader, callerGaii, input.storage_key, { capability: 'image' })
      ?? await readOwnPictureInPayerStorage(storage, reader, callerGaii, payerGaii, input.storage_key);
    if (!file) throw new AiCompletionError('NOT_FOUND', 404, `${field}: no such file in your storage: ${input.storage_key}.`);
    data = file.data;
  } else if (typeof input.data_url === 'string' && input.data_url) {
    const m = DATA_URL.exec(input.data_url);
    if (!m) throw new AiCompletionError('INVALID_BODY', 400, `${field}: data_url must be data:<mime>;base64,<bytes>. An https URL is not accepted; store the picture and pass storage_key.`);
    data = Buffer.from(m[2], 'base64');
  } else {
    throw new AiCompletionError('INVALID_BODY', 400, `${field}: each entry needs storage_key (preferred) or data_url.`);
  }
  const mime = sniffImage(data).mime;
  if (!mime || !IMAGE_INPUT_TYPES.has(mime)) {
    throw new AiCompletionError('INVALID_BODY', 400, `${field}: ${input.storage_key ?? 'the data_url'} is not a PNG, JPEG, WebP or GIF picture.`);
  }
  return { data, mime };
}

/**
 * A picture an agent made earlier, which the image call stored in its owner's storage (the payer's,
 * services/ai-image.ts). It is the agent's to reuse only when the picture's provenance record names
 * this agent as the principal it was made for; any other file of the owner stays out of reach,
 * because an agent reading its owner's private files goes through the ordinary checks.
 */
async function readOwnPictureInPayerStorage(
  storage: Storage, reader: ContentReader, callerGaii: string, payerGaii: string | undefined, key: string,
) {
  if (!payerGaii || payerGaii === callerGaii) return null;
  const file = await storage.getStorageFile(payerGaii, key);
  if (!file?.aiProvenanceId) return null;
  const record = await storage.getAiProvenance(file.aiProvenanceId);
  if (record?.principal !== callerGaii) return null;
  return readAiFile(storage, reader, payerGaii, key, { capability: 'image' });
}

/**
 * The input pictures of an image call (POST /v1/ai/image `reference_images` and `mask`, and the MCP
 * tool that calls the same service): read in the caller's own storage under the same
 * classification gate as a text call's files, counted against IMAGE_INPUT_LIMITS together. An
 * agent's call also finds the pictures it made itself in its owner's storage (`payerGaii`).
 */
export async function readImageInputs(
  storage: Storage, reader: ContentReader, callerGaii: string,
  input: { references?: unknown; mask?: unknown },
  payerGaii?: string,
): Promise<{ references: ImageInput[]; mask?: ImageInput }> {
  const refs = input.references === undefined ? [] : input.references;
  if (!Array.isArray(refs)) throw new AiCompletionError('INVALID_BODY', 400, 'reference_images must be a list of { storage_key } or { data_url } objects.');
  if (refs.length > IMAGE_INPUT_LIMITS.maxImages) {
    throw new AiCompletionError('INVALID_BODY', 400, `reference_images: at most ${IMAGE_INPUT_LIMITS.maxImages} per call.`);
  }
  const references: ImageInput[] = [];
  for (const r of refs) references.push(await readImageInput(storage, reader, callerGaii, r, 'reference_images', payerGaii));
  const mask = input.mask === undefined || input.mask === null
    ? undefined
    : await readImageInput(storage, reader, callerGaii, input.mask, 'mask', payerGaii);
  if (mask && references.length === 0) {
    throw new AiCompletionError('INVALID_BODY', 400, 'mask edits the first reference image, so it needs reference_images with the picture to edit first.');
  }
  if (mask && mask.mime !== 'image/png') {
    throw new AiCompletionError('INVALID_BODY', 400, 'mask must be a PNG: its transparent pixels mark the area to redraw.');
  }
  const total = references.reduce((n, r) => n + r.data.length, 0) + (mask?.data.length ?? 0);
  if (total > IMAGE_INPUT_LIMITS.maxTotalBytes) {
    throw new AiCompletionError('FILES_TOO_LARGE', 400, `reference_images and mask: at most ${IMAGE_INPUT_LIMITS.maxTotalBytes / 1048576} MB in one call.`);
  }
  return { references, ...(mask ? { mask } : {}) };
}
