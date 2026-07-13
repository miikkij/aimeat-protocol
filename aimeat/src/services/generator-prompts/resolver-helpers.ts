/**
 * @file src/services/generator-prompts/resolver-helpers.ts
 * @description Shared helpers for the per-prompt variable resolvers — fallback warnings,
 *   daisyUI component reference builders, and formatting utilities (data sources,
 *   structures, specs, use cases, completed-component context). Extracted from
 *   resolvers.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import { logger } from '../../utils/logger.js';
import type {
  PromptRuntimeData,
  ComponentState, DataSource,
} from './types.js';
import { formatBundlesForPrompt } from './bundle.js';

export type Vars = Record<string, string>;

/** Log a loud warning when a resolver variable falls back to a default value.
 *  This means the blueprint/interview data is missing or the filter didn't match. */
export function warnFallback(promptId: string, varName: string, fallbackValue: string): string {
  logger.error(`[RESOLVER FALLBACK] ⚠️⚠️⚠️ ${promptId} → {{${varName}}} used FALLBACK: "${fallbackValue.slice(0, 80)}" — DATA IS MISSING, PROMPT WILL BE DEGRADED`);
  return fallbackValue;
}

// ── DaisyUI component HTML examples ──
// Used by resolvers to inject ONLY the components the spec selected.
export const DAISYUI_COMPONENTS: Record<string, string> = {
  table: '<table class="table">\n  <thead><tr><th>Name</th><th>Status</th></tr></thead>\n  <tbody><tr><td>Item</td><td><span class="badge badge-success">Active</span></td></tr></tbody>\n</table>',
  card: '<div class="card bg-base-100 shadow-sm">\n  <div class="card-body">\n    <h2 class="card-title">Title</h2>\n    <p>Content</p>\n    <div class="card-actions justify-end"><button class="btn btn-primary">Action</button></div>\n  </div>\n</div>',
  tabs: '<div role="tablist" class="tabs tabs-bordered">\n  <a role="tab" class="tab tab-active">Tab 1</a>\n  <a role="tab" class="tab">Tab 2</a>\n</div>',
  badge: '<span class="badge badge-primary">Label</span>\n<span class="badge badge-success">Active</span>\n<span class="badge badge-warning">Pending</span>',
  alert: '<div role="alert" class="alert alert-info"><span>Info message</span></div>',
  modal: '<dialog class="modal"><div class="modal-box">\n  <h3 class="font-bold text-lg">Title</h3>\n  <p>Content</p>\n  <div class="modal-action"><form method="dialog"><button class="btn">Close</button></form></div>\n</div></dialog>',
  stat: '<div class="stats shadow">\n  <div class="stat"><div class="stat-title">Total</div><div class="stat-value">31K</div></div>\n</div>',
  timeline: '<ul class="timeline timeline-vertical">\n  <li><div class="timeline-start">Date</div><div class="timeline-middle">●</div><div class="timeline-end">Event</div><hr/></li>\n</ul>',
  input: '<label class="input"><span class="label">Label</span><input type="text" placeholder="Type..." /></label>',
  select: '<label class="select"><span class="label">Pick</span><select><option>Option</option></select></label>',
  toggle: '<label class="toggle"><span class="label">Setting</span><input type="checkbox" /></label>',
  checkbox: '<label class="checkbox"><input type="checkbox" /><span>Option</span></label>',
  textarea: '<label class="textarea"><span class="label">Notes</span><textarea placeholder="Write..."></textarea></label>',
  button: '<button class="btn btn-primary">Primary</button>\n<button class="btn btn-outline">Outline</button>\n<button class="btn btn-ghost">Ghost</button>',
  loading: '<span class="loading loading-spinner loading-md"></span>',
  progress: '<progress class="progress progress-primary w-56" value="70" max="100"></progress>',
  tooltip: '<div class="tooltip" data-tip="Info"><button class="btn">Hover</button></div>',
  collapse: '<div class="collapse collapse-arrow bg-base-100 border border-base-300">\n  <input type="radio" name="accordion" />\n  <div class="collapse-title font-semibold">Title</div>\n  <div class="collapse-content"><p>Content</p></div>\n</div>',
  dropdown: '<div class="dropdown"><div tabindex="0" role="button" class="btn">Menu</div>\n  <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box w-52 p-2 shadow-sm">\n    <li><a>Item 1</a></li><li><a>Item 2</a></li>\n  </ul>\n</div>',
  drawer: '<div class="drawer lg:drawer-open">\n  <input id="drawer" type="checkbox" class="drawer-toggle" />\n  <div class="drawer-content"><!-- main content --></div>\n  <div class="drawer-side"><ul class="menu bg-base-200 min-h-full w-60 p-4">\n    <li><a>Home</a></li><li><a>Settings</a></li>\n  </ul></div>\n</div>',
  navbar: '<div class="navbar bg-base-100 shadow-sm">\n  <div class="flex-1"><a class="btn btn-ghost text-xl">App</a></div>\n  <div class="flex-none"><button class="btn btn-ghost">Settings</button></div>\n</div>',
  menu: '<ul class="menu bg-base-200 rounded-box w-56">\n  <li><a>Item 1</a></li><li><a class="active">Active</a></li>\n</ul>',
  breadcrumbs: '<div class="breadcrumbs text-sm"><ul><li><a>Home</a></li><li>Current</li></ul></div>',
  steps: '<ul class="steps"><li class="step step-primary">Step 1</li><li class="step">Step 2</li></ul>',
  hero: '<div class="hero bg-base-200 min-h-96"><div class="hero-content text-center">\n  <div class="max-w-md"><h1 class="text-5xl font-bold">Title</h1><p>Description</p></div>\n</div></div>',
  carousel: '<div class="carousel w-full"><div class="carousel-item w-full"><img src="..." class="w-full" /></div></div>',
  divider: '<div class="divider">OR</div>',
  toast: '<div class="toast toast-end"><div class="alert alert-success"><span>Saved!</span></div></div>',
  pagination: '<div class="join"><button class="join-item btn">«</button><button class="join-item btn btn-active">1</button><button class="join-item btn">»</button></div>',
  avatar: '<div class="avatar placeholder"><div class="bg-neutral text-neutral-content w-12 rounded-full"><span>AB</span></div></div>',
  skeleton: '<div class="skeleton h-32 w-full"></div>',
};

