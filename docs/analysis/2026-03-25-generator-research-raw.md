# Generator Pipeline Research — Raw Findings

**Date:** 2026-03-25
**Purpose:** Research on multi-file code generation, self-repair, test tautology, contract-first generation, and probe/golden-sample patterns. Each finding includes the exact URL where it was found.

---

## 1. Multi-File Code Generation in Commercial Tools

### 1.1 Devin (Cognition AI)

**Architecture:** Devin operates as a compound AI system — not a single model but a swarm of specialized models (planner, coder, critic, browser agent) orchestrating a workflow inside a sandboxed VM.

- **Planning loop:** The prompt is handed to a planner LLM that expands the goal into a step-by-step plan and self-critiques each step before execution. A lightweight executor then selects the right tool (shell, code editor, headless browser). As tests fail or lints complain, Devin iterates autonomously until the build turns green.
- **Memory layer:** Beneath the workspace sits a memory layer that stores vectorized snapshots of the codebase plus a full replay timeline of every command, file diff, and browser tab. This allows context to be maintained across execution steps.
- **Multi-file handling:** Devin operates with access to a complete development environment. It writes and modifies code directly in files, has shell access to run terminal commands, and can create directories and execute build processes.
- **Feedback:** The plan changes dynamically during execution — outputs from earlier steps inform subsequent prompting and decision-making rather than following rigid predetermined paths.
- **Sandbox:** Pre-configured "machine snapshots" provide isolated environments with fork and rollback capabilities.

