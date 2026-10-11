# Connecting an AI client

Choose a connection from what the client can do.

| Client capability | AIMEAT connection |
|---|---|
| Remote MCP with authentication | Connect to the node's `/v1/mcp` endpoint and approve the requested access |
| HTTP requests from an agent runtime | Use device authorization, then call REST with the granted token |
| Reading public URLs | Read the node's `/llms.txt` and public resources |
| Copying text between applications | Use a prompt supplied by the node and bring the result back |

Every node serves its per-tool setup at `GET /v1/ai-tools`: the steps, the fields, the plans each
tool needs, and a link to the vendor's own documentation. Its source is
`aimeat/src/services/ai-tool-setup.ts`. Provider plans and menus change independently of AIMEAT,
so check the vendor's page that each entry links before relying on a plan restriction.

## Client configuration from the AIMEAT CLI

The implementation supports these client names:

```bash
npx aimeat connect client <goose|claude-code|cursor|vscode|claude-desktop> \
  --url https://your-node --owner your-handle
```

Read `GET /v1/ai-tools` for each client's setup and
[the agent guide](building-an-aimeat-compatible-agent.md) for onboarding.
For other clients, read the node's `/.well-known/mcp.json` and the client's own MCP setup guide.

One-time-key writes and micro-memory were removed. A client that can only read URLs
uses public reads or the copy-prompt workflow.
