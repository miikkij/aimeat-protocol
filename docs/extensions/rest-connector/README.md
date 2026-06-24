# rest-connector (reference connector)

A minimal, generic third-party REST connector that demonstrates the **encrypted secret config**
pattern (Secretary P5 / §18, sub-feature S-C).

## What it shows

- A **per-instance secret API key** (bring-your-own-key per tenant) declared in the manifest as
  `type: secret` under `instances.config_per_instance`.
- Secret values are **encrypted at rest** with AES-256-GCM (the node master key,
  `AIMEAT_ENCRYPTION_KEY`) — exactly like the OpenRouter API key — and are **never returned in
  plaintext**: API responses show a mask sentinel (`••••••••`). The plaintext is decrypted only
  just before the sandboxed action code runs.
- The same `pull` action works as a **live action call** and as a **scheduled (cron) sync**; an
  instance-scoped schedule loads the instance's decrypted secret on each fire.
- Outbound fetches go through `ctx.fetch`, which enforces the **SSRF guard** (internal/link-local
  hosts are rejected, every redirect hop re-validated).

## Use

1. Install + activate this extension (operator).
2. Create an instance with your `apiKey` (+ optional `baseUrl`):
   `POST /v1/extensions/rest-connector/instances` → `{ "id": "acme", "config": { "apiKey": "…", "baseUrl": "https://api.example.com/v1/data" } }`
3. Run a sync: `POST /v1/ext/rest-connector/acme/pull` (optionally `{ "url": "https://…" }` to
   override the endpoint). The result is cached under `ext:rest-connector.acme` → `latest`.
4. Optional cron sync: `POST /v1/schedules` with
   `{ "kind": "extension", "cron": "0 * * * *", "extension_name": "rest-connector", "action_id": "pull", "instance_id": "acme" }`.

## Real connectors

Plug a real endpoint + auth into `actions/pull.js`. Paid third-party data (e.g. Vainu/Alma) must
stay **bring-your-own-key per instance** (never a node-global key), and the redistribution/ToS
contract must be settled before shipping a specific paid integration. This file ships the
mechanism, not a paid integration.
