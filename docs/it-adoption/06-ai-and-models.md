# 06 AI and models

> Checked against AIMEAT node 4.2.0 (commit 5ec62c24a) on 2026-11-01. Maintained with the code: see the README for how.

This page is for the architect and the security officer who decide which AI model sources the node may use, and for the administrator who connects them. It answers: which provider types exist and what each can do, who holds the keys, how the node limits where a key and a prompt may go, what data reaches a model and when, how data is kept to a local model, how spend is limited and measured, what the node does for EU AI Act transparency, and what IT prepares for each model source.

A new node has no AI provider. Without one the node stores and serves data and every AI feature answers with a refusal that names the missing setting (`aimeat/src/services/ai/unset-model.ts`).

## Provider types

A provider is a record that says where the model server is, which capabilities it serves with which model, and where the data goes (`aimeat/src/services/ai/providers.ts`). The adapter type decides how the node speaks to it (`aimeat/src/services/ai/adapters/index.ts`).

| Type | Address | Text | Image | Transcribe | Embed | Speech (TTS) | Key | Data leaves the machine |
|---|---|---|---|---|---|---|---|---|
| `openrouter` | fixed: `https://openrouter.ai/api/v1` (or the EU or US host, below) | yes | yes | yes | yes | yes | required | yes |
| `openai` | fixed: `https://api.openai.com/v1` | yes | yes | yes | yes | yes | required | yes |
| `anthropic` | fixed: `https://api.anthropic.com/v1` | yes (also vision, files) | no | no | no | no | required | yes |
| `mistral` | fixed: `https://api.mistral.ai/v1` | yes | no | yes | yes | no | required | yes |
| `xai` | fixed: `https://api.x.ai/v1` | yes | yes | yes | no | no | required | yes |
| `openai-compatible` | any `https` address; `http` only on loopback or an operator-listed origin | yes | yes | yes | yes | yes | optional | yes |
| `local` | loopback, or an origin the operator listed in `AIMEAT_AI_PROVIDER_EGRESS` | yes | yes | yes | yes | yes | optional | no |
| `extension` | an installed extension of the person's own, whose manifest names its hosts | yes | yes | yes | yes | yes | the person's | yes, to the hosts the manifest names |

Sources: `aimeat/src/services/ai/types.ts` (`FIXED_BASE_URLS`), `aimeat/src/services/ai/providers.ts` (`TYPE_CAPABILITIES`). A fixed type is reached only at its official address whatever a record says; any other address is `openai-compatible`. Which model at a provider can do what comes from the model catalogue, refreshed from public sources (`AIMEAT_AI_CATALOG_REFRESH`, weekly by default, `off` available).

Every request goes out through the node's own fetch guard, so a provider record cannot reach an address the egress rules refuse (`aimeat/src/services/ai/fetch.ts`, `aimeat/src/services/ai/adapters/sdk.ts`).

### How the node authenticates to a provider

| Type | Header sent | Source |
|---|---|---|
| `openrouter`, `openai`, `xai`, `mistral` | the vendor package's own header (`Authorization: Bearer <key>`) | `aimeat/src/services/ai/adapters/sdk.ts` |
| `anthropic` | the Anthropic package's own header | `aimeat/src/services/ai/adapters/sdk.ts` |
| `openai-compatible`, `local` | `Authorization: Bearer <key>` when a key is set, nothing when none is | `aimeat/src/services/ai/adapters/sdk.ts`, `aimeat/src/services/openrouter.ts` |

A provider record has no field for a custom header, an `api-key` header, a token that refreshes, or request signing (`aimeat/src/services/ai/providers.ts`, `ProviderAuth`). That decides what works for Azure and AWS below.

## Who holds the keys

