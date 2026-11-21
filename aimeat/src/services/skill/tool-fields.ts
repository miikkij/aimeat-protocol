/**
 * @file src/services/skill/tool-fields.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the calls a skill bound to an app writes out against the app's own tool
 *   manifest when the skill is published, and names every field the manifest does not accept.
 *
 *   WHY. An app's operating guide is the skill bound to it, and an agent writes the calls it makes
 *   from that guide. The guide is prose, the manifest is a schema that refuses unknown fields, and
 *   nothing compared the two: a guide could show a field the tool had never accepted, and every agent
 *   that followed it was refused (2026-11-21, one call in seven to aimeat_app_tool_invoke). Checked at
 *   publish, the author learns it once instead of each reader learning it on a refusal.
 *
 *   WHAT IT READS. A call written the way the node's own skills write them: the tool's name followed
 *   by its input in braces, `claim_heartbeat { id, session, sessionId }` or
 *   `incident_open { title: "…", blocks: ["…"] }`, in any Markdown file of the skill. The keys are
 *   the top-level names before a `:` or a comma; `?` after a name marks it optional and is ignored.
 *   A field written only in a sentence is not read, so a guide that wants this check writes its
 *   calls in that form. Only a tool whose schema refuses extra fields (`additionalProperties: false`)
 *   is held to it, because any other tool accepts the field.
 *
 *   WHAT IT DOES NOT DO. It refuses nothing: the answer names the fields and the publish stands, as
 *   the Agent Skills issues of an existing skill do (standardIssues).
 * @structure skillToolFieldIssues(storage, config, binding, fileTexts) → SkillToolFieldIssue[] · callFieldsIn(text, tool)
 * @usage
 *   summary.toolFieldIssues = await skillToolFieldIssues(storage, config, storedBinding, fileTexts);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-app-ty-kalujen-skeemavirheet-ly-korjaa-kutsun-yhdell-yrityks).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { loadPublicToolManifest } from '../app-tools/manifest-read.js';
import { logger } from '../../utils/logger.js';

/** One field a skill writes in a call that the bound app's tool does not accept. */
export interface SkillToolFieldIssue {
  path: string;
  tool: string;
  field: string;
  accepted: string[];
  message: string;
}

/** The most issues one publish names: a guide written against the wrong app would otherwise list hundreds. */
const MAX_ISSUES = 50;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The text inside the braces that open at `open`, or null when they never close. */
function braced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

/** Split on the commas that are not inside brackets, braces or quotes. */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0; let quote = ''; let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote && body[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === '\'' || c === '`') quote = c;
    else if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * The top-level field names in every `<tool> { … }` call written in `text`, with no repeats. A part
 * that does not start with a name (a spread `...`, a placeholder `<input>`) is skipped.
 */
export function callFieldsIn(text: string, tool: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(tool)}\`?\\s*\\{`, 'g');
  for (const m of text.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const body = braced(text, open);
    if (body === null) continue;
    for (const part of topLevelParts(body)) {
      const key = /^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*\??\s*(?::|$)/.exec(part)?.[1];
      if (key) found.add(key);
    }
  }
  return [...found];
}

/**
 * The fields the skill's calls write that the bound app's tools refuse. Empty for a skill bound to
 * nothing, to something other than an app, or to an app with no tool manifest.
 */
export async function skillToolFieldIssues(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, binding: string | undefined, fileTexts: Record<string, string>,
): Promise<SkillToolFieldIssue[]> {
  const m = typeof binding === 'string' ? /^app:([^/]+)\/(.+)$/.exec(binding) : null;
  if (!m) return [];
  const [, owner, filename] = m;
  // The manifest the tools are called against: the public one aimeat_app_tool_invoke reads
  // (services/app-tools/manifest-read.ts), so the check holds the skill to what a caller meets.
  let tools: Array<{ name?: unknown; inputSchema?: Record<string, unknown> }> = [];
  try {
    const manifest = await loadPublicToolManifest(storage, config.nodeId, owner, filename);
    if (manifest.state === 'ok') tools = manifest.tools as typeof tools;
  } catch (err) {
    // The check is advice on a publish that stands; a failed read leaves it out and says so in the log.
    logger.warn('skill tool fields: manifest not read', { binding, error: String(err) });
    return [];
  }
  const issues: SkillToolFieldIssue[] = [];
  for (const tool of tools) {
    const name = typeof tool.name === 'string' ? tool.name : '';
    const schema = tool.inputSchema;
    if (!name || !schema || schema.additionalProperties !== false) continue;
    // By name: a schema stored on PostgreSQL (jsonb) comes back with its keys in another order.
    const accepted = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {}).sort();
    for (const [path, text] of Object.entries(fileTexts)) {
      if (!/\.md$/i.test(path)) continue;
      for (const field of callFieldsIn(text, name)) {
        if (accepted.includes(field)) continue;
        issues.push({
          path, tool: name, field, accepted,
          message: `${path} writes ${name} with "${field}", which the tool does not accept. Accepted: ${accepted.join(', ') || 'none'}.`,
        });
        if (issues.length >= MAX_ISSUES) return issues;
      }
    }
  }
  return issues;
}
