# REQ-001: AIMEAT + OpenClaw Integration Guide

**Status:** Draft  
**Priority:** High  
**Type:** Documentation + Integration  
**Created:** 2026-03-04  

---

## 1. Summary

Create a comprehensive integration guide and reference prompts enabling OpenClaw (open-source AI agent framework, 68k+ GitHub stars) to connect to AIMEAT nodes via MCP. This replaces the original "LLM Loader / Mini-agent" idea — OpenClaw already solves the agent runtime problem; AIMEAT should focus on being the best memory/action backend for it.

## 2. Background

- OpenClaw is the dominant open-source AI agent framework as of early 2026
- It supports MCP (Model Context Protocol) natively for tool calls
- AIMEAT already exposes 18 MCP tools at `/v1/mcp`
- Users need a documented path from "I installed OpenClaw" to "my agent reads/writes AIMEAT memory"
- The original idea of building a custom LLM loader is redundant when OpenClaw exists

## 3. Requirements

### 3.1 Integration Documentation

| ID | Requirement | Priority |
|----|------------|----------|
| R-001-01 | Create `docs/integrations/openclaw-setup.md` with step-by-step guide | Must |
| R-001-02 | Document MCP server URL configuration for OpenClaw (`http://host:40050/v1/mcp`) | Must |
| R-001-03 | Document Initial OTK usage for prompt-embedded auth (no repeated token fetching) | Must |
| R-001-04 | Document anonymous mode as zero-config quickstart path | Must |
| R-001-05 | Document dev mode for local development without OTK | Should |
| R-001-06 | Provide example OpenClaw config snippet (MCP server block) | Must |
| R-001-07 | List all 18 MCP tools with one-line descriptions and typical use cases | Must |
| R-001-08 | Provide 3+ worked examples: memory read/write, board post, work request | Should |

### 3.2 Starter Prompts

| ID | Requirement | Priority |
|----|------------|----------|
| R-001-09 | Create `docs/init-prompts/openclaw-aimeat-agent.md` — system prompt for an OpenClaw agent connected to AIMEAT | Must |
| R-001-10 | Prompt must instruct agent how to authenticate (OTK or anonymous) | Must |
| R-001-11 | Prompt must instruct agent to store findings in AIMEAT memory with structured keys | Must |
| R-001-12 | Prompt must instruct agent to check memory before external lookups (cache-first) | Should |
| R-001-13 | Create share prompt (`/v1/prompts/openclaw`) that users can copy-paste | Should |

### 3.3 Compatibility Testing

| ID | Requirement | Priority |
|----|------------|----------|
| R-001-14 | Verify AIMEAT MCP server works with OpenClaw's MCP client (StreamableHTTP transport) | Must |
| R-001-15 | Verify tool calls succeed with Initial OTK auth flow | Must |
| R-001-16 | Verify concurrent tool calls from OpenClaw do not cause race conditions | Should |
| R-001-17 | Document any OpenClaw version requirements or known incompatibilities | Should |

### 3.4 LM Studio Integration (Related)

| ID | Requirement | Priority |
|----|------------|----------|
| R-001-18 | Create `docs/integrations/lm-studio-setup.md` — LM Studio + AIMEAT via MCP plugin | Should |
| R-001-19 | Document local-only setup (LM Studio model + AIMEAT node on same machine) | Should |
| R-001-20 | Provide system prompt template for LM Studio chat sessions with AIMEAT tools | Should |

## 4. Out of Scope

- Building a custom LLM loader or agent runtime (OpenClaw handles this)
- Modifying AIMEAT's MCP server protocol (already compliant)
- Supporting non-MCP agent frameworks in this requirement (separate REQs if needed)

## 5. Success Criteria

1. A new user can go from `git clone openclaw` + `aimeat init` to a working agent with memory in under 15 minutes following the guide
2. The integration requires zero code changes to AIMEAT's MCP server
3. At least 3 end-to-end examples demonstrate real value (not just "hello world")

## 6. Dependencies

- AIMEAT MCP server (`/v1/mcp`) — already implemented
- Initial OTK endpoint (`/v1/auth/initial-otk`) — already implemented
- Anonymous mode (`AIMEAT_ANONYMOUS=true`) — already implemented
- OpenClaw MCP client support — external dependency

## 7. Estimated Effort

- Documentation: 1-2 days
- Testing & verification: 1 day
- Starter prompts: 0.5 day