| Source | Who sets it | Where the key is | Source |
|---|---|---|---|
| The node's OpenRouter key (`node-openrouter`) | operator | `AIMEAT_OPENROUTER_INSTANCE_KEY`. It goes only to OpenRouter's own hosts, never to an address a person or app named | `aimeat/src/services/ai/node-openrouter-key.ts`, `aimeat/src/services/ai-allowance.ts` |
| The node's other providers | operator | `AIMEAT_AI_PROVIDERS`: a JSON array of records whose `auth` names an environment variable (`AIMEAT_AI_KEY_<NAME>`, a vendor-style `*_API_KEY`), never the key itself. A record naming any other variable is refused | `aimeat/src/services/config-schema-ai.ts`, `aimeat/src/services/ai-provider-common.ts` |
| Built-in local servers | operator | `AIMEAT_AI_BUILTIN_PROVIDERS`: `lmstudio` (1234), `ollama` (11434), `llamacpp` (8080) on loopback, no key | `aimeat/src/services/ai/providers.ts` |
| A person's own providers | the person in person (their session or an owner-level personal access token), or an agent they gave `account:security`; there is no MCP tool for it (`aimeat/src/routes/ai-providers.ts`) | a memory record `ai.providers.<id>`; the key in a separate encrypted record `ai.apikey.provider.<id>` (AES-256-GCM, `AIMEAT_ENCRYPTION_KEY`) | `aimeat/src/services/ai/provider-store.ts` |
| An agent's own key | the person, for one agent | `ai.apikey.agent.<agent>.<id>`, encrypted | `aimeat/src/services/ai/provider-store.ts` |

Which key pays for a call: the person's (or agent's) own key first, then the node's key while the person has allowance left, then the free fallback model when one is set (the default is `openrouter/free`), then nothing (`aimeat/src/services/ai-allowance.ts`, `aimeat/.env.example`). A person with their own key is not metered against the node's allowance.

## Egress controls

| Setting | Default | What it does | Source |
|---|---|---|---|
| `AIMEAT_AI_PROVIDER_TYPES` | empty: all five fixed types allowed | which fixed vendor types the node allows (`openrouter,openai,anthropic,mistral,xai`). Set it to keep data to named vendors | `aimeat/src/services/config-schema-ai.ts` |
| `AIMEAT_AI_PROVIDER_ALLOWLIST` | empty: any public host | the hosts a non-fixed provider address may point at before a key is sent. It applies to every `openai-compatible` and `local` address, loopback included, so list `127.0.0.1` or the internal host too when it is set. The start-up posture check warns on a public node while it is empty | `aimeat/src/services/ai/route-plan.ts`, `aimeat/src/services/ai/call-guards.ts`, `aimeat/src/config-posture.ts` |
| `AIMEAT_AI_PROVIDER_EGRESS` | empty | exact origins (scheme, host, port) of the operator's own model servers on a private network. Only the node's own providers reach them; a person's provider never does | `aimeat/src/services/ai/providers.ts` |
| `AIMEAT_ALLOW_PRIVATE_EGRESS` | `false` on a public profile | whether server-side fetches may reach loopback at all. RFC 1918, link-local and cloud metadata addresses are refused regardless, except an origin listed in an egress list | `aimeat/.env.example` |
| `AIMEAT_AI_FIXED_BASEURL_OVERRIDES` | empty | tests only; refused on a public node | `aimeat/.env.example` |

## Roles, routing and policy

