/**
 * @file types.ts
 * @description TypeScript interfaces for the generator prompt system.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial types for DB-backed generator prompts
 */

/** Blueprint component entry */
export interface BlueprintComponent {
  id: string;
  type: string;
  subtype?: string;
  label: string;
  produces?: string[];
  consumes?: string[];
  uses?: string[];
  schedules?: Array<{ action: string; cron: string; description?: string }>;
}

/** Blueprint data model */
export interface BlueprintDataModel {
  structures?: Record<string, unknown>;
  memoryKeys?: Record<string, {
    description?: string;
    source?: string;
    producedBy?: string;
    consumedBy?: string[];
    schema?: unknown;
  }>;
  actions?: Record<string, {
    component?: string;
    description?: string;
    input?: unknown;
    output?: unknown;
  }>;
}

/** Full blueprint */
export interface Blueprint {
  architecture?: string;
  components: BlueprintComponent[];
  phases: Array<{ id: string; label?: string; componentIds: string[] }>;
  dataModel?: BlueprintDataModel;
  settings?: {
    service?: Array<{ key: string; type?: string; label?: string; required?: boolean }>;
    user?: Array<{ key: string; type?: string; label?: string; default?: unknown }>;
  };
  testScenarios?: Array<{
    component: string;
    scenarios: Array<{ action: string; input: Record<string, unknown>; expect: string; type?: string }>;
  }>;
}

/** Interview spec data source */
export interface DataSource {
  name: string;
  type?: string;
  url?: string;
  encoding?: string;
  notes?: string;
  responseEnvelope?: string | Record<string, unknown>;
  sampleEntry?: string | Record<string, unknown>;
  sampleResponse?: string | Record<string, unknown>;
  staticData?: unknown[];
}

/** Interview spec */
export interface InterviewSpec {
  locale?: string;
  useCases?: Array<{ id?: string; title?: string; description?: string; priority?: string } | string>;
  dataSources?: DataSource[];
  views?: Array<{ title: string; type?: string; description?: string; interactions?: string[] }>;
  style?: { mood?: string; layout?: string; typography?: string };
  dataModel?: { entities?: unknown[] };
  settings?: unknown[];
  externalServices?: unknown[];
  userSettings?: unknown[];
}

/** Component state in the generator pipeline */
export interface ComponentState {
  id: string;
  type: string;
  subtype?: string;
  label: string;
  status: string;
  result?: string;
  registeredAs?: string | null;
  spec?: Record<string, unknown> | null;
  probeResults?: ProbeResult[];
  contextBundle?: ComponentBundle | null;
  testCode?: string;
  testResult?: TestResult;
  testEnvironment?: string;
  validationErrors?: string[];
  history?: Array<{ action: string; at: string; by: string; [key: string]: unknown }>;
  _version?: number;
}

/** Probe result from extension action call */
export interface ProbeResult {
  action: string;
  input: Record<string, unknown>;
  status: number;
  response?: unknown;
}

/** Context bundle for downstream prompts */
export interface ComponentBundle {
  name: string;
  type: string;
  subtype?: string | null;
  registeredAs?: string;
  actions?: string[];
  exports?: string[];
  libName?: string;
  probeResults?: Array<{ action?: string; method?: string; input?: unknown; status?: number; response?: unknown }>;
  spec?: Record<string, unknown>;
  locale?: string;
  keys?: string[];
}

/** Test result */
export interface TestResult {
  componentId: string;
  type: string;
  status: 'passed' | 'failed' | 'skipped';
  scenarios: number;
  passed: number;
  errors: string[];
  screenshots: string[];
  fixRound: number;
  trace?: Array<{ type: string; args: unknown; result: unknown; status: number }>;
}

/** Runtime data passed to prompt resolvers */
export interface PromptRuntimeData {
  /** The project's blueprint */
  blueprint: Blueprint;
  /** The interview spec (may be null if not available) */
  interviewSpec: InterviewSpec | null;
  /** The specific blueprint component being generated */
  blueprintComponent?: BlueprintComponent;
  /** Label of the component being generated */
  componentLabel?: string;
  /** Type of the component being generated */
  componentType?: string;
  /** All completed components with their specs, bundles, and probe results */
  completedComponents?: ComponentState[];
  /** The component's own spec (for code generation from spec) */
  selfSpec?: Record<string, unknown>;
  /** Project description */
  projectDescription?: string;
  /** Extension spec (for downstream prompts) */
  extensionSpec?: Record<string, unknown>;
  /** Data API spec (for downstream prompts) */
  dataApiSpec?: Record<string, unknown>;
  /** Component specs (for app-domain prompt) */
  componentSpecs?: Array<Record<string, unknown>>;
  /** Translation keys */
  translationKeys?: string[];
  /** View definition from interview */
  viewDefinition?: unknown;
  /** Use cases from interview */
  useCases?: unknown[];
  /** Views from interview */
  views?: unknown[];
  /** For fix prompts */
  originalPrompt?: string;
  /** Generated code (for fix/test prompts) */
  code?: string;
  /** Validation/test errors */
  errors?: string[];
  /** Extension name (for test prompts) */
  extensionName?: string;
  /** Test failure context (for fix prompts) — errors, trace, dependency results */
  testContext?: Record<string, unknown>;
  /** Previous fix attempts (for fix prompts) — round, diagnosis, errors per round */
  previousAttempts?: Array<Record<string, unknown>>;
  /** Reflection diagnosis text (for fix prompts) — root cause analysis from diagnostic step */
  reflectionDiagnosis?: string;
}
