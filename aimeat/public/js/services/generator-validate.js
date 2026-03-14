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
 *   v2.0.0 — 2026-03-14 — Use real yaml parser (yaml@2.8.2 via /lib/yaml.mjs)
 *     for CSM/MSM/Extension validation instead of regex heuristics
 *   v2.1.0 — 2026-03-14 — Fix MSM validator to check real structure
 *     (service.name/category, auth.type, actions[] with display_name/endpoint);
 *     fix Extension validator to check metadata.name/version/description/author
 *     and actions[].id/method/path/script
 */
import { parse as parseYaml } from '/lib/yaml.mjs';

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

/**
 * Sanitize AI-generated YAML from common markdown artifacts.
 * Applied before validation so the YAML checks see clean content.
 */
function sanitizeYaml(text) {
  if (typeof text !== 'string') return text;
  let s = text;
  // Markdown bullets → YAML list items: `*   name:` → `  - name:`
  s = s.replace(/^(\s*)\*\s{2,}/gm, '$1- ');
  s = s.replace(/^(\s*)\*\s+(?=\S)/gm, '$1- ');
  // Remove backslash-escaped underscores: `\_` → `_`
  s = s.replace(/\\_/g, '_');
  // Remove backslash-escaped brackets and braces
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  // Remove zero-width unicode
  s = s.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  // Convert YAML block scalars (> or |) to plain strings on same line
  // e.g., "description: >\n  multi\n  line" → "description: multi line"
  s = s.replace(/^(\s*\w[\w_-]*:\s*)[>|]-?\s*\n((?:\s+.*\n?)*)/gm, (_match, prefix, body) => {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    return prefix + '"' + lines.join(' ').replace(/"/g, '\\"') + '"\n';
  });
  // Auto-quote unquoted YAML values containing { } which YAML misparses as flow mappings
  s = s.replace(/^(\s*(?:description|title|label|message):\s+)(?!["'>|])(.+\{.+\}.*)$/gm,
    (_match, prefix, value) => prefix + '"' + value.replace(/"/g, '\\"') + '"');
  return s;
}

/* ── YAML Parse ──────────────────────────────────────── */

/**
 * Parse YAML text using the real yaml library. Returns { parsed, errors }.
 * Sanitizes common AI artifacts first, then attempts parse.
 */
function tryParseYaml(text) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    errors.push('Result is empty');
    return { errors, parsed: null, cleaned: text };
  }
  const cleaned = sanitizeYaml(text);
  try {
    const parsed = parseYaml(cleaned);
    return { errors, parsed, cleaned };
  } catch (e) {
    errors.push(`YAML parse error: ${e.message}`);
    return { errors, parsed: null, cleaned };
  }
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

  extension(result) {
    const errors = [];
    const raw = extractCodeBlock(result, 'yaml');
    const { parsed, errors: parseErrors } = tryParseYaml(raw);
    errors.push(...parseErrors);

    if (parsed && typeof parsed === 'object') {
      if (!parsed.metadata?.name) errors.push('Missing: metadata.name');
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

    // Check for action scripts — each action.script must have a matching JS code block
    const jsBlocks = result.match(/```javascript[\s\S]*?```/gi) || [];
    const actionCount = Array.isArray(parsed?.actions) ? parsed.actions.length : 0;
    if (actionCount > 0 && jsBlocks.length === 0) {
      errors.push(`Extension defines ${actionCount} action(s) but no JavaScript code blocks found`);
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
