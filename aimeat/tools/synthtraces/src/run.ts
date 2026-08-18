/**
 * @file run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Entry point for the SynthTraces self-play harness. Optionally
 *   boots an in-process AIMEAT node (sqlite, test mode), then runs N self-play
 *   sessions — each registers a fresh owner + agent, plays a persona against the
 *   agent model over native AIMEAT messaging/tasks, and appends one trace line.
 * @usage
 *   cd aimeat
 *   pnpm exec tsx tools/synthtraces/src/run.ts                       # auto provider (owl-alpha if key file present)
 *   pnpm exec tsx tools/synthtraces/src/run.ts --provider=scripted   # no LLM, verify pipeline
 *   pnpm exec tsx tools/synthtraces/src/run.ts --provider=openrouter --sessions=4
 *   pnpm exec tsx tools/synthtraces/src/run.ts --provider=xai
 *   pnpm exec tsx tools/synthtraces/src/run.ts --base=http://localhost:40050  # external node
 * @version-history
 *   v0.2.0 -- 2026-06-05 -- Multi-provider selection (anthropic/openrouter/xai/scripted)
 *   v0.1.0 -- 2026-06-05 -- Initial PoC
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { loadHarnessConfig, type ProviderKind, type Inference } from './config.js';
import { AimeatClient } from './client.js';
import { AnthropicProvider, OpenAICompatProvider, ScriptedProvider, type LlmProvider } from './llm.js';
import { PERSONAS } from './personas.js';
import { runSession } from './selfplay.js';
import { writeTrace } from './trace.js';

async function bootEmbedded(port: number, outDir: string): Promise<{ close: () => Promise<void> }> {
  process.env.AIMEAT_PORT = String(port);
  process.env.AIMEAT_DEV_MODE = 'true';
  process.env.AIMEAT_TEST_MODE = 'true';
  process.env.AIMEAT_DB = process.env.AIMEAT_DB ?? 'sqlite';
  process.env.AIMEAT_DB_PATH = process.env.AIMEAT_DB_PATH ?? join(outDir, `synthtraces-node-${randomBytes(4).toString('hex')}.db`);
  if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { loadConfig } = (await import('../../../src/config.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createServer } = (await import('../../../src/server.js')) as any;
  const { config } = loadConfig({});
  config.port = port;
  const { app } = await createServer(config);
  const server = await new Promise<{ close: (cb: () => void) => void }>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}

function buildProvider(provider: ProviderKind, inference: Inference): LlmProvider {
  if (provider === 'scripted') return new ScriptedProvider(process.argv.includes('--scripted-ask'));
  if (!inference.apiKey) {
    throw new Error(`provider=${provider} but no API key found (set the env var or place the key file at the repo root)`);
  }
  if (provider === 'anthropic') {
    return new AnthropicProvider(inference.apiKey, inference.agentModel, inference.personaModel, inference.maxTokens);
  }
  // openrouter | xai | ollama — all OpenAI-compatible
  return new OpenAICompatProvider(inference.baseUrl as string, inference.apiKey, inference.agentModel, inference.personaModel, inference.maxTokens);
}

async function main(): Promise<void> {
  const cfg = loadHarnessConfig();
  console.log(`\n=== SynthTraces self-play (variant B) ===`);
  console.log(`transport=${cfg.transport} sessions=${cfg.sessions} embedded=${cfg.embedded}`);
  console.log(
    `agent=${cfg.provider}:${cfg.inference.agentModel} ` +
      `persona=${cfg.personaProvider}:${cfg.personaInference.personaModel} maxTokens=${cfg.inference.maxTokens}`,
  );

  let embedded: { close: () => Promise<void> } | undefined;
  if (cfg.embedded) {
    console.log(`Booting embedded AIMEAT node on :${cfg.embeddedPort} ...`);
    embedded = await bootEmbedded(cfg.embeddedPort, cfg.outDir);
  }

  const client = new AimeatClient(cfg.baseUrl, cfg.nodeId);
  const detected = await client.detectNodeId();
  if (detected && detected !== cfg.nodeId) {
    console.log(`Detected node id: ${detected} (overriding ${cfg.nodeId})`);
    cfg.nodeId = detected;
    client.updateNodeId(detected);
  }

  const agentLlm = buildProvider(cfg.provider, cfg.inference);
  const personaLlm = cfg.personaProvider === cfg.provider ? agentLlm : buildProvider(cfg.personaProvider, cfg.personaInference);
  const providers = { agent: agentLlm, persona: personaLlm };

  const stamp = Date.now();
  const outcomes: Record<string, number> = {};
  let traceFile = '';
  for (let i = 0; i < cfg.sessions; i++) {
    const persona = PERSONAS[i % PERSONAS.length];
    const ownerName = `synthowner${stamp}s${i}`;
    try {
      const creds = await client.setup({ ownerName, agentName: 'synthagent' });
      const trace = await runSession(cfg, client, providers, persona, creds);
      traceFile = writeTrace(cfg.outDir, cfg.runLabel, trace);
      outcomes[trace.outcome] = (outcomes[trace.outcome] ?? 0) + 1;
      console.log(
        `  [${i + 1}/${cfg.sessions}] ${persona.id.padEnd(20)} outcome=${trace.outcome.padEnd(10)} ` +
          `task=${trace.task.final_status ?? '-'} tools=${trace.tool_calls.length} events=${trace.events.length}` +
          (trace.error ? ` error="${trace.error}"` : ''),
      );
    } catch (e) {
      outcomes.setup_error = (outcomes.setup_error ?? 0) + 1;
      console.error(`  [${i + 1}/${cfg.sessions}] ${persona.id} SESSION FAILED: ${(e as Error).message}`);
    }
  }

  console.log(`\nOutcomes: ${JSON.stringify(outcomes)}`);
  if (traceFile) console.log(`Traces written to: ${traceFile}`);

  if (embedded) await embedded.close();
  process.exit(0); // embedded node may hold timers (scheduler, etc.)
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
