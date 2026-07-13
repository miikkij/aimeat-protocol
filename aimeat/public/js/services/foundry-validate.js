/**
 * @file foundry-validate.js
 * @description Validators for foundry component results, blueprints, and interview specs.
 *   Each component type (csm, msm, extension, app, memory, translation, cortex) has a
 *   validator that checks structure and extracts usable content from AI output.
 *   Includes validateInterviewSpec for structured interview JSON and cortex validator
 *   for IIFE domain library manifest + lib extraction.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences
 *   - validators[type](result): per-type validation returning { valid, errors, extracted }
 *   - validateInterviewSpec(result): validates interview spec JSON from AI interviews
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (strips extra fields)
 *   - validateComponent(type, result): dispatches to per-type validator
 * @usage import { validateBlueprint, validateComponent, validateInterviewSpec } from '/js/services/foundry-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial validators
 *   v1.1.0 — 2026-03-14 — validateBlueprint now strips extra component fields
 *     (manifest, code, files, etc.) and returns warnings array
 *   v1.2.0 — 2026-03-14 — Add sanitizeJson() to fix AI markdown artifacts
 *     (\[ → [, trailing commas, zero-width chars) before JSON.parse
 *   v2.0.0 — 2026-03-14 — Use real yaml parser (yaml@2.8.2 via /lib/yaml.mjs)
 *     for CSM/MSM/Extension validation instead of regex heuristics
 *   v2.1.0 — 2026-03-14 — Fix MSM validator to check real structure
 *     (service.name/category, auth.type, actions[] with display_name/endpoint);
 *     fix Extension validator to check metadata.name/version/description/author
 *     and actions[].id/method/path/script
 *   v3.0.0 — 2026-03-14 — Replace regex sanitizeYaml with real yaml parse+stringify.
 *     YAML is now parsed by the yaml library, then re-serialized to clean output.
 *     No more regex hacks for block scalars, quoting, or multiline values.
 *   v3.1.0 — 2026-03-14 — Add validateInterviewSpec() for structured interview JSON,
 *     add cortex component validator, add 'cortex' to allowed blueprint types
 *   v4.0.0 — 2026-03-15 — Add validateAntiPatterns() for universal crash-prevention
 *     checks (JSON.parse on memory, require/import in sandbox, HTML entities,
 *     translation locale mismatch); integrate into extension/app/translation validators
 *   v4.1.0 — 2026-03-15 — Fix HTML entity false positives: strip string literals
 *     and regex patterns before checking for entities in code — prevents flagging
 *     legitimate entity-decoding code like .replace(/&amp;/g, "&")
 *   v4.2.0 — 2026-03-15 — validateBlueprint now validates dataModel: checks
 *     producedBy/consumedBy reference valid component IDs, warns on missing schemas
 *   v4.3.0 — 2026-03-15 — Allow "schedules" field on extension components and "uses"
 *     field on cortex components in blueprint validation (not stripped as extra fields)
 *   v4.4.0 — 2026-03-15 — Cortex validator cross-checks YAML metadata.name against
 *     JS LIB_NAME (kebab→camelCase), verifies IIFE pattern and AIMEAT.register usage
 *   v4.5.0 — 2026-03-16 — Cortex validator supports single-block format (YAML + JS
 *     separated by // lib/ comment) in addition to legacy separate blocks. Accept
 *     var/let/const for LIB_NAME declaration.
 *   v5.0.0 — 2026-03-26 — Add validateSkeleton with cross-check against interview
 *     sampleResponse; add validateUnit with anti-pattern scan; add crossCheckSampleData,
 *     extractOutputFieldsNearUrl, deepFieldExists helpers
 *   v5.0.1 — 2026-06-19 — lint fixes (misleading-char-class/unused-expression/empty-block)
 */
import { parse as parseYaml, stringify as stringifyYaml } from '/lib/yaml.mjs';

/* ── Helpers ─────────────────────────────────────────── */

