# `aimeat/tools/` — developer tooling

Standalone, dev-only tools that run **on top of** the AIMEAT node via its public
APIs. Nothing here is part of the server build or the protocol surface — these
are clients you run with `tsx`. The backend stays protocol-only; tools live out
here so they can be added, changed, or deleted without touching `src/`.

| Tool | What it is |
|------|------------|
| [`synthtraces/`](synthtraces/) | Self-play harness that generates synthetic AIMEAT agent-session traces (see its own README for run details) |

---

## SynthTraces — the big picture

### What it is

A tiny harness where **two LLMs talk to each other through a real AIMEAT node** to
produce **session traces**: a *persona model* plays the human **owner**, an
*agent model* plays the **AIMEAT agent**. They converse over AIMEAT's native
**owner↔agent messaging** and **task lifecycle**, and every action is recorded
as one JSONL trace line.

It is the AIMEAT analogue of Hugging Face's *SynthTraces* (two models producing
coding-agent traces against a repo). The twist: here the **environment is the
AIMEAT protocol itself** — the "tools" the agent uses are AIMEAT's memory, task,
and messaging operations, reached over REST or MCP.

### Why it was built

1. **AIMEAT had no way to measure whether models can actually drive it.** The
   protocol has sharp edges (GHII vs GAII, owner-only `/start`, ext: vs owner
   memory namespaces, MCP auth). The only way to know if a model handles them is
   to watch one try. This harness makes that observable and repeatable.
2. **No existing dataset of "infrastructure-agent" traces exists.** Everyone has
   coding-agent traces; nobody has traces of agents operating an AI-agent
   protocol. That is a niche this can own.
3. **It dogfoods the protocol.** Running real agents against real endpoints
   surfaces protocol bugs that unit tests miss (the PoC already found two:
   agents cannot self-`/start` a task, and a failed `complete` was being
   reported as success).

### What you get out of it

- **A benchmark** — "can model X drive AIMEAT correctly?" Run the same personas
  against different models/providers and compare eval scores.
- **A fine-tuning corpus** — traces of correct (and incorrect) protocol use,
  usable to train or optimise a small local "AIMEAT agent".
- **Regression detection** — after a protocol change, re-run and watch the eval
  scores; a drop points at a newly-introduced sharp edge.
- **Demo / seed data** — realistic owner/agent/task/memory activity on a node in
  one command.
- **Cost control** — defaults to the **free** OpenRouter `owl-alpha`; the
  scripted provider needs no key at all.

### Design at a glance

```
  persona model (owner)            agent model (AIMEAT agent)
        │ intent → task                  │ tool calls
        ▼ owner JWT                      ▼ agent JWT, via AgentDriver
   create + start task  ───►  inbox ──►  REST  or  MCP  ──►  AIMEAT node
        ◄── inbound msg ◄── reply ◄──  task events / memory / messages
                                            │
                              trace.jsonl  ←┘  (task events + telemetry + tool calls)
                                            └► eval.ts → protocol-correctness score
```

Three orthogonal axes, each pluggable:

- **Provider** (how the models think): `openrouter` (free owl-alpha) · `xai`
  (Grok) · `anthropic` · `scripted` (no key).
