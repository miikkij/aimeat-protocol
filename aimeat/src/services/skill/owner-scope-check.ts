/**
 * @file src/services/skill/owner-scope-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Names, at publish, the places where a skill bound to an app tells the AI to write the
 *   app's keys with aimeat_memory_write and does not say owner_scope.
 *
 *   WHY. An agent's memory write lands in the agent's own namespace unless it says owner_scope: true,
 *   and the app keeps those keys in the owner's memory, so an agent that follows the guide saves data
 *   the app does not show. The guide is where the agent learns the call, so the publish answer is
 *   where its author hears about it.
 *
 *   WHAT IT READS. Each Markdown file in paragraphs (text between blank lines). A paragraph that names
 *   aimeat_memory_write and one of the app's key prefixes (services/app/declared-key-prefixes.ts:
 *   `apps.<id>.` and the data map rows kept in the owner's memory) and does not say owner_scope is a
 *   finding. A file that says owner_scope in a paragraph of its own, with no write call in it, states
 *   the rule once for the whole file, and its calls are not named.
 *
 *   WHAT IT DOES NOT DO. It refuses nothing: the answer names the places and the publish stands, as
 *   toolFieldIssues does (skill/tool-fields.ts).
 * @structure SkillOwnerScopeIssue · ownerScopeIssuesIn(fileTexts, prefixes, app) · skillOwnerScopeIssues(storage, config, binding, fileTexts)
 * @usage summary.ownerScopeIssues = await skillOwnerScopeIssues(storage, config, storedBinding, fileTexts);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appKeyPrefixes } from '../app/declared-key-prefixes.js';
import { logger } from '../../utils/logger.js';

/** One place a bound skill writes the app's keys with aimeat_memory_write and no owner_scope. */
export interface SkillOwnerScopeIssue {
  path: string;
  prefix: string;
  message: string;
}

const MAX_ISSUES = 20;
const WRITE_TOOL = 'aimeat_memory_write';
const OWNER_SCOPE = /\bowner_scope\b/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The places in `fileTexts` where the app's keys are written without owner_scope. Pure. */
export function ownerScopeIssuesIn(fileTexts: Record<string, string>, prefixes: string[], app: string): SkillOwnerScopeIssue[] {
  const issues: SkillOwnerScopeIssue[] = [];
  const patterns = prefixes.map(prefix => ({ prefix, re: new RegExp(`(?:^|[^A-Za-z0-9_.])${escapeRe(prefix)}`) }));
  for (const [path, text] of Object.entries(fileTexts)) {
    if (!/\.md$/i.test(path) || typeof text !== 'string' || !text.includes(WRITE_TOOL)) continue;
    const paragraphs = text.split(/\r?\n[ \t]*\r?\n/);
    // A rule stated once, in a paragraph that makes no call, covers every call in the file.
    if (paragraphs.some(p => OWNER_SCOPE.test(p) && !p.includes(WRITE_TOOL))) continue;
    for (const paragraph of paragraphs) {
      if (!paragraph.includes(WRITE_TOOL) || OWNER_SCOPE.test(paragraph)) continue;
      const hit = patterns.filter(p => p.re.test(paragraph)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (!hit) continue;
      issues.push({
        path, prefix: hit.prefix,
        message: `${path} tells the AI to write "${hit.prefix}" keys with ${WRITE_TOOL} without owner_scope. `
          + `The app ${app} keeps them in the owner's memory, and an agent's write without owner_scope goes to `
          + 'the agent\'s own namespace, where the app does not read it. Add `owner_scope: true` to the call '
          + '(the agent needs memory:write-as-owner, which the owner grants per agent).',
      });
      if (issues.length >= MAX_ISSUES) return issues;
    }
  }
  return issues;
}

/** The issues for a skill whose binding is `app:<owner>/<filename>`; none for any other skill. */
export async function skillOwnerScopeIssues(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, binding: string | undefined, fileTexts: Record<string, string>,
): Promise<SkillOwnerScopeIssue[]> {
  const m = typeof binding === 'string' ? /^app:([^/]+)\/(.+)$/.exec(binding) : null;
  if (!m) return [];
  if (!Object.values(fileTexts).some(t => typeof t === 'string' && t.includes(WRITE_TOOL))) return [];
  const [, owner, filename] = m;
  try {
    const prefixes = await appKeyPrefixes(storage, owner.includes('@') ? owner : `${owner}@${config.nodeId}`, filename);
    return ownerScopeIssuesIn(fileTexts, prefixes, filename);
  } catch (err) {
    // The check is advice on a publish that stands; a failed read leaves it out and says so in the log.
    logger.warn('skill owner_scope check: the app data map was not read', { binding, error: String(err) });
    return [];
  }
}
