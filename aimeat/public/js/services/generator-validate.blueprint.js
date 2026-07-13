/**
 * @file public/js/services/generator-validate.blueprint.js
 * @description Interview-spec, spec-quality, and blueprint validators for the generator
 *   pipeline. Extracted from generator-validate.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-validate.js (max-file-lines)
 */
import { extractCodeBlock, sanitizeJson } from './generator-validate.helpers.js';

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
    // service_slug is REQUIRED — it namespaces all memory keys, translations, and cortex naming
    if (!parsed.service_slug || typeof parsed.service_slug !== 'string') {
      errors.push('Missing "service_slug" field — required for memory key namespacing. Must be a kebab-case string (e.g., "company-registry").');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.service_slug)) {
      errors.push(`Invalid "service_slug": "${parsed.service_slug}" — must be kebab-case (lowercase letters, numbers, hyphens only)`);
    }

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
