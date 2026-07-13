/**
 * @file src/services/foundry-validate/component-validators.ts
 * @description Per-type foundry component validators (csm, msm, extension, app, memory, translation, cortex) and the validateComponent dispatcher. Extracted from src/services/foundry-validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/services/foundry-validate.ts (max-file-lines)
 */

import { stringify as stringifyYaml } from 'yaml';
import type { ComponentType, ValidationResult, CortexExtracted } from './types.js';
import { extractCodeBlock, sanitizeJson, tryParseYaml, validateAntiPatterns } from './helpers.js';

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

function validateExtension(result: string): ValidationResult {
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

  // Format 2: fenced ```yaml block
  if (!raw) {
    const fenced = extractCodeBlock(result, 'yaml');
    if (fenced !== result.trim()) {
      raw = fenced;
    }
  }

  // Format 3: no fences — cut at first // actions/ comment in raw text
  if (!raw) {
    const jsStart = result.search(/^\/\/\s*actions\//m);
    raw = jsStart > 0 ? result.slice(0, jsStart).trim() : result.trim();
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

  // Check for action scripts — look for fenced JS blocks OR unfenced // actions/file.js comments
  const fencedJs = result.match(/```javascript[\s\S]*?```/gi) || [];
  const unfencedJs = result.match(/^\/\/\s*actions\/[\w-]+\.js\s*$/gm) || [];
  const jsBlockCount = Math.max(fencedJs.length, unfencedJs.length);
  const actionCount = Array.isArray(parsed?.actions) ? (parsed.actions as unknown[]).length : 0;
  if (actionCount > 0 && jsBlockCount === 0) {
    errors.push(`Extension defines ${actionCount} action(s) but no JavaScript code blocks found`);
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
  const warnings: string[] = [];
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
    // Anti-pattern scan (warnings only, don't block validation)
    const ap = validateAntiPatterns('translation', json);
    warnings.push(...ap.warnings);

    return { valid: errors.length === 0, errors, warnings, extracted: json };
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

      // Cross-check with blueprint produces API methods if available
      if (blueprint?.components) {
        interface BlueprintComponent { type: string; produces?: string[] }
        const cortexComp = (blueprint.components as BlueprintComponent[]).find(c => c.type === 'cortex');
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
    case 'extension': return validateExtension(content);
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
