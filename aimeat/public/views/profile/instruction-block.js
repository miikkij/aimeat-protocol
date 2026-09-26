/**
 * @file instruction-block.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The copyable instruction block for one organism, under the name the MCP tab, the
 *   Hello MCP panel and every organism import it by. The block itself is the component
 *   InstructionBlock (components/InstructionBlock.js): the three formats people paste into
 *   (CLAUDE.md, AGENTS.md, the AI chat's own instructions field), each with where it goes,
 *   generated from the organism's real structure on the server.
 * @structure InstructionBlock({ orgId }) — re-exported from /components/InstructionBlock.js
 * @usage import { InstructionBlock } from '/views/profile/instruction-block.js';
 * @version-history
 *   v1.3.0 — 2026-09-26 — The block moved to components/InstructionBlock.js with its markup; this
 *     module keeps the name and the default export its callers import (page group G1a).
 *   v1.2.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.0.0 — 2026-07-31 — Initial.
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { InstructionBlock } from '/components/InstructionBlock.js';

export { InstructionBlock };
export default InstructionBlock;