| Concept | What it is | Who sets it | Tool |
|---|---|---|---|
| Capability | what a model does: text, vision, files, image, speech, transcription, embed | fixed vocabulary | `aimeat_ai_capabilities` |
| Role | what a model is used for, with an ordered list of providers and models per capability; an app declares the roles it needs and the person binds them to one of theirs. Built-in roles `reasoning` and `execution` | the person | `aimeat_ai_roles`, `aimeat_ai_role_set` |
| Routing rules | order of providers, fallback, OpenRouter region choice | the person | `aimeat_ai_routing_set`, `aimeat_ai_providers` |
| Model policy | which models a call may use: `open`, `recommended` (the node's list, `AIMEAT_AI_RECOMMENDED_MODELS`) or `custom`, applied to the person's own calls, the node's chat, their agents and apps. Every layer can only tighten | the person; the operator supplies the recommended list | `aimeat_ai_policy_set` |
| Node default models | the model per role when the person set none: `AIMEAT_MODEL_DEFAULT_CHAT`, `_REASONING`, `_EXECUTION`, `_VISION`, `_STT`, `_IMAGE`, `_TTS`, `_EMBED` | operator | `aimeat_admin_config_set` |
| Daily budget and model settings | the person's daily spend limit in USD, per-app caps, legacy model choices, by propose-then-confirm | the person | `aimeat_operator_ai_config` |

Sources: `aimeat/src/services/ai/roles.ts`, `aimeat/src/services/ai/policy.ts`, `aimeat/src/services/ai/routing.ts`, `aimeat/src/services/ai-model-defaults.ts`. The node picks providers per call from these records (`aimeat/src/services/ai/route-plan.ts`).

### Which model roles a node needs

| Role | Used by | When it is missing | Source |
|---|---|---|---|
| Text (chat, reasoning, execution) | the chat, apps (`AIMEAT.ai.complete`), agents through `/v1/llm`, classification judgement, refinery extraction | on the node's key, a call that named no model and cannot be paid for gets the free fallback model (`AIMEAT_MODEL_FREE_FALLBACK`, default `openrouter/free`), and the answer says so; set it empty, or `AIMEAT_AI_FREE_MODEL_LAST_RESORT=false`, to refuse instead | `aimeat/src/services/ai/unset-model.ts`, `aimeat/.env.example` |
| Vision | reading images in a call | the node default `AIMEAT_MODEL_DEFAULT_VISION` applies when the person set none; what a call does with neither was not traced for this page | `aimeat/src/services/ai-model-defaults.ts` |
| Transcription (STT) | the microphone, `aimeat_ai_transcribe` | refused with `NO_STT_MODEL`; a new person cannot use the microphone until a model is set | `aimeat/src/services/ai/unset-model.ts` |
| Image | `aimeat_image_generate` | refused with `NO_IMAGE_MODEL` | `aimeat/src/services/ai/unset-model.ts` |
| Speech (TTS) | voice answers | refused with `NO_TTS_MODEL` | `aimeat/src/services/ai/unset-model.ts` |
| Embedding | `aimeat_ai_embed`, for apps and agents that store vectors | refused with `NO_EMBED_MODEL`. The node's own memory search does not use embeddings, so search keeps working. Changing the embedding model makes stored vectors incomparable | `aimeat/src/services/ai-embed.ts`, `aimeat/src/services/config-schema-ai.ts` |
| Decision model (System 1) | typed decisions (`aimeat_decide`), mail classification in the refinery | refused when no decision provider is usable: no hosted key (node or person) and no local decision provider | `aimeat/src/services/decide/service.ts` |

## Decision provider (System 1) and ordinary model calls (System 2)

| | System 1: decision provider | System 2: ordinary model calls |
|---|---|---|
| What it answers | typed answers with probabilities, no free text | text, images, transcription, speech, embeddings |
| Provider records | `aimeat/src/services/decide/providers.ts` | `aimeat/src/services/ai/providers.ts` |
| Default address | `AIMEAT_DECIDE_BASE_URL`, a hosted service in the United States by default; on by default (`AIMEAT_DECIDE_ENABLED`), but sends nothing until a key is set (`AIMEAT_TYPESAFE_INSTANCE_KEY` or a person's own) | none |
| Personal data | known identifier patterns (e-mail, phone, identity codes, IBAN, street address, name-type fields, the owner's contacts' names) are replaced before sending; other personal data in the content is sent, and the default provider may keep its input | sent as the caller put it in the call; no scrubbing on this path |
| Local option | `AIMEAT_DECIDE_BUILTIN_PROVIDERS` and `AIMEAT_DECIDE_PROVIDER_EGRESS` | `local` providers |
| Retention | `AIMEAT_DECIDE_RETENTION_DAYS` (365) | usage records ([05 Data protection](05-data-protection.md)) |

Sources: `aimeat/src/services/decide/scrub.ts`, `aimeat/src/config-decide.ts`.

## What data reaches a model, and when

The node sends what the caller put in the call. The caller is a person's AI chat, an app running in the person's browser, an agent, or a node job; what they put in can include memory records, workspace content, mail and files they read with the person's permissions.

| Call | What is sent | Who starts it | Without a button press | Source |
|---|---|---|---|---|
| Chat turn | the conversation and what the chat agent's tools read | the person | no | `aimeat/.env.example` (chat agent section) |
| App call | the app's prompt and the files it names from the caller's own storage (`data:` URLs or storage keys; `https` URLs are refused) | the person using the app | no | `aimeat/src/services/ai/call-files.ts` |
| Agent call through `/v1/llm` | the agent's prompt | the agent | yes, when the agent runs on its own | `aimeat/src/services/ai/completion.ts` |
| Scheduled job (agent task, workflow, extension, refinery batch) | the job's prompt and what it reads | a schedule the person, an agent or an app set up | yes | `aimeat/src/services/scheduler.ts`, `aimeat/src/services/refinery/scheduled-job.ts` |
| Refinery (mail sorting) | mail text and attachment text of the connected mailbox; decisions go to System 1 | a person, a schedule or an agent | yes, when scheduled | `aimeat/src/services/refinery/pipeline.ts` |
| Classification judgement | content the policy names, with personal data removed first, to the node's decision model or the person's own text model | a write, or the hourly queue `core:classification-queue` | yes | [Data classification](../data-classification.md) |
| AI job (`aimeat_ai_job_start`) | the job's prompt, on the person's own key | a person or agent | runs in the background | `aimeat/.env.example` (AI jobs section) |

Each provider carries a sentence that says where its data goes ("The prompt goes to api.openai.com, outside this machine"), shown on the settings page and in data maps (`aimeat/src/services/ai/providers.ts`). An OpenRouter answer names the region that processed it (`route.answeredBy.region`, [OpenRouter region](../operations/openrouter-region.md)).

## Data kept to a local model

When classification is on, content at a level with `externalAi: refused` (every TL and NATO class, and health, biometric, defence and export-controlled data domains) goes only into a call whose model reference is `local:<model id>`. Any other model is refused with `CLASSIFIED` (`aimeat/src/services/classification/external-ai.ts`). A role can also require a local provider (`requires-local` in `aimeat/src/services/ai/route-plan.ts`). Detail: [Data classification](../data-classification.md), [05 Data protection](05-data-protection.md).

`local` is checked: a provider record of type `local` is accepted only at a loopback address (`localhost`, `::1`, a literal `127.x.x.x`), or, for the operator's own record, at an origin in `AIMEAT_AI_PROVIDER_EGRESS`. A host name that only starts with "127." is not loopback. A person's provider at another host is `openai-compatible` and counts as outside (`aimeat/src/services/ai/types.ts` `adapterTypeOf`, `aimeat/src/services/ai/providers.ts` `parseAiProvider`).

## Budgets and usage metering

| Control | Setting or tool | Default | Source |
|---|---|---|---|
| Free starting allowance per person on the node's key | `AIMEAT_CHAT_FREE_ALLOWANCE_USD` | 0 | `aimeat/src/services/ai-allowance.ts` |
| What the node's key does when the allowance is spent | `AIMEAT_AI_NODE_KEY_WHEN_SPENT` (`refuse` or `limits`) | `refuse` | `aimeat/.env.example` |
| Daily limits on the node's key, per account and for the node | `AIMEAT_AI_NODE_KEY_ACCOUNT_DAILY_USD`, `AIMEAT_AI_NODE_KEY_NODE_DAILY_USD` | 1, 10 | `aimeat/.env.example` |
| Longest answer on the node's key; price held before the call | `AIMEAT_AI_NODE_KEY_MAX_OUTPUT_TOKENS` | 32000 | `aimeat/.env.example` |
| Person's daily budget and per-app caps | `/v1/ai/settings`, `aimeat_operator_ai_config` | the person's | `aimeat/src/services/ai/completion.ts` |
| Price corrections | `AIMEAT_AI_PRICE_OVERRIDES` | none | `aimeat/.env.example` |
| Person's usage report | `aimeat_usage_report` | | `aimeat/src/tool-catalog/definitions/agent-messaging.ts` |
| Operator's cost report, split by whose key paid | `aimeat_admin_usage` | | `aimeat/src/tool-catalog/definitions/discovery-work-boards.ts` |

Direct providers report no cost in their answer; the node prices them from the model catalogue. A call whose price is unknown is recorded as zero and flagged as inexact (`aimeat/src/services/ai/types.ts`, `CostSource`).

## Transparency and the EU AI Act

| Item | What the node does | Setting | Source |
|---|---|---|---|
| Provenance records (Article 50) | every piece of content generated through the node gets a record: model, provider, principal, time, SHA-256 of the bytes, human involvement; served on JSON, headers, HTML and MCP; public detection by hash | `AIMEAT_AI_PROVENANCE` (on; a public node records whatever it says), `AIMEAT_AI_PROVENANCE_DETAIL`, `AIMEAT_AI_LABEL_PUBLIC` (`strict`) | [AI transparency](../ai-transparency.md) |
| Public transparency statement | `GET /v1/ai-transparency` | | `aimeat/src/routes/ai-transparency.ts` |
| Market surveillance authority | named in the statement; empty reports it as unstated | `AIMEAT_AI_SUPERVISORY_NAME`, `AIMEAT_AI_SUPERVISORY_URL` | `aimeat/.env.example` |
| Code of Practice signature | which sections the organisation signed; empty reports not a signatory | `AIMEAT_AI_COP_SECTIONS`, `AIMEAT_AI_COP_SIGNED_ON` | `aimeat/.env.example` |
| Register of AI uses | use cases with their systems, models, purpose and data subjects, each with a risk class from a questionnaire: prohibited, high, limited (transparency duty), minimal; unanswered reads `unclassified`, never minimal. The question set is a record the operator edits | `aimeat_compliance_register_read`, `aimeat_compliance_register_write`, the admin Compliance page | `aimeat/src/services/compliance-register.ts`, `aimeat/src/data/compliance-questionnaire.ts` |
| Compliance report | joins the register to what the node logged about AI use and names the gaps, such as a model in use that no use case names, or an app whose own statements say it uses AI; a monthly job stores it | `aimeat_compliance_report`, `aimeat_compliance_snapshot` | `aimeat/src/services/compliance-report.ts`, `aimeat/src/services/compliance-monthly-job.ts` |

The questionnaire is an engineering aid and serves a not-legal-advice note with every result. Mapping to the articles: [14 Compliance mapping](14-compliance-mapping.md).

## What IT prepares for each model source

The project has not tested AIMEAT against any of the services in this section: no test or document in the repository shows a run against Azure, AWS Bedrock, vLLM, TGI, Ollama or LM Studio. The tables say what the code accepts and what the vendor documents.

How an operator adds a provider in all cases below: a record in `AIMEAT_AI_PROVIDERS` with `type`, `baseUrl`, `auth: { "type": "env", "env": "AIMEAT_AI_KEY_<NAME>" }` and `capabilities` with a model per capability, the key in that variable, and the host in `AIMEAT_AI_PROVIDER_ALLOWLIST` when the allowlist is set. Test it with `aimeat_ai_provider_test`. A person may add the same kind of provider for themselves on their AI settings page, with an `https` address only.

### 1. Azure OpenAI or Azure AI Foundry

No native adapter. It connects as `openai-compatible` against Azure's v1 endpoint, `https://<resource>.openai.azure.com/openai/v1/` (or `https://<resource>.services.ai.azure.com/openai/v1/`), which needs no `api-version` parameter ([Microsoft: Azure OpenAI v1 API](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle)).

**Authentication.** AIMEAT sends `Authorization: Bearer <key>`. Microsoft documents the v1 endpoint with the standard OpenAI client and an Azure API key, and that client sends the key in the same header; Microsoft's REST examples use the `api-key` header for a key and `Authorization: Bearer` for a Microsoft Entra ID token. AIMEAT cannot send `api-key`, and it cannot use Entra ID: it stores a static key and has no token refresh, while an Entra ID token expires. So the only path is an Azure API key that the resource accepts as a bearer value. Whether a given resource accepts it is to be verified by IT with one test call; the project has not tested it.

| What IT provides | Where it goes in AIMEAT | What to check |
|---|---|---|
| The resource endpoint with `/openai/v1` | `baseUrl` of a record in `AIMEAT_AI_PROVIDERS`, type `openai-compatible` | `curl -H "Authorization: Bearer $KEY" <endpoint>/chat/completions` with a deployment name answers 200 |
| An API key of the resource (key-based authentication left enabled on it) | `AIMEAT_AI_KEY_<NAME>`, named in the record's `auth` | key rotation plan: change the variable and restart |
| Deployment names per capability (chat, embeddings, transcription) | the `model` of each capability in the record; AIMEAT sends it as `model`, and Azure reads the deployment name there | AIMEAT uses chat completions, not the Responses API Microsoft recommends; check the deployment serves chat completions |
| The host name | `AIMEAT_AI_PROVIDER_ALLOWLIST` | the posture check no longer warns |
| Region and data zone of the deployment (Standard, Data Zone or Global deployment type) | the processor entry in the records of processing (`aimeat_compliance_register_write`) | the deployment type matches the transfer basis you record |
| Tokens-per-minute quota per deployment | nothing in AIMEAT; the node has no rate limit per provider | quota covers peak concurrency; a 429 from Azure reaches the person as a provider refusal |

### 2. AWS Bedrock

No native adapter. AWS documents an OpenAI Chat Completions endpoint on `bedrock-runtime`, `https://bedrock-runtime.<region>.amazonaws.com/openai/v1`, and a compatibility endpoint `bedrock-mantle`, `https://bedrock-mantle.<region>.api.aws/v1`, both taking a Bedrock API key as `Authorization: Bearer` or SigV4 ([AWS: Chat Completions API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html)). The Chat Completions shape is what `openai-compatible` sends, so this is the only path.

| Works with `openai-compatible` | Does not work |
|---|---|
| A **long-term** Bedrock API key as a bearer value | SigV4 signing: AIMEAT signs nothing |
| Chat completions for the models whose model card lists Chat Completions on that endpoint | **short-term** Bedrock API keys, which last at most 12 hours: AIMEAT holds a static key and does not refresh it ([AWS: API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)) |
| | the model list on `bedrock-runtime` (`GET /models` is not implemented there), so pick model ids from the AWS model cards |
| | images and transcription: not documented on these endpoints |

AWS recommends short-term keys for production and calls long-term keys "for exploration only" ([AWS: API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)). An organisation whose policy follows that cannot connect AIMEAT to Bedrock directly today. The open-source Bedrock Access Gateway that put an OpenAI-compatible proxy in front of Bedrock is deprecated and archived by AWS ([aws-samples/bedrock-access-gateway](https://github.com/aws-samples/bedrock-access-gateway)); a proxy of the organisation's own that holds IAM credentials and accepts a static bearer key from AIMEAT is the other option, and is not provided by the project.

| What IT provides | Where it goes in AIMEAT | What to check |
|---|---|---|
| The endpoint for the region | `baseUrl`, type `openai-compatible` | one chat completion with a model id from the model card answers 200 |
| A long-term API key, scoped to an IAM user with the least Bedrock permissions, with an expiry the policy allows | `AIMEAT_AI_KEY_<NAME>` | the policy exception for a long-term key is approved; rotation date recorded |
| Model ids per capability | `capabilities.<cap>.model` | the model is enabled in the account and region |
| The host name | `AIMEAT_AI_PROVIDER_ALLOWLIST` | |
| Region and cross-region inference profile choice | records of processing | the region matches the transfer basis |

### 3. OpenRouter

Native type `openrouter`, either as the node's own key (`AIMEAT_OPENROUTER_INSTANCE_KEY`, everyone metered by the allowance) or as each person's own key. Region pinning: `AIMEAT_AI_OPENROUTER_REGION` `eu` (eu.openrouter.ai) or `us` (us.openrouter.ai) needs OpenRouter's Business plan on the key; `any` is the default. OpenRouter keeps account, billing and security records in the United States whatever is chosen. Detail and the recommended setting for an EU organisation: [OpenRouter region](../operations/openrouter-region.md). `AIMEAT_AI_REGION_MODE` (`eu`, `eu-only`, `own`) sets the four region settings at once.

| What IT provides | Where it goes in AIMEAT | What to check |
|---|---|---|
| An OpenRouter account and key, on the Business plan for `eu` or `us` | `AIMEAT_OPENROUTER_INSTANCE_KEY` | the key's credit limit at OpenRouter |
| The region decision and the fallback | `AIMEAT_AI_OPENROUTER_REGION`, `AIMEAT_AI_OPENROUTER_REGION_FALLBACK`, `AIMEAT_AI_OPENROUTER_REGIONS`, `AIMEAT_AI_OPENROUTER_REGION_PERSON_CHOICE` | the default models exist in the region (the EU host offers fewer models and none for images or embeddings) |
| The allowance policy | `AIMEAT_CHAT_FREE_ALLOWANCE_USD`, `AIMEAT_AI_NODE_KEY_WHEN_SPENT` and the daily limits | `aimeat_admin_usage` after a week |
| OpenRouter's data processing agreement and the transfer basis | the processors entries the node creates per region | |
| A zero data retention requirement, if the organisation has one | nothing: the repository does not mention OpenRouter's data retention options | see Open questions |

### 4. Own GPU servers (vLLM, TGI, Ollama, LM Studio, llama.cpp)

These servers expose an OpenAI-compatible API. Two cases:

| Case | Type | How | Counts as local for classification |
|---|---|---|---|
| Model server on the node's own machine | `local` | `AIMEAT_AI_BUILTIN_PROVIDERS` (`lmstudio`, `ollama`, `llamacpp`) or an `AIMEAT_AI_PROVIDERS` record at `http://127.0.0.1:<port>/v1` | yes; the data never leaves the machine |
| Model server on another internal host (an H100 box with vLLM, say) | `local`, operator record only | an `AIMEAT_AI_PROVIDERS` record of type `local` with the server's exact origin also in `AIMEAT_AI_PROVIDER_EGRESS`; `http` is accepted for a listed origin | yes, because the operator listed it; the data leaves the node's machine for that host, so the network path is the organisation's to protect |
| The same host added by a person | `openai-compatible` | refused: a person's provider must be a public `https` address and never reaches a private one | no |

Sources: `aimeat/src/services/ai/types.ts`, `aimeat/src/services/ai/providers.ts`. On a public node a person's provider can never be on the node's own machine.

| What IT provides | Where it goes in AIMEAT | What to check |
|---|---|---|
| The server's exact origin (scheme, host, port) and its `/v1` root | `baseUrl`; the origin in `AIMEAT_AI_PROVIDER_EGRESS`; the host in `AIMEAT_AI_PROVIDER_ALLOWLIST` if set | the record is accepted at start (a refused record is logged by `[ai] an operator AI provider was refused`) |
| The served model names | `capabilities.<cap>.model`; model references then read `local:<model>` | the classification check needs the `local:` reference |
| A key if the server is started with one | `AIMEAT_AI_KEY_<NAME>`; `auth: none` otherwise | network access to the server is limited to the node |
| Capacity answers: concurrent requests the GPU serves, context length per model, the embedding model and its dimension, a transcription model if speech is wanted | the model per capability; nothing else in AIMEAT limits concurrency per provider | peak users times calls per turn fits the server's concurrency; the context length covers the longest documents people send |
| TLS on the internal hop, if policy requires it | an `https` origin | |

### 5. OpenAI, Anthropic, Mistral, xAI directly

Native fixed types, reached only at the vendor's official address ([provider types](#provider-types)). Narrow the allowed vendors with `AIMEAT_AI_PROVIDER_TYPES`.

| What IT provides | Where it goes in AIMEAT | What to check |
|---|---|---|
| An organisation account and API key per vendor | `AIMEAT_AI_PROVIDERS` record of the vendor's type with `auth` naming the variable (for example `ANTHROPIC_API_KEY`), or each person's own key on their settings page | the vendor's own spend limit on the key |
| The vendor's data processing terms and region options | records of processing | |
| Model ids per capability | `capabilities.<cap>.model` | Anthropic serves text only; Mistral has no image; xAI has no embeddings |
| The list of allowed vendors | `AIMEAT_AI_PROVIDER_TYPES` | a vendor left out refuses its records with a sentence the person sees |

## Limits

- No provider record can send an `api-key` header, a custom header, a refreshing token or a SigV4 signature; every OpenAI-compatible call carries `Authorization: Bearer <key>` or nothing.
- Azure OpenAI with Microsoft Entra ID authentication is not supported; only an Azure API key accepted as a bearer value can work, and the project has not tested it.
- AWS Bedrock works only with a long-term Bedrock API key on the Chat Completions endpoint; short-term keys and SigV4 are not supported, and AWS recommends against long-term keys in production.
- AIMEAT calls Chat Completions, not the Responses API.
- The project has not tested any model source in this page against the real service: Azure, Bedrock, vLLM, TGI, Ollama, LM Studio and llama.cpp are untested by the project.
- An operator-listed internal host counts as `local` for classification although the data crosses the network to it.
- An agent's claim that its model is local is recorded and cannot be checked.
- Ordinary model calls (System 2) send the caller's prompt as given. The decision provider and the classification judgement replace known identifier patterns first, and other personal data in the content still goes to the provider.
- AI calls happen without a button press: schedules, agents, the refinery, the classification queue and AI jobs.
- The decision provider is on by default and points at a hosted service in the United States; it sends nothing until a key is set.
- No per-provider rate limit or concurrency limit exists in AIMEAT; a provider's own quota answers with a refusal.
- A missing transcription, image, speech or embedding model refuses the feature; only text has a fallback, and only on the node's key.
- The repository does not mention OpenRouter's zero data retention options or send any data retention parameter.
- Costs of direct providers are the catalogue's estimate, and a call with an unknown price is recorded as zero.
- `aimeat_admin_usage`'s description says chat turns are never metered, while `aimeat/.env.example` says the chat is metered unless `AIMEAT_GOOSE_PROVIDER_API_KEY` is set (see Open questions).

## Open questions

- OPEN: Does an Azure OpenAI v1 endpoint accept an Azure API key sent as `Authorization: Bearer` from a plain HTTP client, and does it serve AIMEAT's chat completions, embeddings and transcription calls? IT of the adopting organisation can answer with one test call; the maintainer named in `.github/SECURITY.md` can say whether an `api-key` header option is planned.
- OPEN: Is support for refreshing credentials (Entra ID tokens, short-term Bedrock keys) or SigV4 planned? The maintainer can answer.
- OPEN: Does the node send any OpenRouter request field for data collection or zero data retention, and can an operator require it? The maintainer can answer.
- OPEN: Which statement is current: `aimeat_admin_usage`'s description that no chat turn is metered (`aimeat/src/tool-catalog/definitions/discovery-work-boards.ts`), or `aimeat/.env.example`, which says chat is metered unless the shared chat key is set? The maintainer decides.
- OPEN: What does a call that needs vision do when neither the person nor the operator set a vision model: refuse, or use the text model? The maintainer can answer.
- OPEN: Has the project measured a `local` provider on another host with vLLM or TGI under concurrent load (streaming, tool calls, embeddings)? The maintainer can answer.
