/**
 * @file src/services/content/technical.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `technical` stage of the content class pipeline: everything a file says about
 *   itself, read without any AI model (types.ts TechnicalFacts). It computes the content hash and
 *   the kind, runs the readers for that kind (extract-pdf, extract-image, extract-c2pa,
 *   extract-video, extract-text), looks up the node's own provenance record when the file names one,
 *   and builds the AI marks from what the file declares (provenance-read.ts).
 *
 *   ONE FAILING READER DOES NOT STOP THE OTHERS. Each reader runs inside its own try/catch; a reader
 *   that throws is recorded in `errors` under its name and the facts from the rest are still
 *   returned. The readers themselves also report partial failures in `errors`.
 *
 *   TEXT. For a text file the bytes are decoded as UTF-8 and returned as `text` with
 *   `textFrom: 'file'`; for a PDF the text layer is returned with `textFrom: 'pdf-text-layer'`. The
 *   caller stores that text as its own file; only the counts go into the facts.
 * @structure readTechnicalFacts · extOf
 * @usage
 *   const { technical, text, textFrom } = await readTechnicalFacts({ config, storage },
 *     { bytes, mimeType, filename, aiProvenanceId, ffprobePath: config.ffprobePath });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { contentKindOf } from './kind.js';
import { readPdfFacts } from './extract-pdf.js';
import { readImageFacts } from './extract-image.js';
import { readC2pa } from './extract-c2pa.js';
import { probeVideo } from './extract-video.js';
import { measureText } from './extract-text.js';
import { aiMarksOf } from './provenance-read.js';
import type { AiMarks, TechnicalFacts, TextFacts } from './types.js';

/** The file name's extension, lower case, without the dot; '' when there is none. */
function extOf(filename: string): string {
  const dot = (filename || '').lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

const errText = (err: unknown): string => ((err as Error)?.message || String(err)).slice(0, 300);

/**
 * The technical facts of a file.
 * @param {{config: AimeatConfig, storage: Storage}} deps - The node's settings (docsign) and storage
 *   (only getAiProvenance is called).
 * @param {object} input - bytes, mimeType, filename; aiProvenanceId (the node's own record, when the
 *   file carries one); onlineSignatures (let PDF signature validation go online); ffprobePath.
 * @returns {Promise<{technical: TechnicalFacts, text: string|null, textFrom?: TextFacts['from']}>}
 */
export async function readTechnicalFacts(
  deps: { config: AimeatConfig; storage: Pick<Storage, 'getAiProvenance'> },
  input: {
    bytes: Buffer;
    mimeType: string;
    filename: string;
    aiProvenanceId?: string | null;
    onlineSignatures?: boolean;
    ffprobePath: string;
  },
): Promise<{ technical: TechnicalFacts; text: string | null; textFrom?: TextFacts['from'] }> {
  const { bytes, mimeType, filename } = input;
  const errors: Record<string, string> = {};
  const kind = contentKindOf(mimeType, filename);
  const technical: TechnicalFacts = {
    kind,
    mimeType,
    size: bytes.length,
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    ai: { verdict: 'unknown', sources: [], euAiAct: { marked: false, how: [], markMissing: false } },
  };
  let text: string | null = null;
  let textFrom: TextFacts['from'] | undefined;
  let digitalSourceType: string | undefined;
  let software: string | undefined;
  let c2pa: AiMarks['c2pa'] | null = null;
  let nodeRecord: { id: string; level?: string } | null = null;

  const addErrors = (from: Record<string, string>): void => { Object.assign(errors, from); };

  if (kind === 'pdf') {
    try {
      const got = await readPdfFacts(deps.config, bytes, { online: !!input.onlineSignatures });
      technical.pdf = got.facts;
      addErrors(got.errors);
      if (got.text) {
        text = got.text;
        textFrom = 'pdf-text-layer';
        technical.text = measureText(got.text, 'pdf-text-layer');
      }
    } catch (err) {
      errors.pdf = errText(err);
    }
  } else if (kind === 'image') {
    try {
      const got = await readImageFacts(bytes, mimeType);
      technical.image = got.facts;
      digitalSourceType = got.digitalSourceType;
      software = got.software;
      addErrors(got.errors);
    } catch (err) {
      errors.image = errText(err);
    }
  } else if (kind === 'video') {
    try {
      technical.video = await probeVideo({ ffprobePath: input.ffprobePath }, bytes, extOf(filename) || 'bin');
    } catch (err) {
      errors.video = errText(err);
    }
  } else if (kind === 'text') {
    try {
      // TextDecoder drops a leading byte order mark by default (ignoreBOM: false).
      text = new TextDecoder('utf-8').decode(bytes);
      textFrom = 'file';
      technical.text = measureText(text, 'file');
    } catch (err) {
      errors.text = errText(err);
    }
  }

  if (kind === 'image' || kind === 'video') {
    try {
      c2pa = await readC2pa(bytes);
    } catch (err) {
      errors.c2pa = errText(err);
    }
  }

  if (input.aiProvenanceId) {
    try {
      const row = await deps.storage.getAiProvenance(input.aiProvenanceId);
      if (row) nodeRecord = { id: row.id, level: row.record?.level };
      else errors.provenance = `no provenance record ${input.aiProvenanceId} on this node`;
    } catch (err) {
      errors.provenance = errText(err);
    }
  }

  technical.ai = aiMarksOf({ nodeRecord, digitalSourceType, c2pa, software });
  if (Object.keys(errors).length) technical.errors = errors;
  const result: { technical: TechnicalFacts; text: string | null; textFrom?: TextFacts['from'] } = { technical, text };
  if (textFrom) result.textFrom = textFrom;
  return result;
}
