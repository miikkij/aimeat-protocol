/**
 * @file src/services/content/provenance-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an item says it was made by AI, from the marks it DECLARES: the node's own
 *   provenance record, the IPTC DigitalSourceType in its XMP, a C2PA manifest, and the EXIF Software
 *   tag when it names a known image generator. Every statement found is kept as a source, so a reader
 *   sees which mark said what (types.ts AiMarks).
 *
 *   THIS IS NOT A DETECTOR. Nothing here looks at the pixels, the words or the sound. An item that
 *   declares nothing gets the verdict 'unknown', which is the correct answer when no mark is present
 *   (docs/internal/EUAct/10-validators-and-ci.md: no bespoke AI detector).
 *
 *   PRECEDENCE. When sources disagree, the strongest claim wins: ai-generated over ai-assisted over
 *   human over unknown. A file that one mark calls AI-made is reported as AI-made, because a missing
 *   or weaker mark elsewhere does not cancel a positive declaration.
 *
 *   EU AI ACT ART. 50. `marked` is true when an IPTC or a C2PA statement (the machine-readable marks
 *   the article asks for) says ai-generated or ai-assisted. The node's own record is not inside the
 *   file, and the EXIF Software tag is not a provenance mark, so neither counts. `markMissing` is set
 *   when the verdict is AI-made and no such mark is in the file.
 * @structure verdictOfDigitalSourceType · verdictOfNodeLevel · aiMarksOf
 * @usage
 *   const ai = aiMarksOf({ digitalSourceType: facts.digitalSourceType, c2pa, software: facts.software });
 * @version-history
 *   v1.0.1 — 2026-10-20 — The IPTC term table moves to ai-provenance-adapters.ts fromIptc(), the one
 *     file the external vocabulary may be spelled in (check:ai-disclosure, assertion 4).
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { AiMarks } from './types.js';
import { fromIptc } from '../ai-provenance-adapters.js';

type Verdict = AiMarks['verdict'];

const RANK: Record<Verdict, number> = { unknown: 0, human: 1, 'ai-assisted': 2, 'ai-generated': 3 };

/** Generator names that, in the EXIF Software tag, say the picture came from an image model. */
const GENERATOR_SOFTWARE = /DALL|Midjourney|Stable Diffusion|Firefly|Imagen|gpt-image|Flux|Ideogram/i;

/**
 * The verdict one IPTC digital source type (URI or bare term) maps to. The vocabulary lives in the
 * adapter (ai-provenance-adapters.ts fromIptc), the one file the external values may be spelled in.
 */
export function verdictOfDigitalSourceType(value: string): Verdict {
  return fromIptc(value);
}

/** The verdict of the node's own provenance record level (models/ai-provenance-schemas.ts). */
export function verdictOfNodeLevel(level: string | undefined): Verdict {
  switch (level) {
    case 'ai-generated': return 'ai-generated';
    case 'synthesized':
    case 'assisted': return 'ai-assisted';
    case 'original': return 'human';
    default: return 'unknown';
  }
}

const isAiMade = (v: Verdict): boolean => v === 'ai-generated' || v === 'ai-assisted';

/**
 * The AI marks of an item from what it declares.
 * @param {object} input - nodeRecord (id and level of the node's own record), digitalSourceType (the
 *   XMP value), c2pa (the readC2pa result), software (the EXIF Software tag).
 * @returns {AiMarks} The verdict, each source, the C2PA summary and the EU AI Act marking.
 */
export function aiMarksOf(input: {
  nodeRecord?: { id: string; level?: string } | null;
  digitalSourceType?: string;
  c2pa?: AiMarks['c2pa'] | null;
  software?: string;
}): AiMarks {
  const sources: AiMarks['sources'] = [];

  if (input.nodeRecord) {
    const level = input.nodeRecord.level ?? '';
    sources.push({ from: 'node-record', value: level || input.nodeRecord.id, says: verdictOfNodeLevel(level) });
  }

  if (input.digitalSourceType?.trim()) {
    const value = input.digitalSourceType.trim();
    sources.push({ from: 'iptc', value, says: verdictOfDigitalSourceType(value) });
  }

  const c2pa = input.c2pa ?? undefined;
  if (c2pa?.present) {
    for (const dst of c2pa.digitalSourceTypes ?? []) {
      sources.push({ from: 'c2pa', value: dst, says: verdictOfDigitalSourceType(dst) });
    }
  }

  const software = input.software?.trim();
  if (software && GENERATOR_SOFTWARE.test(software)) {
    sources.push({ from: 'exif-software', value: software, says: 'ai-generated' });
  }

  const verdict = sources.reduce<Verdict>((acc, s) => (RANK[s.says] > RANK[acc] ? s.says : acc), 'unknown');

  const how: string[] = [];
  if (sources.some(s => s.from === 'iptc')) how.push('iptc-digitalsourcetype');
  if (c2pa?.present) how.push('c2pa');
  const marked = sources.some(s => (s.from === 'iptc' || s.from === 'c2pa') && isAiMade(s.says));

  const out: AiMarks = {
    verdict,
    sources,
    euAiAct: { marked, how, markMissing: isAiMade(verdict) && !marked },
  };
  if (c2pa) out.c2pa = c2pa;
  if (input.nodeRecord?.id) out.nodeRecordId = input.nodeRecord.id;
  return out;
}
