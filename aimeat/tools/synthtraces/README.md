# SynthTraces — synthetic AIMEAT agent-session traces

A small self-play harness that generates synthetic **AIMEAT** agent-session
traces, in the spirit of HF's *SynthTraces* (two models talking to produce
trainable/evaluable session data) — but the "environment" here is the **AIMEAT
protocol** itself, not a code repo.

This is **variant B**: a *persona model* plays the human **owner** and an *agent
model* plays the **AIMEAT agent**. They talk over AIMEAT's native owner↔agent
messaging and the **task lifecycle**, so each session produces a real task with
an immutable event timeline + telemetry — the backbone of the trace.

No backend changes are required: the harness is a pure client on top of AIMEAT.

## What it does (per session)

1. Registers a fresh owner + agent on a node (the proven `test/api-full.ts`
   recipe — no browser approval needed).
2. The persona's seed intent becomes a **queued task**; the owner starts it
   (start is owner-only — the propose-before-start rule).
3. The agent model works the task with AIMEAT tools (`aimeat_memory_write`,
   `aimeat_task_event`, `aimeat_reply_to_owner`, `aimeat_complete_task`, …) over
   the chosen **transport**. Every tool call hits the real node and is recorded.
4. If the agent asks the owner a question, the persona model answers via a real
   **inbound message**; the agent reads its inbox and continues.
5. The task + its events + telemetry are pulled and embedded in one JSONL line.

## Run

From the `aimeat/` directory:

```bash
# Auto provider — uses free OpenRouter owl-alpha if a key is found, else scripted:
pnpm exec tsx tools/synthtraces/src/run.ts

# Free live two-model self-play (owl-alpha), 4 sessions:
pnpm exec tsx tools/synthtraces/src/run.ts --provider=openrouter --sessions=4

# Same, but the agent drives the node over MCP instead of REST:
pnpm exec tsx tools/synthtraces/src/run.ts --provider=openrouter --transport=mcp

# x.ai Grok (paid) instead:
pnpm exec tsx tools/synthtraces/src/run.ts --provider=xai

# SynthTraces-style: free cloud agent + a LOCAL model playing the user (needs `ollama pull llama3.2:3b`):
pnpm exec tsx tools/synthtraces/src/run.ts --provider=openrouter --persona-provider=ollama --persona-model=llama3.2:3b

# Fully local, zero cloud (needs a tool-capable agent model, e.g. `ollama pull qwen2.5:7b`):
pnpm exec tsx tools/synthtraces/src/run.ts --provider=ollama --agent-model=qwen2.5:7b --persona-model=llama3.2:3b

# No LLM (verify the pipeline), exercise the message round-trip:
pnpm exec tsx tools/synthtraces/src/run.ts --provider=scripted --scripted-ask

# Evaluate a trace file (protocol-correctness metrics):
pnpm exec tsx tools/synthtraces/src/eval.ts --in=tools/synthtraces/out/traces-openrouter.jsonl
```

Traces append to `tools/synthtraces/out/traces-<label>.jsonl`; eval writes a
sibling `*.eval.json`. Both, plus the embedded node's sqlite files, are
gitignored.

## API keys

Keys are read from an env var first, else from a gitignored `*.log` file at the
**repo root** — keys never live in code and are never printed:

| Provider | env var | key file (repo root) | default model |
|----------|---------|----------------------|---------------|
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter_key.log` | `openrouter/owl-alpha` (free) |
| `xai` | `XAI_API_KEY` | `xai_api_key.log` | `grok-4.3` (paid) |
| `anthropic` | `ANTHROPIC_API_KEY` | — | `claude-sonnet-4-6` |
| `ollama` | — (no key) | — | `qwen2.5:7b` agent / `llama3.2:3b` persona (local, free) |

OpenRouter, x.ai, and Ollama are all OpenAI-compatible, so one provider class
(`OpenAICompatProvider`) handles them; Anthropic has its own. **Ollama** runs
locally (`http://localhost:11434/v1`) with no key — `ollama pull` the model
first. Tip: the agent role needs a tool-capable model (`qwen2.5`/`llama3.1`);
the persona role is text-only so a tiny model (`llama3.2:3b`) is plenty. Local
inference is slower than cloud.

### Per-role providers

Agent and persona can use **different** providers/models — this is how you run
the SynthTraces shape (small local model = the user, capable model = the agent):

```bash
--provider=openrouter            # agent: free cloud owl-alpha (reliable tools)
--persona-provider=ollama        # persona: local model (free, private)
--persona-model=llama3.2:3b
```

If `--persona-provider` is omitted, the persona uses the agent's provider/model.

## Key flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--provider=` | auto | `openrouter` \| `xai` \| `anthropic` \| `ollama` \| `scripted` (agent provider) |
| `--persona-provider=` | = agent | Separate provider for the persona, e.g. `ollama` |
| `--persona-base=` | preset | Override the persona provider base URL |
| `--transport=` | `rest` | `rest` \| `mcp` \| `hybrid` — how the agent's actions reach the node |
| `--sessions=N` | 2 | Number of self-play sessions (= trace lines) |
| `--max-turns=N` | 8 | Safety ceiling on agent turns per session |
| `--agent-model=` / `--persona-model=` | per provider | Override models |
| `--max-tokens=N` | 16000 | Agent completion cap |
| `--base=URL` | embedded | Drive an external node instead of booting one |
| `--node-id=ID` | auto-detect | Node id for auth signing (detected from `GET /`) |
| `--scripted-ask` | off | Scripted agent asks the owner once (tests messaging) |
| `--label=` | provider | Folded into the output filename |

## Design axes

- **Transport** ✅ — REST, MCP, and **hybrid** implemented behind the
  `AgentDriver` boundary (`driver.ts`). Hybrid mixes per operation (memory +
  messaging over MCP, task lifecycle over REST); each trace tool-call records a
  `via` field so the channel is observable. Lets the dataset span and compare
  transports.
- **Inference** ✅ — direct API: OpenRouter (free owl-alpha), x.ai, Anthropic,
  and **Ollama** (local, free). Agent and persona can use different providers,
  so the SynthTraces "small local model plays the user" shape works (e.g. agent
  on owl-alpha, persona on local llama3.2). An `AIMEAT.ai` provider (the node's
  own `/v1/ai/complete`) is a later dogfooding variant.
- **Telemetry** ✅ — each agent turn's token usage + duration is captured into
  `trace.usage` and pushed as a `task_event` `details.telemetry`, so the node's
  native `task.telemetry` accumulates real token/duration cost per session.
- **Eval** ✅ — `eval.ts` derives protocol-correctness checks from the recorded
  tool calls + native task state (task reached done, no hallucinated tools, no
  failed calls, persisted something, valid memory keys/visibility, completed
  after real work), and reports token cost + transport mix.

## Files

| File | Role |
|------|------|
| `config.ts` | env + CLI config, provider presets, key-from-file |
| `sign.ts` | Ed25519 auth signing |
| `client.ts` | AIMEAT REST client + owner/agent setup recipe |
| `driver.ts` | `AgentDriver` transport abstraction (REST + MCP) |
| `tools.ts` | agent tool schemas + dispatch to the driver |
| `llm.ts` | `AnthropicProvider` + `OpenAICompatProvider` + `ScriptedProvider` |
| `personas.ts` | seed persona library |
| `selfplay.ts` | one session → one trace |
| `trace.ts` | trace schema + JSONL writer |
| `eval.ts` | offline protocol-correctness evaluator |
| `run.ts` | entry point (optional embedded node) |
| `probe-mcp.ts` | one-off: inspect the node's MCP tool surface |
