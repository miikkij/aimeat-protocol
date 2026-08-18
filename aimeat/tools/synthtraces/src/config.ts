/**
 * @file config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runtime configuration for the SynthTraces self-play harness.
 *   Merges process env + simple `--key=value` CLI args into one typed object.
 *   Providers: anthropic, openrouter (default — free owl-alpha), xai (Grok),
 *   ollama (local, no key), scripted (no key). The agent and persona roles can
 *   use DIFFERENT providers/models (e.g. agent=owl-alpha, persona=local llama),
 *   matching the SynthTraces "small local model plays the user" pattern.
 *   API keys are read from env first, else from a gitignored `*.log` file at the
 *   repo root — never in code, never printed.
 * @structure HarnessConfig, ProviderKind (types); loadHarnessConfig()
 * @usage import { loadHarnessConfig } from './config.js';
 * @version-history
 *   v0.3.0 -- 2026-06-05 -- Ollama provider + per-role (agent/persona) provider split
 *   v0.2.0 -- 2026-06-05 -- Multi-provider (OpenAI-compatible openrouter/xai) + key-from-file
 *   v0.1.0 -- 2026-06-05 -- Initial PoC (variant B, REST transport, task-driven trace)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ProviderKind = 'anthropic' | 'openrouter' | 'xai' | 'ollama' | 'scripted';
export type TransportKind = 'rest' | 'mcp' | 'hybrid';

export interface Inference {
  /** OpenAI-compatible base URL (openrouter/xai/ollama). Undefined => native Anthropic endpoint. */
  baseUrl?: string;
  apiKey: string | undefined;
  agentModel: string;
  personaModel: string;
  maxTokens: number;
}

export interface HarnessConfig {
  baseUrl: string;
  nodeId: string;
  embedded: boolean;
  embeddedPort: number;
  sessions: number;
  maxTurns: number;
  transport: TransportKind;
  /** Provider for the AGENT model (the one that uses tools). */
  provider: ProviderKind;
  inference: Inference;
  /** Provider for the PERSONA (owner) model; defaults to the agent provider. */
  personaProvider: ProviderKind;
  personaInference: Inference;
  outDir: string;
  runLabel: string;
}

interface Preset {
  baseUrl: string;
  keyEnv: string;
  keyFile: string;
  agentModel: string;
  personaModel: string;
}

const PRESETS: Record<'openrouter' | 'xai' | 'ollama', Preset> = {
  // owl-alpha is free (prompt price 0), supports tools, 1M context.
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keyFile: 'openrouter_key.log',
    agentModel: 'openrouter/owl-alpha',
    personaModel: 'openrouter/owl-alpha',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    keyFile: 'xai_api_key.log',
    agentModel: 'grok-4.3',
    personaModel: 'grok-4.3',
  },
  // Local, free, no key. Agent role needs a tool-capable model (qwen2.5 / llama3.1);
  // persona role is text-only so any small model works. Pull models with `ollama pull`.
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    keyFile: '',
    agentModel: 'qwen2.5:7b',
    personaModel: 'llama3.2:3b',
  },
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  if (process.argv.includes(`--${name}`)) return 'true';
  return undefined;
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Read a secret from a gitignored file at the repo root. Never logged. */
function readKeyFile(name: string): string | undefined {
  if (!name) return undefined;
  try {
    const p = fileURLToPath(new URL(`../../../../${name}`, import.meta.url));
    const v = readFileSync(p, 'utf8').trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

function resolveKey(provider: ProviderKind): string | undefined {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'ollama') return process.env.OLLAMA_API_KEY ?? 'ollama'; // dummy — Ollama ignores auth
  if (provider === 'openrouter' || provider === 'xai') {
    const p = PRESETS[provider];
    return process.env[p.keyEnv] ?? readKeyFile(p.keyFile);
  }
  return undefined;
}

/** Build an Inference for one provider, applying per-role model/base overrides. */
function resolveInference(
  provider: ProviderKind,
  o: { agentModel?: string; personaModel?: string; apiBase?: string },
  maxTokens: number,
): Inference {
  if (provider === 'anthropic') {
    return {
      apiKey: resolveKey('anthropic'),
      agentModel: o.agentModel ?? 'claude-sonnet-4-6',
      personaModel: o.personaModel ?? 'claude-haiku-4-5-20251001',
      maxTokens,
    };
  }
  if (provider === 'scripted') {
    return { apiKey: undefined, agentModel: 'scripted', personaModel: 'scripted', maxTokens };
  }
  const pre = PRESETS[provider];
  return {
    baseUrl: o.apiBase ?? pre.baseUrl,
    apiKey: resolveKey(provider),
    agentModel: o.agentModel ?? pre.agentModel,
    personaModel: o.personaModel ?? pre.personaModel,
    maxTokens,
  };
}

export function loadHarnessConfig(): HarnessConfig {
  const base = arg('base') ?? process.env.AIMEAT_BASE;
  const embeddedArg = arg('embedded');
  const embedded = embeddedArg !== undefined ? embeddedArg === 'true' : !base;
  const embeddedPort = num(arg('port'), 40251);
  const maxTokens = num(arg('max-tokens'), 16000);

  // Agent provider: explicit flag, else first provider with a usable key.
  // (Ollama is never auto-selected — it needs a pulled model — choose it explicitly.)
  let provider = arg('provider') as ProviderKind | undefined;
  if (!provider) {
    if (resolveKey('anthropic')) provider = 'anthropic';
    else if (resolveKey('openrouter')) provider = 'openrouter';
    else if (resolveKey('xai')) provider = 'xai';
    else provider = 'scripted';
  }
  const inference = resolveInference(
    provider,
    { agentModel: arg('agent-model'), personaModel: arg('persona-model'), apiBase: arg('api-base') },
    maxTokens,
  );

  // Persona provider: defaults to the agent provider, or a separate one
  // (e.g. --persona-provider=ollama for a local user model).
  const personaProvider = (arg('persona-provider') as ProviderKind) ?? provider;
  const personaInference =
    personaProvider === provider
      ? inference
      : resolveInference(personaProvider, { personaModel: arg('persona-model'), apiBase: arg('persona-base') }, maxTokens);

  return {
    baseUrl: base ?? `http://localhost:${embeddedPort}`,
    nodeId: arg('node-id') ?? process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev',
    embedded,
    embeddedPort,
    sessions: num(arg('sessions'), 2),
    maxTurns: num(arg('max-turns'), 8),
    transport: (arg('transport') as TransportKind) ?? 'rest',
    provider,
    inference,
    personaProvider,
    personaInference,
    outDir: fileURLToPath(new URL('../out/', import.meta.url)),
    runLabel: arg('label') ?? provider,
  };
}
