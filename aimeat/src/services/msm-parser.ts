import { parse as parseYaml } from 'yaml';

// ── MSM Types ──

export type MsmCategory = 'data' | 'utility' | 'image' | 'communication' | 'analytics' | 'analysis';

const VALID_CATEGORIES: MsmCategory[] = [
  'data', 'utility', 'image', 'communication', 'analytics', 'analysis',
];

export type MsmAuthType = 'bearer' | 'query_param' | 'oauth2' | 'api_key' | 'none';

const VALID_AUTH_TYPES: MsmAuthType[] = [
  'bearer', 'query_param', 'oauth2', 'api_key', 'none',
];

export interface MsmFieldDef {
  type: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  from?: string;
  items?: string | MsmFieldDef;
  properties?: Record<string, MsmFieldDef>;
}

export interface MsmAction {
  id: string;
  displayName: string;
  description: string;
  endpoint: {
    method: string;
    url: string;
    contentType?: string;
  };
  input: Record<string, MsmFieldDef>;
  output: Record<string, MsmFieldDef>;
  requestMapping?: string;
  pricing?: Record<string, unknown>;
  estimatedTimeSeconds?: number;
  examples?: unknown[];
}

export interface MsmDefinition {
  version: string;
  service: {
    name: string;
    description: string;
    homepage?: string;
    category: MsmCategory;
    tags: string[];
  };
  auth: {
    type: MsmAuthType;
    envVar?: string;
    envVarSecret?: string;
    paramName?: string;
    header?: string;
    tokenUrl?: string;
  };
  actions: MsmAction[];
  health?: {
    endpoint: string;
    method: string;
    intervalSeconds?: number;
    expectedStatus?: number;
  };
}

// ── Helpers (not exported) ──

function parseFieldDef(raw: unknown): MsmFieldDef {
  if (typeof raw === 'string') {
    return { type: raw };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { type: 'string' };
  }
  const r = raw as Record<string, unknown>;

  const def: MsmFieldDef = {
    type: String(r.type ?? 'string'),
  };

  if (r.required !== undefined) def.required = r.required === true;
  if (r.description !== undefined) def.description = String(r.description);
  if (Array.isArray(r.enum)) def.enum = r.enum.map(String);
  if (r.from !== undefined) def.from = String(r.from);

  // items: can be a string type or an object field def
  if (r.items !== undefined) {
    if (typeof r.items === 'string') {
      def.items = r.items;
    } else if (typeof r.items === 'object' && r.items !== null) {
      def.items = parseFieldDef(r.items);
    }
  }

  // properties: nested object fields
  if (r.properties && typeof r.properties === 'object') {
    def.properties = parseFieldMap(r.properties as Record<string, unknown>);
  }

  return def;
}

function parseFieldMap(raw: unknown): Record<string, MsmFieldDef> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, MsmFieldDef> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = parseFieldDef(value);
  }
  return result;
}

function parseAction(raw: unknown): MsmAction {
  if (typeof raw !== 'object' || raw === null) {
    return {
      id: '',
      displayName: '',
      description: '',
      endpoint: { method: 'GET', url: '' },
      input: {},
      output: {},
    };
  }
  const r = raw as Record<string, unknown>;
  const endpoint = (r.endpoint ?? {}) as Record<string, unknown>;

  const action: MsmAction = {
    id: String(r.id ?? ''),
    displayName: String(r.display_name ?? ''),
    description: String(r.description ?? '').trim(),
    endpoint: {
      method: String(endpoint.method ?? 'GET'),
      url: String(endpoint.url ?? ''),
    },
    input: parseFieldMap(r.input),
    output: parseFieldMap(r.output),
  };

  if (endpoint.content_type !== undefined) {
    action.endpoint.contentType = String(endpoint.content_type);
  }

  if (r.request_mapping !== undefined) {
    action.requestMapping = String(r.request_mapping);
  }

  if (r.pricing !== undefined && typeof r.pricing === 'object') {
    action.pricing = r.pricing as Record<string, unknown>;
  }

  if (r.estimated_time_seconds !== undefined) {
    action.estimatedTimeSeconds = Number(r.estimated_time_seconds);
  }

  if (Array.isArray(r.examples)) {
    action.examples = r.examples as unknown[];
  }

  return action;
}

