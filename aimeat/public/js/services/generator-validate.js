/**
 * @file generator-validate.js
 * @description Validators for generator component results and blueprints.
 *   Each component type (csm, msm, extension, app, memory, translation) has a
 *   validator that checks structure and extracts usable content from AI output.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences
 *   - validators[type](result): per-type validation returning { valid, errors, extracted }
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (strips extra fields)
 *   - validateComponent(type, result): dispatches to per-type validator
 * @usage import { validateBlueprint, validateComponent } from '/js/services/generator-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial validators
 *   v1.1.0 — 2026-03-14 — validateBlueprint now strips extra component fields
 *     (manifest, code, files, etc.) and returns warnings array
 *   v1.2.0 — 2026-03-14 — Add sanitizeJson() to fix AI markdown artifacts
 *     (\[ → [, trailing commas, zero-width chars) before JSON.parse
 */

/* ── Helpers ─────────────────────────────────────────── */

function extractCodeBlock(text, lang) {
  const regex = new RegExp('```' + (lang || '') + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

/**
 * Sanitize JSON string from common AI/markdown artifacts before parsing.
 * AI chat models frequently escape brackets, add trailing commas, or wrap
 * JSON in markdown formatting that breaks JSON.parse().
 */
function sanitizeJson(text) {
  let s = text;
  // Strip markdown bold/italic markers that leak into values
  // (but preserve content inside quoted strings carefully)
  // Remove backslash-escaped brackets: \[ → [, \] → ]
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  // Remove backslash-escaped parens and braces (some models do this)
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  s = s.replace(/\\\(/g, '(').replace(/\\\)/g, ')');
  // Remove trailing commas before } or ] (common AI mistake)
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Strip zero-width spaces and other invisible unicode
  s = s.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  return s;
}

/* ── YAML Parse (lightweight) ────────────────────────── */

function basicYamlCheck(text) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    errors.push('Result is empty');
    return { errors, parsed: null };
  }
  // Check for common YAML issues
  const lines = text.split('\n');
  if (lines.length < 3) errors.push('YAML seems too short (fewer than 3 lines)');
  if (!lines.some(l => l.includes(':'))) errors.push('No key-value pairs found — not valid YAML');
  return { errors, raw: text };
}

/* ── Validators ──────────────────────────────────────── */

const validators = {
  csm(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^name:\s*.+/m)) errors.push('Missing required field: name');
    if (!yaml.match(/^version:\s*.+/m)) errors.push('Missing required field: version');
    if (!yaml.match(/^fields:/m)) errors.push('Missing required field: fields');
    if (!yaml.match(/consent:/m)) errors.push('Missing required section: consent');

    return { valid: errors.length === 0, errors, extracted: yaml };
  },

  msm(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^name:\s*.+/m)) errors.push('Missing required field: name');
    if (!yaml.match(/^version:\s*.+/m)) errors.push('Missing required field: version');
    if (!yaml.match(/auth:/m)) errors.push('Missing required section: auth');
    if (!yaml.match(/endpoints:/m)) errors.push('Missing required section: endpoints');

    return { valid: errors.length === 0, errors, extracted: yaml };
  },

  extension(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^extension:\s*.+/m)) errors.push('Missing required field: extension (version)');
    if (!yaml.match(/metadata:/m)) errors.push('Missing required section: metadata');
    if (!yaml.match(/actions:/m)) errors.push('Missing required section: actions');

    // Check for action scripts
    const jsBlocks = result.match(/```javascript[\s\S]*?```/gi) || [];
    const actionIds = [...yaml.matchAll(/- id:\s*(.+)/g)].map(m => m[1].trim());
    if (actionIds.length > 0 && jsBlocks.length === 0) {
      errors.push(`Extension defines ${actionIds.length} action(s) but no JavaScript code blocks found`);
    }

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
      if (!parsed.en) errors.push('Missing "en" (English) locale');
      if (!parsed.fi) errors.push('Missing "fi" (Finnish) locale');
      if (parsed.en && parsed.fi) {
        const enKeys = Object.keys(parsed.en);
        const fiKeys = Object.keys(parsed.fi);
        const missing = enKeys.filter(k => !fiKeys.includes(k));
        if (missing.length > 0) errors.push(`Finnish translations missing for: ${missing.join(', ')}`);
      }
      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${e.message}`);
      return { valid: false, errors, extracted: json };
    }
  },
};

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
      const allowedComponentKeys = new Set(['id', 'type', 'label']);
      parsed.components = parsed.components.map(c => {
        if (!c.id) errors.push(`Component missing "id" field`);
        if (!c.type) errors.push(`Component "${c.id || '?'}" missing "type" field`);
        if (!c.label) errors.push(`Component "${c.id || '?'}" missing "label" field`);
        if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation'].includes(c.type)) {
          errors.push(`Component "${c.id}" has unknown type "${c.type}"`);
        }
        // Strip extra fields (manifest, code, files, etc.) — blueprint is lightweight
        const extraKeys = Object.keys(c).filter(k => !allowedComponentKeys.has(k));
        if (extraKeys.length > 0) {
          warnings.push(`Component "${c.id || '?'}" had extra fields stripped: ${extraKeys.join(', ')}`);
        }
        return { id: c.id, type: c.type, label: c.label };
      });
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
    return { valid: errors.length === 0, errors, warnings, parsed, extracted: json };
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`);
    return { valid: false, errors, warnings, parsed: null, extracted: json };
  }
}

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(type, result) {
  const validator = validators[type];
  if (!validator) return { valid: false, errors: [`No validator for type: ${type}`], extracted: result };
  return validator(result);
}