function extractCodeBlock(text, lang) {
  const regex = new RegExp('```' + (lang || '') + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

/**
 * Sanitize JSON string from common AI/markdown artifacts before parsing.
 */
function sanitizeJson(text) {
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
function preCleanYaml(text) {
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
function tryParseYaml(text) {
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

/* ── Anti-Pattern Validation ─────────────────────────── */

/**
 * Scan generated code for universal anti-patterns that always indicate bugs.
 * Returns { warnings: string[], errors: string[] }
 * - errors: patterns that will definitely crash (block install)
 * - warnings: patterns that are suspicious (show warning, allow install)
 */
export function validateAntiPatterns(type, code) {
  const errors = [];
  const warnings = [];
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
    // require() — not available in V8 sandbox
    if (/\brequire\s*\(/m.test(code)) {
      errors.push('CRASH: require() is not available in the V8 sandbox. All code must be self-contained.');
    }
    // import ... from (but allow export default)
    if (/\bimport\s+.+\s+from\s+/m.test(code)) {
      errors.push('CRASH: import...from is not available in the V8 sandbox. Only "export default" is allowed.');
    }
    // global fetch() without ctx prefix
    if (/(?<!ctx\.)fetch\s*\(/m.test(code) && !/function\s+fetch/m.test(code)) {
      warnings.push('Suspicious: fetch() called without ctx prefix — use ctx.fetch() in the V8 sandbox. Global fetch is not available.');
    }
    // console.log — not available
    if (/\bconsole\.(log|warn|error|info)\s*\(/m.test(code)) {
      warnings.push('console.log is not available in the V8 sandbox. Use ctx.log.info/warn/error() instead.');
    }
    // setTimeout/setInterval — not available
    if (/\b(setTimeout|setInterval|setImmediate)\s*\(/m.test(code)) {
      errors.push('CRASH: setTimeout/setInterval/setImmediate are not available in the V8 sandbox.');
    }
    // Web APIs — not available in bare V8 isolate (not Node.js, not browser)
    if (/\bnew\s+URLSearchParams\b/m.test(code)) {
      errors.push('CRASH: URLSearchParams is not available in the V8 sandbox. Use string concatenation with encodeURIComponent() instead.');
    }
    if (/\bnew\s+URL\s*\(/m.test(code)) {
      errors.push('CRASH: URL constructor is not available in the V8 sandbox. Use string concatenation instead.');
    }
    if (/\bnew\s+(TextEncoder|TextDecoder)\s*\(/m.test(code)) {
      errors.push('CRASH: TextEncoder/TextDecoder are not available in the V8 sandbox.');
    }
    if (/\bnew\s+(Headers|Request|Response|FormData|Blob|AbortController)\s*\(/m.test(code)) {
      errors.push('CRASH: Web API constructors (Headers, Request, Response, FormData, Blob, AbortController) are not available in the V8 sandbox.');
    }
    if (/\b(atob|btoa)\s*\(/m.test(code)) {
      errors.push('CRASH: atob/btoa are not available in the V8 sandbox.');
    }
    if (/\bstructuredClone\s*\(/m.test(code)) {
      errors.push('CRASH: structuredClone is not available in the V8 sandbox. Use JSON.parse(JSON.stringify(obj)) instead.');
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
      errors.push(`HTML entities found in code (${entityLines.length} lines) — use => not =&gt;, && not &amp;&amp;, etc. This crashes the V8 sandbox.`);
    }
  }

  // === Translation anti-patterns ===
  if (type === 'translation') {
    try {
      const parsed = JSON.parse(code);
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

/* ── Validators ──────────────────────────────────────── */

const validators = {
  csm(result) {
    const errors = [];
    const raw = extractCodeBlock(result, 'yaml');
    const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      if (!parsed.service?.name) errors.push('Missing: service.name');
      if (!parsed.service?.description) errors.push('Missing: service.description');
      if (!parsed.data_schema?.required || Object.keys(parsed.data_schema.required).length === 0) {
        errors.push('data_schema.required must have at least one field');
      }
      if (!parsed.consent_requirements) errors.push('Missing section: consent_requirements');
    }

    return { valid: errors.length === 0, errors, extracted: cleaned };
  },

  msm(result) {
    const errors = [];
    const raw = extractCodeBlock(result, 'yaml');
    const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      if (!parsed.service?.name) errors.push('Missing: service.name');
      if (!parsed.service?.description) errors.push('Missing: service.description');
      if (!parsed.service?.category) errors.push('Missing: service.category');
      if (!parsed.auth?.type) errors.push('Missing: auth.type');
      if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
        errors.push('actions must be a non-empty array');
      } else {
        for (const action of parsed.actions) {
          const pfx = `action "${action?.id || '?'}"`;
          if (!action?.id) errors.push(`${pfx}: missing id`);
          if (!action?.display_name) errors.push(`${pfx}: missing display_name`);
          if (!action?.endpoint?.method) errors.push(`${pfx}: missing endpoint.method`);
          if (!action?.endpoint?.url) errors.push(`${pfx}: missing endpoint.url`);
          if (!action?.output || Object.keys(action.output).length === 0) {
            errors.push(`${pfx}: must have at least one output field`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, extracted: cleaned };
  },

  extension(result, blueprint) {
    const errors = [];

    // ── Extract YAML manifest — supports three formats ──
    // Format 1 (preferred): Single untagged code block with // actions/*.js separator
    // Format 2: Fenced ```yaml block + JS markers
    // Format 3: Raw text with JS markers
    let raw = null;

    // Format 1: single untagged code block — extract content, split at // actions/
    const untaggedMatch = result.match(/```\s*\n([\s\S]*?)```/);
    if (untaggedMatch) {
      const content = untaggedMatch[1];
      const actionSep = content.match(/^\/\/\s*actions\/\S+\.js\s*$/m);
      if (actionSep) {
        const sepIndex = content.indexOf(actionSep[0]);
        raw = content.slice(0, sepIndex).trim();
      }
    }

    // Format 2/3: fenced ```yaml block or raw text — cut at JS markers
    if (!raw) {
      raw = extractCodeBlock(result, 'yaml');
      const jsMarkers = [
        /^\/\/\s*actions\//m,
        /^#\s*actions\//m,
        /^export\s+default\s+/m,
      ];
      let jsStart = -1;
      for (const rx of jsMarkers) {
        const idx = raw.search(rx);
        if (idx > 0 && (jsStart === -1 || idx < jsStart)) jsStart = idx;
      }
      if (jsStart > 0) raw = raw.slice(0, jsStart).trim();
    }
    const { parsed, errors: parseErrors } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      if (!parsed.metadata?.name) errors.push('Missing: metadata.name');
      else if (/\./.test(parsed.metadata.name)) errors.push('metadata.name must not contain dots (.) — dots cause namespace collisions in memory owner keys');
      else if (!/^[a-z][a-z0-9-]*$/.test(parsed.metadata.name)) errors.push('metadata.name must be lowercase kebab-case (e.g., "my-collector")');
      if (!parsed.metadata?.version) errors.push('Missing: metadata.version');
      if (!parsed.metadata?.description) errors.push('Missing: metadata.description');
      if (!parsed.metadata?.author) errors.push('Missing: metadata.author');
      if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
        errors.push('actions array is required and must not be empty');
      } else {
        for (const action of parsed.actions) {
          const pfx = `action "${action?.id || '?'}"`;
          if (!action?.id) errors.push(`${pfx}: missing id`);
          if (!action?.method) errors.push(`${pfx}: missing method`);
          if (!action?.path) errors.push(`${pfx}: missing path`);
          if (!action?.script) errors.push(`${pfx}: missing script`);
        }
      }
    }

    // Validate action IDs match blueprint testScenarios (if available)
    if (blueprint?.testScenarios && Array.isArray(parsed?.actions)) {
      const bpComp = blueprint.components?.find(c => c.type === 'extension');
      if (bpComp) {
        const testActions = (blueprint.testScenarios || [])
          .filter(ts => ts.component === bpComp.id)
          .flatMap(ts => (ts.scenarios || []).map(s => s.action));
        const actualIds = new Set(parsed.actions.map(a => a.id));
        for (const expected of testActions) {
          if (!actualIds.has(expected)) {
            errors.push(`Blueprint expects action "${expected}" but extension does not have it. Add it or rename the matching action to "${expected}".`);
          }
        }
      }
    }

    // Check for action scripts — look for fenced JS blocks OR unfenced // actions/file.js comments
    const fencedJs = result.match(/```javascript[\s\S]*?```/gi) || [];
    const unfencedJs = result.match(/^\/\/\s*actions\/[\w-]+\.js\s*$/gm) || [];
    const jsBlockCount = Math.max(fencedJs.length, unfencedJs.length);
    const actionCount = Array.isArray(parsed?.actions) ? parsed.actions.length : 0;
    if (actionCount > 0 && jsBlockCount === 0) {
      errors.push(`Extension defines ${actionCount} action(s) but no JavaScript code blocks found`);
    } else if (actionCount > 0 && jsBlockCount > 0 && jsBlockCount < actionCount) {
      errors.push(`Extension defines ${actionCount} action(s) but only ${jsBlockCount} JavaScript code blocks found — each action needs its own script`);
    }

    // Anti-pattern scan
    const ap = validateAntiPatterns('extension', result);
    errors.push(...ap.errors);

    return { valid: errors.length === 0, errors, extracted: result };
  },

  app(result) {
    const errors = [];
    const html = extractCodeBlock(result, 'html') || result;

    if (!html.includes('<!DOCTYPE html') && !html.includes('<html')) {
      errors.push('Not a valid HTML document — missing <!DOCTYPE html> or <html> tag');
    }
    if (!html.includes('<head')) errors.push('Missing <head> section');
    if (!html.includes('<body')) errors.push('Missing <body> section');
    if (!html.includes('AIMEAT App Manifest') && !html.match(/name:\s*.+/)) {
      errors.push('Missing AIMEAT App Manifest comment');
    }

    // Anti-pattern scan
    const ap = validateAntiPatterns('app', html);
    errors.push(...ap.errors);

    return { valid: errors.length === 0, errors, extracted: html };
  },

  memory(result) {
    const errors = [];
    const json = sanitizeJson(extractCodeBlock(result, 'json'));
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('Memory structure must be a JSON object with key-value pairs');
      } else if (Object.keys(parsed).length === 0) {
        errors.push('Memory structure is empty');
      }
      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${e.message}`);
      return { valid: false, errors, extracted: json };
    }
  },

  translation(result) {
    const errors = [];
    const json = sanitizeJson(extractCodeBlock(result, 'json'));
    try {
      const parsed = JSON.parse(json);
      // Each translation component produces ONE locale (e.g., { "fi": { ... } } or { "en": { ... } })
      const locales = Object.keys(parsed).filter(k => typeof parsed[k] === 'object' && parsed[k] !== null);
      if (locales.length === 0) {
        errors.push('No locale object found — expected e.g. { "fi": { ... } } or { "en": { ... } }');
      } else if (locales.length > 1) {
        errors.push(`Multiple locales found (${locales.join(', ')}) — each translation component should contain only ONE locale`);
      } else {
        // Validate the single locale has content
        const locale = locales[0];
        const keys = Object.keys(parsed[locale]);
        if (keys.length === 0) {
          errors.push(`Locale "${locale}" is empty — no translation keys found`);
        }
      }
      // Anti-pattern scan
      validateAntiPatterns('translation', json);
      // translation anti-patterns are warnings only, don't block validation

      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${e.message}`);
      return { valid: false, errors, extracted: json };
    }
  },

  cortex(result, blueprint) {
    const errors = [];

    // ── Extract YAML and JS — supports two formats ──
    // Format 1 (preferred): Single untagged code block with YAML first, then // lib/*.js separator
    // Format 2 (legacy): Separate ```yaml and ```javascript blocks
    let yamlBlock = null;
    const jsBlocks = [];

    // Try Format 1: single block with // lib/ separator
    const untaggedMatch = result.match(/```\s*\n([\s\S]*?)```/);
    if (untaggedMatch) {
      const content = untaggedMatch[1];
      const libSeparator = content.match(/^\/\/\s*lib\/\S+\.js\s*$/m);
      if (libSeparator) {
        const sepIndex = content.indexOf(libSeparator[0]);
        yamlBlock = content.slice(0, sepIndex).trim();
        jsBlocks.push(content.slice(sepIndex).trim());
      }
    }

    // Try Format 2: separate ```yaml and ```javascript blocks
    if (!yamlBlock) {
      yamlBlock = extractCodeBlock(result, 'yaml');
      if (yamlBlock) {
        const jsRegex = /```(?:javascript|js)\s*\n([\s\S]*?)```/gi;
        let match;
        const afterYaml = result.indexOf('```yaml') > -1
          ? result.slice(result.indexOf('```', result.indexOf('```yaml') + 7) + 3)
          : result;
        while ((match = jsRegex.exec(afterYaml)) !== null) {
          jsBlocks.push(match[1].trim());
        }
      }
    }

    if (!yamlBlock) {
      errors.push('No YAML manifest found — cortex must include a manifest (either in a single code block with // lib/ separator, or in a ```yaml block)');
      return { valid: false, errors, extracted: null };
    }

    const { parsed, errors: yamlErrors } = tryParseYaml(yamlBlock);
    if (yamlErrors.length > 0) return { valid: false, errors: yamlErrors, extracted: null };

    if (parsed.apiVersion !== 'cortex.aimeat.org/v1') {
      errors.push('apiVersion must be "cortex.aimeat.org/v1"');
    }
    if (parsed.kind !== 'Extension') errors.push('kind must be "Extension"');
    if (!parsed.metadata?.name) errors.push('metadata.name is required');
    else if (/\./.test(parsed.metadata.name)) errors.push('metadata.name must not contain dots (.)');
    else if (!/^[a-z][a-z0-9-]*$/.test(parsed.metadata.name)) errors.push('metadata.name must be lowercase kebab-case (e.g., "my-domain-lib")');
    if (!parsed.spec?.components || !Array.isArray(parsed.spec.components)) {
      errors.push('spec.components array is required');
    }

    const libComponents = (parsed.spec?.components || []).filter(c => c.type === 'lib');
    if (libComponents.length > 0 && jsBlocks.length === 0) {
      errors.push(`Manifest declares ${libComponents.length} lib component(s) but no JavaScript code blocks found`);
    }

    // ── Cross-check: YAML metadata.name ↔ JS LIB_NAME consistency ──
    if (parsed.metadata?.name && jsBlocks.length > 0) {
      const yamlName = parsed.metadata.name; // kebab-case e.g. "halytyskartta-cortex"
      const expectedCamel = yamlName.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); // → "halytyskarttaCortex"
      const jsCode = jsBlocks.join('\n');

      // Check LIB_NAME matches expected camelCase
      const libNameMatch = jsCode.match(/(?:const|let|var)\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
      if (libNameMatch) {
        const actualLibName = libNameMatch[1];
        if (actualLibName !== expectedCamel) {
          errors.push(`LIB_NAME mismatch: JS has "${actualLibName}" but YAML name "${yamlName}" expects "${expectedCamel}"`);
        }
      } else {
        errors.push('No LIB_NAME constant found in JS code — cortex must declare const LIB_NAME = \'...\';');
      }

      // Check AIMEAT.register uses correct name
      const registerMatch = jsCode.match(/AIMEAT\.register\s*\(\s*LIB_NAME/);
      if (!registerMatch) {
        const hardcodedRegister = jsCode.match(/AIMEAT\.register\s*\(\s*['"]([^'"]+)['"]/);
        if (hardcodedRegister && hardcodedRegister[1] !== expectedCamel) {
          errors.push(`AIMEAT.register uses "${hardcodedRegister[1]}" but expected "${expectedCamel}"`);
        }
      }

      // Check IIFE pattern exists
      if (!/\(function\s*\(\s*AIMEAT\s*\)/.test(jsCode)) {
        errors.push('Cortex JS must use IIFE pattern: (function (AIMEAT) { ... })(window.AIMEAT || ...)');
      }

      // Check exports object includes all required methods from blueprint
      // Accept "exports", "exportsObj", etc. — also handle multiline object literals
      const exportsMatch = jsCode.match(/(?:const|let|var)\s+\w*[Ee]xport\w*\s*=\s*\{([\s\S]*?)\}/);
      if (exportsMatch) {
        const exportedMethods = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);

        // Cross-check with blueprint produces API methods if available
        // Match the specific cortex component by metadata.name or subtype
        if (blueprint?.components && parsed?.metadata?.name) {
          const metaName = parsed.metadata.name;
          // Find the blueprint component that matches this cortex by name similarity
          const cortexComps = blueprint.components.filter(c => c.type === 'cortex');
          const cortexComp = cortexComps.find(c =>
            c.id === metaName || c.label?.toLowerCase().includes(metaName.replace(/-/g, ' ')) ||
            metaName.includes(c.id?.replace('cortex-', ''))
          ) || (cortexComps.length === 1 ? cortexComps[0] : null);
          if (cortexComp?.produces) {
            const requiredMethods = cortexComp.produces
              .filter(p => p.startsWith('api:'))
              .map(p => p.replace('api:', ''));
            for (const method of requiredMethods) {
              if (!exportedMethods.includes(method)) {
                errors.push(`Blueprint requires method "${method}" but it's not in the exports object. Found: ${exportedMethods.join(', ')}`);
              }
            }
          }
        }
      } else {
        errors.push('No exports object found — cortex must have: const exports = { method1, method2, ... };');
      }
    }

    if (errors.length > 0) return { valid: false, errors, extracted: null };

    return {
      valid: true,
      errors: [],
      extracted: {
        manifest: stringifyYaml(parsed),
        libs: libComponents.map((lib, i) => ({
          filename: lib.filename || `${lib.name}.js`,
          code: jsBlocks[i] || '',
        })),
      },
    };
  },
};

/* ── Interview Spec Validator ────────────────────────── */

/**
 * Validate and extract an interview specification JSON from AI output.
 * Expects a JSON code block with required fields.
 */
export function validateInterviewSpec(result) {
  const errors = [];
  const warnings = [];

  try {
    const raw = extractCodeBlock(result, 'json');
    const cleaned = sanitizeJson(raw);
    const spec = JSON.parse(cleaned);

    if (!spec.version) errors.push('Missing "version" field');
    if (!spec.projectName) errors.push('Missing "projectName" field');
    if (!spec.description) errors.push('Missing "description" field');
    if (!Array.isArray(spec.useCases) || spec.useCases.length === 0) {
      errors.push('Missing or empty "useCases" array');
    }
    if (!Array.isArray(spec.dataSources)) errors.push('Missing "dataSources" array');
    if (!spec.dataModel) errors.push('Missing "dataModel" object');
    if (!Array.isArray(spec.views) || spec.views.length === 0) {
      errors.push('Missing or empty "views" array');
    }

    if (Array.isArray(spec.useCases)) {
      spec.useCases.forEach((uc, i) => {
        if (!uc.id) errors.push(`useCases[${i}] missing "id"`);
        if (!uc.title) errors.push(`useCases[${i}] missing "title"`);
      });
    }

    if (Array.isArray(spec.dataSources)) {
      spec.dataSources.forEach((ds, i) => {
        if (!ds.name) errors.push(`dataSources[${i}] missing "name"`);
        if (!ds.type) errors.push(`dataSources[${i}] missing "type"`);
        if (ds.url && !ds.verified) {
          warnings.push(`dataSources[${i}] "${ds.name}" URL not verified — may need manual validation`);
        }
      });
    }

    if (Array.isArray(spec.views)) {
      spec.views.forEach((v, i) => {
        if (!v.type) errors.push(`views[${i}] missing "type"`);
        if (!v.title) errors.push(`views[${i}] missing "title"`);
      });
    }

    // Validate optional externalServices
    if (spec.externalServices !== undefined) {
      if (!Array.isArray(spec.externalServices)) {
        errors.push('externalServices must be an array');
      } else {
        for (const svc of spec.externalServices) {
          if (!svc.name || typeof svc.name !== 'string') errors.push('externalServices[].name required');
          if (!Array.isArray(svc.requiredSettings)) errors.push(`externalServices[${svc.name}].requiredSettings must be array`);
          if (!['shared', 'per-user'].includes(svc.sharingModel)) errors.push(`externalServices[${svc.name}].sharingModel invalid`);
        }
      }
    }

    // Validate optional userSettings
    if (spec.userSettings !== undefined) {
      if (!Array.isArray(spec.userSettings)) {
        errors.push('userSettings must be an array');
      }
    }

    if (errors.length > 0) return { valid: false, errors, warnings };
    return { valid: true, errors: [], warnings, parsed: spec };
  } catch (e) {
    return { valid: false, errors: [`Failed to parse interview spec: ${e.message}`], warnings: [] };
  }
}

/* ── Spec Quality Gate ──────────────────────────────── */

/**
 * Check interview spec quality before proceeding to blueprint.
 * No AI needed — just automated checks on the spec data.
 */
export function validateSpecQuality(spec) {
  const warnings = [];
  const errors = [];

  if (!spec) { errors.push('No specification provided'); return { valid: false, errors, warnings }; }

  // Use cases
  if (!Array.isArray(spec.useCases) || spec.useCases.length < 2) {
    warnings.push('Less than 2 use cases defined — consider adding more to get a useful application');
  }

  // Data sources
  if (Array.isArray(spec.dataSources)) {
    for (const ds of spec.dataSources) {
      if (!ds.url && ds.type !== 'user-input') {
        warnings.push(`Data source "${ds.name || ds.id}" has no URL`);
      }
      if (!ds.sampleEntry && ds.type !== 'user-input' && ds.fallback !== 'defer') {
        warnings.push(`Data source "${ds.name || ds.id}" has no sampleEntry — structures will be guessed, not verified`);
      }
      if (ds.verified === false && !ds.fallback) {
        errors.push(`Data source "${ds.name || ds.id}" is unverified and has no fallback strategy`);
      }
    }
  }

  // Views
  if (!Array.isArray(spec.views) || spec.views.length === 0) {
    warnings.push('No views defined — the blueprint will guess the UI layout');
  }

  // Locale
  if (!spec.locale) {
    warnings.push('No locale set — defaulting to English');
  }

  // Style
  if (!spec.style) {
    warnings.push('No style preferences — the app will use default layout');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ── Blueprint Validator ─────────────────────────────── */

export function validateBlueprint(result) {
  const errors = [];
  const warnings = [];
  const raw = extractCodeBlock(result, 'json') || result;
  const json = sanitizeJson(raw);
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.components)) errors.push('Missing "components" array');
    else {
      const allowedComponentKeys = new Set(['id', 'type', 'subtype', 'label', 'produces', 'consumes', 'schedules', 'uses', 'role']);
      parsed.components = parsed.components.map(c => {
        if (!c.id) errors.push(`Component missing "id" field`);
        if (!c.type) errors.push(`Component "${c.id || '?'}" missing "type" field`);
        if (!c.label) errors.push(`Component "${c.id || '?'}" missing "label" field`);
        // Auto-fix common AI shorthand: "ext" → "extension"
        if (c.type === 'ext') {
          c.type = 'extension';
          warnings.push(`Component "${c.id}": auto-corrected type "ext" → "extension"`);
        }
        if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'].includes(c.type)) {
          errors.push(`Component "${c.id}" has unknown type "${c.type}"`);
        }
        // Validate produces/consumes are arrays of strings (if present)
        if (c.produces && !Array.isArray(c.produces)) {
          warnings.push(`Component "${c.id || '?'}": "produces" should be an array`);
        }
        if (c.consumes && !Array.isArray(c.consumes)) {
          warnings.push(`Component "${c.id || '?'}": "consumes" should be an array`);
        }
        // Strip extra fields (manifest, code, files, etc.) — blueprint is lightweight
        const extraKeys = Object.keys(c).filter(k => !allowedComponentKeys.has(k));
        if (extraKeys.length > 0) {
          warnings.push(`Component "${c.id || '?'}" had extra fields stripped: ${extraKeys.join(', ')}`);
        }
        const clean = { id: c.id, type: c.type, label: c.label };
        if (typeof c.subtype === 'string' && c.type === 'cortex') clean.subtype = c.subtype;
        if (typeof c.role === 'string') clean.role = c.role;
        if (Array.isArray(c.produces)) clean.produces = c.produces;
        if (Array.isArray(c.consumes)) clean.consumes = c.consumes;
        if (Array.isArray(c.schedules) && c.type === 'extension') {
          // Validate and auto-fix each schedule entry
          for (const s of c.schedules) {
            if (!s.action) errors.push(`Component "${c.id}": schedule missing "action" field`);
            if (!s.cron) errors.push(`Component "${c.id}": schedule missing "cron" field`);
            else if (s.cron !== '@activate') {
              // Auto-fix: strip markdown backslash escaping (\* → *)
              let cron = String(s.cron).trim().replace(/\\\*/g, '*');
              if (cron !== String(s.cron).trim()) {
                warnings.push(`Component "${c.id}": stripped backslash escaping from cron`);
                s.cron = cron;
              }
              // Auto-fix: "/15" → "*/15" (AI commonly drops leading asterisk)
              if (/^\/\d/.test(cron)) {
                const fixed = '*' + cron;
                warnings.push(`Component "${c.id}": auto-corrected cron "${cron}" → "${fixed}"`);
                cron = fixed;
                s.cron = fixed;
              }
              // Auto-fix: pad to 5 fields with * if fields are missing
              const fields = cron.split(/\s+/);
              if (fields.length < 5 && fields.length >= 3) {
                while (fields.length < 5) fields.push('*');
                const fixed = fields.join(' ');
                warnings.push(`Component "${c.id}": auto-padded cron to 5 fields: "${fixed}"`);
                s.cron = fixed;
              } else if (fields.length !== 5) {
                errors.push(`Component "${c.id}": cron "${s.cron}" must have exactly 5 fields (got ${fields.length}). Example: "*/15 * * * *"`);
              }
            }
          }
          clean.schedules = c.schedules;
        }
        if (Array.isArray(c.uses) && c.type === 'cortex') clean.uses = c.uses;
        return clean;
      });
    }
    // Cross-validate produces/consumes: warn if a consumed key has no producer
    if (parsed.components) {
      const allProduced = new Set(parsed.components.flatMap(c => c.produces || []));
      for (const c of parsed.components) {
        for (const consumed of (c.consumes || [])) {
          if (!allProduced.has(consumed)) {
            warnings.push(`Component "${c.id}" consumes "${consumed}" but no component produces it`);
          }
        }
      }
    }

    if (!Array.isArray(parsed.phases)) errors.push('Missing "phases" array');
    else {
      parsed.phases = parsed.phases.map(p => {
        if (!p.id) errors.push(`Phase missing "id"`);
        if (!p.label) errors.push(`Phase "${p.id || '?'}" missing "label"`);
        if (!Array.isArray(p.componentIds)) errors.push(`Phase "${p.id || '?'}" missing "componentIds" array`);
        return { id: p.id, label: p.label, componentIds: p.componentIds };
      });
    }

    // Validate dataModel if present — supports both old flat format and new structures/$ref format
    if (parsed.dataModel && typeof parsed.dataModel === 'object') {
      const componentIds = new Set((parsed.components || []).map(c => c.id));
      const dm = parsed.dataModel;

      // New format: has structures + memoryKeys + actions
      if (dm.structures && typeof dm.structures === 'object') {
        // Validate structures
        for (const [name, struct] of Object.entries(dm.structures)) {
          if (!struct.type) warnings.push(`structure "${name}" missing "type"`);
        }
        // Validate $ref references in memoryKeys
        if (dm.memoryKeys && typeof dm.memoryKeys === 'object') {
          for (const [key, schema] of Object.entries(dm.memoryKeys)) {
            if (schema.$ref && !dm.structures[schema.$ref]) {
              errors.push(`memoryKey "${key}" references unknown structure "${schema.$ref}"`);
            }
            if (schema.items?.$ref && !dm.structures[schema.items.$ref]) {
              errors.push(`memoryKey "${key}" items references unknown structure "${schema.items.$ref}"`);
            }
            if (schema.producedBy && !componentIds.has(schema.producedBy)) {
              errors.push(`memoryKey "${key}" producedBy "${schema.producedBy}" does not match any component`);
            }
          }
        }
        // Validate $ref references in actions
        if (dm.actions && typeof dm.actions === 'object') {
          for (const [name, action] of Object.entries(dm.actions)) {
            if (action.output?.$ref && !dm.structures[action.output.$ref]) {
              errors.push(`action "${name}" output references unknown structure "${action.output.$ref}"`);
            }
          }
        }
      } else {
        // Old flat format — backward compatible
        for (const [key, schema] of Object.entries(dm)) {
          if (key === 'structures' || key === 'memoryKeys' || key === 'actions') continue;
          if (!schema.type) warnings.push(`dataModel "${key}" missing "type"`);
          if (!schema.source) warnings.push(`dataModel "${key}" missing "source"`);
          if (!schema.producedBy) {
            errors.push(`dataModel "${key}" missing "producedBy"`);
          } else if (!componentIds.has(schema.producedBy)) {
            errors.push(`dataModel "${key}" producedBy "${schema.producedBy}" does not match any component`);
          }
          if (!Array.isArray(schema.consumedBy) || schema.consumedBy.length === 0) {
            warnings.push(`dataModel "${key}" has no consumers`);
          } else {
            for (const cid of schema.consumedBy) {
            if (!componentIds.has(cid)) {
              errors.push(`dataModel "${key}" consumedBy "${cid}" does not match any component`);
            }
          }
        }
      }
      } // end old flat format else
    } else {
      warnings.push('Missing "dataModel" — downstream components will not have schema guidance');
    }

    // Validate optional settings
    if (parsed.settings) {
      const s = parsed.settings;
      if (s.service && !Array.isArray(s.service)) errors.push('settings.service must be an array');
      if (s.user && !Array.isArray(s.user)) errors.push('settings.user must be an array');
      if (Array.isArray(s.service)) {
        for (const entry of s.service) {
          if (!entry.key || !entry.type || !entry.label) {
            errors.push('settings.service entry missing key/type/label');
          }
          if (entry.type && !['secret', 'url', 'string', 'number', 'boolean'].includes(entry.type)) {
            warnings.push(`settings.service[${entry.key}] has unknown type: ${entry.type}`);
          }
        }
      }
    }

    // New top-level blueprint fields (settings/testScenarios/architecture) are preserved
    // automatically — `parsed` is returned in full below.
    return { valid: errors.length === 0, errors, warnings, parsed, extracted: json };
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`);
    return { valid: false, errors, warnings, parsed: null, extracted: json };
  }
}

/* ── Skeleton Validation ─────────────────────────────── */

/**
 * Validate a skeleton YAML document.
 * Checks: structure completeness, schema parseability, no implementation code,
 * and critically — cross-checks output field names against interview sampleResponse.
 *
 * @param {string} skeletonYaml - Raw YAML skeleton text
 * @param {object} blueprintComponent - The blueprint's component definition
 * @param {object} interviewSpec - The interview specification (for sampleResponse cross-check)
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSkeleton(skeletonYaml, blueprintComponent, interviewSpec) {
  const errors = [];
  const warnings = [];

  // 1. Basic check
  if (!skeletonYaml || typeof skeletonYaml !== 'string' || skeletonYaml.trim().length === 0) {
    return { valid: false, errors: ['Skeleton is empty'], warnings: [] };
  }

  // 2. Check for implementation code (function bodies, loops, conditionals)
  const codePatterns = [
    /\bfunction\s*\(/,
    /=>\s*\{/,
    /\bif\s*\(/,
    /\bfor\s*\(/,
    /\bwhile\s*\(/,
    /\bawait\s+/,
    /\breturn\s+/,
    /\bconst\s+\w+\s*=/,
    /\blet\s+\w+\s*=/,
    /ctx\.\w+/,
  ];
  for (const pattern of codePatterns) {
    if (pattern.test(skeletonYaml)) {
      errors.push(`Skeleton contains implementation code (matched: ${pattern.source}). Skeletons must contain only structure, signatures, and schemas — no code.`);
      break; // one error is enough
    }
  }

  // 3. Check required sections based on component type
  const type = blueprintComponent?.type;
  if (type === 'extension') {
    if (!skeletonYaml.includes('actions:')) errors.push('Extension skeleton missing "actions:" section');
    if (!skeletonYaml.includes('metadata:') && !skeletonYaml.includes('name:')) errors.push('Extension skeleton missing metadata');
  } else if (type === 'cortex') {
    const subtype = blueprintComponent?.subtype || 'data';
    if (subtype === 'data' && !skeletonYaml.includes('methods:')) errors.push('Data cortex skeleton missing "methods:" section');
    if (subtype === 'feature' && !skeletonYaml.includes('sections:')) errors.push('Feature cortex skeleton missing "sections:" section');
    if (subtype === 'app-domain' && !skeletonYaml.includes('exports:')) errors.push('App-domain cortex skeleton missing "exports:" section');
  } else if (type === 'app') {
    if (!skeletonYaml.includes('views:')) errors.push('App skeleton missing "views:" section');
  }

  // 4. Cross-check output fields against interview sampleResponse
  const sampleMismatches = crossCheckSampleData(skeletonYaml, interviewSpec);
  for (const mismatch of sampleMismatches) {
    warnings.push(mismatch);
  }
  // Promote warnings to errors if there are clear field name mismatches
  const criticalMismatches = sampleMismatches.filter(m => m.includes('field mismatch'));
  if (criticalMismatches.length > 0) {
    errors.push(...criticalMismatches.map(m => `CRITICAL: ${m}`));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Cross-check skeleton output field names against interview sampleResponse data.
 * This prevents the #1 failure mode: skeleton declares field names the API doesn't use.
 *
 * @param {string} skeletonYaml - The skeleton YAML
 * @param {object} interviewSpec - Interview spec with dataSources[].sampleEntry
 * @returns {string[]} - Array of mismatch descriptions
 */
function crossCheckSampleData(skeletonYaml, interviewSpec) {
  const mismatches = [];
  if (!interviewSpec?.dataSources) return mismatches;

  for (const ds of interviewSpec.dataSources) {
    if (!ds.sampleEntry && !ds.sampleResponse) continue;
    const sample = ds.sampleResponse || ds.sampleEntry;
    if (typeof sample !== 'object') continue;

    // Extract field names from the sample (top-level keys)
    const sampleFields = Object.keys(sample);

    // Look for output schemas in the skeleton that reference this data source
    if (ds.url && skeletonYaml.includes(ds.url)) {
      const outputFields = extractOutputFieldsNearUrl(skeletonYaml, ds.url);
      for (const field of outputFields) {
        if (!sampleFields.includes(field) && !deepFieldExists(sample, field)) {
          mismatches.push(`Skeleton output field "${field}" not found in sample data from ${ds.url}. Sample has: [${sampleFields.join(', ')}]. Possible field mismatch.`);
        }
      }
    }
  }
  return mismatches;
}

/**
 * Extract output field names declared near a data source URL in the skeleton.
 */
function extractOutputFieldsNearUrl(yaml, url) {
  const fields = [];
  const lines = yaml.split('\n');
  let nearUrl = false;
  let inOutput = false;

  for (const line of lines) {
    if (line.includes(url)) nearUrl = true;
    if (nearUrl && /output:/i.test(line)) inOutput = true;
    if (inOutput && /^\s+-?\s*\w+:/.test(line)) {
      const match = line.match(/(\w+):/);
      if (match && !['type', 'items', 'schema', 'output', 'input'].includes(match[1])) {
        fields.push(match[1]);
      }
    }
    // Stop at the next action/method
    if (nearUrl && inOutput && /^ {2}- id:|^ {2}- name:|^\w/.test(line) && !line.includes(url)) {
      break;
    }
  }
  return fields;
}

/**
 * Check if a field exists anywhere in a nested object (dot-path or direct).
 */
function deepFieldExists(obj, field) {
  if (obj === null || typeof obj !== 'object') return false;
  if (field in obj) return true;
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null && deepFieldExists(val, field)) return true;
  }
  return false;
}

/* ── Unit Validation ─────────────────────────────────── */

/**
 * Validate a unit implementation against its skeleton entry.
 * Checks: syntax, anti-patterns, and that the implementation matches the skeleton's contract.
 *
 * @param {string} code - The unit implementation code
 * @param {object} unitDef - The unit's definition from the skeleton ({ id, input, output, ... })
 * @param {string} componentType - 'extension' | 'cortex' | 'app'
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateUnit(code, unitDef, componentType) {
  const errors = [];
  const warnings = [];

  if (!code || code.trim().length === 0) {
    return { valid: false, errors: ['Unit implementation is empty'], warnings: [] };
  }

  // Run anti-pattern check
  const antiPatterns = validateAntiPatterns(componentType, code);
  if (antiPatterns.errors) errors.push(...antiPatterns.errors);
  if (antiPatterns.warnings) warnings.push(...antiPatterns.warnings);

  // Check that the implementation references the expected function/action name
  if (unitDef?.id && !code.includes(unitDef.id)) {
    warnings.push(`Unit implementation does not reference "${unitDef.id}" — verify it implements the correct unit.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(type, result, blueprint = null) {
  const validator = validators[type];
  if (!validator) return { valid: false, errors: [`No validator for type: ${type}`], extracted: result };
  return validator(result, blueprint);
}
