/**
 * @file skill-md.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SKILL.md parser + validator for the skills registry. A skill is a directory
 *   `skill-name/` with a required SKILL.md (YAML frontmatter + markdown body) plus optional
 *   `scripts/` `references/` `assets/` files. This module enforces the cross-repo shared
 *   contract (crewaimeat consumes the same format): frontmatter `name` (1-64 chars, lowercase
 *   alphanumeric + hyphens, must match the directory name), `description` (1-1024 chars),
 *   optional `license` / `compatibility` / `metadata`. `allowed-tools` is accepted as inert
 *   metadata only (it does NOT provision tools). Fails loud on malformed input.
 * @structure
 *   - SkillValidationError — typed error with code
 *   - SkillFrontmatter / ParsedSkillMd — parsed shapes
 *   - parseSkillMd(content) — split fences, YAML-parse, validate
 *   - validateSkillFiles(files) — validate a whole skill directory (SKILL.md + allowed paths)
 *   - SKILL_NAME_RE / SKILL_FILE_ALLOW — contract constants (shared with the ZIP allowlist)
 * @usage
 *   import { parseSkillMd, validateSkillFiles, SkillValidationError } from './skill-md.js';
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial: shared-contract parser/validator (Skills feature Phase 2a).
 */
import { parse as parseYaml } from 'yaml';

export type SkillValidationCode =
  | 'NO_FRONTMATTER' | 'BAD_YAML' | 'BAD_NAME' | 'BAD_DESCRIPTION'
  | 'BAD_FIELD' | 'BODY_TOO_LARGE' | 'NAME_MISMATCH' | 'MISSING_SKILL_MD' | 'BAD_FILE_PATH';

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

/** Allowed relative paths inside a skill directory (the ZIP allowlist reuses this). */
export function isAllowedSkillPath(path: string): boolean {
  if (path === 'SKILL.md') return true;
  return /^(scripts|references|assets)\/[^\0]+$/.test(path) && !path.endsWith('/');
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  /** Free-form extras. `allowed-tools`, when present, is folded in here as inert metadata. */
  metadata?: Record<string, unknown>;
}

export interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  /** The markdown body (the expertise injected into an agent's prompt on activation). */
  body: string;
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

  return { frontmatter, body };
}

/**
 * Validate a whole skill directory given as relative-path -> content. Requires SKILL.md,
 * rejects paths outside the contract layout, and enforces the name-matches-dir rule when
 * `expectedName` is known (e.g. from the wrapping ZIP directory).
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
        `Unexpected file "${path}" — a skill may only contain SKILL.md plus scripts/, references/, assets/`);
    }
  }
  const parsed = parseSkillMd(skillMd.toString());
  if (expectedName && parsed.frontmatter.name !== expectedName) {
    throw new SkillValidationError('NAME_MISMATCH',
      `Frontmatter name "${parsed.frontmatter.name}" must match the skill directory name "${expectedName}"`);
  }
  return { parsed, files };
}
