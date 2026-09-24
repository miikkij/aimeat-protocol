/**
 * @file src/config-themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's choices about the look of the node's own interface (Themes & Styles):
 *   whether people choose their own theme, the one theme when they do not, which themes the pill
 *   offers, and the theme a person sees before choosing (Jouni, 2026-09-23: the operator configures
 *   "voiko jokainen käyttäjä valita oman teemansa vai onko joku tietty teema vain käytössä").
 *
 *   Its own file because config.ts and config-types.ts are at the line ceiling. The values are ids;
 *   services/themes/service.ts drops one that names no theme, so these defaults are safe on a node
 *   that has made none of its own.
 * @structure ThemesConfig · themesDefaults()
 * @usage import { themesDefaults } from './config-themes.js';  const config = { ...themesDefaults(), … };
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */

export interface ThemesConfig {
  /** People choose their own theme in the pill. Off: every page wears `themesFixed`. */
  themesPersonalChoice: boolean;
  /** The one theme every page wears when people do not choose. */
  themesFixed: string;
  /** Comma-separated theme ids the pill offers; empty offers every theme that is not retired. */
  themesOffered: string;
  /** The theme a person sees before they choose one. */
  themesDefault: string;
}

export function themesDefaults(): ThemesConfig {
  return {
    themesPersonalChoice: process.env.AIMEAT_THEMES_PERSONAL_CHOICE !== 'false',
    themesFixed: (process.env.AIMEAT_THEMES_FIXED ?? 'aimeat').trim() || 'aimeat',
    themesOffered: (process.env.AIMEAT_THEMES_OFFERED ?? '').trim(),
    themesDefault: (process.env.AIMEAT_THEMES_DEFAULT ?? 'aimeat').trim() || 'aimeat',
  };
}
