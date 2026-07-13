/**
 * @file public/js/services/generator-validate.validators.js
 * @description Anti-pattern scanner + per-component-type validators (csm, msm, extension,
 *   app, memory, translation, cortex) for generator output. Extracted from
 *   generator-validate.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-validate.js (max-file-lines)
 */
import { stringify as stringifyYaml } from '../../lib/yaml.mjs';
import { extractCodeBlock, sanitizeJson, tryParseYaml } from './generator-validate.helpers.js';

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

export const validators = {
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

    // Blueprint action ID cross-check — WARNING only, not an error.
    // The spec is the authority. Blueprint has abstract action names
    // that may not match the actual API structure.
    if (blueprint?.testScenarios && Array.isArray(parsed?.actions)) {
      const bpComp = blueprint.components?.find(c => c.type === 'extension');
      if (bpComp) {
        const testActions = (blueprint.testScenarios || [])
          .filter(ts => ts.component === bpComp.id)
          .flatMap(ts => (ts.scenarios || []).map(s => s.action));
        const actualIds = new Set(parsed.actions.map(a => a.id));
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
