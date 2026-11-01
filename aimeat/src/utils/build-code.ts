/**
 * @file src/utils/build-code.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The format of the store's build code for a place (site.build_code): RK- and three
 *   groups of four Crockford base32 characters (0-9 and A-Z without I, L, O, U). A file of its own with
 *   no imports, so the config loader, the setting's check and the service read one pattern without an
 *   import cycle.
 * @structure BUILD_CODE
 * @usage if (BUILD_CODE.test(code)) …
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi").
 */

export const BUILD_CODE = /^RK-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
