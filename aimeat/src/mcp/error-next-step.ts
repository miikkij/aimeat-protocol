/**
 * @file src/mcp/error-next-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every MCP tool that fails says what to do next, in the failure itself.
 *
 *   THE RULE IS OLD, AND AN AGENT NEVER SAW IT AT THE MOMENT IT MATTERED. This node has always
 *   meant the same two steps for a failure: work it out from what the error says, and when that
 *   does not get there, tell the people who run the node at `support@operators`, so they learn what
 *   is causing failures. REST carries it on every error (middleware/envelope.ts appends the
 *   support hint to `next_actions`). For MCP it lived in one place, the tail of the server
 *   instructions, which several clients cut off at about 2 kB; the instruction review of
 *   2026-09-18 counted 331 `isError` returns under src/mcp/ in three shapes, and not one of them
 *   said where to go next. An agent reads an error more closely than any handbook, because it is
 *   stuck at exactly that moment, and without a next step it invents a workaround and nobody
 *   hears about the wall.
 *
 *   WHY A WRAPPER. All tools are registered through one window in mcp/index.ts, where
 *   tool-usage-wrap.ts already measures each call. A second wrapper at the same place covers
 *   every tool with one change, and a tool added tomorrow is covered the day it is added. It is
 *   its own file because the measuring wrapper promises never to change what a tool returns, and
 *   its tests hold it to that.
 *
 *   WHAT IT LEAVES ALONE. A successful result, by identity. A thrown error, which the SDK turns
 *   into its own failure. And a failure whose text already names the operators: a tool that wrote
 *   its own, more specific next step is not told twice.
 * @structure NEXT_STEP_TEXT · withErrorNextStep(register)
 * @usage
 *   const stepped = withErrorNextStep(originalTool);
 *   patchable.tool = wrapToolHandler(stepped, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial (wish-mcp-virheilmoituksiin-seuraava-askel-...).
 */

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Plain and in order: first what the agent can do itself, then who to tell. It names the route
 * beside the tool because `aimeat_dm_send` is not on every v2 surface, and the address works on
 * all of them.
 */
export const NEXT_STEP_TEXT = [
  'What to do next: when the message above explains what happened (the thing does not exist, a',
  'value is missing, a permission is not granted), act on that: correct the call, or tell the',
  'person what you found. When it does not explain itself, or the same call keeps failing, or it',
  'looks like a fault in this node, tell the people who run it: send a message to',
  '"support@operators" (aimeat_dm_send, or POST /v1/messages) saying what you were doing and what',
  'happened instead. It reaches them in one thread they answer in, and what you report is how',
  'they learn what causes failures here.',
].join(' ');

interface ToolResult { content?: { type?: string; text?: string }[]; isError?: boolean }

export function withErrorNextStep(register: AnyFn): AnyFn {
  return (...args: unknown[]) => {
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== 'function') return register(...args);

    const stepped = async (...handlerArgs: unknown[]): Promise<unknown> => {
      const result = await (handler as AnyFn)(...handlerArgs) as ToolResult | undefined;
      if (!result || typeof result !== 'object' || result.isError !== true) return result;
      const said = (result.content ?? []).map(c => c.text ?? '').join(' ');
      if (said.includes('support@operators')) return result;
      return { ...result, content: [...(result.content ?? []), { type: 'text' as const, text: NEXT_STEP_TEXT }] };
    };

    const next = [...args];
    next[last] = stepped;
    return register(...next);
  };
}