// ── Parser ──

export function parseMsm(yamlContent: string): MsmDefinition {
  const raw = parseYaml(yamlContent) as Record<string, unknown>;

  const service = (raw.service ?? {}) as Record<string, unknown>;
  const auth = (raw.auth ?? {}) as Record<string, unknown>;
  const health = raw.health as Record<string, unknown> | undefined;
  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];

  return {
    version: String(raw.msm ?? '1.0'),
    service: {
      name: String(service.name ?? ''),
      description: String(service.description ?? ''),
      homepage: service.homepage ? String(service.homepage) : undefined,
      category: String(service.category ?? 'utility') as MsmCategory,
      tags: Array.isArray(service.tags) ? (service.tags as string[]) : [],
    },
    auth: {
      type: String(auth.type ?? 'none') as MsmAuthType,
      envVar: auth.env_var ? String(auth.env_var) : undefined,
      envVarSecret: auth.env_var_secret ? String(auth.env_var_secret) : undefined,
      paramName: auth.param_name ? String(auth.param_name) : undefined,
      header: auth.header ? String(auth.header) : undefined,
      tokenUrl: auth.token_url ? String(auth.token_url) : undefined,
    },
    actions: rawActions.map(parseAction),
    health: health ? {
      endpoint: String(health.endpoint ?? ''),
      method: String(health.method ?? 'GET'),
      intervalSeconds: health.interval_seconds !== undefined
        ? Number(health.interval_seconds) : undefined,
      expectedStatus: health.expected_status !== undefined
        ? Number(health.expected_status) : undefined,
    } : undefined,
  };
}

// ── Validator ──

export function validateMsm(def: MsmDefinition): string[] {
  const errors: string[] = [];

  if (!def.version) errors.push('msm version is required');
  if (!def.service.name) errors.push('service.name is required');
  if (!def.service.description) errors.push('service.description is required');
  if (!def.service.category) errors.push('service.category is required');
  if (!VALID_CATEGORIES.includes(def.service.category)) {
    errors.push(`service.category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Validate auth
  if (!def.auth.type) errors.push('auth.type is required');
  if (!VALID_AUTH_TYPES.includes(def.auth.type)) {
    errors.push(`auth.type must be one of: ${VALID_AUTH_TYPES.join(', ')}`);
  }
  if (def.auth.type === 'query_param' && !def.auth.paramName) {
    errors.push('auth.param_name is required when auth.type is query_param');
  }
  if (def.auth.type === 'oauth2' && !def.auth.tokenUrl) {
    errors.push('auth.token_url is required when auth.type is oauth2');
  }
  if (def.auth.type === 'api_key' && !def.auth.header && !def.auth.paramName && !def.auth.envVar) {
    errors.push('auth.header, auth.param_name, or auth.env_var is required when auth.type is api_key');
  }

  // Validate actions
  if (def.actions.length === 0) {
    errors.push('at least one action is required');
  }
  for (const action of def.actions) {
    const prefix = `action "${action.id || '(unnamed)'}"`;
    if (!action.id) errors.push(`${prefix}: id is required`);
    if (!action.displayName) errors.push(`${prefix}: display_name is required`);
    if (!action.description) errors.push(`${prefix}: description is required`);
    if (!action.endpoint.method) errors.push(`${prefix}: endpoint.method is required`);
    if (!action.endpoint.url) errors.push(`${prefix}: endpoint.url is required`);
    if (Object.keys(action.output).length === 0) {
      errors.push(`${prefix}: at least one output field is required`);
    }
  }

  // Validate health if present
  if (def.health) {
    if (!def.health.endpoint) errors.push('health.endpoint is required');
    if (!def.health.method) errors.push('health.method is required');
  }

  return errors;
}
