/**
 * @file src/services/generator-validate.ts
 * @description Server-side component validators for the AIMEAT service generator.
 *   TypeScript port of public/js/services/generator-validate.js.
 *   Each component type (csm, msm, extension, app, memory, translation, cortex) has a
 *   validator that checks structure and extracts usable content from AI output.
 *   Includes validateInterviewSpec for structured interview JSON, validateBlueprint for
 *   blueprint JSON validation/sanitization, and validateAntiPatterns for crash-prevention checks.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences (see generator-validate-helpers.ts)
 *   - validateAntiPatterns(type, code): universal crash-prevention checks
 *   - validateComponent(type, content): dispatches to per-type validator
 *   - validateInterviewSpec(result): validates interview spec JSON from AI interviews
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (see generator-validate-blueprint.ts)
 * @usage import { validateBlueprint, validateComponent, validateInterviewSpec, validateAntiPatterns } from '../services/generator-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-18 — Initial port from public/js/services/generator-validate.js (v4.5.0)
 *   v1.1.0 — 2026-03-21 — Add externalServices/userSettings to InterviewSpec; settings/testScenarios/architecture/role to Blueprint
 *   v1.2.0 — 2026-07-13 — Extract types, YAML/JSON helpers, and blueprint/spec-quality validators into sibling modules (max-file-lines)
 */

import { stringify as stringifyYaml } from 'yaml';
import { extractCodeBlock, sanitizeJson, tryParseYaml } from './generator-validate-helpers.js';
import type {
  ComponentType,
  CortexExtracted,
  ValidationResult,
  InterviewSpec,
  InterviewSpecValidationResult,
  AntiPatternResult,
} from './generator-validate-types.js';

// Re-export shared types so existing consumers keep importing them from this module.
export type {
  ComponentType,
  CortexExtracted,
  ValidationResult,
  BlueprintValidationResult,
  InterviewSpec,
  InterviewSpecValidationResult,
  AntiPatternResult,
  SpecQualityResult,
} from './generator-validate-types.js';

// Re-export the spec-quality gate and blueprint validator (moved to a sibling module).
export { validateSpecQuality, validateBlueprint } from './generator-validate-blueprint.js';

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

/* ── Validators ──────────────────────────────────────── */

function validateCsm(result: string): ValidationResult {
  const errors: string[] = [];
  const raw = extractCodeBlock(result, 'yaml');
  const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
  errors.push(...parseErrors);

  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, Record<string, unknown>>;
    if (!p.service?.name) errors.push('Missing: service.name');
    if (!p.service?.description) errors.push('Missing: service.description');
    const dataSchema = p.data_schema as Record<string, unknown> | undefined;
    if (!dataSchema?.required || Object.keys(dataSchema.required as object).length === 0) {
      errors.push('data_schema.required must have at least one field');
    }
    if (!p.consent_requirements) errors.push('Missing section: consent_requirements');
  }

  return { valid: errors.length === 0, errors, extracted: cleaned };
}