- **Transport** (how the agent's actions reach the node): `rest` · `mcp` ·
  `hybrid` (mixed per call).
- **Persona** (the diversity engine): a library of owner roles + seed intents.

The trace container is **task-driven**: AIMEAT's own immutable task event
timeline (`started → memory_write → completed …`) plus accumulated telemetry
*is* the backbone of each trace — the protocol builds half the trace for us.

---

## What to observe (the point of the output)

Each run writes `synthtraces/out/traces-<label>.jsonl` (one line per session) and
`eval.ts` writes a sibling `*.eval.json`. When reviewing a run, look at:

1. **Eval score / per-check pass rate** — the headline. `task_reached_done`,
   `no_hallucinated_tools`, `no_failed_tool_calls`, `persisted_something`,
   `valid_memory_keys/visibility`, `completed_after_real_work`. A failing check
   names the protocol mistake the model made.
2. **`outcome` vs `task.final_status`** — they must agree. `outcome=completed`
   with `final_status≠done` means a terminal call silently failed (the bug class
   the harness was built to catch).
3. **Tool-call `status` codes** — REST shows real HTTP (201 on writes), MCP
   shows 200; in `hybrid` runs the `via` field on each call shows which channel
   handled it. A cluster of 4xx/409 reveals a state-machine or auth problem.
4. **`task.telemetry` / `usage`** — token + duration cost per successful session.
   Watch cost-per-success across models; a model that "passes" but burns 10×
   tokens is not free.
5. **Native `events`** — should mirror what the agent claims it did. A `completed`
   event with no preceding `memory_write` when the owner asked to store something
   is a real-work failure even if the score looks fine.
6. **Per-persona breakdown** — which owner roles trip the model up (e.g. the
   `uncertain-clarifier` persona stresses the message round-trip).
7. **Transport deltas** — does the same model/persona score worse over MCP than
   REST? That points at the MCP surface (scope filtering, schema mismatch).

---

## How to work with it going forward

- **Add a persona, not a code path.** New coverage usually means a new entry in
  `personas.ts`, not new harness logic.
- **Keep the backend untouched.** If a scenario needs a backend change, that is a
  protocol finding — raise it; don't special-case it in the harness.
- **Scale by sessions, then by model.** Generate a corpus with one model first,
  read the eval, then fan out across models for comparison.
- **Treat eval failures as protocol intel.** Every repeated failure is either a
  model weakness (fine-tuning target) or a protocol sharp edge (docs/UX fix).
- **Never commit secrets or output.** Keys live in gitignored `*.log` files at the
  repo root; `out/` and `*.db` are gitignored.

## Running with local models (Ollama)

You can run the whole loop with **local** models — free, private, and offline-
capable — using [Ollama](https://ollama.com). This replicates the SynthTraces
"small local model plays the user" idea, or goes fully local (zero cloud).

**Prerequisites**

- Ollama installed and running: `ollama --version` (the server listens on
  `http://localhost:11434` and exposes an OpenAI-compatible `/v1` API — the same
  shape the harness already speaks, so no key is needed).
- Models pulled (you start with none — `ollama list` to check):

  ```bash
  ollama pull llama3.2:3b     # persona (the user): text-only, tiny is fine
  ollama pull qwen2.5:7b      # agent: needs reliable tool/function calling
  ```

**Two modes**

```bash
# Hybrid — free cloud agent + LOCAL user model (most reliable):
pnpm exec tsx tools/synthtraces/src/run.ts \
  --provider=openrouter --persona-provider=ollama --persona-model=llama3.2:3b

# Fully local — zero cloud, nothing leaves your machine:
pnpm exec tsx tools/synthtraces/src/run.ts \
  --provider=ollama --agent-model=qwen2.5:7b --persona-model=llama3.2:3b
```

**Which model for which role**

- **Persona** (the human user) is text-only — any small model works (`llama3.2:3b`).
- **Agent** needs solid **tool/function calling**. Locally that means a
  `qwen2.5` / `llama3.1`-class model; tiny models will fail to emit tool calls.

**Verified:** fully-local `qwen2.5:7b` agent + `llama3.2:3b` persona ran a
4-persona self-play at eval **1.000** — qwen2.5 emitted valid tool calls (it even
split "I like jazz, dislike metal" into two memory keys) and handled the
clarification round-trip with the local persona. No cloud, no key, no spend.

**Caveats**

- Local inference can be **slow on CPU**; a GPU makes 7B models fast (the
  verified run was ~seconds/session). If CPU-only, keep `--sessions` modest and
  bound `--max-tokens`.
- Ollama needs no API key — the harness sends a dummy `Authorization` header it
  ignores.

## Generating a dataset

To produce a comparable corpus, run all personas across all three transports for
one provider, appending into a single labelled file, then eval it:

```bash
for T in rest mcp hybrid; do
  pnpm exec tsx tools/synthtraces/src/run.ts --provider=openrouter --transport=$T --sessions=10 --label=dataset
done
pnpm exec tsx tools/synthtraces/src/eval.ts --in=tools/synthtraces/out/traces-dataset.jsonl
```

That is 30 traces (10 personas × 3 transports). Swap `--provider` /
`--agent-model` to compare models. Observed on this exact 30-session setup:

| Agent model | Cost | Mean eval | Notes |
|-------------|------|-----------|-------|
| `owl-alpha` (free cloud) | $0 | **0.971** | 0 hallucinated tools, 0 failed calls |
| `qwen2.5:7b` (fully local) | $0, offline | **0.950** | same discipline; a few more `max_turns` (didn't finish within 8 turns) |

The gap is the point: both models use the protocol *correctly* (no hallucinated
tools, no failed calls, valid keys), but the smaller local model occasionally
fails to **finish** within the turn budget. That is exactly the signal this
harness exists to surface — and the kind of comparison the dataset enables.

## Roadmap / further development

Done:
- ✅ Variant B self-play (owner↔agent + task lifecycle), task-driven traces
- ✅ Providers: openrouter (free owl-alpha), xai, anthropic, ollama (local), scripted
- ✅ Per-role providers — agent + persona can differ (SynthTraces "local model
  plays the user": agent on free cloud, persona on local Ollama)
- ✅ Transports: REST, MCP, hybrid (behind the `AgentDriver` boundary)
- ✅ Eval layer (protocol-correctness checks)
- ✅ Telemetry capture (token/duration → task events → `task.telemetry`)

Next candidates:
- **Richer eval** — AIMEAT-specific checks: GHII/GAII confusion, ext: vs owner
  namespace misuse, scope-violation attempts, wrong callExt paths.
- **More tools in the agent surface** — boards, organisms, capabilities,
  consent — to trace deeper protocol use.
- **Multi-agent sessions** — organisms/groups so several agents collaborate.
- **AIMEAT.ai provider** — route inference through the node's own
  `/v1/ai/complete` as a dogfooding variant (note: budget-capped, human-in-loop).
- **Dataset publishing** — export to a HF-style dataset with a datacard.
- **Failure-injection personas** — adversarial owners that try to make the agent
  misuse the protocol, to grow the "incorrect use" half of the corpus.

See [`synthtraces/README.md`](synthtraces/README.md) for run commands, flags, and
the file-by-file map.
