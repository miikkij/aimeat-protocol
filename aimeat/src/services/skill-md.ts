/**
 * @file skill-md.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SKILL.md parser + validator for the skills registry. A skill is a directory
 *   `skill-name/` with a required SKILL.md (YAML frontmatter + markdown body) plus any other files
 *   the author keeps beside it (`scripts/`, `references/`, `assets/` by convention, a LICENSE.txt or
 *   a forms.md at the root just as well): the Agent Skills format (agentskills.io/specification),
 *   which crewaimeat, Claude Code and the other clients read. This module enforces it: frontmatter
 *   `name` (1-64 chars, lowercase alphanumeric + hyphens, must match the directory name),
 *   `description` (1-1024 chars), optional `license` / `compatibility` / `metadata`. `allowed-tools`
 *   is accepted as inert metadata only (it does NOT provision tools). Fails loud on malformed input.
 *
 *   The standard's stricter rules (no `--` in a name, `compatibility` at most 500 characters,
 *   `metadata` values that are strings, no other top-level fields) are reported as `issues`, not
 *   thrown here: publishSkill refuses a NEW skill that breaks one of the first two, which the
 *   specification's reference validator refuses too, and only warns for the rest and for a skill
 *   already in the registry, so a skill published before 2026-10-26 can still be edited.
 * @structure
 *   - SkillValidationError — typed error with code
 *   - SkillFrontmatter / ParsedSkillMd / SkillStandardIssue — parsed shapes
 *   - parseSkillMd(content) — split fences, YAML-parse, validate, list the standard issues
 *   - isAllowedSkillPath(path) — a file path stays inside the skill folder on every platform
 *   - validateSkillFiles(files) — validate a whole skill directory (SKILL.md text + safe paths)
 *   - SKILL_NAME_RE — contract constant (shared with the ZIP allowlist)
 * @usage
 *   import { parseSkillMd, validateSkillFiles, SkillValidationError } from './skill-md.js';
 * @version-history
 *   v2.0.0 -- 2026-10-26 -- Agent Skills standard: a skill folder holds any file whose path stays
 *     inside it (isAllowedSkillPath also refuses an absolute or drive path, a `:` or other character
 *     Windows reads specially, a control character, a device name, a `.git` folder and a path over
 *     200 characters), SKILL.md must be UTF-8 text, and parseSkillMd lists the standard's stricter
 *     rules as `issues` (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
 *   v1.0.0 -- 2026-07-05 -- Initial: shared-contract parser/validator (Skills feature Phase 2a).
 */
import { isUtf8 } from 'node:buffer';
import { parse as parseYaml } from 'yaml';

export type SkillValidationCode =
  | 'NO_FRONTMATTER' | 'BAD_YAML' | 'BAD_NAME' | 'BAD_DESCRIPTION'
  | 'BAD_FIELD' | 'BODY_TOO_LARGE' | 'NAME_MISMATCH' | 'MISSING_SKILL_MD' | 'BAD_FILE_PATH'
  | 'BAD_ENCODING' | 'NOT_STANDARD';

