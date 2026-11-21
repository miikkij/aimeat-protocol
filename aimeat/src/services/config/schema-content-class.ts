/**
 * @file src/services/config/schema-content-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for the content class pipeline (config/content-class.ts). Its own file
 *   because config-schema.ts is near the line ceiling; spread into the schema beside the
 *   classification rows.
 * @structure CONTENT_CLASS_CONFIG_FIELDS
 * @usage import { CONTENT_CLASS_CONFIG_FIELDS } from './schema-content-class.js';
 * @version-history
 *   v1.4.0 — 2026-11-21 — content_risk.*: the content risk marks' switch, defaults, floors and AI limit.
 *   v1.3.0 — 2026-11-02 — content_class.profile_model, the fingerprint's default model, and
 *     content_class.profile_labels, who marks its sections.
 *   v1.2.0 — 2026-11-01 — content_class.media_read_seconds and media_read_memory_mb (secaudit2026oct31w2
 *     round 12, the exifr and c2pa-ts readers).
 *   v1.1.0 — 2026-10-29 — content_class.pdf_text_seconds and pdf_text_memory_mb (secaudit2026oct26
 *     round 8c, memory-b-09).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import { CONTENT_RISK_KIND_NAMES, type ContentClassConfig } from '../../config/content-class.js';
import type { ConfigFieldShape } from './field-def.js';
import { oneOf } from './schema-validators.js';

const isWhole = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isModelId = (v: unknown) => typeof v === 'string' && (v as string).length <= 200 && !/[\s\0]/.test(v as string);
const isRiskKinds = (v: unknown) => typeof v === 'string' && v.split(',').map((s) => s.trim()).filter(Boolean).every((s) => (CONTENT_RISK_KIND_NAMES as readonly string[]).includes(s));
const isProgram =(v: unknown) => typeof v === 'string' && (v as string).trim().length > 0 && (v as string).length <= 1024 && !/[\r\n\0]/.test(v as string);

export const CONTENT_CLASS_CONFIG_FIELDS: ConfigFieldShape<keyof ContentClassConfig>[] = [
  { key: 'contentClassMode', dotPath: 'content_class.mode', envVar: 'AIMEAT_CONTENT_CLASS', type: 'string', ...oneOf('on', 'off'), immutable: false, description: 'Content classes: on (each owner decides; reading what a file says about itself runs for everyone, and every step that calls an AI model stays off until the owner turns it on) or off (nothing runs, and the content class routes and tools answer 404)' },
  { key: 'ffprobePath', dotPath: 'content_class.ffprobe_path', envVar: 'AIMEAT_FFPROBE_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffprobe program that reads a video\'s length, size and recording details: a name on PATH or a full path. Missing: a video gets only the details every file gets' },
  { key: 'ffmpegPath', dotPath: 'content_class.ffmpeg_path', envVar: 'AIMEAT_FFMPEG_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffmpeg program that takes still pictures and the sound out of a video for its description: a name on PATH or a full path' },
  { key: 'pdfTextSeconds', dotPath: 'content_class.pdf_text_seconds', envVar: 'AIMEAT_PDF_TEXT_SECONDS', type: 'number', validate: isWhole, immutable: false, range: '0-86400', description: 'Seconds the node may spend reading the text of a PDF whose decoded size it cannot measure first (an encrypted PDF, or one written in a way the size check does not know). Past it the file stays stored and its text is not read. 0 = no limit' },
  { key: 'pdfTextMemoryMb', dotPath: 'content_class.pdf_text_memory_mb', envVar: 'AIMEAT_PDF_TEXT_MEMORY_MB', type: 'number', validate: isWhole, immutable: false, range: '0-65536', description: 'Memory in MB the node may use to read the text of such a PDF. Past it the file stays stored and its text is not read. 0 = no limit' },
  { key: 'mediaReadSeconds', dotPath: 'content_class.media_read_seconds', envVar: 'AIMEAT_MEDIA_READ_SECONDS', type: 'number', validate: isWhole, immutable: false, range: '0-86400', description: 'Seconds the node may spend reading the metadata of a stored picture or video (EXIF, IPTC, XMP, the colour profile, the C2PA manifest). Past it the file stays stored, its format and size are still known, and its details say the rest was not read. 0 = no limit' },
  { key: 'contentClassProfileModel', dotPath: 'content_class.profile_model', envVar: 'AIMEAT_CONTENT_PROFILE_MODEL', type: 'string', validate: isModelId, immutable: false, description: 'The AI model that makes the fingerprint of a document (what kind of text each part is and what it rests on) when the owner has not chosen one, as the provider names it. It runs on the owner\'s own AI key or allowance, and only for owners who turned the fingerprint on. Empty: the owner\'s own text model. Default ~deepseek/deepseek-pro-latest, the model it was measured on' },
  { key: 'contentClassProfileLabels', dotPath: 'content_class.profile_labels', envVar: 'AIMEAT_CONTENT_PROFILE_LABELS', type: 'string', ...oneOf('auto', 'model'), immutable: false, description: 'Who marks each part of a document for its fingerprint: auto (the decision model when it is on, which is steadier and costs a fraction; the AI model then writes only the headings, the one-sentence claims and the topics) or model (the AI model does all of it). A fingerprint says which way it was made' },
  { key: 'contentRiskMode', dotPath: 'content_risk.mode', envVar: 'AIMEAT_CONTENT_RISK', type: 'string', ...oneOf('on', 'off'), immutable: false, description: 'Content risk marks: on (text that tries to steer an AI, hidden text and the like is marked beside the content, never changed; the organism, workspace and person settings decide the rest within the limits below) or off (nothing extra runs and no read carries marks)' },
  { key: 'contentRiskDetect', dotPath: 'content_risk.detect', envVar: 'AIMEAT_CONTENT_RISK_DETECT', type: 'string', ...oneOf('rules', 'rules+ai'), immutable: false, description: 'How content risks are found by default: rules (no AI model, no cost) or rules+ai (an AI model looks too, on the allowance of whoever chose it). Default rules' },
  { key: 'contentRiskAi', dotPath: 'content_risk.ai', envVar: 'AIMEAT_CONTENT_RISK_AI', type: 'string', ...oneOf('allow', 'deny'), immutable: false, description: 'Whether an organism, workspace or person may choose rules+ai for content risks: allow, or deny (every layer stays at rules)' },
  { key: 'contentRiskOnIntake', dotPath: 'content_risk.on_intake', envVar: 'AIMEAT_CONTENT_RISK_ON_INTAKE', type: 'string', ...oneOf('off', 'mark', 'mark+warn', 'hold'), immutable: false, description: 'Default for content that arrives from outside (receivers, mail, imports): off, mark, mark+warn (the owner is told), or hold (marked content waits for the owner before other people\'s AIs get it). Default mark' },
  { key: 'contentRiskOnSharedWrite', dotPath: 'content_risk.on_shared_write', envVar: 'AIMEAT_CONTENT_RISK_ON_SHARED_WRITE', type: 'string', ...oneOf('off', 'mark', 'mark+warn', 'hold'), immutable: false, description: 'Default for what someone other than the owner writes into a shared place (a workspace document, a comment, a message): off, mark, mark+warn or hold. Default mark' },
  { key: 'contentRiskOnRead', dotPath: 'content_risk.on_read', envVar: 'AIMEAT_CONTENT_RISK_ON_READ', type: 'string', ...oneOf('off', 'mark', 'mark+warn'), immutable: false, description: 'Default when an AI reads content over MCP: off, mark (the marks travel with the content) or mark+warn (also one warning line for the AI). Default mark+warn' },
  { key: 'contentRiskFloorIntake', dotPath: 'content_risk.floor_on_intake', envVar: 'AIMEAT_CONTENT_RISK_FLOOR_INTAKE', type: 'string', ...oneOf('off', 'mark', 'mark+warn', 'hold'), immutable: false, description: 'The least any organism, workspace or person may choose for content that arrives from outside. Default off (no limit)' },
  { key: 'contentRiskFloorSharedWrite', dotPath: 'content_risk.floor_on_shared_write', envVar: 'AIMEAT_CONTENT_RISK_FLOOR_SHARED_WRITE', type: 'string', ...oneOf('off', 'mark', 'mark+warn', 'hold'), immutable: false, description: 'The least any organism or workspace may choose for writes into a shared place. Default off (no limit)' },
  { key: 'contentRiskFloorRead', dotPath: 'content_risk.floor_on_read', envVar: 'AIMEAT_CONTENT_RISK_FLOOR_READ', type: 'string', ...oneOf('off', 'mark', 'mark+warn'), immutable: false, description: 'The least any organism, workspace or person may choose for an AI\'s read. Default off (no limit)' },
  { key: 'contentRiskKinds', dotPath: 'content_risk.kinds', envVar: 'AIMEAT_CONTENT_RISK_KINDS', type: 'string', validate: isRiskKinds, immutable: false, description: 'The kinds of risk looked for by default, comma-separated: ai-instruction, hidden-text, false-role, exfil-link, other-person-data, encoded-block. Empty: all six' },
  { key: 'mediaReadMemoryMb', dotPath: 'content_class.media_read_memory_mb', envVar: 'AIMEAT_MEDIA_READ_MEMORY_MB', type: 'number', validate: isWhole, immutable: false, range: '0-65536', description: 'Memory in MB the node may use to read the metadata of a stored picture or video. Past it the file stays stored, its format and size are still known, and its details say the rest was not read. A PNG colour profile larger than half of it is not read. 0 = no limit' },
];
