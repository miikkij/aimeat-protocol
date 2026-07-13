/**
 * @file src/services/foundry-validate.ts
 * @description Server-side component validators for the AIMEAT foundry pipeline.
 *   Each component type (csm, msm, extension, app, memory, translation, cortex) has a
 *   validator that checks structure and extracts usable content from AI output.
 *   Includes validateInterviewSpec for structured interview JSON, validateBlueprint for
 *   blueprint JSON validation/sanitization, and validateAntiPatterns for crash-prevention checks.
 * @structure
 *   - types + shared helpers + per-type validators live in ./foundry-validate/* (re-exported below)
 *   - validateInterviewSpec(result): validates interview spec JSON from AI interviews
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (strips extra fields)
 * @usage import { validateBlueprint, validateComponent, validateInterviewSpec, validateAntiPatterns } from '../services/foundry-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Copied from generator-validate.ts (v1.1.0) and renamed to foundry
 *   v2.0.0 — 2026-07-13 — Split types/helpers/component-validators into ./foundry-validate/* (max-file-lines); this file keeps interview + blueprint validators and re-exports the rest
 */

import { extractCodeBlock, sanitizeJson } from './foundry-validate/helpers.js';
import type { InterviewSpec, InterviewSpecValidationResult, BlueprintValidationResult } from './foundry-validate/types.js';

// Re-export types + moved validators so existing consumers import from here unchanged.
export * from './foundry-validate/types.js';
export { validateAntiPatterns } from './foundry-validate/helpers.js';
export { validateComponent } from './foundry-validate/component-validators.js';

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

    if (!Array.isArray(parsed.components)) {
      errors.push('Missing "components" array');
    } else {
      const allowedComponentKeys = new Set(['id', 'type', 'label', 'produces', 'consumes', 'schedules', 'uses', 'role']);
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
      for (const [key, schema] of Object.entries(parsed.dataModel as Record<string, Record<string, unknown>>)) {
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
