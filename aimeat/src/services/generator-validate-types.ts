/**
 * @file src/services/generator-validate-types.ts
 * @description Shared TypeScript types for the generator component validators. Extracted from generator-validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-validate.ts (max-file-lines)
 */

/* ── Types ───────────────────────────────────────────── */

export type ComponentType =
  | 'csm' | 'msm' | 'extension' | 'app'
  | 'memory' | 'translation' | 'cortex';

export interface CortexExtracted {
  manifest: string;
  libs: Array<{ filename: string; code: string }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  extracted: string | CortexExtracted | null;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed?: unknown;
  extracted: string;
}

export interface InterviewSpecValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed?: InterviewSpec;
}

export interface InterviewSpec {
  version: string;
  projectName: string;
  description: string;
  technicalLevel?: 'beginner' | 'intermediate' | 'advanced';
  useCases: Array<{ id: string; title: string; description?: string; priority?: 'must-have' | 'nice-to-have' }>;
  audience?: { type?: 'personal' | 'multi-user'; scale?: 'single' | 'small' | 'medium' | 'large'; description?: string };
  dataSources: Array<{ name: string; type: string; url?: string; verified?: boolean }>;
  dataModel: { entities?: unknown[] } & Record<string, unknown>;
  views: Array<{ type: string; title: string } & Record<string, unknown>>;
  constraints?: Record<string, unknown>;
  interviewNotes?: string;
  externalServices?: Array<{
    name: string;
    purpose: string;
    requiredSettings: Array<{
      key: string;
      type: 'secret' | 'url' | 'string' | 'number' | 'boolean';
      label: string;
    }>;
    sharingModel: 'shared' | 'per-user';
    suggestedBy: 'ai' | 'user';
  }>;
  sharedService?: boolean;
  adminAppRecommended?: boolean;
  adminAppReason?: string | null;
  userSettings?: Array<{
    key: string;
    type: 'string' | 'number' | 'boolean';
    label: string;
    default?: string | number | boolean;
  }>;
}

export interface AntiPatternResult {
  errors: string[];
  warnings: string[];
}

export interface SpecQualityResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
