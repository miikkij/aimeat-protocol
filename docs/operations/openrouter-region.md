# Where your node's AI calls are processed: the OpenRouter region

For the operator of an AIMEAT node with an OpenRouter key of its own (`AIMEAT_OPENROUTER_INSTANCE_KEY`,
on the Config tab `ai.instance_key`). It says how to keep the people on your node in Europe, in the
United States, or let their calls go to any country, how to let each person choose, and what to
write into your privacy records. A node without its own OpenRouter key has nothing to set here.

## What you choose

OpenRouter has three addresses. Your node sends a call on its own key to one of them.

| Region | Address | Where the model runs | Models (2026-10-31) |
|---|---|---|---|
| `eu` | eu.openrouter.ai | servers in the EU or the EEA, the United Kingdom and Switzerland | 69 |
| `us` | us.openrouter.ai | servers in the United States | 125 |
| `any` | openrouter.ai | the model's provider, in any country | 452 |

Whatever you choose, OpenRouter, Inc. (United States) keeps account, billing and security records
in the United States. The EU and US addresses refuse rather than send a call elsewhere.

**The EU and US addresses need OpenRouter's Business plan on the key.** Business has no monthly
fee; a credit purchase costs 8 % on top instead of 5.5 % (OpenRouter's pricing page, 2026-10-31).
Upgrade the account in OpenRouter's settings before you choose `eu` or `us`.

## The four settings

All four are on the admin Config tab (`/admin.html`, section AI) and take effect without a
restart, except the shared chat key below. The same names work in `.env`.

| Setting | Environment variable | Values | Default |
|---|---|---|---|
| `ai.openrouter_region` | `AIMEAT_AI_OPENROUTER_REGION` | `eu`, `us`, `any` | `any` |
| `ai.openrouter_region_fallback` | `AIMEAT_AI_OPENROUTER_REGION_FALLBACK` | `off`, `us`, `any` | `us` |
| `ai.openrouter_regions` | `AIMEAT_AI_OPENROUTER_REGIONS` | any of `eu,us,any` | `eu,us,any` |
| `ai.openrouter_region_person_choice` | `AIMEAT_AI_OPENROUTER_REGION_PERSON_CHOICE` | `true`, `false` | `true` |

- **The region** is where your node's key sends calls.
- **The fallback** decides what happens to a model the region does not offer. `off` refuses the
  call (code `AI_MODEL_NOT_IN_REGION`) and names models the region does offer. `us` sends it to
  us.openrouter.ai. `any` tries us.openrouter.ai and then openrouter.ai.
- **The allowed regions** are the only ones used at all: as your choice, as a person's choice, or
  as a fallback. Leave `any` out to make sure no call on your key goes to any country.
- **Person choice** lets each person choose their own region and fallback on their AI page
  (Settings & Controls, AI, Routing) or from their chat, among the regions you allow. Off, everyone gets yours.

A person who brings their own OpenRouter key chooses for that key alone; with no choice it stays on
`any`, because their key may not be on the Business plan.

## Before you switch to the EU: check your models

The EU address offers fewer models, and none that makes pictures or embeddings. Read the list:

```
curl -s https://eu.openrouter.ai/api/v1/models | jq -r '.data[].id' | sort
```

Then compare it with your default models (`ai.model_default_chat`, `_vision`, `_image`, `_stt`,
`_embed`, `ai.model_free_fallback`, `ai.chat_agent_model`). For each one the EU does not offer:

- with fallback `us`, it runs in the United States when us.openrouter.ai offers it, and is refused
  when it does not;
- with fallback `any`, it runs wherever its provider is;
- with fallback `off`, it is refused; choose an EU model for that role instead.

Measured on 2026-10-31: `openai/whisper-large-v3-turbo` (speech to text) and `openrouter/free` (the
free model) are on neither the EU nor the US list, so on `eu` with fallback `us` they are refused.
`mistralai/voxtral-small-24b-2507` takes audio on the EU address.

## Every call says where it went

Every answer's `route.answeredBy.region` names the region that processed it, and `regionWanted` the
region it was meant for when it fell back. A person, their AI and an app can all read it. A person
reads their own setting with `GET /v1/ai/routing` (`openrouter_region`) or `aimeat_ai_providers`.

## Your privacy records follow the settings

- **The privacy page** (`/v1/privacy`, section 5.1) states the region, the fallback, whether people
  choose, and the transfer to the United States. You write nothing for it.
- **The records of processing** (`/admin.html`, the Compliance tab) list one processor per region your key can
  reach: `ai-node-openrouter-eu`, `ai-node-openrouter-us` and `ai-node-openrouter` (any). Record
  OpenRouter's data processing agreement (openrouter.ai/data-processing-agreement, binding on its
  terms of service) on each, and the transfer basis:
  - EU address: `adequacy` (the United Kingdom and Switzerland have an EU adequacy decision); the
    account records in the United States go under the SCC in the same agreement.
  - US address and any: `scc` (EU Standard Contractual Clauses, Module 2, in OpenRouter's agreement).

  Your AI can write these with `aimeat_compliance_register_write { part: "processors" }`.

## The shared chat key

When `ai.chat_agent_key` is set, the chat agent calls OpenRouter with it directly, and that process
takes the region when it starts. After you change the region, restart the node or wait for the
chat to start again. Without the shared key every chat call goes through the node and follows the
setting at once.

## Choosing for your node

- **A company or a public body in the EU:** `eu`, fallback `off` or `us`, allowed `eu,us`. Off keeps
  every call in Europe; `us` keeps the apps working on models the EU lacks, and each answer says so.
- **A person's own node:** `any` is what it always was. Choose `eu` when the person asks for it.
- **A node where people decide for themselves:** keep person choice on and say in your own terms
  which regions you allow.
