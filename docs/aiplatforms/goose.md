# Goose — AIMEAT Platform Report

**Vendor:** the Goose project, Apache 2.0, governed by the Linux Foundation's Agentic AI Foundation · **URL:** https://block.github.io/goose/
**Vendor facts checked:** 3 September 2026
**Shortest path:** `npx aimeat connect client goose --url https://your-node --owner your-handle`

## Can it reach a node?

| Road | Works | How |
|---|---|---|
| MCP | Yes | Extensions in `config.yaml`, which the connect command writes |
| Manual prompt | Yes | It is a terminal agent; paste anything |
| HTTP | Yes | It runs shell commands |

## What is worth knowing

Free and open source with no paid tier at all. Block contributed it as a founding project of the
Linux Foundation's Agentic AI Foundation in December 2025, and the repository and governance moved to
the foundation in April 2026.

It brings its own key: you pick the model and pay per token for exactly what you use, across more than
25 providers including Anthropic, OpenAI, Google, Mistral, xAI, Bedrock, Vertex, Azure OpenAI, Ollama
and **OpenRouter**. That last one is why this is the recommendation for anybody who wants a capable
chat that is not Claude, ChatGPT or Grok: a strong model for a hard build, a cheap one for everything
else, switched in seconds.

## Connecting it

```bash
npx aimeat connect client goose --url https://your-node --owner your-handle
# approve from your profile → Agents; a launcher script is left behind that supplies the token
```

Set `OPENROUTER_API_KEY` in your environment, then:

```bash
# a model for this session only
$env:GOOSE_MODEL = "z-ai/glm-5.2"; C:\Users\you\.aimeat-goose\launch-goose.ps1
GOOSE_MODEL=z-ai/glm-5.2 ~/.aimeat-goose/launch-goose.sh

# inside a running session
/model deepseek/deepseek-v4-flash   # switch model without restarting
/mode auto                          # stop confirming every tool call
```

## What to expect

The full toolset costs roughly 50k input tokens per turn, so a cheap model plus `--surface appdev`
(about a third of that) is the combination that keeps a long build affordable. Goose is also the
runtime the node's own built-in chat uses, so what you see in the terminal and what a person sees at
`/v1/chat` behave the same way.
