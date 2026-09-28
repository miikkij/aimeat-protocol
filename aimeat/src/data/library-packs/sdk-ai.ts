/**
 * @file sdk-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-ai.js, AI on the user's own AI providers. Its own file
 *   because library-packs/sdk.ts is at the line ceiling; placed where it stood in SDK_PACKS, after
 *   aimeat-organism.
 * @structure AI_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.1 — 2026-09-28 — The roles paragraph: roles() is the app's own, context passes a model over, a
 *     connection needs every capability.
 *   v1.0.0 — 2026-09-28 — Moved from library-packs/sdk.ts (max-file-lines), with the aiDoc's AI roles
 *     paragraph added in the same change (role on every call, AIMEAT.ai.roles(), AI_ROLE_NOT_BOUND).
 */
import type { LibraryPack } from './types.js';

export const AI_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-ai',
    kind: 'sdk',
    category: 'ai',
    title: 'AI completions',
    description: "AI on the user's own AI providers: text, pictures, speech, transcription and embeddings. Per-user daily budget, per-app quotas and the owner's model policy keep spend safe.",
    url: '/v1/libs/aimeat-ai.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-ai.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.ai',
    aiDoc: [
      "AI on the user's own AI providers, reached through the node (AIMEAT.ai: capabilities, complete, completeJson, stream, image, speak, transcribe, embed, models, roles, usage, job). No key reaches the browser; never bundle your own API key. The server enforces the owner's daily USD budget, per-app quotas and model policy.",
      'CHECK FIRST: const caps = await AIMEAT.ai.capabilities({ app_id }) gives caps.capabilities.text, .vision, .files, .image, .speech, .transcription and .embed, each { on, model, price, leaves } or, when off, { on: false, reason, fix }. When a capability is off, show the person its `fix` beside the control that needs it (disabled, with that sentence); never hide the button silently, because then nobody learns what to set up. isAvailable() stays the quick yes or no for text.',
      "ASK FOR THE CAPABILITY, NOT A MODEL: complete({ app_id, prompt }), stream({ app_id, messages or prompt, onText(delta, all) }), image({ app_id, prompt, size }) → { url, storage_key }, speak({ app_id, input }) → { blob } (mp3; new Audio(URL.createObjectURL(r.blob)).play()), transcribe({ app_id, storage_key or audio: blob, language }) → { text }, embed({ app_id, input: [texts] }) → { embeddings, model }. The owner's providers and policy choose the model. When the app truly needs particular models, declare them in its meta: <meta name=\"aimeat-ai\" content=\"generates=text,image; discloses=yes; models=<type>:<id>; prefer.image=openrouter; local.transcription=yes\">. models= takes the `ref` of a row from AIMEAT.ai.models({ capability: 'image' }); prefer.<capability>= a provider type or a ref, in order; local.<capability>=yes keeps that capability on the person's machine. A declaration only narrows what the owner allows.",
      "TELL THE PRICE BEFORE AN EXPENSIVE CALL: pictures, speech and long batches cost money. image({ ..., confirm: true }) and speak({ ..., confirm: true }) show the catalogue price (caps.capabilities.image.price) in the confirm dialog; for anything else pass confirm: { estimate: '~$0.04' }. A cancel rejects with err.code SPEND_CANCELLED. Identical calls in flight collapse into one paid call.",
      'EVERY ANSWER SAYS WHO ANSWERED: route { answeredBy: { provider, model }, fellBack } and, on complete, policy_chose_model. When route.fellBack or policy_chose_model is true, say beside the result that another model answered than the usual one. provider: <id or type> and fallback: false pin a call to one of the owner\'s providers. Errors carry err.code from the node (NO_API_KEY, QUOTA_EXHAUSTED, APP_QUOTA_EXHAUSTED, APP_NOT_ALLOWED, AI_CAPABILITY_UNAVAILABLE, AI_MODEL_NOT_ALLOWED, ...) and err.details; after a capability refusal call capabilities({ app_id, fresh: true }) and show the fix.',
      "complete() details: images: [dataUrlOrHttpsUrl] (at most 8, downscale first) for a question about a picture; files: [storage_key or File or { data_url, filename }] (at most 5, 20 MB in all) for documents the model reads itself (needs files on). Pattern: compose the prompt from app data, call with app_id so spend is attributable, render the result into an editable field. Work that takes minutes goes to AIMEAT.ai.job.start, not complete().",
      'EMBEDDINGS rarely, and only when the person decided it: never add them on your own. A collection that fits one prompt (thousands of short items, 200 000 tokens) goes to AIMEAT.ai.complete() whole, and word search (AIMEAT.data.search) comes first. Keep the model with every vector (vectors of different models do not compare) and embed again when it changes. A vector is 6 to 12 kB and one memory value holds 1024 kB: never put a collection of vectors in one value; store a vector with its own record, or in small groups.',
      "AI ROLES: a capability says what a model does, a role what it is for. An app that needs different tuning for different jobs declares each role in its meta (role.summarizer=text; role.summarizer.purpose=...) and passes role: 'summarizer' on every call (complete, stream, image, speak, transcribe, embed, job.start). The role runs only after the owner binds it to one of their roles; until then the call is refused with err.code AI_ROLE_NOT_BOUND (err.details.binding): show that the owner connects it on the AI page. AIMEAT.ai.roles() lists the app's own roles and whether each is bound (boundTo). A named model or provider wins over the role. role.<name>.context=100000 says how many tokens the role reads: a model the catalogue says reads less is passed over. The owner can connect the role only to a role of theirs with a provider for every capability it needs.",
      'models({ capability, type, allowed }) reads the node catalogue (GET /v1/ai/models, open to an app) instead of the old owner-only OpenRouter list: rows are { ref, type, id, name, caps, limits, price, status } plus context_length and pricing in the old form; default is the text models this caller can use. Pass `ref` as model.',
      'AIMEAT.ai.declare(item, provenance) stores the BARE record under item.aiProvenance (plus aiProvenanceUrl), not the { id, record, recordUrl } wrapper complete() returns, so keep the bare shape on your item from the start. AIMEAT.ai.disclose(provenance, { target }) REPLACES the target\'s content and draws nothing when no label is owed: give it an element of its own, and write your own origin line beside it if readers should always see where a text came from.',
    ].join(' '),
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['ai', 'llm', 'summary', 'suggestion', 'generate', 'tekoäly'],
    sizeEstimate: '~4KB',
    status: 'stable',
    modelTier: 'needs-doc',
    proofs: [
      { model: 'claude-haiku-4-5', verdict: 'pass', testSet: 'coresdk-smoke', evidence: 'tools/aeb/results/aeb3-baselib-sweep.md', tokens: 59251, date: '2026-07-17' },
    ],
    promptGroup: 'ai',
    promptLine: "- aimeat-ai.js — AI on the USER's own AI providers: text, pictures, speech, transcription, embeddings. Check `AIMEAT.ai.capabilities()` first and show the `fix` of one that is off; then `complete`, `stream`, `image`, `speak`, `transcribe`, `embed`. Requires aimeat-auth.",
  },
];