function validateMsm(result: string): ValidationResult {
  const errors: string[] = [];
  const raw = extractCodeBlock(result, 'yaml');
  const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
  errors.push(...parseErrors);

  if (parsed && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    const service = p.service as Record<string, unknown> | undefined;
    const auth = p.auth as Record<string, unknown> | undefined;
    const actions = p.actions;

    if (!service?.name) errors.push('Missing: service.name');
    if (!service?.description) errors.push('Missing: service.description');
    if (!service?.category) errors.push('Missing: service.category');
    if (!auth?.type) errors.push('Missing: auth.type');

    if (!Array.isArray(actions) || actions.length === 0) {
      errors.push('actions must be a non-empty array');
    } else {
      for (const action of actions as Record<string, unknown>[]) {
        const pfx = `action "${(action?.id as string) || '?'}"`;
        if (!action?.id) errors.push(`${pfx}: missing id`);
        if (!action?.display_name) errors.push(`${pfx}: missing display_name`);
        const endpoint = action?.endpoint as Record<string, unknown> | undefined;
        if (!endpoint?.method) errors.push(`${pfx}: missing endpoint.method`);
        if (!endpoint?.url) errors.push(`${pfx}: missing endpoint.url`);
        const output = action?.output as Record<string, unknown> | undefined;
        if (!output || Object.keys(output).length === 0) {
          errors.push(`${pfx}: must have at least one output field`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, extracted: cleaned };
}

function validateExtension(result: string, blueprint: Record<string, unknown> | null = null): ValidationResult {
  const errors: string[] = [];

  // ── Extract YAML manifest — supports three formats ──
  // Format 1 (preferred): Single untagged code block with YAML first, then // actions/*.js separator
  // Format 2: Fenced ```yaml block
  // Format 3: Raw text (no fences) — cut at first // actions/ comment
  let raw: string | null = null;

  // Format 1: single untagged code block — split at first // actions/ separator
  const untaggedMatch = result.match(/```\s*\n([\s\S]*?)```/);
  if (untaggedMatch) {
    const content = untaggedMatch[1];
    const actionSep = content.match(/^\/\/\s*actions\/\S+\.js\s*$/m);
    if (actionSep) {
      const sepIndex = content.indexOf(actionSep[0]);
      raw = content.slice(0, sepIndex).trim();
    }
  }

  // Format 2/3: fenced ```yaml block or raw text — cut at the earliest JS marker
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
    const p = parsed as Record<string, unknown>;
    const metadata = p.metadata as Record<string, unknown> | undefined;
    const actions = p.actions;

    if (!metadata?.name) errors.push('Missing: metadata.name');
    else if (/\./.test(metadata.name as string)) errors.push('metadata.name must not contain dots (.) — dots cause namespace collisions in memory owner keys');
    else if (!/^[a-z][a-z0-9-]*$/.test(metadata.name as string)) errors.push('metadata.name must be lowercase kebab-case (e.g., "my-collector")');

    if (!metadata?.version) errors.push('Missing: metadata.version');
    if (!metadata?.description) errors.push('Missing: metadata.description');
    if (!metadata?.author) errors.push('Missing: metadata.author');

    if (!Array.isArray(actions) || actions.length === 0) {
      errors.push('actions array is required and must not be empty');
    } else {
      for (const action of actions as Record<string, unknown>[]) {
        const pfx = `action "${(action?.id as string) || '?'}"`;
        if (!action?.id) errors.push(`${pfx}: missing id`);
        if (!action?.method) errors.push(`${pfx}: missing method`);
        if (!action?.path) errors.push(`${pfx}: missing path`);
        if (!action?.script) errors.push(`${pfx}: missing script`);
      }
    }
  }

  // Blueprint action ID cross-check — WARNING only, not an error. The spec is the
  // authority; the blueprint has abstract action names that may not match the API.
  const parsedActions = (parsed as Record<string, unknown> | null)?.actions;
  if (blueprint?.testScenarios && Array.isArray(parsedActions)) {
    const components = blueprint.components as Array<Record<string, unknown>> | undefined;
    const bpComp = components?.find((c) => c.type === 'extension');
    if (bpComp) {
      const testScenarios = blueprint.testScenarios as Array<Record<string, unknown>>;
      const testActions = testScenarios
        .filter((ts) => ts.component === bpComp.id)
        .flatMap((ts) => ((ts.scenarios as Array<Record<string, unknown>>) || []).map((s) => s.action));
      const actualIds = new Set((parsedActions as Array<Record<string, unknown>>).map((a) => a.id));
      for (const expected of testActions) {
        if (!actualIds.has(expected)) {
          console.warn(`[validator] Blueprint expects "${expected}" but extension has: ${[...actualIds].join(', ')}`);
        }
      }
    }
  }

  // Check for action scripts — look for fenced JS blocks OR unfenced // actions/file.js comments
  const fencedJs = result.match(/```javascript[\s\S]*?```/gi) || [];
  const unfencedJs = result.match(/^\/\/\s*actions\/[\w-]+\.js\s*$/gm) || [];
  const jsBlockCount = Math.max(fencedJs.length, unfencedJs.length);
  const actionCount = Array.isArray(parsed?.actions) ? (parsed.actions as unknown[]).length : 0;
  if (actionCount > 0 && jsBlockCount === 0) {
    errors.push(`Extension defines ${actionCount} action(s) but no JavaScript code blocks found`);
  } else if (actionCount > 0 && jsBlockCount > 0 && jsBlockCount < actionCount) {
    errors.push(`Extension defines ${actionCount} action(s) but only ${jsBlockCount} JavaScript code blocks found — each action needs its own script`);
  }

  // Anti-pattern scan
  const ap = validateAntiPatterns('extension', result);
  errors.push(...ap.errors);

  return { valid: errors.length === 0, errors, extracted: result };
}

function validateApp(result: string): ValidationResult {
  const errors: string[] = [];
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
}

function validateMemorySchema(result: string): ValidationResult {
  const errors: string[] = [];
  const json = sanitizeJson(extractCodeBlock(result, 'json'));
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push('Memory structure must be a JSON object with key-value pairs');
    } else if (Object.keys(parsed as object).length === 0) {
      errors.push('Memory structure is empty');
    }
    return { valid: errors.length === 0, errors, extracted: json };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Invalid JSON: ${msg}`);
    return { valid: false, errors, extracted: json };
  }
}

function validateTranslation(result: string): ValidationResult {
  const errors: string[] = [];
  const json = sanitizeJson(extractCodeBlock(result, 'json'));
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // Each translation component produces ONE locale (e.g., { "fi": { ... } } or { "en": { ... } })
    const locales = Object.keys(parsed).filter(k => typeof parsed[k] === 'object' && parsed[k] !== null);
    if (locales.length === 0) {
      errors.push('No locale object found — expected e.g. { "fi": { ... } } or { "en": { ... } }');
    } else if (locales.length > 1) {
      errors.push(`Multiple locales found (${locales.join(', ')}) — each translation component should contain only ONE locale`);
    } else {
      // Validate the single locale has content
      const locale = locales[0];
      const keys = Object.keys(parsed[locale] as object);
      if (keys.length === 0) {
        errors.push(`Locale "${locale}" is empty — no translation keys found`);
      }
    }
    // Anti-pattern scan — translation anti-patterns are warnings only, and the
    // authoritative (UI) validator does NOT surface them; discard to keep parity.
    void validateAntiPatterns('translation', json);

    return { valid: errors.length === 0, errors, extracted: json };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Invalid JSON: ${msg}`);
    return { valid: false, errors, extracted: json };
  }
}

