# Connecting an AI client

Choose a connection from what the client can do.

| Client capability | AIMEAT connection |
|---|---|
| Remote MCP with authentication | Connect to the node's `/v1/mcp` endpoint and approve the requested access |
| HTTP requests from an agent runtime | Use device authorization, then call REST with the granted token |
| Reading public URLs | Read the node's `/llms.txt` and public resources |
| Copying text between applications | Use a prompt supplied by the node and bring the result back |

The [platform reports](aiplatforms/README.md) contain client-specific notes. They are
dated references: provider plans, menus and capabilities can change independently of AIMEAT.
Check the provider's current documentation before relying on a plan restriction or setup screen.

## Client configuration from the AIMEAT CLI

The implementation supports these client names:

```bash
npx aimeat connect client <goose|claude-code|cursor|vscode|claude-desktop> \
  --url https://your-node --owner your-handle
```

Read [the client reports](aiplatforms/README.md) for details and
[the agent guide](building-an-aimeat-compatible-agent.md) for onboarding.
For other clients, read the node's `/.well-known/mcp.json` and the client's own MCP setup guide.

One-time-key writes and micro-memory were removed. A client that can only read URLs
uses public reads or the copy-prompt workflow.
