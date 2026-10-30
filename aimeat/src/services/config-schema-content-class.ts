/**
 * @file src/services/config-schema-content-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for the content class pipeline (config-content-class.ts). Its own file
 *   because config-schema.ts is near the line ceiling; spread into the schema beside the
 *   classification rows.
 * @structure CONTENT_CLASS_CONFIG_FIELDS
 * @usage import { CONTENT_CLASS_CONFIG_FIELDS } from './config-schema-content-class.js';
 * @version-history
 *   v1.1.0 — 2026-10-29 — content_class.pdf_text_seconds and pdf_text_memory_mb (secaudit2026oct26
 *     round 8c, memory-b-09).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { ContentClassConfig } from '../config-content-class.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

const isWhole = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isProgram = (v: unknown) => typeof v === 'string' && (v as string).trim().length > 0 && (v as string).length <= 1024 && !/[\r\n\0]/.test(v as string);

export const CONTENT_CLASS_CONFIG_FIELDS: ConfigFieldShape<keyof ContentClassConfig>[] = [
  { key: 'contentClassMode', dotPath: 'content_class.mode', envVar: 'AIMEAT_CONTENT_CLASS', type: 'string', ...oneOf('on', 'off'), immutable: false, description: 'Content classes: on (each owner decides; reading what a file says about itself runs for everyone, and every step that calls an AI model stays off until the owner turns it on) or off (nothing runs, and the content class routes and tools answer 404)' },
  { key: 'ffprobePath', dotPath: 'content_class.ffprobe_path', envVar: 'AIMEAT_FFPROBE_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffprobe program that reads a video\'s length, size and recording details: a name on PATH or a full path. Missing: a video gets only the details every file gets' },
  { key: 'ffmpegPath', dotPath: 'content_class.ffmpeg_path', envVar: 'AIMEAT_FFMPEG_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffmpeg program that takes still pictures and the sound out of a video for its description: a name on PATH or a full path' },
  { key: 'pdfTextSeconds', dotPath: 'content_class.pdf_text_seconds', envVar: 'AIMEAT_PDF_TEXT_SECONDS', type: 'number', validate: isWhole, immutable: false, range: '0-86400', description: 'Seconds the node may spend reading the text of a PDF whose decoded size it cannot measure first (an encrypted PDF, or one written in a way the size check does not know). Past it the file stays stored and its text is not read. 0 = no limit' },
  { key: 'pdfTextMemoryMb', dotPath: 'content_class.pdf_text_memory_mb', envVar: 'AIMEAT_PDF_TEXT_MEMORY_MB', type: 'number', validate: isWhole, immutable: false, range: '0-65536', description: 'Memory in MB the node may use to read the text of such a PDF. Past it the file stays stored and its text is not read. 0 = no limit' },
];