function validateCortex(result: string, blueprint?: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];

  // ── Extract YAML and JS — supports two formats ──
  // Format 1 (preferred): Single untagged code block with YAML first, then // lib/*.js separator
  // Format 2 (legacy): Separate ```yaml and ```javascript blocks
  let yamlBlock: string | null = null;
  const jsBlocks: string[] = [];

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
    const extracted = extractCodeBlock(result, 'yaml');
    if (extracted && extracted !== result.trim()) {
      yamlBlock = extracted;
    }
    if (yamlBlock) {
      const jsRegex = /```(?:javascript|js)\s*\n([\s\S]*?)```/gi;
      let match: RegExpExecArray | null;
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

  if (!parsed) return { valid: false, errors: ['Failed to parse YAML manifest'], extracted: null };

  const p = parsed as Record<string, unknown>;
  if (p.apiVersion !== 'cortex.aimeat.org/v1') {
    errors.push('apiVersion must be "cortex.aimeat.org/v1"');
  }
  if (p.kind !== 'Extension') errors.push('kind must be "Extension"');
  const metadata = p.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name) errors.push('metadata.name is required');
  else if (/\./.test(metadata.name as string)) errors.push('metadata.name must not contain dots (.)');
  else if (!/^[a-z][a-z0-9-]*$/.test(metadata.name as string)) errors.push('metadata.name must be lowercase kebab-case (e.g., "my-domain-lib")');

  const spec = p.spec as Record<string, unknown> | undefined;
  if (!spec?.components || !Array.isArray(spec.components)) {
    errors.push('spec.components array is required');
  }

  interface LibComponent { type: string; filename?: string; name?: string }
  const libComponents = ((spec?.components || []) as LibComponent[]).filter(c => c.type === 'lib');
  if (libComponents.length > 0 && jsBlocks.length === 0) {
    errors.push(`Manifest declares ${libComponents.length} lib component(s) but no JavaScript code blocks found`);
  }

  // ── Cross-check: YAML metadata.name ↔ JS LIB_NAME consistency ──
  if (metadata?.name && jsBlocks.length > 0) {
    const yamlName = metadata.name as string; // kebab-case e.g. "halytyskartta-cortex"
    const expectedCamel = yamlName.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()); // → "halytyskarttaCortex"
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
    const exportsMatch = jsCode.match(/(?:const|let|var)\s+\w*[Ee]xport\w*\s*=\s*\{([\s\S]*?)\}/);
    if (exportsMatch) {
      const exportedMethods = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);

      // Cross-check with blueprint produces API methods if available.
      // Match the SPECIFIC cortex component by metadata.name (a blueprint may have several cortexes).
      if (blueprint?.components && metadata?.name) {
        const metaName = metadata.name as string;
        interface BlueprintComponent { id?: string; type?: string; label?: string; produces?: string[] }
        const cortexComps = (blueprint.components as BlueprintComponent[]).filter(c => c.type === 'cortex');
        const cortexComp = cortexComps.find(c =>
          c.id === metaName || c.label?.toLowerCase().includes(metaName.replace(/-/g, ' ')) ||
          metaName.includes(c.id?.replace('cortex-', '') as string)
        ) || (cortexComps.length === 1 ? cortexComps[0] : null);
        if (cortexComp?.produces) {
          const requiredMethods = cortexComp.produces
            .filter(prod => prod.startsWith('api:'))
            .map(prod => prod.replace('api:', ''));
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

  // SYNTAX CHECK: a cortex that does not PARSE passes every structural check above but crashes at
  // runtime (e.g. `listTitle className = '...'` — a missing dot → "Unexpected identifier 'className'").
  // new Function() COMPILES without executing, so undefined globals (window/document/AIMEAT) are
  // irrelevant — it surfaces only real syntax errors. This gap let broken cortex code register "green".
  for (let i = 0; i < jsBlocks.length; i++) {
    try {
      new Function(jsBlocks[i]);
    } catch (e) {
      if (e instanceof SyntaxError) errors.push(`Cortex JS (lib ${i + 1}) has a syntax error: ${e.message}`);
    }
  }

  if (errors.length > 0) return { valid: false, errors, extracted: null };

  const extracted: CortexExtracted = {
    manifest: stringifyYaml(parsed),
    libs: libComponents.map((lib, i) => ({
      filename: lib.filename || `${lib.name || 'lib'}.js`,
      code: jsBlocks[i] || '',
    })),
  };

  return { valid: true, errors: [], extracted };
}

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(
  type: ComponentType,
  content: string,
  blueprint: Record<string, unknown> | null = null,
): ValidationResult {
  switch (type) {
    case 'csm': return validateCsm(content);
    case 'msm': return validateMsm(content);
    case 'extension': return validateExtension(content, blueprint);
    case 'app': return validateApp(content);
    case 'memory': return validateMemorySchema(content);
    case 'translation': return validateTranslation(content);
    case 'cortex': return validateCortex(content, blueprint);
    default: {
      const exhaustive: never = type;
      return { valid: false, errors: [`Unknown component type: ${exhaustive}`], extracted: content };
    }
  }
}

/* ── Interview Spec Validator ────────────────────────── */

/**
 * Validate and extract an interview specification JSON from AI output.
 * Expects a JSON code block with required fields.
 */
export function validateInterviewSpec(result: string): InterviewSpecValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const raw = extractCodeBlock(result, 'json');
    const cleaned = sanitizeJson(raw);
    const spec = JSON.parse(cleaned) as InterviewSpec;

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, errors: [`Failed to parse interview spec: ${msg}`], warnings: [] };
  }
}
