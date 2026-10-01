/**
 * @file ai-setup-guide.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two surfaces built on the per-tool setup table, under the names the Agents tab,
 *   the MCP tab, the overview and the home import them by: McpSetupGuide (how to attach this node to
 *   a given AI tool) and InstructionsDialog (the instruction block plus, for the tool the reader
 *   actually uses, the exact place to paste it). Both are the component components/SetupGuide.js.
 *
 *   McpSetupGuide takes the component's named options (`poster`, `asideInstall`, `facts`,
 *   `stepRows`). It also still reads the older class props its callers pass until they move
 *   (tabClass / activeClass: the poster tab row; installClassName: the attention note's frame round
 *   the install row), as those same options: nothing a caller writes restyles the guide.
 * @structure McpSetupGuide({ poster, asideInstall, facts, stepRows }) · InstructionsDialog({ open, onClose })
 * @usage import { McpSetupGuide, InstructionsDialog } from '/views/profile/ai-setup-guide.js';
 * @version-history
 *   v2.8.0 -- 2026-10-01 -- Passes `claudeNote` through to SetupGuide (the home's free road).
 *   v2.7.0 -- 2026-09-26 -- The guide and the dialog moved to components/SetupGuide.js with their markup
 *     (the tool tabs, the copy doors and the field table are the library's Tabs, Action and Facts);
 *     this module keeps the names its callers import and maps the old class props to named options
 *     (page group G1a).
 *   v2.6.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v2.5.0 -- 2026-09-26 -- McpSetupGuide takes `stepRows`: the steps are then the numbered list's rows (IndexList), as the MCP tab and the Agents tab draw them (a unification: Jouni's decision "Numbered list"). Without it the part's classic list stays, as the home draws it.
 *   v2.4.0 -- 2026-09-25 -- McpSetupGuide takes `facts`: the field table is then the Facts (css/components/facts.css), a unification: the look most tabs use. Without it the classic rows stay, for the pages that have not moved.
 *   v2.3.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-24 -- "Official instructions" is the action link's more tone (Jouni's decision "Small
 *     link").
 *   2026-09-24 -- The copy buttons (a field's Copy, Copy the command) are the underlined action link
 *     (Jouni's decision "Panel action").
 *   2026-09-14 -- McpSetupGuide takes tabClass / activeClass for its tool tabs, so the agents page
 *     can hand in the shared poster tab instead of restyling .ast-tool from outside.
 *   2026-09-13 -- Pass the caller's shared install-row shape to McpInstallRow.
 *   v2.2.0 — 2026-08-27 — The short way in (McpInstallRow) renders above the steps for the three
 *     clients that have one, and the module-level table cache moved to ai-tool-setup.js so the
 *     install shortcuts elsewhere on the page share this read instead of opening a second.
 *   v2.0.0 — 2026-07-31 — Table fetched from GET /v1/ai-tools instead of an in-SPA copy, so
 *     the Experience Center reads the same one.
 *   v1.0.0 — 2026-07-31 — Initial.
 *   v2.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import htm from 'htm';
import { SetupGuide, InstructionsDialog } from '/components/SetupGuide.js';

const html = htm.bind(h);

/**
 * How to attach this node to one AI tool. The older props tabClass (any value: the poster tab row)
 * and installClassName (any value: the install row in the attention note's frame) read as the
 * component's named options.
 * @param {{ poster?: boolean, asideInstall?: boolean, facts?: boolean, stepRows?: boolean,
 *   tabClass?: string, activeClass?: string, installClassName?: string, claudeNote?: string|null }} [props]
 */
export function McpSetupGuide({ poster, asideInstall, facts = false, stepRows = false, tabClass, installClassName, claudeNote = null } = {}) {
  return html`<${SetupGuide} poster=${!!(poster || tabClass)} asideInstall=${!!(asideInstall || installClassName)}
    facts=${facts} stepRows=${stepRows} claudeNote=${claudeNote} />`;
}

export { InstructionsDialog };
