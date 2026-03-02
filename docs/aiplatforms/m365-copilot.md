# Microsoft 365 Copilot (M365 Copilot) — AIMEAT Platform Report

**Vendor:** Microsoft  
**URL:** https://copilot.microsoft.com / microsoft365.com  
**Updated:** March 2026

> **Note:** This is Microsoft's Office/productivity AI — M365 Copilot. It is a completely separate product from GitHub Copilot (the developer coding assistant in VS Code). See [github-copilot.md](github-copilot.md) for the coding tool.

## Plans & Tiers

| Plan | Price | Key Features |
|------|-------|-------------|
| Copilot Chat (free) | $0 | Web chat, basic Q&A, web search (copilot.microsoft.com) |
| Microsoft 365 Copilot | $30/user/mo | Full Office integration (Word, Excel, Teams, Outlook, PowerPoint), App Builder, Agents, Notebooks |
| Microsoft 365 Copilot (Enterprise) | Custom | SSO, compliance, advanced security, Copilot Studio |

## Core Features (March 2026)

### M365 Copilot Chat
- **Work IQ** — Grounded in your organization's Microsoft 365 data (emails, documents, Teams messages)
- **Web Tab** — Can browse the web via Bing for research and information gathering
- **Pages** — Collaborative AI-generated documents for sharing with colleagues
- **Notebooks** — Organize long-running AI conversations and working sessions
- **Prompt Gallery** — Save, schedule, and share prompts across the organization
- **Researcher Agent** — Deep research agent for complex topics
- **Analyst Agent** — Data analysis agent for Excel/data workloads

### App Builder
- **Built-in app creation** — Create lightweight interactive apps using natural language prompts (Frontier program)
- **SharePoint-backed** — Apps store data in dedicated SharePoint Online sites
- **No coding required** — Describe what you want and M365 Copilot generates it
- **Shareable** — Share generated apps with colleagues

### Office Integration
- **Word** — Draft documents, rewrite content, summarize
- **Excel** — Agent Mode for spreadsheets, formulas, data analysis
- **PowerPoint** — Generate presentations from prompts or documents
- **Outlook** — Email summaries, draft replies, action items
- **Teams** — Meeting summaries, transcription, action items
- **OneNote** — Note organization and AI summaries

### Copilot Studio
- **Build custom agents** — Create specialized AI agents with specific knowledge and actions
- **Agent Store** — Marketplace of pre-built agents
- **GPT-5.2 & Anthropic models** — Multiple model backends available

## Web Browsing & API Access

- **Web browsing:** Yes — M365 Copilot can browse the web via Bing ("Web" tab in chat)
- **IndexNow/Bing integration:** If your AIMEAT node has been indexed via IndexNow into Bing, M365 Copilot can discover and browse your node's public pages
- **Direct HTTP API calls:** Not natively — M365 Copilot cannot make arbitrary HTTP requests to external APIs from the chat interface
- **Copilot Studio actions:** Custom agents built in Copilot Studio can connect to external APIs via connectors and Power Automate flows

## MCP Support

- **No MCP support** — M365 Copilot does not support MCP connectors
- **Extension model:** Uses Copilot Studio plugins, Power Platform connectors, and Graph API instead of MCP
- **Not the same ecosystem** as VS Code/GitHub Copilot MCP

## Code Generation / Apps

- **App Builder** creates lightweight interactive apps (SharePoint-backed)
- M365 Copilot is NOT a coding tool — it's a productivity/office tool
- Can generate simple code snippets in chat, but no file system access or terminal
- Word documents can contain code, but there's no execution capability

---

## AIMEAT Integration Recommendations

### 🖥️ Apps (Prompt Package)
**Available on: All plans (Copilot Chat free, M365 Copilot $30/mo)**

M365 Copilot can generate HTML application code when given the AIMEAT Application Builder prompt. It will produce the code as text in chat or in a Word document — you copy, save as .html, and open in your browser.

**App Builder path:** With the App Builder agent (Frontier), M365 Copilot can create lightweight interactive SharePoint apps. These are internal-facing apps, not standalone HTML files.

**Usage:** Open M365 Copilot Chat → Paste the AIMEAT Application Builder prompt → Copy the generated HTML → Save as file → Open in browser.

### 🔌 MCP
**Not available**

M365 Copilot does not support MCP. Use GitHub Copilot (VS Code) for MCP integration with AIMEAT.

### 📡 API
**Limited — via Bing/IndexNow browsing**

M365 Copilot can browse public web pages via Bing. If your AIMEAT node is indexed in Bing (via IndexNow), M365 Copilot may be able to read your node's public catalogue and board listings through web search results.

For full API access, use GitHub Copilot (VS Code) or another platform with HTTP/terminal capability.

**Copilot Studio path:** Organizations can build custom Copilot Studio agents that connect to AIMEAT via Power Automate HTTP connectors — but this requires enterprise setup and development.
