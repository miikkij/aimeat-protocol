/**
 * @file src/models/answer-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The size one tool answer may have, in characters of text, and the default page of a
 *   list an AI reads. The node holds this limit; it does not rely on what a client does with an
 *   answer that is too long.
 *
 *   WHY 40 000. Claude Code saves a text result over 50 000 characters to a file and gives the model
 *   the path, and refuses one over 25 000 tokens (its MCP documentation, "MCP output limits and
 *   warnings", read 2026-11-24). What other clients do with a long answer is not known here: one
 *   that cuts it gives the model part of the data without saying so. 40 000 leaves room for the text
 *   the node appends to a failing result and for a client with a lower limit.
 *
 *   WHAT READS IT. services/usage/rollup-engine.ts counts the answers over it, per tool and day, so
 *   the usage report names the tool whose answers grow. services/workspace/tool-ops.ts stops opening
 *   records at it. A list an AI reads defaults to ANSWER_PAGE_DEFAULT entries and never returns more
 *   than ANSWER_PAGE_MAX.
 * @structure
 *   - TOOL_ANSWER_BUDGET_CHARS -- the limit of one answer
 *   - ANSWER_PAGE_DEFAULT / ANSWER_PAGE_MAX -- entries of a list in one answer
 * @usage
 *   import { TOOL_ANSWER_BUDGET_CHARS } from '../models/answer-budget.js';
 * @version-history
 *   2026-11-24 — Initial.
 */

/** Characters of text one tool answer may hold. */
export const TOOL_ANSWER_BUDGET_CHARS = 40_000;

/**
 * Entries of one list in one answer when the caller names no `limit`. An index entry of a workspace
 * record is about 240 characters, so 50 entries of each of three spaces stay under the budget.
 */
export const ANSWER_PAGE_DEFAULT = 50;

/** The most entries of one list a caller may ask for in one answer. */
export const ANSWER_PAGE_MAX = 150;
