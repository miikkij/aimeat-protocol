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

The command does three things. It authorizes an agent of its own for that program, which the
owner approves on the Agents page like any other agent. It writes the MCP settings in the shape
that program expects, merged into what was already there. And it leaves a launcher script that
starts the program with the token supplied at run time.

| Client | How it reaches the node | Config it writes |
|---|---|---|
| `goose` | `POST /v1/mcp` | `config.yaml`, under `extensions` |
| `claude-code` | `POST /v1/mcp` | `claude mcp add-json`, user scope |
| `cursor` | `POST /v1/mcp` | `~/.cursor/mcp.json` |
| `vscode` | `POST /v1/mcp` | the user `mcp.json`, under `servers` |
| `claude-desktop` | the local connector over stdio | `claude_desktop_config.json` |

Options:

- `--agent <name>` names the agent.
- `--workdir <path>` sets where the program starts. An agent writes files where it is launched,
  so this keeps it out of your source repositories. The default is `~/aimeat-work`.
- `--surface <appdev|agent|service|admin>` narrows the tools to one job. The full set at
  `/v1/mcp` costs a client many more input tokens per turn than one surface.
- `--home <path>` puts the credential somewhere other than the default `~/.aimeat-<client>`.
- `--name <server>` lets a second node sit beside the first in the same client.

Two guarantees, because the command edits files you own. The token is never written into a
config file: each client gets a variable reference, a headers-helper command or the local
connector, and the token stays in the connector home. And every other MCP server in the file is
left as it was: the command backs the file up first, merges, and writes nothing if it cannot parse
what is there.

goose takes its model from OpenRouter, so you pick the model per session and pay per token. Set
`OPENROUTER_API_KEY` before you start it, then choose the model with `GOOSE_MODEL` on the launcher
(`GOOSE_MODEL=<model> ~/.aimeat-goose/launch-goose.sh`, or the `.ps1` launcher on Windows), or with
`/model <model>` inside a running session.

## Client configuration from the desktop app

A person who does not want a terminal uses the aimeat-desktop app instead of the CLI. It lists the
AI tools installed on the computer and attaches Claude Code, Cursor and VS Code to their AIMEAT with
one click, by editing each tool's own MCP settings; nothing it writes holds a secret, because the
node signs the tool in over OAuth. Codex keeps its servers in a TOML file, so the app gives the lines
to paste. Claude Desktop takes a remote MCP server in its own settings (Settings, Connectors, Add
custom connector), so the app gives the address to paste; Anthropic's cloud makes that connection,
so it works only with an AIMEAT the internet can reach. See `aimeat-desktop/README.md`.

Read `GET /v1/ai-tools` for each client's setup and
[the agent guide](building-an-aimeat-compatible-agent.md) for onboarding.
For other clients, read the node's `/.well-known/mcp.json` and the client's own MCP setup guide.

## Prompt injection warnings on company-managed accounts

An AI tool in a company-managed environment (an Enterprise or Team plan, or a workspace an
administrator configures) can show a prompt injection or untrusted source warning when a person
connects a node or pastes one of its prompts. The warning appears before anything has run.

The reason is the environment. There, every external service the administrator has not approved
is untrusted by default, and the same warning applies to any unapproved connector. Injection
classifiers score content that enters the model's context from outside (a tool result, a fetched
page, a connector response) rather than what the person types or pastes. Without an approved
connector, what a prompt asks the model to read arrives as an untrusted fetch. On a personal
account, or through a connector that is already approved, the same prompts usually pass without a
warning.

Do not click past the warning out of habit. A prompt of unknown origin should not be run. Every
prompt the node hands out is shown in full before it is copied, and every one is in this
repository.

Three routes, in this order:

1. **The administrator approves the connector.** They approve the MCP endpoint
   (`https://<node>/v1/mcp`), the OAuth 2.1 sign-in with PKCE to that node (each person signs in
   as themselves; there are no shared keys), and the tools the connector exposes. The administrator
   approves first, then the person adds the connector and signs in. For their review: the tool
   annotations in [`aimeat/src/mcp/annotations.ts`](../aimeat/src/mcp/annotations.ts), the OAuth
   metadata at `/.well-known/oauth-authorization-server` (RFC 8414) and
   `/.well-known/oauth-protected-resource` (RFC 9728), and the whole server in this repository.
2. **The prompt route instead of MCP.** The node composes a prompt, the person reads it, pastes it
   into the chat by hand and brings the answer back. Nothing is connected, and nothing leaves the
   chat until the person sends it. This route is permanent and supported, and for confidential
   material it is often the right one.
3. **Run AIMEAT yourself.** The code is MIT licensed and self-hostable (`npx aimeat init`), so an
   organisation can read what a prompt does, run it on its own server and point the prompts at its
   own address.

The product shows the same explanation above every copyable prompt.

One-time-key writes and micro-memory were removed. A client that can only read URLs
uses public reads or the copy-prompt workflow.
