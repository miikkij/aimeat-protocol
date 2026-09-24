/**
 * @file src/config-themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's choices about the look of the node's own interface (Themes & Styles):
 *   whether people choose, which themes are available to them, and the default theme (Jouni,
 *   2026-09-23: the operator configures "voiko jokainen käyttäjä valita oman teemansa vai onko joku
 *   tietty teema vain käytössä. sekä operaattori voi valita mitkä teemat on valittavissa
 *   käyttäjille"; 2026-09-24: "yhden teeman operaattori valitsee defaultiksi"). Which styles of a
 *   theme the pill offers, and its default style, live in the theme itself.
 *
 *   Its own file because config.ts and config-types.ts are at the line ceiling. The values are theme
 *   ids; services/themes/service.ts drops one that names no live theme, so the defaults are safe on a
 *   node that has made no theme of its own.
 * @structure ThemesConfig · themesDefaults()
 * @usage import { themesDefaults } from './config-themes.js';  const config = { ...themesDefaults(), … };
 * @version-history
 *   v2.0.0 — 2026-09-24 — Theme ids, not style ids; themesFixed folded into themesDefault (07 "Data").
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */

export interface ThemesConfig {
  /** People choose in the pill. Off: every page wears the default theme in its default style. */
  themesPersonalChoice: boolean;
  /** Comma-separated theme ids available to people; empty means the built-in AIMEAT theme only. */
  themesOffered: string;
  /** The theme a person sees before choosing, and the one everybody sees when people do not choose. */
  themesDefault: string;
}

export function themesDefaults(): ThemesConfig {
  return {
    themesPersonalChoice: process.env.AIMEAT_THEMES_PERSONAL_CHOICE !== 'false',
    themesOffered: (process.env.AIMEAT_THEMES_OFFERED ?? '').trim(),
    themesDefault: (process.env.AIMEAT_THEMES_DEFAULT ?? 'aimeat').trim() || 'aimeat',
  };
}
