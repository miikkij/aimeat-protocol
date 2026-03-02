# Gemini — AIMEAT Platform Report

**Vendor:** Google  
**URL:** https://gemini.google.com  
**Updated:** March 2026

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| Gemini (Free) | $0 | Gemini 2.0 Flash, search, code generation, limited usage |
| Gemini Advanced | $19.99/mo | Gemini 2.5 Pro, 3 Pro Preview, 1M context, Gems, extensions |
| Gemini API (Free Tier) | $0 | Rate-limited access to Flash and Pro models for development |
| Gemini API (Pay-as-you-go) | Usage-based | Full production access, no rate limits |

## Core Features (March 2026)

### Gemini Chat
- **Gemini 3 Pro** — Latest frontier model with advanced reasoning
- **Google Search Integration** — Deep integration with Google Search
- **Extensions** — Google Workspace, YouTube, Maps, Flights, Hotels
- **Gems** — Custom AI assistants with specific personalities/instructions
- **Code execution** — Python sandbox for computations and data analysis
- **Canvas** — Code and content editing workspace (similar to ChatGPT Canvas)
- **Image generation** — Built-in Imagen model
- **File upload** — Documents, images, audio, video analysis
- **URL browsing** — Can read and analyze web pages
- **1M context** (Advanced) — Massive context window for large documents

### Gemini API / AI Studio
- **Function calling** — Full tool use support across all models
- **Gemini 3 series** — Pro ($2-4/1M input), Flash ($0.50/1M input)
- **Context caching** — Optimize costs for repeated contexts
- **Batch processing** — Async batch completions
- **Multimodal** — Text, image, audio, video input

### Gemini CLI
- **Extensions** — Framework for CLI plugins and integrations
- **MCP support** — Connect to MCP servers via Gemini CLI extensions
- **Open source** — Terminal-based AI agent

## MCP Support

- **Gemini Chat:** No native MCP connector UI. Extensions provide limited integration.
- **Gemini API:** Full function calling — can be used as backend for MCP clients
- **Gemini CLI:** MCP support via extensions framework, open-source extensible
- **Google ADK:** McpToolset class for programmatic MCP integration
- **Third-party:** Gemini models work in VS Code, Cursor, and other MCP-compatible hosts

## Code Generation / Apps

- Strong code generation capabilities across all plans
- Canvas workspace for interactive code editing (Advanced)
- URL browsing allows reading documentation and API specs
- Can generate complete single-file HTML applications
- Free plan has solid code generation (Gemini Flash is very capable)

## API

- Gemini Developer API via AI Studio
- Generous free tier for development and testing
- Function calling with structured output (Gemini 3 series)
- Google Cloud Vertex AI for enterprise deployment
- Compatible with many MCP client frameworks

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All plans (Free and Advanced)**

Gemini can generate complete HTML applications with AIMEAT integration. The free plan (Gemini Flash) is surprisingly capable for code generation.

**Prompt:** Copy the AIMEAT Application Builder prompt into Gemini. It will interview you and generate a complete .html file. With Gemini Advanced's Canvas, you can edit the generated code interactively.

### 🔌 MCP
**Not available in Gemini Chat web interface**

Gemini Chat does not have a native MCP connector UI. Use Gemini models via:
- **Gemini CLI** — Install Gemini CLI, add MCP extension for AIMEAT
- **VS Code** — Select Gemini as model in Copilot, use MCP servers
- **Google ADK** — Use McpToolset for programmatic AIMEAT MCP integration
- **Cursor** — Add Gemini API as model provider with MCP enabled

### 📡 API
**Available on: All plans (Gemini can browse URLs)**

Gemini (Advanced) can browse URLs directly. Paste the AIMEAT public endpoints:
- Catalogue: `{NODE_URL}/v1/catalogue`
- Node info: `{NODE_URL}/`
- Discovery: `{NODE_URL}/.well-known/aimeat`

Gemini can read and analyze the data. For full API access, copy the API integration prompt — Gemini will generate the code to run locally.

**Developer path:** Use Gemini API's function calling to build AIMEAT applications. The generous free tier makes it ideal for development and testing.
