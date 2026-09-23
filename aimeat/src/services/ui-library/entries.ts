/**
 * @file src/services/ui-library/entries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every catalogue entry's purpose half, in catalogue order: the setup path, the page
 *   parts, the conversation, the older shared components, then the shapes of poster.css.
 * @structure UI_ENTRY_SOURCES
 * @usage import { UI_ENTRY_SOURCES } from './entries.js';
 * @version-history
 *   v1.1.0 — 2026-09-24 — The shell parts; `use` is the fixed words of entries-use.ts.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntrySource } from './types.js';
import { STEP_ENTRIES } from './entries-steps.js';
import { PAGE_ENTRIES } from './entries-page.js';
import { CONVERSATION_ENTRIES } from './entries-conversation.js';
import { SHARED_ENTRIES } from './entries-shared.js';
import { SHELL_ENTRIES } from './entries-shell.js';
import { SHAPE_ENTRIES } from './entries-shapes.js';
import { USE_OF } from './entries-use.js';

export const UI_ENTRY_SOURCES: UiEntrySource[] = [
    ...STEP_ENTRIES,
    ...PAGE_ENTRIES,
    ...CONVERSATION_ENTRIES,
    ...SHARED_ENTRIES,
    ...SHELL_ENTRIES,
    ...SHAPE_ENTRIES,
].map(e => ({ ...e, use: USE_OF[e.id] ?? [] }));
