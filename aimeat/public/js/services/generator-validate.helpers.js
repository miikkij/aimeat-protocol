/**
 * @file public/js/services/generator-validate.helpers.js
 * @description Text/JSON/YAML extraction + sanitization + parse helpers shared by the
 *   generator validators. Extracted from generator-validate.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-validate.js (max-file-lines)
 */
import { parse as parseYaml, stringify as stringifyYaml } from '../../lib/yaml.mjs';

/* ── Helpers ─────────────────────────────────────────── */

export function extractCodeBlock(text, lang) {
  const regex = new RegExp('```' + (lang || '') + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

/**
 * Sanitize JSON string from common AI/markdown artifacts before parsing.
 */
export function sanitizeJson(text) {
  let s = text;
  // Strip markdown backslash escaping: \[ \] \{ \} \( \) \* \_ \` \| \~ \#
  s = s.replace(/\\([[\]{}()*_`|~#])/g, '$1');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');
  return s;
}

/**
 * Minimal text-level cleanup applied BEFORE YAML parsing.
 * Only fixes characters that prevent the parser from running at all.
 * No structural changes — the real yaml parser handles block scalars,
 * multiline strings, etc. correctly on its own.
 */
export function preCleanYaml(text) {
  if (typeof text !== 'string') return text;
  let s = text;
  // Remove markdown-escaped chars that aren't valid YAML
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  // Remove zero-width unicode
  s = s.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');
  // Fix common AI mistake: action list items missing "id:" key
  // e.g. "  - refreshQuotes\n    description:" → "  - id: refreshQuotes\n    description:"
  // Only match lines under "actions:" where the list item is a bare word followed by description on next line
  s = s.replace(/^(\s+- )([a-zA-Z][\w-]*)\n(\s+description:)/gm, '$1id: $2\n$3');
  return s;
}

/* ── YAML Parse ──────────────────────────────────────── */

/**
 * Parse YAML using the real yaml library with multiple fallback strategies.
 * 1. Try parsing as-is (after minimal pre-clean)
 * 2. If that fails, try with yaml library's more tolerant options
 * 3. Return { parsed, errors, cleaned } where cleaned is the canonical YAML
 *    re-serialized by the yaml library (no regex hacks)
 */
export function tryParseYaml(text) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    errors.push('Result is empty');
    return { errors, parsed: null, cleaned: text };
  }

  const preCleaned = preCleanYaml(text);

  // Attempt 1: strict parse
  try {
    const parsed = parseYaml(preCleaned);
    // Re-serialize through the real yaml library → guaranteed clean output
    const cleaned = stringifyYaml(parsed, { lineWidth: 0 });
    return { errors, parsed, cleaned };
  } catch (_e1) {
    // Attempt 2: try stripping markdown bullets `* ` → `- ` and retry
    let fixed = preCleaned;
    fixed = fixed.replace(/^(\s*)\*\s{2,}/gm, '$1- ');
    fixed = fixed.replace(/^(\s*)\*\s+(?=\S)/gm, '$1- ');
    try {
      const parsed = parseYaml(fixed);
      const cleaned = stringifyYaml(parsed, { lineWidth: 0 });
      return { errors, parsed, cleaned };
    } catch {
      // Both attempts failed — report the original error
      errors.push(`YAML parse error: ${_e1.message}`);
      return { errors, parsed: null, cleaned: preCleaned };
    }
  }
}
