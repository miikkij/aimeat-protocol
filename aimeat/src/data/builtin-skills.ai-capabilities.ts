/**
 * @file src/data/builtin-skills.ai-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-ai-capabilities` built-in skill: how an AI that builds an app, an
 *   automation or its own work uses the node's AI capabilities (text, vision, files, image, speech,
 *   transcription, embed), with recipes (System 2 plan, docs/internal/llmproviderintegrations/13
 *   section 3, and 12 for embeddings).
 *
 *   WHY A NODE SKILL. The capabilities are a platform feature every node ships; a builder on any node
 *   finds the guide with `aimeat_skill_list`, and `GET /v1/ai/capabilities` names it in `guide`.
 *   Seeded on every boot.
 *
 *   WHAT IT MUST AGREE WITH. The capabilities answer (services/ai/capabilities.ts), the routes, the
 *   library (sdk-libs/ai/), the publish hints (services/app-ai-capability-hints.ts) and the jobs and
 *   workflow step. It is measured with its eval suite, .claude/evals/aimeat-ai-capabilities/, through
 *   `pnpm eval:skill --node-skill aimeat-ai-capabilities`, which never copies it into the repo.
 * @structure AI_CAPABILITIES_SKILL_ENTRY
 * @usage import { AI_CAPABILITIES_SKILL_ENTRY } from './builtin-skills.ai-capabilities.js';
 * @version-history
 *   v1.3.0 — 2026-10-05 — A direct AI call counts against the account's limit of AI calls a minute
 *     (RATE_LIMITED); a schedule, a workflow step or a job's run does not (secaudit 2026-10, C5).
 *   v1.1.0 — 2026-10-02 — `fix` is the person's sentence, `settingsUrl` the link to where it is
 *     fixed, `agentFix` the AI's; for UNTESTED, offer to run the test with the person's yes.
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 *   v1.0.1 — 2026-09-28 — An extension of the owner's can be a provider (V6).
 *   v1.1.0 — 2026-09-28 — Embeddings are rare and the person's decision: never proposed by the AI,
 *     two tests first (does it fit one prompt, does word search find it), and the three conditions
 *     that make them truly needed (Jouni: "embeddings should be used rarely and only when user
 *     decides so and is really really needed").
 *   v1.2.1 — 2026-09-28 — Section 2b: role.<name>.context= passes a model over, a connection needs every
 *     capability, and AIMEAT.ai.roles() answers an app with its own roles only.
 *   v1.2.0 — 2026-09-28 — Section 2b, AI roles: an app declares what each kind of AI work is for, the
 *     owner connects it before it runs, and an AI proposes a connection the owner confirms.
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const AI_CAPABILITIES_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-ai-capabilities',
  visibility: 'public',
  skillMd: `---
name: aimeat-ai-capabilities
description: How to use the AI capabilities of an AIMEAT node (text, reading images, reading files and PDFs, making images, speech, transcription, embeddings) in an app, an automation or an agent's own work. Check first with aimeat_ai_capabilities or AIMEAT.ai.capabilities(), ask for the capability and not a model, handle a capability that is off visibly, tell the price before an expensive call, and never propose embeddings, which are for a collection far too large for one prompt and only when the person decides. Recipes for a picture button, voice message to summary, asking a PDF, a morning digest of voice messages, alt text, duplicates in a very large collection, and a crew on the node's /v1/llm. Use before building anything that calls AI. Triggers on AI feature, AI role, connect an app's role, generate image, speech, text to speech, transcribe, voice message, PDF, embeddings, vectors, semantic search, kuvan teko, puhe, litterointi, upotus.
license: MIT
metadata:
  audience: agent
---

# The node's AI capabilities

The owner's AI providers (their own OpenAI, Anthropic, Mistral, xAI or OpenRouter account, a model
on their own machine, an extension of theirs that serves AI calls, the node's own) serve seven
capabilities. Each is on or off for each caller:

| Capability | What a person gets |
|---|---|
| \`text\` | Written answers: summaries, drafts, replies, structured data. |
| \`vision\` | A model reads a picture: describes it, answers a question about it. |
| \`files\` | A model reads a file or a PDF itself and answers from it. The node never converts a PDF. |
| \`image\` | A new picture from a description. |
| \`speech\` | Text read aloud in a synthetic voice. |
| \`transcription\` | Speech in an audio file turned into text. |
| \`embed\` | Text turned into vectors, so a search finds what means the same, not only the same words. |

## 1. Check first

Before you plan, call \`aimeat_ai_capabilities\` (an app: \`AIMEAT.ai.capabilities({ app_id })\`). For
each capability it answers \`on\`, the \`model\` and \`provider\` a call would use, the \`price\`, and a
\`howTo\` line. For one that is off it answers \`reason\` and three ways to the fix:

- \`fix\`: the sentence for the person, already in their language, with no tool names. Say it to them.
- \`settingsUrl\`: their AI settings, opened at the provider to fix, with its test chosen when a test
  is the fix. Give it to them as a link.
- \`agentFix\`: the same fix for you, with the tool to use. \`testProvider\` names the provider to test.

| reason | What to do |
|---|---|
| NO_MODEL | The owner sets a model for it on a provider, or the operator sets a node default. |
| NO_PROVIDER_SUPPORTS | The owner adds a provider of a type in \`providersThatCan\`. |
| NO_KEY | The owner sets the key on the AI settings page. Never ask for a key in chat. |
| POLICY_EMPTY | Propose a policy change with aimeat_ai_policy_set; the owner confirms. |
| BUDGET_EXHAUSTED | The owner raises the daily budget, or it resets at midnight UTC. |
| RETIRED_MODEL | Find another with aimeat_ai_models and propose it. |
| UNTESTED | The owner's rules use only tested providers. Offer to test it; with their yes, aimeat_ai_provider_test { provider: testProvider.id, capability }. Or give them \`settingsUrl\`, where Test now is one press. |
| APP_NOT_ALLOWED | The owner adds the app to their AI app list. |

Tell the person \`fix\` and give them \`settingsUrl\`. Do not build around a capability that is off,
and do not promise a feature the node cannot run for them.

## 2. Five rules for code

1. **Ask for the capability, not a model.** Leave \`model\` out and the owner's providers choose. Name
   a model only when the app truly needs that one.
2. **Check first and show the fix.** \`const caps = await AIMEAT.ai.capabilities({ app_id })\`; when
   \`caps.capabilities.image.on\` is false, keep the control visible, disabled, with \`fix\` beside it
   and an "Open AI settings" link to \`settingsUrl\`. Never hide a button in silence, and never show
   the person \`message\` or \`agentFix\`: they are written for developers and AIs.
3. **Declare the models the app needs** in its head: \`<meta name="aimeat-ai" content="generates=text,image;
   discloses=yes; models=<type>:<model id>">\`. \`prefer.<capability>=\` orders the owner's providers (a type,
   or a model reference) and never adds one; \`local.<capability>=yes\` keeps that capability on this
   machine. The format is \`key=value;\`, not JSON. Take each reference from \`aimeat_ai_models\` (its \`ref\`).
4. **Say when the answer came from elsewhere.** \`route.fellBack\` is true when the first provider failed
   and another answered; \`policy_chose_model\` when the owner's policy picked the model. Say so when it
   matters, for example a different voice in speech.
5. **Tell the price before an expensive call**: a picture, a long transcription, a large embedding run.
   The price is in the capabilities answer; \`confirm: true\` on \`AIMEAT.ai.image()\` and \`speak()\` shows it.

Errors carry \`err.code\`: AI_CAPABILITY_UNAVAILABLE (with \`details.rejected\`), AI_MODEL_NOT_ALLOWED
(with the \`allowed\` list), QUOTA_EXHAUSTED, and RATE_LIMITED (429). A refusal the person can fix carries
\`err.fix\` and \`err.settingsUrl\`, as a capability does: show the sentence and the link; never an empty result.

**Calls are counted per account.** Every AI call a person, an app or an agent starts directly (complete,
image, transcribe, speech, embed, a provider test, a job start) counts against one limit for the whole
account, 30 a minute unless the operator set another number. Over it, the call answers RATE_LIMITED and
says in how many seconds to try again (\`Retry-After\` on REST): wait that long, then call again.

## 2b. Roles: what a model is for

A capability says what a model does; a role says what it is for (a summarizer, an illustrator). When an
app has more than one kind of AI work, declare a role for each in the meta, and call with \`role\`:
\`role.summarizer=text; role.summarizer.purpose=Short summaries; role.summarizer.temperature=0.2\`, then
\`AIMEAT.ai.complete({ app_id, prompt, role: 'summarizer' })\`. A role takes several capabilities joined
with \`+\` (\`role.illustrator=text+image\`), and its fine-tuning (\`temperature\`, \`top_p\`, \`max_tokens\`,
\`reasoning\`) overrides the provider's default.

- **A role says what the work needs, never a model.** The owner connects it to one of their roles, which
  names the providers and models in order, so the app works on any owner's providers. The owner's role
  must have a provider for every capability yours needs, or the connection is refused.
- **Say how much text the role reads**: \`role.<name>.context=100000\` (tokens). A model the catalogue
  says reads less is passed over, and the owner's AI page says so on the role.
- **Nothing runs until the owner connects it.** An unconnected role is refused with AI_ROLE_NOT_BOUND
  (409) and the owner sees the request on the AI page. \`capabilities()\` answers \`roles\`, each with
  \`bound\` and a \`fix\`: show it beside the control, as for a capability that is off.
- **As an app:** \`AIMEAT.ai.roles()\` answers the app's own roles only, each with \`boundTo\` (null while
  it waits). It never shows the owner's other apps.
- **As the owner's AI:** \`aimeat_ai_roles\` lists the owner's roles and the app roles waiting;
  \`aimeat_ai_role_set\` proposes a role or a connection, and the owner confirms it. Never connect a role
  the owner has not seen: connecting it is their approval of what that app may run.

## 3. Automations

- A long answer or a picture in the background: \`aimeat_ai_job_start\` (\`ctx.ai.start\` in an extension),
  with \`op\`: \`text\` (default), \`image\` (the record at \`result_key\` is \`{ storage_key, url, mime_type, model }\`),
  or \`transcribe\` with \`audio_key\`, the audio file's storage key.
- A workflow's \`ai\` step takes the same \`op\`, \`audio_key\` and \`provider\`.
- Something every morning: \`aimeat_schedule_create\` or a scheduled workflow.
- A capability that goes off while a run is under way stops that step with its refusal, and the owner is
  told. A spent budget stops it the same way. Check capabilities when you set the automation up.
- The calls a schedule, a workflow step or a running job makes do not count against the account's limit
  of AI calls a minute; starting a job counts once. Work over many items belongs there, not in a loop
  of direct calls.

## 4. Embeddings: rarely, and only when the person decides

An embedding model turns a text into a vector that captures its meaning: "invoice late" finds "payment
not received by the due date", which share no word. They are seldom needed.

**Never propose embeddings on your own initiative.** Build with word search (\`AIMEAT.data.search\`),
filters, or the whole collection in one prompt. Talk about embeddings only when the person asks for
them, or when both tests below fail; then say what they cost and let the person decide.

**Test 1: does the collection fit in one prompt?** A current text model reads 200 000 tokens or more in
one call, about 150 000 words: thousands of short items. 120 recipes are about 40 000 tokens. When the
collection fits and changes little, send all of it to a text model; that is simpler, and usually more
accurate than finding pieces first.

**Test 2: does word search find it?** Try it with the words people really use. A reason exists only when
a real use keeps missing texts written in other words or in another language.

**Truly needed only when all three hold:** the collection is far larger than one prompt (hundreds of
thousands of tokens and more) or grows every day; people search it by meaning, often; and sending all of
it with every question would cost too much. Examples: years of a company's documents, a support archive
of tens of thousands of messages, search across languages in such a collection.

**Never for:** a few hundred or a few thousand short texts; exact values (ids, names, dates, codes); only
the newest items; "just in case"; data that must not leave the machine when there is no local embedding
model.

- **Cost:** a million input tokens costs from about $0.01 to $0.13 by model (2026-09-27). Changing the
  model means embedding everything again: vectors of different models cannot be compared, which is why
  a fallback only ever uses the same model. Store the answered \`model\` beside every vector.
- **Size:** 1 536 or 3 072 numbers per text, 6 to 12 kB as 32-bit numbers, more as JSON. One memory
  value holds 1024 kB, so a memory record is not the place for a large vector collection. The node
  itself has no vector search yet.
- **What to embed:** condensed facts work better than raw text; split long text into passages; embed
  what people will search for; never embed secrets or identity numbers (the text goes to the provider).

## 5. Files and PDFs

The model reads the file itself: \`AIMEAT.ai.complete({ app_id, prompt, files: [{ storage_key }] })\`, at
most 5 files and 20 MB. When \`files\` is off, suggest a provider whose model reads files (the catalogue's
\`caps.fileIn\`), or on OpenRouter a PDF engine on the provider. Never extract the text in the app and
present it as the model having read the file.

## 6. Recipes

**A picture from a button, price first, a message when off (app):**
\`\`\`javascript
const caps = await AIMEAT.ai.capabilities({ app_id: 'poster' });
const img = caps.capabilities.image;
button.disabled = !img.on;
hint.textContent = img.on ? '' : img.fix;
button.onclick = async () => {
  try {
    const r = await AIMEAT.ai.image({ app_id: 'poster', prompt: input.value, confirm: true });
    picture.src = r.src;   // loads for a private picture too; keep it public to show it again later
  } catch (e) { hint.textContent = e.message; }
};
\`\`\`

**Voice message → transcript → summary (app):**
\`\`\`javascript
const t = await AIMEAT.ai.transcribe({ app_id: 'voice-notes', storage_key: key });
const s = await AIMEAT.ai.complete({ app_id: 'voice-notes', prompt: 'Summarise in three lines:\\n' + t.text });
render(t.text, s.content);
\`\`\`
Check \`transcription\` and \`text\` first; a long recording costs by the second.

**Ask a PDF (app):** store the file (\`AIMEAT.storage\`), then
\`AIMEAT.ai.complete({ app_id: 'ask-pdf', prompt: question, files: [{ storage_key: key }] })\`. Check \`files\` first.

**Every morning: yesterday's voice messages as one summary in a workspace (automation):** a scheduled
workflow whose steps list yesterday's audio files, run an \`ai\` step with \`op: 'transcribe'\` for each,
then one \`ai\` step (text) that summarises the transcripts, and write the result to the workspace.

**Alt text for published pictures (automation):** for each new picture, \`POST /v1/ai/complete\` with
\`images: [<the picture's URL>]\` and the prompt "Describe this picture in one sentence for a screen
reader" (the \`vision\` capability); store the answer beside the picture. A background job takes no
picture input, so this is a direct call.

**Duplicates in a very large notes collection (automation, only when the person decided it after section 4):** embed each note's
condensed text in batches of at most 256 with \`aimeat_ai_embed\`, keep \`{ id, model, vector }\` in records
of a few hundred vectors each, compare by cosine similarity, and show pairs above a threshold for a
person to decide. Embed again only the notes that changed, with the same model.

**A crew on the node's AI (agent):** in Python, \`from aimeat_crewai import node_llm, capabilities\`;
\`llm = node_llm()\` sends the crew's calls through the node's \`/v1/llm\`, so the owner's providers,
policy and budget apply. \`capabilities()\` answers what is on, as above.
`,
};
