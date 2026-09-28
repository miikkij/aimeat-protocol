/**
 * @file src/services/goose-env.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The environment the built-in chat agent (a `goose acp` child) starts with.
 *
 *   WHY AN ALLOW-LIST. The child was started with a copy of the node's whole environment. That holds
 *   DATABASE_URL, AIMEAT_PRIVATE_KEY, AIMEAT_ENCRYPTION_KEY, the SMTP password, the OAuth client
 *   secrets and every other AIMEAT_* value. The agent runs a model that people talk to, and goose
 *   loads the extensions its own configuration switches on; with a shell or developer extension on,
 *   a chat user could ask for `env` and read all of it. The child now gets what a process needs to
 *   run at all (paths, locale, temp directories, proxy and certificate settings), goose's own
 *   GOOSE_* settings, the provider settings the node itself sets, and the names the host lists in
 *   AIMEAT_GOOSE_ENV_PASSTHROUGH. Nothing else.
 *
 *   The passthrough list is read from the environment only. It is immutable on purpose: an operator
 *   who could extend it from the admin screen could hand the agent DATABASE_URL again.
 *
 *   TWO ROUTES FOR THE MODEL CALLS (Jouni, 2026-09-28, plan 07 section 6, J6).
 *   - The node route, the default: AIMEAT_GOOSE_PROVIDER_API_KEY is empty. Each person's turns run in
 *     a goose child of their own (services/chat-agent-pool.ts), and that child's OpenAI provider
 *     points at this node's POST /v1/llm/chat/completions with that person's own chat agent token as
 *     the API key. Every model call then passes the gate: the owner's model policy (the "the node's
 *     chat" switch), their daily budget, their allowance and the usage record. The token is the only
 *     credential in the child, so the child can spend only that person's own budget.
 *   - The shared key, the operator's special case: AIMEAT_GOOSE_PROVIDER_API_KEY is set. One child
 *     for everybody, OPENROUTER_API_KEY = that key, and no call is metered per person.
 *
 *   The goose settings the node route relies on, in goose 1.50.0: GOOSE_PROVIDER=openai selects the
 *   OpenAI provider; OPENAI_HOST (default https://api.openai.com) and OPENAI_BASE_PATH (default
 *   v1/chat/completions) make the request URL; OPENAI_API_KEY is sent as `Authorization: Bearer`.
 *   Measured 2026-09-28 by running the real `goose acp` with this environment against a local stub:
 *   a turn sent POST <host>/v1/llm/chat/completions (stream: true, model = GOOSE_MODEL) and
 *   GET <host>/v1/llm/models, every request carrying `Bearer <the person's token>`, and one turn made
 *   two completions, so on the node one turn can be more than one metered call. OPENAI_BASE_URL is another spelling of
 *   the address in the same provider (a string in the binary), so the node removes it rather than let
 *   a passthrough value move the calls elsewhere.
 * @structure GOOSE_BASE_ENV · NODE_CHOOSES_MODEL · LLM_PROXY_PATH · chatUsesSharedKey(config) ·
 *   gooseChildEnv(config, parentEnv, personal?)
 * @usage spawn(bin, ['acp'], { env: gooseChildEnv(config, process.env, { token }) })
 * @version-history
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: the node route. Without the shared key the child's
 *     OpenAI provider points at /v1/llm with the person's own chat token, so the model policy, the
 *     budget and the metering apply to the chat. The shared key is the operator's special case.
 *   v1.0.0 — 2026-09-16 — Initial. The child had the node's whole environment.
 */
import type { AimeatConfig } from '../config.js';

/** Names every process needs, on Linux, macOS and Windows. None of them holds a credential. */
export const GOOSE_BASE_ENV = [
  'PATH', 'PATHEXT', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TZ', 'LANG', 'LANGUAGE',
  'TMPDIR', 'TMP', 'TEMP',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS',
] as const;

/**
 * The model name goose sends when the operator named none. POST /v1/llm/chat/completions ignores the
 * caller's model and lets the owner's preference and the node's default decide (routes/llm-proxy.ts),
 * so this value only has to be a name goose accepts. It names no real model on purpose: goose keys
 * some behaviour on model names, and a neutral name gets its defaults.
 */
