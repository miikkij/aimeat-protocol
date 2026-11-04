/**
 * @file src/services/classification/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One import path for the classification family (TARGET-082): the labels, the
 *   policy, the reader every content read passes, the audience caps, the exceptions and the audit
 *   log. A module outside the family imports from here; the family's own files import each other
 *   by file, never through this index.
 *
 *   WHAT IS NOT HERE, AND WHY. The four files that act on the rest of the node live in
 *   services/classification-run/: the classifier and the scan call the AI, the audience settle
 *   writes organisms, apps and workspace shares, and the switch writes config. Each of those
 *   modules reads labels back, so with the four behind this index, a module that both imports this
 *   index and is reached from it would close an import cycle. An index over the whole family was
 *   tried in October 2026 and reverted because of that: it made 54 import cycles.
 *
 *   THE RULE THAT KEEPS IT SAFE. No file this index exports may reach, through run-time imports,
 *   a module outside the family that imports the family at run time. `pnpm check:family-index`
 *   refuses the change that breaks it and prints the path. A new file that needs such a module
 *   goes to services/classification-run/ and imports the family from here.
 * @structure export * from each of the family's 31 files
 * @usage
 *   import { ClassificationError, systemReader, type ClassificationLabel } from '../classification/index.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item D-g).
 */
export * from './audience-cap.js';
export * from './audience-levels.js';
export * from './audience.js';
export * from './audit.js';
export * from './classifier-state.js';
export * from './clearance.js';
export * from './containers.js';
export * from './default-caps-state.js';
export * from './default-caps.js';
export * from './defaults.js';
export * from './detect.js';
export * from './effective.js';
export * from './egress.js';
export * from './exception-admin.js';
export * from './exceptions.js';
export * from './explorer.js';
export * from './external-ai.js';
export * from './label-audience-fields.js';
export * from './label-core.js';
export * from './label-rows.js';
export * from './labels.js';
export * from './levels.js';
export * from './owner-scope-labels.js';
export * from './packs.js';
export * from './policy-admin.js';
export * from './policy.js';
export * from './present-memory.js';
export * from './reader-kind.js';
export * from './reader.js';
export * from './regex-safety.js';
export * from './system-record.js';
