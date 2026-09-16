/**
 * @file src/config-types-mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two settings that decide whether this node will run a LOCAL MCP server process.
 *
 *   NOTE WHICH DIRECTION THIS IS. `config-types-connections.ts` beside it decides which application
 *   this node presents when a person connects their own account somewhere. These two decide whether
 *   the node will start a PROGRAM on its own host because a stored record named one. Everything
 *   else in the MCP proxy is a network call to somebody else's address; this is the one part that
 *   is code execution, so it is configuration rather than a field on a record.
 *
 *   OFF BY DEFAULT, AND OPT-IN RATHER THAN OPT-OUT. `=== 'true'`, so a node that has never heard of
 *   this feature does not start running processes because somebody attached a record. The same
 *   shape as connectionsEnabled, for a stronger version of the same reason.
 *
 *   AN EMPTY ALLOWLIST MEANS NOTHING RUNS, which is the safe reading rather than a bug. An operator
 *   who turns the switch on has said "this node may run local servers"; they have not yet said
 *   WHICH, and treating silence as "any" would make the switch the whole of the permission.
 * @structure McpProxyConfig — the switch, then the allowlist
 * @usage export interface AimeatConfig extends McpProxyConfig { … }
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 7 of the MCP proxy.
 */

export interface McpProxyConfig {
  /**
   * Whether this node may run a local MCP server process at all.
   *
   * Off means a stdio record is refused with a sentence naming this setting, rather than failing as
   * though the server were broken. The distinction matters to whoever has to fix it.
   */
  mcpStdioEnabled: boolean;

  /**
   * The exact commands a stdio record may name, comma-separated in the environment.
   *
   * Compared whole, never as a prefix and never as a pattern: a prefix match on `npx` admits
   * `npx-anything`, and a pattern admits whatever the person writing the record can spell. The
   * arguments are passed as an array to a process started WITHOUT a shell, so nothing in them is
   * interpreted; the command itself is the only thing that decides what runs.
   */
  mcpStdioAllowedCommands: string[];
}