**Sources:**
- [Devin 2.0 Blog](https://cognition.ai/blog/devin-2)
- [Devin on ZenML LLMOps Database](https://www.zenml.io/llmops-database/autonomous-software-development-agent-for-production-code-generation)
- [Devin Wikipedia](https://en.wikipedia.org/wiki/Devin_AI)
- [Analytics Vidhya: Devin 2.0 Explained](https://www.analyticsvidhya.com/blog/2025/04/devin-2-0/)

**Relevance to AIMEAT pipeline:** Devin's approach is fundamentally different from our prompt-driven workflow — it has full code execution between steps. However, the key pattern is relevant: plan → execute → observe real output → revise plan → iterate. In our pipeline, this maps to: generate extension → capture its actual exports/types → feed those into library prompt → generate library → capture its actual API → feed into app prompt.

---

### 1.2 Bolt.new (StackBlitz)

**Architecture:** Bolt.new runs entirely in the browser using WebContainers (Node.js via WebAssembly). The AI generates code, a local dev server spins up, and a live preview renders — all client-side.

- **Execution model:** All AI-generated actions execute through a global execution queue to prevent race conditions. Each AI response creates an Artifact with an ActionRunner: `addArtifact()` creates a new runner, `addAction()` queues actions, `runAction()` executes sequentially. File operations write to a virtual filesystem, shell commands execute in BoltShell, dev servers spawn with port forwarding for preview.
- **Real-time feedback:** Every change updates the preview instantly, creating a tight feedback loop. Users refine through natural dialogue and see implementation immediately.
- **Multi-file:** The AI agent has complete control over the entire environment including filesystem, node server, package manager, terminal, and browser console.

**Sources:**
- [StackBlitz bolt.new GitHub](https://github.com/stackblitz/bolt.new)
- [DeepWiki: bolt.new Architecture](https://deepwiki.com/stackblitz/bolt.new)
- [SkyWork: What is Bolt.new](https://skywork.ai/blog/what-is-bolt-new/)

**Relevance to AIMEAT pipeline:** Bolt.new's key insight is that *execution is the feedback mechanism*. Code is generated, then immediately executed in a real runtime, and the user (or system) sees whether it works. Our pipeline currently generates code without executing it between steps. The WebContainer pattern shows that in-browser execution of generated code is technically feasible and provides the tightest possible feedback loop.

---

### 1.3 Lovable (formerly GPT-Engineer)

**Architecture:** Lovable evolved from a CLI code generation utility to a full-stack AI builder with an orchestrated change loop.

- **Multi-file generation:** The LLM agent builds a change plan and generates patches for frontend, backend, and data layers simultaneously. The project is rebuilt, artifacts deployed to preview, and results visible immediately.
- **Five-step agent workflow:** (1) Intent specification from user, (2) Context collection from project state, (3) Planning and patch generation by LLM, (4) Build and preview deployment, (5) Feedback incorporation for next iteration.
- **Context bundle:** During each iteration, the system gathers a "context bundle" that includes project files, environment state, and signals from previous iterations. These signals inform the next agent cycle.
- **Agent Mode (2025):** Independently searches codebases, inspects logs, browses web resources, and makes architectural decisions without constant prompting.
- **Generate → verify → refine:** The platform evolved from a "generator" to a "managed product assembly environment" supporting iterative cycles.

**Sources:**
- [Lovable: From GPT Engineer to Full-Stack AI Builder — System Design Space](https://system-design.space/en/chapter/lovable-startup-architecture/)
- [GPT Engineer and Lovable Evolution](https://lovable.dev/gpt-engineer)
- [Lovable Documentation Changelog](https://docs.lovable.dev/changelog)

**Relevance to AIMEAT pipeline:** Lovable's "context bundle" pattern is directly applicable. After generating an extension, we could capture its actual exports, types, and runtime behavior as a "context bundle" that feeds into the library generation step. Their five-step workflow (intent → context → plan → build/preview → feedback) maps closely to what our pipeline needs.

---

### 1.4 v0.dev (Vercel)

**Architecture:** v0 uses a composite model approach: retrieval (RAG) for grounding, a frontier LLM for reasoning, and a streaming post-processor called "AutoFix" that scans for errors during and after generation.

- **Three-stage pipeline:** (1) Dynamic system prompt injects contextual knowledge, (2) "LLM Suspense" manipulates text during streaming (find-and-replace), (3) Autofixers analyze and repair issues post-generation.
- **AutoFix model:** A custom model (`vercel-autofixer-01`) trained with reinforcement fine-tuning (RFT). Runs in <250ms. Achieves 93% error-free generation rate with 40x faster latency.
- **Multi-file limitation:** v0 generates components as standalone pieces rather than parts of an integrated system. Developers must figure out how components share state, interact with data sources, and fit into larger applications.
- **Sandbox (2025):** New sandbox-based runtime can import any GitHub repo and automatically pull environment variables from Vercel. Every prompt generates production-ready code in a real environment.

**Sources:**
- [How We Made v0 an Effective Coding Agent — Vercel Blog](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent)
- [Introducing the v0 Composite Model Family — Vercel Blog](https://vercel.com/blog/v0-composite-model-family)
- [40X Faster AutoFix — Fireworks AI Blog](https://fireworks.ai/blog/vercel)
- [v0 Review — SkyWork](https://skywork.ai/blog/vercel-v0-review-2025-ai-ui-code-generation-nextjs/)

**Relevance to AIMEAT pipeline:** v0's AutoFix pattern is interesting — a lightweight post-processor that catches and fixes common errors in the generated output *before* the user sees it. This could apply to our pipeline: after generating code, run a quick validation/fix pass before feeding into the next step. Their admission that multi-file integration is a known weakness validates the problem we're trying to solve.

---

### 1.5 Summary: How Commercial Tools Handle Multi-File Integration

| Tool | Executes between steps? | Feeds real output into next step? | Multi-file integration approach |
|------|------------------------|----------------------------------|-------------------------------|
| **Devin** | Yes — full sandbox with shell, builds, tests | Yes — memory layer + dynamic plan revision | Complete dev environment, iterates until green |
| **Bolt.new** | Yes — WebContainer runs code in browser | Yes — live preview + error console feedback | Full filesystem control, sequential action queue |
| **Lovable** | Yes — build + preview after each patch set | Yes — "context bundle" with signals from previous iterations | Patches across frontend/backend/data layers |
| **v0** | Partially — AutoFix post-processing, new sandbox | Limited — AutoFix catches errors, no inter-step feeding | Standalone components; multi-file is a known gap |

**Key finding:** All tools that handle multi-file generation well (Devin, Bolt, Lovable) execute code between generation steps and feed real outputs back. v0, which does the least execution between steps, explicitly acknowledges multi-file integration as a weakness.

---

## 2. LLM Self-Repair / Self-Debugging — State of the Art (2024-2026)

### 2.1 Reflexion (NeurIPS 2023) — Foundational

**What it is:** A framework for reinforcing language agents through verbal (text-based) reflection rather than weight updates. The agent reflects on task feedback, maintains reflective text in episodic memory, and uses it to make better decisions in subsequent trials.

**Architecture:** Three distinct models: (1) Actor — generates text/actions, (2) Evaluator — scores outputs, (3) Self-Reflection model — generates verbal reinforcement cues.

**Results:** 91% pass@1 on HumanEval (vs 80% for GPT-4 baseline). +22% on AlfWorld decision tasks, +20% on HotPotQA reasoning.

**Source:** [Reflexion: Language Agents with Verbal Reinforcement Learning — arXiv](https://arxiv.org/abs/2303.11366), [NeurIPS 2023 Proceedings](https://proceedings.neurips.cc/paper_files/paper/2023/hash/1b44b878bb782e6954cd888628510e90-Abstract-Conference.html)

---

### 2.2 LeDex (NeurIPS 2024) — Training LLMs to Self-Debug

**What it is:** A training framework from AWS that improves LLMs' ability to explain and fix incorrect code. Key insight: a chain of explanations on wrong code followed by refinement helps LLMs better analyze and fix errors.

**Method:** Automated pipeline to collect high-quality datasets for code explanation and refinement. Uses both supervised fine-tuning (SFT) and reinforcement learning (RL) with a reward design that accounts for explanation semantics and unit test success.

**Results:** SFT improved pass@1 by up to 15.92%, pass@10 by 9.30% across four benchmarks. RL training added up to 3.54% more on pass@1.

**Sources:**
- [LeDex Paper — arXiv](https://arxiv.org/abs/2405.18649)
- [LeDex NeurIPS 2024 Proceedings](https://proceedings.neurips.cc/paper_files/paper/2024/file/3ea832724870c700f0a03c665572e2a9-Paper-Conference.pdf)
- [Amazon Science Blog](https://www.amazon.science/blog/training-code-generation-models-to-debug-their-own-outputs)

---

### 2.3 ROCODE (ICSE 2025) — Backtracking During Generation

**What it is:** Integrates backtracking and program analysis into LLM code generation. Uses incremental error detection *during* generation — when a syntax error is detected, the system rolls back and regenerates from a correct point.

**Key feature:** Closed-loop mechanism that continuously monitors compilation output and automatically triggers backtracking. Static program analysis identifies the minimal necessary modification scope for efficient, targeted rewriting.

**Results:** 99.1% compilation pass rate. Test pass rate improved by up to 23.8% vs best baseline. Token cost reduced by 19.3% vs post-revision baselines. Works across 9 different LLMs.

**Source:** [ROCODE — arXiv](https://arxiv.org/abs/2411.07112), [ICSE 2025 Proceedings](https://dl.acm.org/doi/10.1109/ICSE55347.2025.00133)

---

### 2.4 CodeAct (ICML 2024) — Executable Code as Action Space

**What it is:** Represents all LLM agent actions as executable Python code. Integrates a Python interpreter into the agent architecture for immediate execution, real-time feedback, and dynamic action adjustment through multi-turn interactions.

**Key insight:** Code is inherently executable — by making the agent's action space be code itself, you get automated feedback (error messages, return values) for free.

**Results:** Up to 20% higher success rate vs Text and JSON action spaces across 17 LLMs on API-Bank and M3ToolEval benchmarks.

**Source:** [CodeAct — arXiv](https://arxiv.org/abs/2402.01030), [CodeAct GitHub](https://github.com/xingyaoww/code-act)

---

### 2.5 LLMLOOP (ICSME 2025) — Iterative Feedback Loops

**What it is:** Framework that uses iterative feedback loops to enhance LLM-generated code. First loop ensures compilability. When all tests pass (or budget exhausted), performs static analysis using PMD. Feedback from each loop feeds into the next generation attempt.

**Key pattern:** The generate-and-check pattern where code is automatically checked for compilability and behavioral equivalence. For negative results, the LLM is re-prompted with feedback. The first feedback loop boosts performance by up to 24%.

**Source:** [LLMLOOP Paper](https://valerio-terragni.github.io/assets/pdf/ravi-icsme-2025.pdf)

---

### 2.6 Comprehensive Survey (June 2025)

A major survey categorizes 63 LLM-based automated program repair systems published from January 2022 to June 2025 into four paradigms:

1. **Fine-tuning:** Strong task alignment at high training cost
2. **Prompting:** Rapid deployment but limited by prompt design and context windows
3. **Procedural pipelines:** Reproducible control with moderate overhead
4. **Agentic frameworks:** Handle multi-hunk/cross-file bugs at the cost of increased latency

A balanced agentic model achieved 42.3% benchmark solve rate using an average of 11.8 feedback iterations.

**Source:** [Survey of LLM-based Automated Program Repair — arXiv](https://arxiv.org/html/2506.23749v1)

---

### 2.7 Relevance to AIMEAT Pipeline

**Direct applicability:**
- **Reflexion's episodic memory** maps to our pipeline's ability to carry forward context from previous generation steps (extension exports, library API surface)
- **LeDex's explain-then-fix** suggests that asking the LLM to explain what the generated code does before moving to the next step would catch integration issues early
- **ROCODE's incremental detection** during generation could apply to streaming validation of generated code — catching interface mismatches as they appear rather than after full generation
- **CodeAct's code-as-action** validates the approach of executing generated code and using the output (types, exports, runtime behavior) as feedback for subsequent steps
- **LLMLOOP's first-feedback-loop-is-most-valuable** finding suggests that even a single compile/typecheck between steps would capture most of the benefit

---

## 3. The Test Tautology Problem

### 3.1 The Core Problem

When an AI model generates tests from existing code, it creates **self-fulfilling validation** rather than genuine testing. The LLM reads function signatures, interprets variable names, infers branches, and produces test cases whose expected outputs match whatever the current code does — including bugs.

**The tautology:** "Tests now validate the implementation, not the intention. We are replacing validation with transcription."

**Concrete example:** A buggy `divide()` function that returns `0` for division by zero gets an AI-generated test asserting exactly that behavior — the test passes despite the code being incorrect.

**Scale of the problem:** LLMs generated tests with 100% line and branch coverage yet a mutation score of only 4% — meaning the tests caught almost no injected faults.

**Source:** [AI-Generated Tests are Lying to You — David Adamo Jr.](https://davidadamojr.com/ai-generated-tests-are-lying-to-you/)

---

### 3.2 Solutions

#### 3.2.1 Test-First / TDD Approach

Generate tests BEFORE writing the implementation code. The TGen framework demonstrates this with a six-phase pipeline: input → specialized agents → LLM engine → output → verification → remediation loop.

**Results with test-first approach:**
- MBPP: +12.0% additional problems solved
- HumanEval: +8.5%
- CodeChef: +7.72%

Adding a remediation loop (iterating on test failures) added another 2.8-9.36% improvement.

**Source:** [Test-Driven Development for Code Generation — arXiv](https://arxiv.org/abs/2402.13521)

#### 3.2.2 Mutation Testing

Intentionally inject small faults ("mutants") into code and check whether tests detect them. If tests pass despite the mutation, they're tautological.

**Meta's ACH tool (2024):** Used LLMs to generate both mutants and tests that catch them. Over thousands of mutants, Meta engineers accepted 73% of generated tests, with 36% judged as privacy-relevant. The system ensures generated tests "kill the mutants, so engineers only ever need to look at tests and, if they wish, mutants that are guaranteed to be non-equivalent."

**Source:** [Meta Engineering Blog: LLMs Are the Key to Mutation Testing](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/)

#### 3.2.3 Intent-Anchored Generation

Four strategies from the literature:

1. **Generate tests before code** — treat LLM as TDD collaborator
2. **Use mutation testing** (MutPy, PIT) to verify tests catch real faults
3. **Explore failure modes** — ask "what could break" rather than "how does this work"
4. **Reframe AI role** — creative thinking partner, not validation automaton

**Source:** [AI-Generated Tests are Lying to You](https://davidadamojr.com/ai-generated-tests-are-lying-to-you/)

---

### 3.3 Relevance to AIMEAT Pipeline

**Critical for our generator:** Our pipeline generates both components AND tests. If the tests are generated from the component code (or even from the same prompt context), they will be tautological by definition.

**Solutions that apply:**
1. **Generate tests from the spec/contract, not from the code.** The CSM definition and the extension's declared API surface should drive test generation, not the implementation.
2. **Generate tests FIRST.** Use the extension spec to generate tests, then generate the implementation that must pass them. This inverts the tautology.
3. **Use real runtime outputs as golden samples.** Execute the extension, capture what it actually exports/returns, and verify that against the declared contract — not against what the code "should" do.
4. **Mutation testing post-generation.** After generating both code and tests, inject faults into the code and verify the tests catch them.

---

## 4. Contract-First / Schema-First Multi-Component Generation

### 4.1 The Planner-Coder Gap (2025)

**The problem:** In multi-agent code generation, planning agents decompose requirements into high-level plans that are logically sound but lack sufficient implementation details. Coding agents then fail to implement them correctly.

**Severity:** The planner-coder gap accounts for **75.3% of all observed failures** in tested multi-agent systems. Semantically equivalent inputs cause performance drops of 7.9%-83.3%.

**Root causes:**
1. **Semantic drift** — planner's intent is progressively diluted through abstraction
2. **Context fragmentation** — coders lose access to constraints and boundary conditions implicit in original requirements but not preserved in plans

**Five error patterns:** Misunderstanding core algorithms, overlooking edge cases, failing on multi-step logic, misinterpreting relationships, improper conditional branches.

**Solution:** A "Monitor Agent" that provides detailed plan interpretation addressing the five error patterns, plus code validation checking alignment between generated code and interpreted plans. Repairs 40-89% of identified failures.

**Source:** [Understanding and Bridging the Planner-Coder Gap — arXiv](https://arxiv.org/abs/2510.10460), [Full HTML](https://arxiv.org/html/2510.10460)

---

### 4.2 Shared Context Architectures

#### Blackboard Model (Self-Collaboration)
An explicit shared memory space for storing structured information: task descriptions, intermediate generation results, and code revision records. All agents can read or update blackboard content based on task types.

#### L2MAC — Von Neumann Architecture (ICLR 2024)
Designs decoupled instruction registers and file storage modules with explicit control units for scheduling context. Organizes information by program units, effectively breaking through context window limitations. The file store contains both final and intermediate outputs, and each instruction is executed by a separate LLM agent whose context is managed by a control unit capable of precise memory reading and writing.

**Source:** [L2MAC — arXiv](https://arxiv.org/abs/2310.02003), [L2MAC GitHub](https://github.com/samholt/L2MAC)

#### Hierarchical Memory (Cogito)
Brain-like context organization with short-term memory, long-term knowledge base, and evolutionary growth units.

**Source:** [Survey on Code Generation with LLM-based Agents — arXiv](https://arxiv.org/html/2508.00083v1)

---

### 4.3 Multi-Agent Code Generation Frameworks

#### MapCoder (ACL 2024)
Four specialized agents in a cycle: (1) Retrieval — recalls relevant examples, (2) Planning — formulates solution plan, (3) Code Generation — produces code, (4) Debugging — uses sample I/O to fix bugs. The debugging agent is supplemented with plans from the planning agent for "plan-derived debugging."

**Results:** HumanEval 93.9%, MBPP 83.1%, APPS 22.0%, CodeContests 28.5%.

**Source:** [MapCoder — arXiv](https://arxiv.org/abs/2405.11403), [ACL 2024 Proceedings](https://aclanthology.org/2024.acl-long.269/)

#### AgentCoder
Three specialized agents: programmer, test designer, test executor. The test designer generates tests independently, the test executor runs code against tests and feeds results back to the programmer.

**Key insight:** The test designer agent operates independently of the programmer — this avoids the tautology problem because tests aren't derived from the implementation.

**Results:** GPT-3.5 improved from 57.3% to 79.9% pass@1 on HumanEval. GPT-4 achieved 91.5% mean pass@1.

**Source:** [AgentCoder — arXiv](https://arxiv.org/abs/2312.13010)

#### SolAgent (2025)
Dual-loop refinement: inner loop uses compiler for functional correctness, outer loop uses static analyzer for security vulnerabilities. File system tools enable exploring project structures and resolving dependencies contextually.

**Results:** 64.39% Pass@1, significantly outperforming AI IDEs like GitHub Copilot. Reduces security vulnerabilities by 39.77% vs human baselines.

**Source:** [SolAgent — arXiv](https://arxiv.org/abs/2601.23009)

---

### 4.4 MCP as Neural Contract Layer

The Model Context Protocol (MCP) serves as a structured framework enabling LLMs and agents to retain, enforce, and evolve within a shared understanding of context. It functions as: (1) a vision anchor ensuring agentic behavior stays aligned with original mission, (2) a protocol interface standardizing how agents interpret parameters and constraints, (3) a semantic memory keeper maintaining reasoning behind generated code.

**Source:** [MCP: The Neural Contract Layer — Medium](https://medium.com/@armankamran/model-context-protocol-mcp-the-neural-contract-layer-for-vision-aligned-multi-agent-code-9264a1a84e8f)

---

### 4.5 Relevance to AIMEAT Pipeline

**The planner-coder gap is our exact problem.** When our pipeline generates an extension spec (the "plan"), then generates a library that must use it (the "code"), we face exactly the semantic drift and context fragmentation described in the research.

**What applies:**

1. **The contract IS the shared context.** Our CSM/extension spec should be the explicit "blackboard" that all generation steps read from and validate against. Not just a prompt input, but a structured artifact that constrains generation.

2. **L2MAC's file store pattern** maps to our pipeline: each step's output (actual generated files) becomes part of the context for the next step. The intermediate outputs ARE the contract.

3. **AgentCoder's independent test designer** is the right pattern for us: generate tests from the spec, not from the implementation. The spec describes intent; the implementation may have bugs.

4. **The Monitor Agent pattern** (from planner-coder gap research) suggests we need a validation step between generation stages that checks: "Does the generated library actually use the extension's exported API correctly?" This is more than typechecking — it's semantic alignment verification.

5. **SolAgent's dual-loop** (compile + analyze) applies: after generating each component, run both a compile check AND a semantic check before proceeding.

---

## 5. The Probe / Golden Sample Pattern

### 5.1 Execute and Capture Real Outputs

The core idea: instead of telling the next generation step what the previous step's output *should* be, execute the previous step's code and capture what it *actually* is.

#### CodeAct Pattern
By integrating a Python interpreter into the agent architecture, CodeAct enables immediate code execution, real-time feedback from the environment, and dynamic adjustment of actions through multi-turn interactions. Each action yields a structured observation or exception, which is looped back into the state history.

**Source:** [CodeAct — arXiv](https://arxiv.org/abs/2402.01030)

#### LLMLOOP's Generate-and-Check
Code generated by the LLM is automatically checked for compilability and behavioral equivalence with the original code. For negative results, the LLM is re-prompted with feedback. The first feedback loop alone boosts performance by up to 24%.

**Source:** [LLMLOOP Paper](https://valerio-terragni.github.io/assets/pdf/ravi-icsme-2025.pdf)

#### Lovable's Context Bundle
After each generation cycle, the system gathers a "context bundle" that includes project files, environment state, and signals from previous iterations. These signals inform the next agent cycle.

**Source:** [Lovable Architecture — System Design Space](https://system-design.space/en/chapter/lovable-startup-architecture/)

---

### 5.2 Golden Datasets for Validation

A golden dataset contains expected inputs with approved outputs — "ground truth" that evaluation targets must match. In LLM evaluation, goldens are "pending test cases" containing input data and expected results, but missing the dynamic elements (actual_output) that will be generated when the LLM processes them.

**Key principle:** It is "highly not recommended to pre-populate the actual output" — these must be populated dynamically. Testing compares the system's responses to expected results.

**Cross-model validation:** Generate data with one model (e.g., GPT-4) and validate with another (e.g., Mistral Large 2) to avoid self-reinforcing biases.

**Source:** [Golden Test Cases — Confident AI Docs](https://www.confident-ai.com/docs/llm-evaluation/core-concepts/test-cases-goldens-datasets)

---

### 5.3 Code Execution as Grounded Supervision

Research on using code execution traces as supervision signal for LLM reasoning. The translated execution trace is grounded in actual code execution, making it a reliable and accurate source of reasoning supervision.

**Source:** [Code Execution as Grounded Supervision — ACL EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1260.pdf)

---

### 5.4 Relevance to AIMEAT Pipeline

**This is the most directly applicable pattern.** Here's how it maps:

**Current pipeline (prompt-driven, no execution):**
```
Generate Extension → [prompt tells LLM what extension exports] → Generate Library → [prompt tells LLM what library provides] → Generate App
```

**Probe pattern applied:**
```
Generate Extension → Execute: capture actual exports/types → Feed real exports into Library prompt → Generate Library → Execute: capture actual API surface → Feed real API into App prompt → Generate App
```

**Specific implementation ideas:**

1. **Extension probe:** After generating extension code, run it in a sandboxed environment and capture:
   - Actual exported function signatures
   - TypeScript type definitions (via `tsc --declaration`)
   - Runtime behavior (call functions with sample inputs, capture outputs)

2. **Library probe:** After generating the cortex library, capture:
   - Actual exported API (function names, parameter types, return types)
   - Actual CSS class names if it generates styles
   - Sample rendered output if it generates UI components

3. **App probe (validation):** After generating the app, execute it and verify:
   - It successfully imports the library
   - The library's functions are called with correct arguments
   - The UI renders without errors

**The golden sample pattern for tests:**
- Execute the extension with known inputs
- Capture actual outputs as "golden samples"
- Generate tests that verify these golden outputs
- This avoids the tautology problem because the golden samples come from execution, not from reading the source code

---

## 6. Synthesis: Patterns for the AIMEAT Generator Pipeline

### 6.1 Key Architectural Patterns from Research

| Pattern | Source | What It Means for Us |
|---------|--------|---------------------|
| **Execute between steps** | Devin, Bolt, Lovable, CodeAct | Run generated code and capture real outputs before generating the next component |
| **Context bundle** | Lovable | Package each step's real outputs as structured context for the next step |
| **Shared blackboard** | Self-Collaboration, L2MAC | The CSM spec + accumulated real outputs form a shared context all steps read from |
| **Independent test designer** | AgentCoder | Generate tests from spec, not from implementation |
| **Test-first generation** | TGen, TDD research | Generate tests before implementation to avoid tautology |
| **AutoFix post-processing** | v0/Vercel | Quick validation/fix pass after each generation step |
| **Monitor Agent** | Planner-Coder Gap | Validate semantic alignment between steps, not just syntax |
| **Backtracking** | ROCODE | When a step fails validation, roll back and regenerate with error context |
| **Dual-loop validation** | SolAgent | Compile check + semantic check after each component |
| **Episodic memory** | Reflexion | Carry forward what worked/failed in previous attempts |

### 6.2 What the Research Says About Our Specific Architecture

Our pipeline is unusual because it's **prompt-driven** — the user copies prompts to their AI chat and brings results back. This means:

1. **We cannot execute between steps automatically** (the AI chat has no execution environment). However, we CAN:
   - Execute the *previous* step's output on our server before composing the next prompt
   - Include real execution results in the next prompt's context
   - Validate generated code on our server before accepting it

2. **The contract-first approach is our strongest lever.** Since we control the prompts, we can:
   - Define the interface contract in the extension spec
   - Generate tests from the contract (not the implementation)
   - Include the contract + real execution outputs in every subsequent prompt
   - Validate each generated component against the contract

3. **The tautology problem is solvable** if we:
   - Generate tests from the CSM/spec, not from the generated code
   - Use execution probes to create golden samples
   - Validate tests with mutation testing (inject faults, verify tests catch them)

### 6.3 Recommended Reading

These are the most actionable papers/resources for our specific use case:

1. **Planner-Coder Gap** — directly describes our inter-step integration problem: https://arxiv.org/abs/2510.10460
2. **AgentCoder** — independent test generation pattern: https://arxiv.org/abs/2312.13010
3. **CodeAct** — code execution as feedback mechanism: https://arxiv.org/abs/2402.01030
4. **ROCODE** — backtracking on errors during generation: https://arxiv.org/abs/2411.07112
5. **LeDex** — explain-then-fix for self-debugging: https://arxiv.org/abs/2405.18649
6. **TDD for Code Generation** — test-first approach with LLMs: https://arxiv.org/abs/2402.13521
7. **Lovable Architecture** — context bundle pattern: https://system-design.space/en/chapter/lovable-startup-architecture/
8. **v0 AutoFix** — streaming post-processing for error correction: https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent
9. **Meta Mutation Testing** — using mutation testing with LLM-generated tests: https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/
10. **Survey on Code Generation with LLM Agents** — comprehensive 2025 overview: https://arxiv.org/html/2508.00083v1
