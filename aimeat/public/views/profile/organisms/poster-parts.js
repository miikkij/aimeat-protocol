/**
 * @file poster-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The helpers the tab pages share: the translate-with-fallback helper and the in-page
 *   scroll that brings a section to the top of the content column. The section and the folded row
 *   that lived here are library components now (/components/PageSection.js, /components/FoldSection.js).
 * @structure tr(key, fallback) · scrollTo(id)
 * @usage import { tr, scrollTo } from '/views/profile/organisms/poster-parts.js';
 * @version-history
 *   v1.5.0 — 2026-09-26 — scrollTo is the contents rail's scrollToSection (/components/Rail.js),
 *     moved there unchanged (component plan C9, a move).
 *   v1.4.0 — 2026-09-25 — Section and Fold moved to /components as PageSection and FoldSection
 *     (UI consolidation phase 5, a move).
 *   v1.3.0 -- 2026-09-25 -- The Settings & Controls frame and its side menu are library components (SettingsFrame, SideMenu; settings-frame.css, side-menu.css); the old .pf-shell, .pf-side- and .pf-content names are gone (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- Compose the section headline from the shared poster-section-title class.
 *   v1.1.0 — 2026-08-29 — scrollTo scrolls the content region itself instead of calling scrollIntoView,
 *     which also moved the window and hid the top bar on aimeat.io.
 *   v1.0.0 — 2026-08-29 — Extracted from home.js v3.0.0 for the workspace cover; no behaviour change.
 */
import { t } from '/js/i18n.js';
import { scrollToSection } from '/components/Rail.js';

export const tr = (key, fb) => t(key) || fb;

/**
 * Bring a section to the top of the content area, and move nothing else. The scroll is the
 * contents rail's own now (/components/Rail.js scrollToSection, where its reason is written); this
 * name stays for the pages that still import it here.
 * @param {string} id
 */
export const scrollTo = scrollToSection;
