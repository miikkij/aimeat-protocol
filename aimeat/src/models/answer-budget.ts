/**
 * @file src/models/answer-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The size one tool answer may have, in characters of text, and the default page of a
 *   list an AI reads. The node holds this limit; it does not rely on what a client does with an
 *   answer that is too long.
 *
 *   THE LIMIT IS THE OPERATOR'S SETTING mcp.tool_answer_chars (config/node-limits.ts), default
 *   250 000; 0 is no limit. Claude Code saves a text result over 50 000 characters to a file and
 *   gives the model the path, and refuses one over 25 000 tokens, unless the tool's entry in
 *   tools/list declares `_meta["anthropic/maxResultSizeChars"]`: then it passes text up to that
 *   size, at most 500 000 characters, whatever the token count (its MCP documentation, "MCP output
 *   limits and warnings", read 2026-11-25). The node declares the setting on every tool
 *   (mcp/declared-answer-size.ts), so an answer inside the limit reaches the model as text. What
 *   another client does with a long answer is not known here: one that cuts it gives the model part
 *   of the data without saying so, and an operator whose people use such a client lowers the setting.
 *
 *   WHAT READS IT. services/usage/rollup-engine.ts counts the answers over it, per tool and day, so
 *   the usage report names the tool whose answers grow. services/workspace/tool-ops.ts stops opening
 *   records at it. A list an AI reads defaults to ANSWER_PAGE_DEFAULT entries and never returns more
 *   than ANSWER_PAGE_MAX.
 * @structure
 *   - TOOL_ANSWER_CHARS_DEFAULT -- the setting's default
 *   - toolAnswerBudgetChars(config) -- the limit of one answer in force
 *   - CLIENT_RESULT_CEILING_CHARS / declaredResultChars(config) -- what a tool declares to the client
 *   - ANSWER_PAGE_DEFAULT / ANSWER_PAGE_MAX -- entries of a list in one answer
 * @usage
 *   import { toolAnswerBudgetChars } from '../models/answer-budget.js';
 *   if (chars > toolAnswerBudgetChars(config)) stop();
 * @version-history
 *   2026-11-25 — The limit is the setting mcp.tool_answer_chars, default 250 000 (was the constant
 *     40 000), and every tool declares it to the client.
 *   2026-11-24 — Initial.
 */

/** The default of mcp.tool_answer_chars. config/node-limits.ts imports nothing, so it repeats the figure. */
export const TOOL_ANSWER_CHARS_DEFAULT = 250_000;

/** The largest size Claude Code accepts in a tool's `anthropic/maxResultSizeChars`. */
export const CLIENT_RESULT_CEILING_CHARS = 500_000;

/** The one setting this module reads; a structural type, so a caller passes its whole config. */
export interface AnswerBudgetConfig { mcpToolAnswerChars: number }

/** Characters of text one tool answer may hold: the setting, and no limit when it is 0. */
export function toolAnswerBudgetChars(config: AnswerBudgetConfig): number {
  const n = config.mcpToolAnswerChars;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** The size a tool declares to the client: the limit in force, inside what the client accepts. */
export function declaredResultChars(config: AnswerBudgetConfig): number {
  return Math.min(toolAnswerBudgetChars(config), CLIENT_RESULT_CEILING_CHARS);
}

/**
 * Entries of one list in one answer when the caller names no `limit`. An index entry of a workspace
 * record is about 240 characters, so 50 entries of each of three spaces stay under the budget.
 */
export const ANSWER_PAGE_DEFAULT = 50;

/** The most entries of one list a caller may ask for in one answer. */
export const ANSWER_PAGE_MAX = 150;
