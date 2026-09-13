/**
 * @file src/routes/knowledge/manifest-validator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one compiled validator for a knowledge package manifest.
 *
 *   IT IS SHARED BECAUSE IT WAS NOT. `POST /v1/knowledge/import` — the door an agent uses — built
 *   its manifest and ran it through this schema, so `maturity` outside 'draft' | 'review' |
 *   'published' was refused with the field named. `POST /v1/admin/knowledge/import` — the door the
 *   OPERATOR uses — assembled a manifest by hand and called storage.setMemory with it, checking
 *   only the name and the content type. The privileged path was the unvalidated one, which is the
 *   wrong way round: an operator's mistake lands in the catalogue with the node's own authority
 *   behind it.
 *
 *   Extracting it is also why there is now one compiled AJV instance rather than two: a schema
 *   compiled in two files is a schema that can be changed in one.
 * @structure validateManifest(manifest) — the AJV validator, with `.errors` after a failure
 * @usage
 *   import { validateManifest } from './manifest-validator.js';
 *   if (!validateManifest(manifest)) { … validateManifest.errors … }
 * @version-history
 *   v1.1.0 — 2026-09-13 — allErrors off: a refusal stops at the first problem instead of walking a
 *     caller-sized tree to collect every one.
 *   v1.0.0 — 2026-09-12 — Extracted from packages-core.ts so the operator's import uses it too.
 */
import ajvPkg from 'ajv';
import formatsPkg from 'ajv-formats';
import { ManifestSchema } from '../../schemas/knowledge-package.js';

const AjvClass = ajvPkg.default ?? ajvPkg;
const addFormats = formatsPkg.default ?? formatsPkg;

// allErrors STAYS OFF. AJV's own documentation says not to turn it on for data you did not write:
// with it, a manifest is walked to the end and one error object is built per bad element, so a
// 5 MB body of entries the schema refuses (the limit express.json allows on /v1/knowledge) turns a
// cheap first-error refusal into a walk of the whole tree and a response carrying thousands of
// error objects. CodeQL calls that js/resource-exhaustion-from-deep-object-traversal and was right.
// The cost is that a caller fixing a broken manifest sees the first problem rather than all of
// them. Ajv's own default is off; this line is here to say that it is deliberate.
const ajv = new AjvClass({ allErrors: false });
addFormats(ajv);

export const validateManifest = ajv.compile(ManifestSchema);
