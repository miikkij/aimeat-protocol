# REQ-004: Help Prompts & Init Prompts System

**Status:** Draft  
**Priority:** High — Small effort, large impact for new users  
**Type:** Documentation + Feature  
**Created:** 2026-03-04  

---

## 1. Summary

Create a structured library of copy-paste ready prompts that users can give to their AI assistants (ChatGPT, Claude, Grok, VS Code Copilot, Claude Code, OpenClaw) to get guided help with AIMEAT setup, configuration, troubleshooting, and node customization. These prompts bridge the gap between technical documentation and user experience — instead of reading docs, users paste a prompt and their AI walks them through it.

## 2. Background

- AIMEAT's setup requires technical knowledge (Node.js, terminal, environment variables)
- Many potential users are non-developers or "vibe coders" who rely on AI assistants
- A well-crafted prompt can turn any AI chat into a step-by-step installation wizard
- The anonymous prompt system (`GET /v1/prompts/anonymous`) proves this pattern works
- No `docs/init-prompts/` directory exists yet
- Genesis network operators need a "customize your node in minutes" experience

## 3. Requirements

### 3.1 Prompt Library Structure

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-01 | Create `docs/init-prompts/` directory as the canonical prompt library location | Must |
| R-004-02 | Each prompt file must be a self-contained markdown document with: context section, the actual prompt (in a code block), expected outcome, and troubleshooting tips | Must |
| R-004-03 | Prompts must be AI-platform-agnostic (work with ChatGPT, Claude, Grok, Gemini, OpenClaw) | Must |
| R-004-04 | Each prompt must include the AIMEAT node URL placeholder and explain how to replace it | Must |

### 3.2 Required Prompts — Setup & Installation

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-05 | `openclaw-setup.md` — Guide user through installing OpenClaw and connecting it to their AIMEAT node via MCP | Must |
| R-004-06 | `lm-studio-setup.md` — Guide user through LM Studio + AIMEAT MCP plugin configuration | Must |
| R-004-07 | `personal-node-setup.md` — Guide user through `aimeat init`, choosing storage, configuring env vars, first start | Must |
| R-004-08 | `docker-setup.md` — Guide user through Docker-based deployment with docker-compose | Should |

### 3.3 Required Prompts — Genesis Operator

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-09 | `genesis-operator-setup.md` — Guide new genesis operator through network creation, peering, and initial configuration | Must |
| R-004-10 | `node-customization.md` — Prompt for Claude Code / VS Code Copilot that customizes portal content, branding, welcome messages, and boards for the operator's use case | Must |
| R-004-11 | Customization prompt must demonstrate AIMEAT's power by using the system to configure itself (eating your own dogfood) | Must |

### 3.4 Required Prompts — Usage & Troubleshooting

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-12 | `troubleshooting.md` — Generic troubleshooting prompt that instructs AI to ask for browser console errors, server logs, and systematically diagnose issues | Must |
| R-004-13 | `agent-development.md` — Prompt for developers creating new AI agents that connect to AIMEAT | Should |
| R-004-14 | `memory-best-practices.md` — Prompt teaching AI how to structure memory keys, use namespacing, handle TTL, and leverage schema locking | Should |

### 3.5 Prompt Serving via API

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-15 | Add `GET /v1/prompts/help` — Returns list of available help prompts with titles and descriptions | Should |
| R-004-16 | Add `GET /v1/prompts/help/:name` — Returns specific prompt content ready for copy-paste | Should |
| R-004-17 | Prompts served via API must have `{{NODE_URL}}` placeholders auto-replaced with the actual node URL | Should |
| R-004-18 | Portal UI should display available prompts with one-click copy buttons | Should |

### 3.6 Prompt Quality Standards

| ID | Requirement | Priority |
|----|------------|----------|
| R-004-19 | Every prompt must start with context: what AIMEAT is, what this prompt helps with, and what the user's environment should look like | Must |
| R-004-20 | Every prompt must instruct the AI to ask clarifying questions about the user's OS, existing setup, and goals before proceeding | Must |
| R-004-21 | Every prompt must end with: "If something doesn't work, tell me the exact error message and we'll figure it out together" | Must |
| R-004-22 | Prompts must never include secrets, API keys, or credentials — only placeholders | Must |
| R-004-23 | Prompts must include links to official AIMEAT documentation and community resources | Should |

## 4. Example Prompt Structure

```markdown
# OpenClaw + AIMEAT Setup

## Context for AI
You are helping a user set up OpenClaw (open-source AI agent) connected to their
AIMEAT node. AIMEAT is an AI memory and action protocol. The user's AIMEAT node
is running at: {{NODE_URL}}

## What you need to do
1. Check if the user has Node.js 24+ installed
2. Guide them through OpenClaw installation
3. Configure OpenClaw's MCP server to point to {{NODE_URL}}/v1/mcp
4. Test the connection with a simple memory write/read
5. Show them how to create their first automation

## Important
- Ask the user's operating system before giving terminal commands
- If something fails, ask for the exact error message
- The AIMEAT MCP server supports 18 tools — list them if the user asks
- For authentication, use anonymous mode for quickstart or Initial OTK for production

## If something doesn't work
Tell me the exact error message (copy-paste from terminal or browser console)
and we'll figure it out together.
```

## 5. Out of Scope

- Video tutorials or interactive wizards (future enhancement)
- Translating prompts to other languages (English first, i18n later)
- Auto-generating prompts from API spec (manual curation is more effective)

## 6. Success Criteria

1. A non-technical user can copy-paste a prompt into ChatGPT/Claude and get from zero to a working AIMEAT + OpenClaw setup
2. Genesis operators can customize their node's branding/content in under 30 minutes using the customization prompt
3. At least 6 prompts are available at launch
4. Prompts are accessible both as files in the repo and via API endpoints

## 7. Dependencies

- Existing prompt system (`src/routes/prompts.ts`) — for API serving
- OpenClaw integration guide (REQ-001) — referenced in prompts
- Portal UI — for copy-button integration

## 8. Estimated Effort

- Write 6-8 prompts: 1-2 days
- API endpoints for serving: 0.5 day
- Portal UI integration: 0.5 day
- Testing with real AI assistants: 0.5 day