export const NODE_CHOOSES_MODEL = 'aimeat-node-choice';

/** The node's OpenAI-compatible completion route, relative to the node's base path. */
export const LLM_PROXY_PATH = 'v1/llm/chat/completions';

/**
 * Inherited goose settings that would send some model calls to another provider (the planner, a
 * subagent, a lead/worker pair). On the node route every model call has to reach /v1/llm, so these
 * are removed; the main provider then answers for all of them.
 */
const SECOND_PROVIDER_PIN = /^GOOSE_(PLANNER|SUBAGENT|LEAD|WORKER)_(PROVIDER|MODEL)$/;

/** Provider settings that could move the node route's calls away from the node. */
const NODE_ROUTE_REMOVED = new Set(['OPENROUTER_API_KEY', 'OPENAI_BASE_URL']);

type GooseEnvConfig = Pick<AimeatConfig,
  'baseUrl' | 'goosePathRoot' | 'gooseProviderApiKey' | 'gooseProvider' | 'gooseModel' | 'gooseEnvPassthrough'>;

/** True when the operator set AIMEAT_GOOSE_PROVIDER_API_KEY: one shared child, not metered per person. */
export function chatUsesSharedKey(config: Pick<AimeatConfig, 'gooseProviderApiKey'>): boolean {
  return !!config.gooseProviderApiKey;
}

/**
 * The child's environment. Names are matched without regard to case, because Windows keeps `Path`
 * and `SystemRoot` in mixed case and a case-exact list would start a child that cannot find anything.
 *
 * `personal` is the node route: the token of ONE person's chat agent, for a child that runs only that
 * person's turns. It is ignored when the shared key is set.
 */
export function gooseChildEnv(
  config: GooseEnvConfig, parentEnv: NodeJS.ProcessEnv, personal?: { token: string },
): NodeJS.ProcessEnv {
  const allowed = new Set<string>([...GOOSE_BASE_ENV, ...config.gooseEnvPassthrough].map(n => n.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    // LC_* is locale; GOOSE_* is goose's own configuration, which the host set for goose.
    if (allowed.has(upper) || upper.startsWith('LC_') || upper.startsWith('GOOSE_')) env[name] = value;
  }
  if (config.goosePathRoot) env.GOOSE_PATH_ROOT = config.goosePathRoot;

  if (!chatUsesSharedKey(config) && personal) return nodeRouteEnv(config, env, personal.token);

  // Every model call this agent makes is billed to whoever owns this key. The node decides who may
  // spend it before a turn is ever started; goose only sees the key.
  if (config.gooseProviderApiKey) env.OPENROUTER_API_KEY = config.gooseProviderApiKey;
  // Set only when non-empty: an unset value must leave goose's own configuration as it was.
  if (config.gooseProvider) env.GOOSE_PROVIDER = config.gooseProvider;
  if (config.gooseModel) env.GOOSE_MODEL = config.gooseModel;
  return env;
}

/**
 * Point goose's OpenAI provider at this node's /v1/llm, with one person's token as the key.
 *
 * The host goes in OPENAI_HOST as the origin alone, and any path the node is served under goes in
 * OPENAI_BASE_PATH: goose resolves the path against the host as a URL, and a host that carried a
 * path of its own would lose its last segment in that resolution.
 */
function nodeRouteEnv(config: GooseEnvConfig, env: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (NODE_ROUTE_REMOVED.has(upper) || SECOND_PROVIDER_PIN.test(upper) || upper.startsWith('OPENAI_')
      || upper === 'GOOSE_PROVIDER' || upper === 'GOOSE_MODEL') {
      delete env[name];
    }
  }
  const base = new URL(config.baseUrl);
  const prefix = base.pathname.replace(/^\/+|\/+$/g, '');
  env.GOOSE_PROVIDER = 'openai';
  env.GOOSE_MODEL = config.gooseModel || NODE_CHOOSES_MODEL;
  env.OPENAI_HOST = base.origin;
  env.OPENAI_BASE_PATH = prefix ? `${prefix}/${LLM_PROXY_PATH}` : LLM_PROXY_PATH;
  env.OPENAI_API_KEY = token;
  return env;
}
