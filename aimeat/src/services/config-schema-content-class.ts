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
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */
import type { ContentClassConfig } from '../config-content-class.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

const isProgram = (v: unknown) => typeof v === 'string' && (v as string).trim().length > 0 && (v as string).length <= 1024 && !/[\r\n\0]/.test(v as string);

export const CONTENT_CLASS_CONFIG_FIELDS: ConfigFieldShape<keyof ContentClassConfig>[] = [
  { key: 'contentClassMode', dotPath: 'content_class.mode', envVar: 'AIMEAT_CONTENT_CLASS', type: 'string', ...oneOf('on', 'off'), immutable: false, description: 'Content classes: on (each owner decides; reading what a file says about itself runs for everyone, and every step that calls an AI model stays off until the owner turns it on) or off (nothing runs, and the content class routes and tools answer 404)' },
  { key: 'ffprobePath', dotPath: 'content_class.ffprobe_path', envVar: 'AIMEAT_FFPROBE_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffprobe program that reads a video\'s length, size and recording details: a name on PATH or a full path. Missing: a video gets only the details every file gets' },
  { key: 'ffmpegPath', dotPath: 'content_class.ffmpeg_path', envVar: 'AIMEAT_FFMPEG_PATH', type: 'string', validate: isProgram, immutable: false, description: 'The ffmpeg program that takes still pictures and the sound out of a video for its description: a name on PATH or a full path' },
];