export class SkillValidationError extends Error {
  constructor(public readonly code: SkillValidationCode, message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

/** Contract: 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen. */
export const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Hard cap on the SKILL.md body (contract advises <~50k chars; enforce 100k). */
export const SKILL_BODY_MAX_CHARS = 100_000;
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;
/** The Agent Skills standard's cap on `compatibility`. */
export const SKILL_COMPATIBILITY_MAX_CHARS = 500;
/** The longest file path inside a skill folder; a path is a memory key segment and a path on disk. */
export const SKILL_PATH_MAX_CHARS = 200;

/** Characters Windows reads specially in a file name (`:` names a drive or a data stream), control characters and the backslash. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const UNSAFE_PATH_CHAR_RE = /[\u0000-\u001f\u007f<>:"|?*\\]/;
/** A device name on Windows, with or without an extension: writing `nul.txt` writes to the device. */
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/**
 * Whether a relative path may name a file inside a skill folder. Publish, the ZIP upload's
 * allowlist, the ZIP download and `aimeat skill install` all ask this, so a path the registry
 * stored is one every reader can write under `<skills dir>/<name>/` and nowhere else.
 *
 * Any file is allowed, as the Agent Skills standard allows it (a LICENSE.txt or a forms.md at the
 * root, a templates/ folder), when the path stays inside the folder on every platform: no '..'
 * segment (secaudit2026oct22: `scripts/../../x` wrote outside ~/.claude/skills/<name>), no leading
 * '/', no backslash, no `:` or other character Windows reads specially, no control character, no
 * device name, no segment ending in a dot or a space (Windows drops it, so two names reach one
 * file), no `.git` folder (a reader opening the folder would run its hooks), at most
 * SKILL_PATH_MAX_CHARS characters, and no second spelling of SKILL.md, which would overwrite the
 * validated one on a case-insensitive disk. An empty or '.' segment does not leave the folder and
 * skills stored with one keep working, so it is not refused.
 */
export function isAllowedSkillPath(path: string): boolean {
  if (path === 'SKILL.md') return true;
  if (typeof path !== 'string' || path.length === 0 || path.length > SKILL_PATH_MAX_CHARS) return false;
  if (path.startsWith('/') || path.endsWith('/') || UNSAFE_PATH_CHAR_RE.test(path)) return false;
  const segments = path.split('/');
  if (segments[segments.length - 1] === '.') return false;
  const named = segments.filter((s) => s !== '' && s !== '.');
  if (named.length === 0 || named.join('/').toLowerCase() === 'skill.md') return false;
  return named.every((s) => s !== '..' && s.toLowerCase() !== '.git' && !WINDOWS_DEVICE_RE.test(s) && !/[ .]$/.test(s));
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** Free-form extras. `allowed-tools`, when present, is folded in here as inert metadata. */
  metadata?: Record<string, unknown>;
}

/** A rule of the Agent Skills standard the frontmatter breaks while the registry still reads it. */
export interface SkillStandardIssue {
  code: 'NAME_CONSECUTIVE_HYPHENS' | 'COMPATIBILITY_LENGTH' | 'METADATA_NOT_STRING' | 'ALLOWED_TOOLS_NOT_STRING' | 'UNKNOWN_FIELD';
  /** The frontmatter field, `metadata.<key>` for one metadata entry. */
  field: string;
  message: string;
  /**
   * True when a skill new to the registry is refused for it: the two rules the specification's
   * reference validator (skills-ref) refuses and every client agrees on, two hyphens in a row in the
   * name and a `compatibility` over 500 characters. The rest only warn. Claude Code and other clients
   * add fields of their own, and skills-ref accepts a metadata value that is not a string, so refusing
   * either would keep out exactly the skills the standard is meant to bring in.
   */
  blocking: boolean;
}

export interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  /** The markdown body (the expertise injected into an agent's prompt on activation). */
  body: string;
  /** The Agent Skills standard's stricter rules this SKILL.md breaks; empty when it conforms. */
  issues: SkillStandardIssue[];
}

/** The top-level fields the Agent Skills standard defines; skills-ref refuses any other. */
const STANDARD_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);

/** The standard's stricter rules, read from the parsed frontmatter mapping. */
function standardIssues(fm: Record<string, unknown>, name: string): SkillStandardIssue[] {
  const issues: SkillStandardIssue[] = [];
  if (name.includes('--')) {
    issues.push({ code: 'NAME_CONSECUTIVE_HYPHENS', field: 'name', blocking: true,
      message: `The name "${name}" has two hyphens in a row, which the Agent Skills standard does not allow. Use one hyphen between words.` });
  }
  if (typeof fm.compatibility === 'string' && (fm.compatibility.trim().length === 0 || fm.compatibility.length > SKILL_COMPATIBILITY_MAX_CHARS)) {
    // Over the cap is what skills-ref refuses; an empty one it lets through, so that only warns.
    issues.push({ code: 'COMPATIBILITY_LENGTH', field: 'compatibility', blocking: fm.compatibility.length > SKILL_COMPATIBILITY_MAX_CHARS,
      message: `"compatibility" must be 1-${SKILL_COMPATIBILITY_MAX_CHARS} characters when it is present; it is ${fm.compatibility.length}. Leave it out when the skill has no special requirements.` });
  }
  if (fm.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)) {
    // The specification's text says string values; its reference validator reads YAML with every
    // value a string and accepts a number, a list and a map, so a skill another client accepts is
    // never refused here for one. It warns, because a stricter client may read it differently.
    for (const [key, value] of Object.entries(fm.metadata as Record<string, unknown>)) {
      if (typeof value === 'string') continue;
      issues.push({ code: 'METADATA_NOT_STRING', field: `metadata.${key}`, blocking: false,
        message: `metadata.${key} should be a string in the Agent Skills standard; quote it ("${key}: \\"…\\"") or write a list or a map as one string.` });
    }
  }
  if (fm['allowed-tools'] !== undefined && typeof fm['allowed-tools'] !== 'string') {
    issues.push({ code: 'ALLOWED_TOOLS_NOT_STRING', field: 'allowed-tools', blocking: false,
      message: '"allowed-tools" is a space-separated string in the Agent Skills standard (for example "Read Bash(git:*)"); other clients may not read a list.' });
  }
  for (const key of Object.keys(fm)) {
    if (STANDARD_FIELDS.has(key)) continue;
    issues.push({ code: 'UNKNOWN_FIELD', field: key, blocking: false,
      message: `"${key}" is not a field of the Agent Skills standard; clients that do not know it ignore it or refuse the skill. Move it under metadata to keep it portable.` });
  }
  return issues;
}