/** Build daisyUI section from spec's ui.components list */
export function buildDaisyUiSection(components: string[]): string {
  if (components.length === 0) return '';
  let section = '## UI Component Reference (daisyUI) — MANDATORY\n\n';
  section += 'Use these daisyUI CSS classes for all UI. Do NOT build raw unstyled HTML.\n';
  section += 'DaisyUI + Tailwind CSS is loaded on the page. Just use the class names.\n\n';
  for (const comp of components) {
    const html = DAISYUI_COMPONENTS[comp];
    if (html) {
      section += `### ${comp}\n\`\`\`html\n${html}\n\`\`\`\n\n`;
    }
  }
  section += 'Combine with Tailwind utilities for spacing/layout: `p-4`, `mb-2`, `flex`, `grid`, `gap-4`, `w-full`, `max-w-lg`, `rounded-lg`, `text-sm`, `font-bold`, etc.\n';
  return section;
}

/** Full daisyUI section fallback (for specs without ui.components) */
export function buildFullDaisyUiSection(): string {
  return buildDaisyUiSection(['card', 'table', 'badge', 'button', 'input', 'select', 'alert', 'tabs', 'loading', 'modal', 'toast']);
}

// ── Helper functions ──

export function formatDataSources(dataSources: DataSource[] | undefined): string {
  if (!dataSources || dataSources.length === 0) return warnFallback('helper', 'data_sources', 'No data sources specified.');
  return dataSources.map(ds => {
    const lines: string[] = [`- **${ds.name}**: ${ds.url || 'user-input'}`];
    if (ds.responseEnvelope) {
      lines.push(`  Response envelope: \`${typeof ds.responseEnvelope === 'string' ? ds.responseEnvelope : JSON.stringify(ds.responseEnvelope)}\``);
    }
    if (ds.sampleEntry) {
      lines.push(`  Sample entry:\n\`\`\`json\n${typeof ds.sampleEntry === 'string' ? ds.sampleEntry : JSON.stringify(ds.sampleEntry, null, 2)}\n\`\`\``);
    }
    if (ds.sampleResponse) {
      const text = typeof ds.sampleResponse === 'string' ? ds.sampleResponse : JSON.stringify(ds.sampleResponse, null, 2);
      lines.push(`  Sample response:\n\`\`\`json\n${text.slice(0, 2000)}\n\`\`\``);
    }
    if (ds.notes) lines.push(`  Notes: ${ds.notes}`);
    return lines.join('\n');
  }).join('\n\n');
}

