/**
 * @file src/services/skill-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a skill's files are stored and handed out, text and bytes alike. A skill folder
 *   may carry an image, a font or a PDF in assets/ (the Agent Skills standard's "static resources"),
 *   and a file record holds a string: a file that is UTF-8 text is stored as its text, any other is
 *   stored as base64 and its entry in the manifest's file index says `encoding: "base64"`. Before
 *   2026-10-26 every file was stored with Buffer.toString(), which turned the bytes of an image into
 *   replacement characters while the publish answered success.
 *
 *   Readers get the stored string in `fileContents` and the encoding in `files`; skillFileBytes()
 *   turns the pair back into the file's bytes (the ZIP download, `aimeat skill install`). Writers that
 *   send files over JSON (POST /v1/skills, aimeat_skill_publish) give a binary file as
 *   `{ content, encoding: "base64" }`, which readSkillFileInput() decodes.
 * @structure SkillFileEncoding · SkillFileEntry · storedSkillFile · skillFileBytes ·
 *   readSkillFileInput · skillFileEncodings
 * @usage
 *   const { value, size, encoding } = storedSkillFile(content);
 *   writeFileSync(target, skillFileBytes(skill.fileContents[path], encodingOf(path)));
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial: binary files in a skill folder (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
 */
import { isUtf8Text, SkillValidationError } from './skill-md.js';

/** How a stored file's string reads back into bytes; absent is UTF-8 text. */
export type SkillFileEncoding = 'base64';

/** One entry of a manifest's file index. */
export interface SkillFileEntry {
  path: string;
  /** The file's size in bytes. */
  size: number;
  /** Present for a file that is not UTF-8 text: its stored string is base64. */
  encoding?: SkillFileEncoding;
}

/** The string a file record stores for `content`, its byte size, and the encoding when it is not text. */
export function storedSkillFile(content: string | Buffer): { value: string; size: number; encoding?: SkillFileEncoding } {
  if (typeof content === 'string') return { value: content, size: Buffer.byteLength(content) };
  if (isUtf8Text(content)) return { value: content.toString('utf8'), size: content.length };
  return { value: content.toString('base64'), size: content.length, encoding: 'base64' };
}

/** A stored file's bytes, from the string `fileContents` holds and the encoding its index entry names. */
export function skillFileBytes(value: string, encoding?: string): Buffer {
  return encoding === 'base64' ? Buffer.from(value, 'base64') : Buffer.from(value, 'utf8');
}

/** Standard base64 with its padding, and nothing else: a typo is refused rather than half-decoded. */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * One file as a JSON caller sends it: a string is the file's text, `{ content, encoding: "base64" }`
 * is its bytes. Throws SkillValidationError BAD_ENCODING for any other shape, named by path.
 */
export function readSkillFileInput(path: string, raw: unknown): string | Buffer {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const { content, encoding } = raw as { content?: unknown; encoding?: unknown };
    if (encoding === 'base64' && typeof content === 'string' && BASE64_RE.test(content)) return Buffer.from(content, 'base64');
    if (encoding === undefined && typeof content === 'string') return content;
  }
  throw new SkillValidationError('BAD_ENCODING',
    `files["${path}"] must be the file's text as a string, or { "content": "<base64>", "encoding": "base64" } for a file that is not text`);
}

/** path -> encoding for the files of an index that are not text; empty when every file is text. */
export function skillFileEncodings(files: ReadonlyArray<SkillFileEntry>): Record<string, SkillFileEncoding> {
  const out: Record<string, SkillFileEncoding> = {};
  for (const f of files) if (f.encoding) out[f.path] = f.encoding;
  return out;
}
