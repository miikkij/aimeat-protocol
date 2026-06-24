# B2B Sales Hub (FI/SE) — reference use-case template

The end-to-end reference for the **use-case template** machinery (Secretary P5 epic: specialist agents +
templates + connectors + secrets). It is **DATA**, not code — a packaged organism blueprint instantiated
by the generic template routes.

## What it contains ([template-meta.json](template-meta.json))

- **Organism skeleton** — a private `B2B Sales Hub` project with two content-free workspaces:
  - **Leads** — qualified B2B leads (company, country FI/SE, contact, status), locked schema.
  - **Meetings** — upcoming meetings + the prep brief drafted for each.
- **Specialist agents** (a reusable agent type *alongside* the personal/company Secretary — not named
  "secretary"):
  - **`sdr`** — researches + qualifies leads, drafts outreach for the user to review (never sends on its
    own — outbound stays owner-approved / Enterprise).
  - **`meeting-prep`** — assembles a concise pre-meeting brief from the workspaces + connectors.
  - Each gets its own brain (directives), its own operating-model policy (the same act/draft/ask/off
    bands + stop-spending as the Secretary), and a conservative, Community-safe scope profile.
- **Connector dependencies** — `vainu-connector` + `alma-connector` (Finnish/Nordic company data). The
  connectors themselves are **not shipped** (the Vainu/Alma redistribution/ToS contract must be settled
  first; secrets always stay **bring-your-own-key per tenant**). They surface as **unmet** on instantiate,
  each with a **build prompt** you can paste to Claude Code to build + install the connector over the
  appdev MCP — the missing-dependency self-heal flow.

## How to instantiate

1. Build a `B2B Sales Hub` organism with the two workspaces (the `organism` + `workspaces` blocks in
   `template-meta.json` describe the skeleton + schemas).
2. Export it as a template:
   `POST /v1/organism-templates/export` with the `specialists`, `extensions`, `scopePresets`, `title`,
   `description`, `tags` from `template-meta.json` (add `"publish": true` to list it in `/v1/discover`).
3. Instantiate the resulting ZIP:
   `POST /v1/organism-templates/instantiate` → a new sales organism + its empty workspaces materialize,
   the `sdr` + `meeting-prep` specialists are provisioned with their brains, and `vainu-connector` +
   `alma-connector` are reported in `unmet_extensions` with a `build_prompt` each.

The full chain is exercised by `aimeat/test/e2e-b2b-sales-hub-template.ts`.

## Reference connector

`docs/extensions/rest-connector/` is the connector shape the build prompts point at — a generic REST
connector with a per-instance `type: secret` API key (encrypted at rest, decrypted only inside the
sandbox). Plug a real Vainu/Alma endpoint into it once the contract is settled.