export function formatStructures(structures: Record<string, unknown> | undefined): string {
  if (!structures || Object.keys(structures).length === 0) return warnFallback('helper', 'structures', 'No structures defined.');
  return Object.entries(structures).map(([name, schema]) =>
    `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
  ).join('\n\n');
}

export function formatSpec(spec: Record<string, unknown> | undefined | null, label: string): string {
  if (!spec) return '';
  return `\n## ${label} (formal contract — your code MUST match this exactly)\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n`;
}

export function formatUseCases(useCases: unknown[] | undefined): string {
  if (!useCases || useCases.length === 0) return 'Not specified.';
  return useCases.map((uc, i) => {
    if (typeof uc === 'string') return `${i + 1}. ${uc}`;
    const obj = uc as Record<string, string>;
    return `${i + 1}. ${obj.description || obj.title || JSON.stringify(uc)}`;
  }).join('\n');
}

export function formatCompletedContext(completedComponents: ComponentState[] | undefined): string {
  if (!completedComponents || completedComponents.length === 0) return '';
  const withSpecs = completedComponents.filter(c => c.spec);
  const withoutSpecs = completedComponents.filter(c => !c.spec);

  let context = '';
  for (const c of withSpecs) {
    const specLabel = c.type === 'extension' ? `Extension Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : c.subtype === 'data' ? `Data API Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : c.subtype === 'component' ? `Component Spec: ${(c.spec as Record<string, string>)?.name || c.label}`
      : `Spec: ${c.label}`;
    context += formatSpec(c.spec, specLabel);
  }

  const bundles = withoutSpecs
    .filter(c => c.contextBundle)
    .map(c => c.contextBundle!);
  if (bundles.length > 0) {
    context += formatBundlesForPrompt(bundles);
  }

  const unbundled = withoutSpecs.filter(c => !c.contextBundle);
  if (unbundled.length > 0) {
    context += '\nAlready completed:\n';
    for (const c of unbundled) {
      context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
    }
  }

  return context;
}

// ── Shared context builder ──

export function buildContextString(data: PromptRuntimeData): string {
  let context = '';

  // Project description (not for extensions — they're project-agnostic)
  if (data.componentType !== 'extension') {
    context += `Project: ${data.projectDescription || ''}\n`;
  }

  // DataModel entries relevant to this component
  if (data.blueprint.dataModel && data.blueprintComponent) {
    const dm = data.blueprint.dataModel;
    const compId = data.blueprintComponent.id;
    const relevant: Record<string, unknown> = {};

    for (const [key, schema] of Object.entries(dm.memoryKeys || {})) {
      if (schema.producedBy === compId || schema.consumedBy?.includes(compId)) {
        // Strip pipeline metadata (source, producedBy, consumedBy) — not part of the data shape
        relevant[key] = Object.fromEntries(
          Object.entries(schema).filter(([k]) => k !== 'source' && k !== 'producedBy' && k !== 'consumedBy'),
        );
      }
    }

    if (Object.keys(relevant).length > 0) {
      context += '\n## Domain Data Model (EXACT schemas)\n```json\n' + JSON.stringify(relevant, null, 2) + '\n```\n\n';
    }
  }

  // Data sources for extensions
  if (data.componentType === 'extension' && data.interviewSpec?.dataSources) {
    context += '\n## Data Source Details\n' + formatDataSources(data.interviewSpec.dataSources) + '\n';
  }

  // Completed components context
  context += formatCompletedContext(data.completedComponents);

  // Interview use cases (for app/cortex)
  if ((data.componentType === 'app' || data.componentType === 'cortex') && data.interviewSpec?.useCases) {
    context += '\n## Use Cases\n' + formatUseCases(data.interviewSpec.useCases) + '\n';
  }

  return context;
}