/** Whether a file's bytes are UTF-8 text with no NUL, the only form SKILL.md may take. */
export function isUtf8Text(bytes: Buffer): boolean {
  return !bytes.includes(0) && isUtf8(bytes);
}

/**
 * Parse + validate one SKILL.md. Throws SkillValidationError on any contract violation —
 * malformed skills must never enter the registry.
 */
export function parseSkillMd(content: string): ParsedSkillMd {
  const normalized = content.replace(/^\uFEFF/, '');
  const m = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    throw new SkillValidationError('NO_FRONTMATTER', 'SKILL.md must start with a --- YAML frontmatter block');
  }

  let raw: unknown;
  try {
    raw = parseYaml(m[1]);
  } catch (err) {
    throw new SkillValidationError('BAD_YAML', `SKILL.md frontmatter is not valid YAML: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SkillValidationError('BAD_YAML', 'SKILL.md frontmatter must be a YAML mapping');
  }
  const fm = raw as Record<string, unknown>;

  const name = fm.name;
  if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) {
    throw new SkillValidationError('BAD_NAME',
      'Frontmatter "name" must be 1-64 chars of lowercase letters, digits and hyphens (no leading/trailing hyphen)');
  }

  const description = fm.description;
  if (typeof description !== 'string' || description.trim().length === 0 || description.length > SKILL_DESCRIPTION_MAX_CHARS) {
    throw new SkillValidationError('BAD_DESCRIPTION',
      `Frontmatter "description" is required: 1-${SKILL_DESCRIPTION_MAX_CHARS} chars describing what the skill does + when to use it`);
  }

  for (const optional of ['license', 'compatibility'] as const) {
    if (fm[optional] !== undefined && typeof fm[optional] !== 'string') {
      throw new SkillValidationError('BAD_FIELD', `Frontmatter "${optional}" must be a string when present`);
    }
  }
  if (fm.metadata !== undefined && (typeof fm.metadata !== 'object' || fm.metadata === null || Array.isArray(fm.metadata))) {
    throw new SkillValidationError('BAD_FIELD', 'Frontmatter "metadata" must be a mapping when present');
  }

  const body = m[2] ?? '';
  if (body.length > SKILL_BODY_MAX_CHARS) {
    throw new SkillValidationError('BODY_TOO_LARGE',
      `SKILL.md body exceeds ${SKILL_BODY_MAX_CHARS} chars — split large material into references/ files`);
  }

  const metadata: Record<string, unknown> = { ...(fm.metadata as Record<string, unknown> | undefined) };
  // `allowed-tools` is experimental metadata only — preserved, never enacted.
  if (fm['allowed-tools'] !== undefined) metadata['allowed-tools'] = fm['allowed-tools'];

  const frontmatter: SkillFrontmatter = { name, description: description.trim() };
  if (typeof fm.license === 'string') frontmatter.license = fm.license;
  if (typeof fm.compatibility === 'string') frontmatter.compatibility = fm.compatibility;
  if (Object.keys(metadata).length > 0) frontmatter.metadata = metadata;

  return { frontmatter, body, issues: standardIssues(fm, name) };
}

/**
 * Validate a whole skill directory given as relative-path -> content. Requires SKILL.md as UTF-8
 * text, refuses a path that would not stay inside the skill folder (isAllowedSkillPath), and
 * enforces the name-matches-dir rule when `expectedName` is known (e.g. from the wrapping ZIP
 * directory). Any other file may be text or bytes.
 */
export function validateSkillFiles(
  files: Map<string, string | Buffer>,
  expectedName?: string,
): { parsed: ParsedSkillMd; files: Map<string, string | Buffer> } {
  const skillMd = files.get('SKILL.md');
  if (skillMd === undefined) {
    throw new SkillValidationError('MISSING_SKILL_MD', 'A skill must contain a SKILL.md at its root');
  }
  for (const path of files.keys()) {
    if (!isAllowedSkillPath(path)) {
      throw new SkillValidationError('BAD_FILE_PATH',
        `The file path "${path}" is not allowed in a skill: a path stays inside the skill folder (no "..", no leading "/", no backslash, no ":" or other character Windows reserves, no ".git" folder, no device name such as NUL, at most ${SKILL_PATH_MAX_CHARS} characters), and only the root SKILL.md may be named SKILL.md.`);
    }
  }
  if (Buffer.isBuffer(skillMd) && !isUtf8Text(skillMd)) {
    throw new SkillValidationError('BAD_ENCODING', 'SKILL.md must be UTF-8 text');
  }
  const parsed = parseSkillMd(skillMd.toString());
  if (expectedName && parsed.frontmatter.name !== expectedName) {
    throw new SkillValidationError('NAME_MISMATCH',
      `Frontmatter name "${parsed.frontmatter.name}" must match the skill directory name "${expectedName}"`);
  }
  return { parsed, files };
}
