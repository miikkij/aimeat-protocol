/**
 * @file src/mcp/sdk-seams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three places the node reaches into the MCP SDK's private members, in one module.
 *
 *   WHY ONE MODULE. The SDK has no public way to wrap the `tools/call` handler, to enumerate the
 *   registered tools, or to adjust input validation, and the node needs all three: a moved tool
 *   answers TOOL_MOVED, a tool without permission answers SCOPE_DENIED, the chat surface switches
 *   tools off and on, and a `null` sent for an optional field is read as absent. Each reads a field
 *   the SDK declares private (`server._requestHandlers`, `_registeredTools`, `validateToolInput`),
 *   so any SDK release may rename one without notice. Kept here, a rename breaks one file, and
 *   test/unit/mcp-sdk-seams.test.ts names the member that is gone, so an SDK bump fails in CI with
 *   the reason rather than in a client with "tool not found" (MCP migration plan doc-mvguy322f9se,
 *   step 2; decision 2026-10-20, item 6). The SDK's public replacement, request middleware
 *   (`server.use()`), is an unreleased experimental change (typescript-sdk PR #2820); move to it
 *   once it is released.
 * @structure ToolsCallHandler · wrapToolsCall(mcp, wrap) · registeredTools(mcp) · wrapToolInputValidation(mcp, wrap) · seamsPresent(mcp)
 * @usage
 *   wrapToolsCall(mcp, (original) => async (request, extra) => original(request, extra));
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-20 — Initial: moved out of moved-tools-answer.ts, scope-denied-answer.ts,
 *     tool-loader.ts and null-as-absent.ts unchanged in behaviour.
 */
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/server';

/** A `tools/call` request as the SDK hands it to its handler. */
export interface ToolsCallRequest { method: string; params?: { name?: unknown; arguments?: Record<string, unknown> } & Record<string, unknown> }
export type ToolsCallHandler = (request: ToolsCallRequest, extra: unknown) => Promise<unknown>;

/** The SDK's input validation for one tool call. */
export type ValidateToolInput = (tool: { inputSchema?: unknown }, args: unknown, toolName: string) => Promise<unknown>;

function handlerMap(mcp: McpServer): Map<string, ToolsCallHandler> | undefined {
    return (mcp.server as unknown as { _requestHandlers?: Map<string, ToolsCallHandler> })._requestHandlers;
}

/**
 * Replace the `tools/call` handler with `wrap(original)`. The SDK keeps its handlers in a map on
 * the protocol object; setRequestHandler() would re-parse and cannot hand back the handler it
 * replaces, so the map is read directly. False when there is no handler to wrap (no tool registered,
 * or the SDK moved the map), so the caller can say what that costs.
 */
export function wrapToolsCall(mcp: McpServer, wrap: (original: ToolsCallHandler) => ToolsCallHandler): boolean {
    const handlers = handlerMap(mcp);
    const original = handlers?.get('tools/call');
    if (!handlers || !original) return false;
    handlers.set('tools/call', wrap(original));
    return true;
}

/** The server's registered tools by name. The SDK keeps them in a field it does not export a getter for. */
export function registeredTools(mcp: McpServer): Record<string, RegisteredTool> {
    return (mcp as unknown as { _registeredTools?: Record<string, RegisteredTool> })._registeredTools ?? {};
}

/** Replace the SDK's per-call input validation with `wrap(original)`. */
export function wrapToolInputValidation(mcp: McpServer, wrap: (original: ValidateToolInput) => ValidateToolInput): void {
    const server = mcp as unknown as { validateToolInput: ValidateToolInput };
    const original = server.validateToolInput.bind(mcp) as ValidateToolInput;
    server.validateToolInput = wrap(original);
}

/** Which private members this SDK still has, for the named test. */
export function seamsPresent(mcp: McpServer): { requestHandlers: boolean; toolsCallHandler: boolean; registeredTools: boolean; validateToolInput: boolean } {
    const handlers = handlerMap(mcp);
    return {
        requestHandlers: handlers instanceof Map,
        toolsCallHandler: typeof handlers?.get('tools/call') === 'function',
        registeredTools: typeof (mcp as unknown as { _registeredTools?: unknown })._registeredTools === 'object',
        validateToolInput: typeof (mcp as unknown as { validateToolInput?: unknown }).validateToolInput === 'function',
    };
}
