/**
 * @file src/services/generator-prompts/validators.ts
 * @description Per-component-type validators (csm, msm, extension, app, memory,
 *   translation, cortex) and the validateComponent dispatcher — each checks structure
 *   and extracts usable content from AI output. Extracted from validate.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from validate.ts (max-file-lines)
 */
import { stringify as stringifyYaml } from 'yaml';

import type { Blueprint } from './types.js';
import {
  type ValidationResult,
  extractCodeBlock,
  sanitizeJson,
  tryParseYaml,
} from './validate-shared.js';
import { validateAntiPatterns } from './validate-anti-patterns.js';

/* ── Validators ──────────────────────────────────────── */

type ValidatorFn = (result: string, blueprint?: Blueprint | null) => ValidationResult;

const validators: Record<string, ValidatorFn> = {
  csm(result: string): ValidationResult {
    const errors: string[] = [];
    const raw = extractCodeBlock(result, 'yaml');
    const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, Record<string, unknown>>;
      if (!(p.service as Record<string, unknown>)?.name) errors.push('Missing: service.name');
      if (!(p.service as Record<string, unknown>)?.description) errors.push('Missing: service.description');
      if (!p.data_schema?.required || Object.keys(p.data_schema.required as object).length === 0) {
        errors.push('data_schema.required must have at least one field');
      }
      if (!p.consent_requirements) errors.push('Missing section: consent_requirements');
    }

    return { valid: errors.length === 0, errors, extracted: cleaned };
  },

  msm(result: string): ValidationResult {
    const errors: string[] = [];
    const raw = extractCodeBlock(result, 'yaml');
    const { parsed, errors: parseErrors, cleaned } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (!(p.service as Record<string, unknown>)?.name) errors.push('Missing: service.name');
      if (!(p.service as Record<string, unknown>)?.description) errors.push('Missing: service.description');
      if (!(p.service as Record<string, unknown>)?.category) errors.push('Missing: service.category');
      if (!(p.auth as Record<string, unknown>)?.type) errors.push('Missing: auth.type');
      if (!Array.isArray(p.actions) || (p.actions as unknown[]).length === 0) {
        errors.push('actions must be a non-empty array');
      } else {
        for (const action of p.actions as Array<Record<string, unknown>>) {
          const pfx = `action "${action?.id || '?'}"`;
          if (!action?.id) errors.push(`${pfx}: missing id`);
          if (!action?.display_name) errors.push(`${pfx}: missing display_name`);
          if (!(action?.endpoint as Record<string, unknown>)?.method) errors.push(`${pfx}: missing endpoint.method`);
          if (!(action?.endpoint as Record<string, unknown>)?.url) errors.push(`${pfx}: missing endpoint.url`);
          if (!action?.output || Object.keys(action.output as object).length === 0) {
            errors.push(`${pfx}: must have at least one output field`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, extracted: cleaned };
  },

  extension(result: string, blueprint?: Blueprint | null): ValidationResult {
    const errors: string[] = [];

    // ── Extract YAML manifest — supports three formats ──
    // Format 1 (preferred): Single untagged code block with // actions/*.js separator
    // Format 2: Fenced ```yaml block + JS markers
    // Format 3: Raw text with JS markers
    let raw: string | null = null;

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
      const p = parsed as Record<string, unknown>;
      const metadata = p.metadata as Record<string, unknown> | undefined;
      if (!metadata?.name) errors.push('Missing: metadata.name');
      else if (/\./.test(metadata.name as string)) errors.push('metadata.name must not contain dots (.) — dots cause namespace collisions in memory owner keys');
      else if (!/^[a-z][a-z0-9-]*$/.test(metadata.name as string)) errors.push('metadata.name must be lowercase kebab-case (e.g., "my-collector")');
      if (!metadata?.version) errors.push('Missing: metadata.version');
      if (!metadata?.description) errors.push('Missing: metadata.description');
      if (!metadata?.author) errors.push('Missing: metadata.author');
      if (!Array.isArray(p.actions) || (p.actions as unknown[]).length === 0) {
        errors.push('actions array is required and must not be empty');
      } else {
        // Auto-assign script fields from action IDs if missing
        // Common LLM pattern: YAML actions without script: field + bare JS code after YAML
        for (const action of p.actions as Array<Record<string, unknown>>) {
          if (!action.script && action.id) {
            action.script = `actions/${action.id as string}.js`;
          }
        }
        for (const action of p.actions as Array<Record<string, unknown>>) {
          const pfx = `action "${action?.id || '?'}"`;
          if (!action?.id) errors.push(`${pfx}: missing id`);
          if (!action?.method) errors.push(`${pfx}: missing method`);
          if (!action?.path) errors.push(`${pfx}: missing path`);
          if (!action?.script) errors.push(`${pfx}: missing script`);
        }
      }
    }

    // Blueprint action ID cross-check — ERROR. Blueprint is the contract.
    // The extension MUST implement all actions the blueprint declares.
    if (blueprint?.testScenarios && Array.isArray((parsed as Record<string, unknown>)?.actions)) {
      const bpComp = blueprint.components?.find(c => c.type === 'extension');
      if (bpComp) {
        const testActions = (blueprint.testScenarios || [])
          .filter(ts => ts.component === bpComp.id)
          .flatMap(ts => (ts.scenarios || []).map(s => s.action));
        // Also check dataModel actions
        const dmActions = Object.keys(blueprint.dataModel?.actions || {})
          .filter(k => k.startsWith('ext:'))
          .map(k => k.replace('ext:', '').replace(/^[^/]+\//, ''));
        const allExpected = [...new Set([...testActions, ...dmActions])];
        const actions = (parsed as Record<string, unknown>).actions as Array<Record<string, unknown>>;
        const actualIds = new Set(actions.map(a => a.id as string));
        for (const expected of allExpected) {
          if (!actualIds.has(expected)) {
            errors.push(`Blueprint declares action "${expected}" but it was not found in the generated manifest`);
          }
        }
      }
    }

    // Check for action scripts — look for fenced JS blocks, // actions/file.js comments, OR bare export default blocks
    const fencedJs = result.match(/```javascript[\s\S]*?```/gi) || [];
    const unfencedJs = result.match(/^\/\/\s*actions\/[\w-]+\.js\s*$/gm) || [];
    const bareExportDefaults = result.match(/^export\s+default\s+async\s+function/gm) || [];
    const jsBlockCount = Math.max(fencedJs.length, unfencedJs.length, bareExportDefaults.length);
    const actions = (parsed as Record<string, unknown>)?.actions;
    const actionCount = Array.isArray(actions) ? (actions as unknown[]).length : 0;
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

  app(result: string): ValidationResult {
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
  },

  memory(result: string): ValidationResult {
    const errors: string[] = [];
    const json = sanitizeJson(extractCodeBlock(result, 'json'));
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('Memory structure must be a JSON object with key-value pairs');
      } else if (Object.keys(parsed as object).length === 0) {
        errors.push('Memory structure is empty');
      }
      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`);
      return { valid: false, errors, extracted: json };
    }
  },

  translation(result: string): ValidationResult {
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
      // Anti-pattern scan
      validateAntiPatterns('translation', json);
      // translation anti-patterns are warnings only, don't block validation

      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${(e as Error).message}`);
      return { valid: false, errors, extracted: json };
    }
  },

  cortex(result: string, blueprint?: Blueprint | null): ValidationResult {
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
      yamlBlock = extractCodeBlock(result, 'yaml');
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

    const specComponents = ((spec?.components || []) as Array<Record<string, unknown>>);
    const libComponents = specComponents.filter(c => c.type === 'lib');
    if (libComponents.length > 0 && jsBlocks.length === 0) {
      errors.push(`Manifest declares ${libComponents.length} lib component(s) but no JavaScript code blocks found`);
    }

    // ── Cross-check: YAML metadata.name ↔ JS LIB_NAME consistency ──
    if (metadata?.name && jsBlocks.length > 0) {
      const yamlName = metadata.name as string; // kebab-case e.g. "halytyskartta-cortex"
      const expectedCamel = yamlName.replace(/-([a-z0-9])/g, (_: string, c: string) => c.toUpperCase()); // → "halytyskarttaCortex"
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
        if (blueprint?.components && metadata?.name) {
          const metaName = metadata.name as string;
          // Find the blueprint component that matches this cortex by name similarity
          const cortexComps = blueprint.components.filter(c => c.type === 'cortex');
          const cortexComp = cortexComps.find(c =>
            c.id === metaName || c.label?.toLowerCase().includes(metaName.replace(/-/g, ' ')) ||
            metaName.includes(c.id?.replace('cortex-', ''))
          ) || (cortexComps.length === 1 ? cortexComps[0] : null);
          if (cortexComp?.produces) {
            const requiredMethods = cortexComp.produces
              .filter(pr => pr.startsWith('api:'))
              .map(pr => pr.replace('api:', ''));
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
          filename: (lib.filename as string) || `${lib.name as string}.js`,
          code: jsBlocks[i] || '',
        })),
      },
    };
  },
};

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(type: string, result: string, blueprint: Blueprint | null = null): ValidationResult {
  const validator = validators[type];
  if (!validator) return { valid: false, errors: [`No validator for type: ${type}`], extracted: result };
  return validator(result, blueprint);
}
