/**
 * @file public/views/profile/organisms/workspace/color-picker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The colour tag of a workspace section, document or record. The picker is the library's
 *   ColorPicker (components/ColorPicker.js); this module re-exports it under its old path, which the
 *   design lab still imports.
 * @structure ColorPicker (re-export)
 * @usage import { ColorPicker } from '/components/ColorPicker.js';
 * @version-history
 *   v2.0.0 — 2026-09-26 — The picker is components/ColorPicker.js with its own sheet names; this file
 *     only re-exports it (page migration G2b).
 *   v1.0.0 — 2026-07-13 — Extracted from workspace.js (max-file-lines)
 */
export { ColorPicker } from '/components/ColorPicker.js';
