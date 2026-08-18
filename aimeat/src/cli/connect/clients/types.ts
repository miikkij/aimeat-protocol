/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared contract for `aimeat connect client <id>` — the one command that points a
 *   chat client (Goose, Claude Code, Cursor, VS Code, Claude Desktop) at this node's MCP surface.
 *   Each client is one adapter: where its config lives, how an MCP server is spelled in it, and how
 *   its user launches it afterwards.
 * @structure
 *   - ClientTarget — the resolved node + agent a client is being pointed at.
 *   - WriteResult — what the adapter did, so the caller can report it truthfully.
 *   - ClientAdapter — the per-client contract (id, label, configPath, apply, launchHint).
 * @usage Implemented by clients/goose.ts, claude-code.ts, cursor.ts, vscode.ts, claude-desktop.ts.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

/** The node + agent identity a client is being connected to. */
export interface ClientTarget {
    /** Node base URL, e.g. `https://aimeat.io` (no trailing slash). */
    nodeUrl: string;
    /** Streamable-HTTP MCP endpoint, e.g. `https://aimeat.io/v1/mcp`. */
    mcpUrl: string;
    /** Agent name inside the dedicated connector home, e.g. `goose`. */
    agent: string;
    /** Owner handle the agent belongs to. */
    owner: string;
    /** Dedicated connector home holding exactly this one agent's credential. */
    home: string;
    /** Absolute path to the agent's token file inside `home`. */
    tokenFile: string;
    /**
     * Name the MCP server gets in the client's config. Defaults to `aimeat`; a second node
     * is connected as `aimeat-<something>` so the two never overwrite each other.
     */
    serverName: string;
    /** Working directory the client should start in (agents write files where they are launched). */
    workdir: string;
    /** Optional purpose-scoped surface. Undefined = the full toolset. */
    surface?: 'appdev' | 'agent' | 'service' | 'admin';
}

/** What an adapter actually did — the caller reports these, it never assumes. */
export interface WriteResult {
    /** Files created or modified, absolute paths. */
    written: string[];
    /** Backup copies taken before modifying an existing file. */
    backedUp: string[];
    /** Lines to print under "next steps", already client-specific. */
    nextSteps: string[];
    /** Set when the adapter could not write and the user must act manually. */
    manual?: string;
}

/** One chat client's integration. */
export interface ClientAdapter {
    /** Stable id used on the command line, e.g. `goose`. */
    id: string;
    /** Human label for output, e.g. `Goose`. */
    label: string;
    /** Transport this client uses to reach the node. */
    transport: 'http' | 'stdio';
    /** Where this client keeps the config we edit, on the current platform. */
    configPath(): string;
    /** Point the client at the node. Must merge, never clobber other servers. */
    apply(target: ClientTarget): Promise<WriteResult>;
}
