/**
 * @file public/views/profile/extensions-tab.constants.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Static lookup tables for the Extensions tab — component-type icons/tag CSS classes
 *   and the bundled ready-made extensions list. Extracted from extensions-tab.js to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from extensions-tab.js (max-file-lines)
 */

export const COMP_ICONS = {schema:'\u{1F4D0}',prompt:'\u{1F4AC}',action:'⚡','board-template':'\u{1F4CC}',ontology:'\u{1F9EC}','seed-data':'\u{1F331}',lib:'\u{1F4E6}'};
export const COMP_TAG_CLASSES = {schema:'ext-comp-tag-schema',prompt:'ext-comp-tag-prompt',action:'ext-comp-tag-action','board-template':'ext-comp-tag-board',ontology:'ext-comp-tag-ontology','seed-data':'ext-comp-tag-seed',lib:'ext-comp-tag-lib'};

export const BUNDLED = [
  { id: 'aimeat-charts', icon: '\u{1F4CA}', nameKey: 'profile.extensions.bundled.charts.name', descKey: 'profile.extensions.bundled.charts.desc' },
  { id: 'aimeat-canvas', icon: '\u{1F3A8}', nameKey: 'profile.extensions.bundled.canvas.name', descKey: 'profile.extensions.bundled.canvas.desc' },
];
