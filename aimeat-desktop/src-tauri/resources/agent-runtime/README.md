# Desktop agent runtime resources

Files the AIMEAT Personal Node desktop app bundles and uses to run **local CrewAI agents**
(the `crewaimeat` fleet) on a local Ollama model — fully offline, no API keys.

## `llm_providers.default.json`

The default LLM routing the desktop copies into the crewaimeat working directory as
`llm_providers.json` on first run. It points every crew at a **local Ollama** provider:

- **`gemma3`** — primary model (the developer-chosen default; the newest Gemma available on
  Ollama. When `gemma4` ships on Ollama, the desktop's model picker can swap the id).
- **`qwen2.5:7b`** — local fallback (stronger at tool-calling, which the AIMEAT crews rely on).

No `api_key_env` is set on the provider, so it runs keyless and offline. The crewaimeat provider
system (`src/crewaimeat/llm.py`, `MultiProviderLLM`) reads `LLM_PROVIDERS_FILE` or
`./llm_providers.json` and falls through model-by-model, then provider-by-provider, on any error.

### Adding a cloud fallback (optional)

Append an OpenRouter or xAI provider **after** the local one and set its `api_key_env`; a
provider whose key is missing is skipped, not fatal. For per-crew routing (e.g. send coding crews
to a stronger model), switch to the `profiles` + `crews` format documented in
`llm_providers.example.json` in the crewaimeat repo.

## How the desktop uses these (workstream A)

On "Enable local agents" the desktop: provisions Python + installs `crewaimeat` (from GitHub),
ensures Ollama is installed and the default model pulled, copies `llm_providers.default.json` →
`<agent-workdir>/llm_providers.json`, mints the agent token via the connector, and supervises the
`run_crew_daemon` fleet — surfacing status to the GUI. See
`docs/plans/2026-06-17-desktop-agent-runtime-plan.md`.
