/**
 * @file src/services/ui-library/entries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every catalogue entry's purpose half, in catalogue order: the setup path, the page
 *   parts, the conversation, the older shared components, the parts of Settings & Controls, then the shapes of poster.css.
 * @structure UI_ENTRY_SOURCES
 * @usage import { UI_ENTRY_SOURCES } from './entries.js';
 * @version-history
 *   v1.6.0 — 2026-09-27 — The app catalogue on components: the catalogue family (entries-catalogue.ts).
 *   v1.5.0 — 2026-09-27 — The admin dashboard on components: the operator family (entries-operator.ts).
 *   v1.4.0 — 2026-09-27 — Settings & Controls on components: the kit (entries-kit.ts), the fields (entries-fields.ts),
 *     the page parts (entries-page-kit.ts), the list (entries-list.ts) and the special views (entries-views-knowledge.ts,
 *     entries-views-work.ts), after the other Settings parts.
 *   v1.3.0 — 2026-09-26 — The organism parts of Settings & Controls (entries-settings-org.ts), after the other Settings parts.
 *   v1.2.0 — 2026-09-25 — The parts of Settings & Controls (entries-settings.ts).
 *   v1.1.0 — 2026-09-24 — The shell parts; `use` is the fixed words of entries-use.ts.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntrySource } from './types.js';
import { STEP_ENTRIES } from './entries-steps.js';
import { PAGE_ENTRIES } from './entries-page.js';
import { CONVERSATION_ENTRIES } from './entries-conversation.js';
import { SHARED_ENTRIES } from './entries-shared.js';
import { SHELL_ENTRIES } from './entries-shell.js';
import { SETTINGS_ENTRIES } from './entries-settings.js';
import { ORG_SETTINGS_ENTRIES } from './entries-settings-org.js';
import { KIT_ENTRIES } from './entries-kit.js';
import { FIELD_ENTRIES } from './entries-fields.js';
import { PAGE_KIT_ENTRIES } from './entries-page-kit.js';
import { LIST_ENTRIES } from './entries-list.js';
import { KNOWLEDGE_VIEW_ENTRIES } from './entries-views-knowledge.js';
import { WORK_VIEW_ENTRIES } from './entries-views-work.js';
import { OPERATOR_ENTRIES } from './entries-operator.js';
import { CATALOGUE_ENTRIES } from './entries-catalogue.js';
import { SHAPE_ENTRIES } from './entries-shapes.js';
import { USE_OF } from './entries-use.js';

export const UI_ENTRY_SOURCES: UiEntrySource[] = [
    ...STEP_ENTRIES,
    ...PAGE_ENTRIES,
    ...CONVERSATION_ENTRIES,
    ...SHARED_ENTRIES,
    ...SHELL_ENTRIES,
    ...SETTINGS_ENTRIES,
    ...ORG_SETTINGS_ENTRIES,
    ...KIT_ENTRIES,
    ...FIELD_ENTRIES,
    ...PAGE_KIT_ENTRIES,
    ...LIST_ENTRIES,
    ...KNOWLEDGE_VIEW_ENTRIES,
    ...WORK_VIEW_ENTRIES,
    ...OPERATOR_ENTRIES,
    ...CATALOGUE_ENTRIES,
    ...SHAPE_ENTRIES,
].map(e => ({ ...e, use: USE_OF[e.id] ?? [] }));
