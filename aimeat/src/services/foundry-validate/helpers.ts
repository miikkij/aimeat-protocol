/**
 * @file src/services/foundry-validate/helpers.ts
 * @description Shared text/YAML/JSON helpers and the universal anti-pattern scanner used by the foundry component validators. Extracted from src/services/foundry-validate.ts to satisfy max-file-lines.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences
 *   - sanitizeJson / preCleanYaml: text cleanup before parsing
 *   - tryParseYaml(text): real-yaml parse with fallback strategies
 *   - validateAntiPatterns(type, code): universal crash-prevention checks
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/services/foundry-validate.ts (max-file-lines)
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AntiPatternResult } from './types.js';

/* ── Helpers ─────────────────────────────────────────── */

export function extractCodeBlock(text: string, lang: string): string {
  const regex = new RegExp('```' + (lang || '') + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

/**
 * Sanitize JSON string from common AI/markdown artifacts before parsing.
 */
export function sanitizeJson(text: string): string {
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
 */
function preCleanYaml(text: string): string {
  if (typeof text !== 'string') return text;
  let s = text;
  // Remove markdown-escaped chars that aren't valid YAML
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  // Remove zero-width unicode
  s = s.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');
  return s;
}

/* ── YAML Parse ──────────────────────────────────────── */

interface ParseResult {
  parsed: Record<string, unknown> | null;
  errors: string[];
  cleaned: string;
}

/**
 * Parse YAML using the real yaml library with multiple fallback strategies.
 * 1. Try parsing as-is (after minimal pre-clean)
 * 2. If that fails, try with bullet-list fix
 * 3. Return { parsed, errors, cleaned } where cleaned is the canonical YAML
 *    re-serialized by the yaml library (no regex hacks)
 */
export function tryParseYaml(text: string): ParseResult {
  const errors: string[] = [];
  if (!text || typeof text !== 'string') {
    errors.push('Result is empty');
    return { errors, parsed: null, cleaned: text };
  }

  const preCleaned = preCleanYaml(text);

  // Attempt 1: strict parse
  try {
    const parsed = parseYaml(preCleaned) as Record<string, unknown>;
    // Re-serialize through the real yaml library → guaranteed clean output
    const cleaned = stringifyYaml(parsed, { lineWidth: 0 });
    return { errors, parsed, cleaned };
  } catch (e1) {
    // Attempt 2: try stripping markdown bullets `* ` → `- ` and retry
    const firstError = e1 instanceof Error ? e1 : new Error(String(e1));
    let fixed = preCleaned;
    fixed = fixed.replace(/^(\s*)\*\s{2,}/gm, '$1- ');
    fixed = fixed.replace(/^(\s*)\*\s+(?=\S)/gm, '$1- ');
    try {
      const parsed = parseYaml(fixed) as Record<string, unknown>;
      const cleaned = stringifyYaml(parsed, { lineWidth: 0 });
      return { errors, parsed, cleaned };
    } catch {
      // Both attempts failed — report the original error
      errors.push(`YAML parse error: ${firstError.message}`);
      return { errors, parsed: null, cleaned: preCleaned };
    }
  }
}

/* ── Anti-Pattern Validation ─────────────────────────── */

/**
 * Scan generated code for universal anti-patterns that always indicate bugs.
 * Returns { warnings: string[], errors: string[] }
 * - errors: patterns that will definitely crash (block install)
 * - warnings: patterns that are suspicious (show warning, allow install)
 */
export function validateAntiPatterns(type: string, code: string): AntiPatternResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!code || typeof code !== 'string') return { errors, warnings };

  // === Extension-specific anti-patterns ===
  if (type === 'extension') {
    // JSON.parse on memory.get — always crashes with "undefined is not valid JSON"
    if (/JSON\.parse\s*\(\s*(await\s+)?ctx\.memory\.get/i.test(code)) {
      errors.push('CRASH: JSON.parse(ctx.memory.get(...)) — memory.get() already returns parsed values. Remove JSON.parse().');
    }
    // JSON.parse wrapping a variable that came from memory.get
    if (/=\s*(await\s+)?ctx\.memory\.get\s*\([^)]+\)\s*;[\s\S]{0,100}JSON\.parse\s*\(\s*\w+\s*\)/m.test(code)) {
      warnings.push('Suspicious: variable from ctx.memory.get() passed to JSON.parse() — memory values are already parsed.');
    }
    // require() — not available in sandbox
    if (/\brequire\s*\(/m.test(code)) {
      errors.push('CRASH: require() is not available in the sandbox. All code must be self-contained.');
    }
    // import ... from (but allow export default)
    if (/\bimport\s+.+\s+from\s+/m.test(code)) {
      errors.push('CRASH: import...from is not available in the sandbox. Only "export default" is allowed.');
    }
    // global fetch() without ctx prefix
    if (/(?<!ctx\.)fetch\s*\(/m.test(code) && !/function\s+fetch/m.test(code)) {
      warnings.push('Suspicious: fetch() called without ctx prefix — use ctx.fetch() in the sandbox. Global fetch is not available.');
    }
    // console.log — not available
    if (/\bconsole\.(log|warn|error|info)\s*\(/m.test(code)) {
      warnings.push('console.log is not available in the sandbox. Use ctx.log.info/warn/error() instead.');
    }
    // setTimeout/setInterval — not available
    if (/\b(setTimeout|setInterval|setImmediate)\s*\(/m.test(code)) {
      errors.push('CRASH: setTimeout/setInterval/setImmediate are not available in the sandbox.');
    }
  }

  // === HTML entity corruption (any type) ===
  // These appear when AI retries render HTML entities in code
  if (/&gt;|&lt;|&amp;(?!amp;)|&quot;/.test(code)) {
    const codeLines = code.split('\n');
    const entityLines = codeLines.filter(line => {
      // Skip lines that are clearly HTML text content
      if (/^\s*<[^>]+>[^<]*&/.test(line)) return false;
      // Skip lines where entities appear only inside string literals (e.g., .replace(/&amp;/g, "&"))
      // Strip quoted strings and regex literals before checking for entities
      const stripped = line
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')         // remove double-quoted strings
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")          // remove single-quoted strings
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')          // remove template literals
        .replace(/\/(?:[^/\\]|\\.)+\/[gimsuy]*/g, '//'); // remove regex literals
      if (!/&gt;|&lt;|&amp;[a-z]|&quot;/.test(stripped)) return false;
      // Flag lines with entities in code context
      return /[=(){}[\];]/.test(line);
    });
    if (entityLines.length > 0) {
      errors.push(`HTML entities found in code (${entityLines.length} lines) — use => not =&gt;, && not &amp;&amp;, etc. This crashes the sandbox.`);
    }
  }

  // === Translation anti-patterns ===
  if (type === 'translation') {
    try {
      const parsed = JSON.parse(code) as Record<string, Record<string, string>>;
      if (parsed.en && !parsed.fi && Object.values(parsed.en).some(v => /[äöåÄÖÅ]/.test(String(v)))) {
        warnings.push('Suspicious: "en" locale contains Finnish characters (ä, ö, å) — check if root key should be "fi".');
      }
      if (parsed.fi && Object.values(parsed.fi).every(v => !/[äöåÄÖÅ]/.test(String(v)))) {
        warnings.push('Suspicious: "fi" locale has no Finnish characters (ä, ö, å) — may contain English text under wrong locale key.');
      }
    } catch { /* not valid JSON, other validators will catch this */ }
  }

  return { errors, warnings };
}
