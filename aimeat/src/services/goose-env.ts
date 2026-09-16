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
 * @structure GOOSE_BASE_ENV · gooseChildEnv(config, parentEnv)
 * @usage spawn(bin, ['acp'], { env: gooseChildEnv(config, process.env) })
 * @version-history
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

type GooseEnvConfig = Pick<AimeatConfig, 'goosePathRoot' | 'gooseProviderApiKey' | 'gooseProvider' | 'gooseModel' | 'gooseEnvPassthrough'>;

/**
 * The child's environment. Names are matched without regard to case, because Windows keeps `Path`
 * and `SystemRoot` in mixed case and a case-exact list would start a child that cannot find anything.
 */
export function gooseChildEnv(config: GooseEnvConfig, parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set<string>([...GOOSE_BASE_ENV, ...config.gooseEnvPassthrough].map(n => n.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    // LC_* is locale; GOOSE_* is goose's own configuration, which the host set for goose.
    if (allowed.has(upper) || upper.startsWith('LC_') || upper.startsWith('GOOSE_')) env[name] = value;
  }
  if (config.goosePathRoot) env.GOOSE_PATH_ROOT = config.goosePathRoot;
  // Every model call this agent makes is billed to whoever owns this key. The node decides who may
  // spend it before a turn is ever started; goose only sees the key.
  if (config.gooseProviderApiKey) env.OPENROUTER_API_KEY = config.gooseProviderApiKey;
  // Set only when non-empty: an unset value must leave goose's own configuration as it was.
  if (config.gooseProvider) env.GOOSE_PROVIDER = config.gooseProvider;
  if (config.gooseModel) env.GOOSE_MODEL = config.gooseModel;
  return env;
}
