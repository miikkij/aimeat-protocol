/**
 * @file src/services/generator-prompts/validate-anti-patterns.ts
 * @description Anti-pattern scanner for generated code — universal bug patterns
 *   (sandbox-forbidden APIs, HTML-entity corruption, translation locale mixups) split
 *   into blocking errors vs. warnings. Extracted from validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from validate.ts (max-file-lines)
 */

import type { AntiPatternResult } from './validate-shared.js';

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
    // Web APIs — not available in the sandbox (not Node.js, not browser)
    if (/\bnew\s+URLSearchParams\b/m.test(code)) {
      errors.push('CRASH: URLSearchParams is not available in the sandbox. Use string concatenation with encodeURIComponent() instead.');
    }
    if (/\bnew\s+URL\s*\(/m.test(code)) {
      errors.push('CRASH: URL constructor is not available in the sandbox. Use string concatenation instead.');
    }
    if (/\bnew\s+(TextEncoder|TextDecoder)\s*\(/m.test(code)) {
      errors.push('CRASH: TextEncoder/TextDecoder are not available in the sandbox.');
    }
    if (/\bnew\s+(Headers|Request|Response|FormData|Blob|AbortController)\s*\(/m.test(code)) {
      errors.push('CRASH: Web API constructors (Headers, Request, Response, FormData, Blob, AbortController) are not available in the sandbox.');
    }
    if (/\b(atob|btoa)\s*\(/m.test(code)) {
      errors.push('CRASH: atob/btoa are not available in the sandbox.');
    }
    if (/\bstructuredClone\s*\(/m.test(code)) {
      errors.push('CRASH: structuredClone is not available in the sandbox. Use JSON.parse(JSON.stringify(obj)) instead.');
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
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')       // remove double-quoted strings
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")        // remove single-quoted strings
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')        // remove template literals
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
      const parsed = JSON.parse(code) as Record<string, Record<string, unknown>>;
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
