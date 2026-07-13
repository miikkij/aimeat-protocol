/**
 * @file src/services/generator-validate-blueprint.ts
 * @description Spec-quality gate and blueprint JSON validator/sanitizer for the generator. Extracted from generator-validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-validate.ts (max-file-lines)
 */

import { extractCodeBlock, sanitizeJson } from './generator-validate-helpers.js';
import type { SpecQualityResult, BlueprintValidationResult } from './generator-validate-types.js';

/* ── Spec Quality Gate ───────────────────────────────── */

/**
 * Check interview spec quality before proceeding to blueprint — no AI, just automated
 * checks on the spec data. Mirrors the UI's validateSpecQuality (public/js/services/generator-validate.js).
 */
export function validateSpecQuality(spec: unknown): SpecQualityResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!spec) {
    errors.push('No specification provided');
    return { valid: false, errors, warnings };
  }

  const s = spec as Record<string, unknown>;

  if (!Array.isArray(s.useCases) || (s.useCases as unknown[]).length < 2) {
    warnings.push('Less than 2 use cases defined — consider adding more to get a useful application');
  }

  if (Array.isArray(s.dataSources)) {
    for (const ds of s.dataSources as Array<Record<string, unknown>>) {
      const dsName = (ds.name || ds.id) as string;
      if (!ds.url && ds.type !== 'user-input') {
        warnings.push(`Data source "${dsName}" has no URL`);
      }
      if (!ds.sampleEntry && ds.type !== 'user-input' && ds.fallback !== 'defer') {
        warnings.push(`Data source "${dsName}" has no sampleEntry — structures will be guessed, not verified`);
      }
      if (ds.verified === false && !ds.fallback) {
        errors.push(`Data source "${dsName}" is unverified and has no fallback strategy`);
      }
    }
  }

  if (!Array.isArray(s.views) || (s.views as unknown[]).length === 0) {
    warnings.push('No views defined — the blueprint will guess the UI layout');
  }

  if (!s.locale) {
    warnings.push('No locale set — defaulting to English');
  }

  if (!s.style) {
    warnings.push('No style preferences — the app will use default layout');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ── Blueprint Validator ─────────────────────────────── */

interface BlueprintComponent {
  id?: string;
  type?: string;
  label?: string;
  produces?: unknown;
  consumes?: unknown;
  schedules?: Array<{ action?: string; cron?: string }>;
  uses?: unknown;
  [key: string]: unknown;
}

interface CleanComponent {
  id: string | undefined;
  type: string | undefined;
  subtype?: string;
  label: string | undefined;
  produces?: string[];
  consumes?: string[];
  schedules?: Array<{ action?: string; cron?: string }>;
  uses?: unknown[];
  role?: string;
}

export function validateBlueprint(result: string): BlueprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = extractCodeBlock(result, 'json') || result;
  const json = sanitizeJson(raw);
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;

    // service_slug is REQUIRED — it namespaces all memory keys, translations, and cortex naming
    if (!parsed.service_slug || typeof parsed.service_slug !== 'string') {
      errors.push('Missing "service_slug" field — required for memory key namespacing. Must be a kebab-case string (e.g., "company-registry").');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.service_slug as string)) {
      errors.push(`Invalid "service_slug": "${parsed.service_slug}" — must be kebab-case (lowercase letters, numbers, hyphens only)`);
    }

    if (!Array.isArray(parsed.components)) {
      errors.push('Missing "components" array');
    } else {
      const allowedComponentKeys = new Set(['id', 'type', 'subtype', 'label', 'produces', 'consumes', 'schedules', 'uses', 'role']);
      parsed.components = (parsed.components as BlueprintComponent[]).map((c): CleanComponent => {
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

        const clean: CleanComponent = { id: c.id, type: c.type, label: c.label };
        if (typeof c.subtype === 'string' && c.type === 'cortex') clean.subtype = c.subtype;
        if (typeof c.role === 'string') clean.role = c.role;
        if (Array.isArray(c.produces)) clean.produces = c.produces as string[];
        if (Array.isArray(c.consumes)) clean.consumes = c.consumes as string[];

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

        if (Array.isArray(c.uses) && c.type === 'cortex') clean.uses = c.uses as unknown[];
        return clean;
      });
    }

    // Cross-validate produces/consumes: warn if a consumed key has no producer
    if (parsed.components) {
      const components = parsed.components as CleanComponent[];
      const allProduced = new Set(components.flatMap(c => c.produces || []));
      for (const c of components) {
        for (const consumed of (c.consumes || [])) {
          if (!allProduced.has(consumed)) {
            warnings.push(`Component "${c.id}" consumes "${consumed}" but no component produces it`);
          }
        }
      }
    }

    if (!Array.isArray(parsed.phases)) {
      errors.push('Missing "phases" array');
    } else {
      parsed.phases = (parsed.phases as Record<string, unknown>[]).map(p => {
        if (!p.id) errors.push(`Phase missing "id"`);
        if (!p.label) errors.push(`Phase "${p.id || '?'}" missing "label"`);
        if (!Array.isArray(p.componentIds)) errors.push(`Phase "${p.id || '?'}" missing "componentIds" array`);
        return { id: p.id, label: p.label, componentIds: p.componentIds };
      });
    }

    // Validate dataModel if present
    if (parsed.dataModel && typeof parsed.dataModel === 'object') {
      const componentIds = new Set(
        ((parsed.components || []) as CleanComponent[]).map(c => c.id).filter(Boolean),
      );
      const dm = parsed.dataModel as Record<string, unknown>;
      // New structures/$ref format: structures + memoryKeys + actions. Old flat format falls to else.
      if (dm.structures && typeof dm.structures === 'object') {
        const structures = dm.structures as Record<string, unknown>;
        for (const [name, struct] of Object.entries(structures as Record<string, Record<string, unknown>>)) {
          if (!struct.type) warnings.push(`structure "${name}" missing "type"`);
        }
        if (dm.memoryKeys && typeof dm.memoryKeys === 'object') {
          for (const [key, schema] of Object.entries(dm.memoryKeys as Record<string, Record<string, unknown>>)) {
            if (schema.$ref && !structures[schema.$ref as string]) {
              errors.push(`memoryKey "${key}" references unknown structure "${schema.$ref}"`);
            }
            const items = schema.items as Record<string, unknown> | undefined;
            if (items?.$ref && !structures[items.$ref as string]) {
              errors.push(`memoryKey "${key}" items references unknown structure "${items.$ref}"`);
            }
            if (schema.producedBy && !componentIds.has(schema.producedBy as string)) {
              errors.push(`memoryKey "${key}" producedBy "${schema.producedBy}" does not match any component`);
            }
          }
        }
        if (dm.actions && typeof dm.actions === 'object') {
          for (const [name, action] of Object.entries(dm.actions as Record<string, Record<string, unknown>>)) {
            const output = action.output as Record<string, unknown> | undefined;
            if (output?.$ref && !structures[output.$ref as string]) {
              errors.push(`action "${name}" output references unknown structure "${output.$ref}"`);
            }
          }
        }
      } else {
        // Old flat format — backward compatible (skip the structured containers if mixed in)
        for (const [key, schema] of Object.entries(dm as Record<string, Record<string, unknown>>)) {
          if (key === 'structures' || key === 'memoryKeys' || key === 'actions') continue;
          if (!schema.type) warnings.push(`dataModel "${key}" missing "type"`);
          if (!schema.source) warnings.push(`dataModel "${key}" missing "source"`);
          if (!schema.producedBy) {
            errors.push(`dataModel "${key}" missing "producedBy"`);
          } else if (!componentIds.has(schema.producedBy as string)) {
            errors.push(`dataModel "${key}" producedBy "${schema.producedBy}" does not match any component`);
          }
          if (!Array.isArray(schema.consumedBy) || (schema.consumedBy as unknown[]).length === 0) {
            warnings.push(`dataModel "${key}" has no consumers`);
          } else {
            for (const cid of schema.consumedBy as string[]) {
              if (!componentIds.has(cid)) {
                errors.push(`dataModel "${key}" consumedBy "${cid}" does not match any component`);
              }
            }
          }
        }
      }
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Invalid JSON: ${msg}`);
    return { valid: false, errors, warnings, parsed: null, extracted: json };
  }
}
