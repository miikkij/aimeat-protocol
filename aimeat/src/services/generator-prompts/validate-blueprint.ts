/**
 * @file src/services/generator-prompts/validate-blueprint.ts
 * @description JSON-spec validators for the generator pipeline — interview spec, spec
 *   quality gate, and blueprint (validate + sanitize + strip extra fields). Extracted
 *   from validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from validate.ts (max-file-lines)
 */
import {
  type InterviewValidationResult,
  type SpecQualityResult,
  type BlueprintValidationResult,
  extractCodeBlock,
  sanitizeJson,
} from './validate-shared.js';

/* ── Interview Spec Validator ────────────────────────── */

/**
 * Validate and extract an interview specification JSON from AI output.
 * Expects a JSON code block with required fields.
 */
export function validateInterviewSpec(result: string): InterviewValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const raw = extractCodeBlock(result, 'json');
    const cleaned = sanitizeJson(raw);
    const spec = JSON.parse(cleaned) as Record<string, unknown>;

    if (!spec.version) errors.push('Missing "version" field');
    if (!spec.projectName) errors.push('Missing "projectName" field');
    if (!spec.description) errors.push('Missing "description" field');
    if (!Array.isArray(spec.useCases) || (spec.useCases as unknown[]).length === 0) {
      errors.push('Missing or empty "useCases" array');
    }
    if (!Array.isArray(spec.dataSources)) errors.push('Missing "dataSources" array');
    if (!spec.dataModel) errors.push('Missing "dataModel" object');
    if (!Array.isArray(spec.views) || (spec.views as unknown[]).length === 0) {
      errors.push('Missing or empty "views" array');
    }

    if (Array.isArray(spec.useCases)) {
      (spec.useCases as Array<Record<string, unknown>>).forEach((uc, i) => {
        if (!uc.id) errors.push(`useCases[${i}] missing "id"`);
        if (!uc.title) errors.push(`useCases[${i}] missing "title"`);
      });
    }

    if (Array.isArray(spec.dataSources)) {
      (spec.dataSources as Array<Record<string, unknown>>).forEach((ds, i) => {
        if (!ds.name) errors.push(`dataSources[${i}] missing "name"`);
        if (!ds.type) errors.push(`dataSources[${i}] missing "type"`);
        if (ds.url && !ds.verified) {
          warnings.push(`dataSources[${i}] "${ds.name as string}" URL not verified — may need manual validation`);
        }
      });
    }

    if (Array.isArray(spec.views)) {
      (spec.views as Array<Record<string, unknown>>).forEach((v, i) => {
        if (!v.type) errors.push(`views[${i}] missing "type"`);
        if (!v.title) errors.push(`views[${i}] missing "title"`);
      });
    }

    // Validate optional externalServices
    if (spec.externalServices !== undefined) {
      if (!Array.isArray(spec.externalServices)) {
        errors.push('externalServices must be an array');
      } else {
        for (const svc of spec.externalServices as Array<Record<string, unknown>>) {
          if (!svc.name || typeof svc.name !== 'string') errors.push('externalServices[].name required');
          if (!Array.isArray(svc.requiredSettings)) errors.push(`externalServices[${svc.name as string}].requiredSettings must be array`);
          if (!['shared', 'per-user'].includes(svc.sharingModel as string)) errors.push(`externalServices[${svc.name as string}].sharingModel invalid`);
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
    return { valid: false, errors: [`Failed to parse interview spec: ${(e as Error).message}`], warnings: [] };
  }
}

/* ── Spec Quality Gate ──────────────────────────────── */

/**
 * Check interview spec quality before proceeding to blueprint.
 * No AI needed — just automated checks on the spec data.
 */
export function validateSpecQuality(spec: unknown): SpecQualityResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!spec) { errors.push('No specification provided'); return { valid: false, errors, warnings }; }

  const s = spec as Record<string, unknown>;

  // Use cases
  if (!Array.isArray(s.useCases) || (s.useCases as unknown[]).length < 2) {
    warnings.push('Less than 2 use cases defined — consider adding more to get a useful application');
  }

  // Data sources
  if (Array.isArray(s.dataSources)) {
    for (const ds of s.dataSources as Array<Record<string, unknown>>) {
      if (!ds.url && ds.type !== 'user-input') {
        warnings.push(`Data source "${(ds.name || ds.id) as string}" has no URL`);
      }
      if (!ds.sampleEntry && ds.type !== 'user-input' && ds.fallback !== 'defer') {
        warnings.push(`Data source "${(ds.name || ds.id) as string}" has no sampleEntry — structures will be guessed, not verified`);
      }
      if (ds.verified === false && !ds.fallback) {
        errors.push(`Data source "${(ds.name || ds.id) as string}" is unverified and has no fallback strategy`);
      }
    }
  }

  // Views
  if (!Array.isArray(s.views) || (s.views as unknown[]).length === 0) {
    warnings.push('No views defined — the blueprint will guess the UI layout');
  }

  // Locale
  if (!s.locale) {
    warnings.push('No locale set — defaulting to English');
  }

  // Style
  if (!s.style) {
    warnings.push('No style preferences — the app will use default layout');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ── Blueprint Validator ─────────────────────────────── */

export function validateBlueprint(result: string): BlueprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = extractCodeBlock(result, 'json') || result;
  const json = sanitizeJson(raw);
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(parsed.components)) errors.push('Missing "components" array');
    else {
      const allowedComponentKeys = new Set(['id', 'type', 'subtype', 'label', 'produces', 'consumes', 'schedules', 'uses', 'role']);
      parsed.components = (parsed.components as Array<Record<string, unknown>>).map(c => {
        if (!c.id) errors.push(`Component missing "id" field`);
        if (!c.type) errors.push(`Component "${c.id || '?'}" missing "type" field`);
        if (!c.label) errors.push(`Component "${c.id || '?'}" missing "label" field`);
        // Auto-fix common AI shorthand: "ext" → "extension"
        if (c.type === 'ext') {
          c.type = 'extension';
          warnings.push(`Component "${c.id}": auto-corrected type "ext" → "extension"`);
        }
        if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation', 'cortex'].includes(c.type as string)) {
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
        const clean: Record<string, unknown> = { id: c.id, type: c.type, label: c.label };
        if (typeof c.subtype === 'string' && c.type === 'cortex') clean.subtype = c.subtype;
        if (typeof c.role === 'string') clean.role = c.role;
        if (Array.isArray(c.produces)) clean.produces = c.produces;
        if (Array.isArray(c.consumes)) clean.consumes = c.consumes;
        if (Array.isArray(c.schedules) && c.type === 'extension') {
          // Validate and auto-fix each schedule entry
          for (const s of c.schedules as Array<Record<string, unknown>>) {
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
      const allProduced = new Set((parsed.components as Array<Record<string, unknown>>).flatMap(c => (c.produces as string[]) || []));
      for (const c of parsed.components as Array<Record<string, unknown>>) {
        for (const consumed of ((c.consumes as string[]) || [])) {
          if (!allProduced.has(consumed)) {
            warnings.push(`Component "${c.id}" consumes "${consumed}" but no component produces it`);
          }
        }
      }
    }

    if (!Array.isArray(parsed.phases)) errors.push('Missing "phases" array');
    else {
      parsed.phases = (parsed.phases as Array<Record<string, unknown>>).map(p => {
        if (!p.id) errors.push(`Phase missing "id"`);
        if (!p.label) errors.push(`Phase "${p.id || '?'}" missing "label"`);
        if (!Array.isArray(p.componentIds)) errors.push(`Phase "${p.id || '?'}" missing "componentIds" array`);
        return { id: p.id, label: p.label, componentIds: p.componentIds };
      });
    }

    // Validate dataModel if present — supports both old flat format and new structures/$ref format
    if (parsed.dataModel && typeof parsed.dataModel === 'object') {
      const componentIds = new Set(((parsed.components || []) as Array<Record<string, unknown>>).map(c => c.id as string));
      const dm = parsed.dataModel as Record<string, unknown>;

      // New format: has structures + memoryKeys + actions
      if (dm.structures && typeof dm.structures === 'object') {
        // Validate structures
        for (const [name, struct] of Object.entries(dm.structures as Record<string, Record<string, unknown>>)) {
          if (!struct.type) warnings.push(`structure "${name}" missing "type"`);
        }
        // Validate $ref references in memoryKeys
        if (dm.memoryKeys && typeof dm.memoryKeys === 'object') {
          const structures = dm.structures as Record<string, unknown>;
          for (const [key, schema] of Object.entries(dm.memoryKeys as Record<string, Record<string, unknown>>)) {
            if (schema.$ref && !(structures as Record<string, unknown>)[schema.$ref as string]) {
              errors.push(`memoryKey "${key}" references unknown structure "${schema.$ref}"`);
            }
            const items = schema.items as Record<string, unknown> | undefined;
            if (items?.$ref && !(structures as Record<string, unknown>)[items.$ref as string]) {
              errors.push(`memoryKey "${key}" items references unknown structure "${items.$ref}"`);
            }
            if (schema.producedBy && !componentIds.has(schema.producedBy as string)) {
              errors.push(`memoryKey "${key}" producedBy "${schema.producedBy}" does not match any component`);
            }
          }
        }
        // Validate $ref references in actions
        if (dm.actions && typeof dm.actions === 'object') {
          const structures = dm.structures as Record<string, unknown>;
          for (const [name, action] of Object.entries(dm.actions as Record<string, Record<string, unknown>>)) {
            const output = action.output as Record<string, unknown> | undefined;
            if (output?.$ref && !(structures as Record<string, unknown>)[output.$ref as string]) {
              errors.push(`action "${name}" output references unknown structure "${output.$ref}"`);
            }
          }
        }
      } else {
        // Old flat format — backward compatible
        for (const [key, schema] of Object.entries(dm)) {
          if (key === 'structures' || key === 'memoryKeys' || key === 'actions') continue;
          const s = schema as Record<string, unknown>;
          if (!s.type) warnings.push(`dataModel "${key}" missing "type"`);
          if (!s.source) warnings.push(`dataModel "${key}" missing "source"`);
          if (!s.producedBy) {
            errors.push(`dataModel "${key}" missing "producedBy"`);
          } else if (!componentIds.has(s.producedBy as string)) {
            errors.push(`dataModel "${key}" producedBy "${s.producedBy}" does not match any component`);
          }
          if (!Array.isArray(s.consumedBy) || (s.consumedBy as unknown[]).length === 0) {
            warnings.push(`dataModel "${key}" has no consumers`);
          } else {
            for (const cid of s.consumedBy as string[]) {
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
      const s = parsed.settings as Record<string, unknown>;
      if (s.service && !Array.isArray(s.service)) errors.push('settings.service must be an array');
      if (s.user && !Array.isArray(s.user)) errors.push('settings.user must be an array');
      if (Array.isArray(s.service)) {
        for (const entry of s.service as Array<Record<string, unknown>>) {
          if (!entry.key || !entry.type || !entry.label) {
            errors.push('settings.service entry missing key/type/label');
          }
          if (entry.type && !['secret', 'url', 'string', 'number', 'boolean'].includes(entry.type as string)) {
            warnings.push(`settings.service[${entry.key}] has unknown type: ${entry.type}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings, parsed, extracted: json };
  } catch (e) {
    errors.push(`Invalid JSON: ${(e as Error).message}`);
    return { valid: false, errors, warnings, parsed: null, extracted: json };
  }
}
