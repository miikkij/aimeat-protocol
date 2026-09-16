/**
 * @file stdio-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether this node will run a LOCAL MCP server process, and which one.
 *
 *   THIS IS THE ONE PART OF THE MCP PROXY THAT IS CODE EXECUTION. Everything else is a network call
 *   to an address a person chose: the far side gets a request, the far side decides. A stdio server
 *   is a PROGRAM started on this host, with this host's filesystem, this host's network and this
 *   host's environment, and nothing about the MCP protocol constrains what it then does. So it is
 *   the last phase of this feature rather than the first, it is off by default, and it is behind
 *   three separate conditions rather than one.
 *
 *   THREE CONDITIONS, AND EACH ONE ALONE IS ENOUGH TO REFUSE:
 *
 *   1. The operator turned it on (AIMEAT_MCP_STDIO_ENABLED). Immutable, so it needs a restart and
 *      cannot be flipped through an admin API by whoever reaches one.
 *   2. The operator named the command (AIMEAT_MCP_STDIO_ALLOWED_COMMANDS). An EMPTY list means
 *      nothing runs, which is the safe reading rather than a bug: turning the feature on says this
 *      node MAY run local servers, not WHICH, and reading silence as "any" would make the switch
 *      the whole of the permission.
 *   3. The record's command matches one of them EXACTLY. Not a prefix, not a pattern, not a
 *      basename. A prefix match on `npx` admits `npx-anything`; a basename match admits any `node`
 *      anywhere on the disk, including one the record's own arguments just wrote.
 *
 *   AND THE RECORD ITSELF IS OPERATOR-ONLY, which is a fourth condition this file does not enforce
 *   because it is not this file's to enforce: a stdio transport can only be written through the
 *   node-wide attach door, which stands behind requireOperatorPrincipal. An owner's attach door and
 *   the agent tools build an http or sse transport and have no way to name a command.
 *
 *   NO SHELL, ever. The SDK's StdioClientTransport spawns with an argument ARRAY, so nothing in the
 *   arguments is interpreted: a semicolon in an argument is a semicolon, not a second command. That
 *   is why the command alone decides what runs, and why checking it whole is sufficient.
 * @structure StdioVerdict · checkStdioPolicy(config, transport)
 * @usage const v = checkStdioPolicy(config, t); if (!v.ok) throw new Error(v.message);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 7 of the MCP proxy.
 */
import type { AimeatConfig } from '../../config.js';

/**
 * The refusal reads as one sentence an operator can act on, naming the setting that decides, and
 * carries its own code so a command nobody allowlisted is not reported as a transport this node
 * does not support. They are different mistakes and they are fixed in different places.
 */
export type StdioVerdict =
  | { ok: true }
  | { ok: false; code: 'STDIO_DISABLED' | 'STDIO_NOT_ALLOWED'; message: string };

export interface StdioTransportShape {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * May this node run this command?
 *
 * A pure function of the config and the record, so the same answer is given wherever it is asked,
 * and so the three conditions can be tested without starting anything.
 */
export function checkStdioPolicy(
  config: Pick<AimeatConfig, 'mcpStdioEnabled' | 'mcpStdioAllowedCommands'>,
  transport: StdioTransportShape,
): StdioVerdict {
  if (!config.mcpStdioEnabled) {
    return {
      ok: false,
      code: 'STDIO_DISABLED',
      message: 'This node cannot run a local MCP server process. Whoever runs it can allow that '
        + 'with AIMEAT_MCP_STDIO_ENABLED, and must then name the commands that may run.',
    };
  }

  const allowed = config.mcpStdioAllowedCommands;
  if (allowed.length === 0) {
    return {
      ok: false,
      code: 'STDIO_NOT_ALLOWED',
      message: 'This node may run local MCP server processes, but no command has been allowed. '
        + 'Name them in AIMEAT_MCP_STDIO_ALLOWED_COMMANDS.',
    };
  }

  // Whole, never a prefix and never a basename. The command is the only thing deciding what runs,
  // because the arguments reach a process started without a shell.
  if (!allowed.includes(transport.command)) {
    return {
      ok: false,
      code: 'STDIO_NOT_ALLOWED',
      // The allowed list is NOT named back: it is the operator's own configuration and belongs on
      // their screen, not in an answer a caller reads.
      message: `"${transport.command}" is not a command this node is allowed to run.`,
    };
  }

  return { ok: true };
}
