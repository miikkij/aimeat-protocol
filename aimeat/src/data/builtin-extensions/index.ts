/**
 * @file src/data/builtin-extensions/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extensions this node SHIPS: installed at boot, updated when the shipped version
 *   is newer, and never a surprise to an owner who configured one.
 *
 *   Until 2026-09-06 nothing was seeded here — the Design Book seeds its parts, the cortexes are
 *   auto-installed and the built-in skills are kept in step, but an extension arrived only when
 *   somebody uploaded it. That is fine for an extension somebody chose and wrong for one a feature
 *   depends on: a living document written by an AI and opened by a person who has never seen the
 *   Extensions page cannot ask them to install its plumbing first.
 *
 *   A builtin is source in this directory rather than a file on disk, because everything in
 *   src/data is: `tsc` emits TypeScript and copies nothing, so a `.js` beside a `.ts` would be in
 *   the tree during development and missing from `dist`.
 * @structure
 *   - BuiltinExtension — the shape the seeder installs
 *   - BUILTIN_EXTENSIONS — the list
 * @usage
 *   import { BUILTIN_EXTENSIONS } from '../data/builtin-extensions/index.js';
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial, with living-hooks as its first entry.
 */
import { LIVING_HOOKS, type BuiltinExtension } from './living-hooks.js';

export type { BuiltinExtension } from './living-hooks.js';

/** Every extension this build ships. Order is install order; nothing here depends on anything else. */
export const BUILTIN_EXTENSIONS: BuiltinExtension[] = [LIVING_HOOKS];
