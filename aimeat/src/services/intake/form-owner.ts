/**
 * @file src/services/intake/form-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The identity a public intake form writes its submissions as: the identity that stored
 *   the form's config record, never a name inside the config value.
 *
 *   WHY. POST /v1/intake/forms stores the config record under the definer's identity and writes the
 *   same identity into the value as `ownerGhii` (routes/organisms/intake.ts). The public submit and the
 *   conversation routes took `ownerGhii` from the value. Two writers put another account's name there:
 *   a workspace manager's plain memory write of `organism.<org>.w.<ws>.meta.intake.<formId>`, and a
 *   workspace or organism import, which restores meta.* objects as they are in the archive under the
 *   importer's identity. Every submission was then written as the named account, in a workspace it may
 *   not belong to and against its memory budget, and the files the record linked that the named account
 *   controls were opened to the workspace (secaudit2026nov08b round 15,
 *   routes/organisms/intake:form-config-ownerGhii-trusted-from-stored-value).
 *
 *   THE RULE. A form's owner is its config record's owner (`ownerGaii`). For a form defined through
 *   POST /v1/intake/forms the two are the same identity, so nothing changes. A config another writer
 *   stored writes as that writer: a manager's own write as the manager, a restored form as its
 *   importer, which is what an owner restoring their own backup gets as well.
 * @structure IntakeFormRecordValue · formConfigOfRecord
 * @usage const cfg = formConfigOfRecord<IntakeFormConfig>(await readWorkspaceMetaRecord(...));
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import type { MemoryRecord } from '../../storage/interface.js';

/** The part of a form config this rule reads. */
export interface IntakeFormRecordValue { ownerGhii: string }

/**
 * A form config as its readers use it: the stored value with `ownerGhii` set to the identity that
 * stored the record. null for no record or a value that is not an object.
 */
export function formConfigOfRecord<T extends IntakeFormRecordValue>(rec: Pick<MemoryRecord, 'ownerGaii' | 'value'> | null | undefined): T | null {
  const v = rec?.value;
  if (!rec || !v || typeof v !== 'object' || Array.isArray(v)) return null;
  return { ...(v as unknown as T), ownerGhii: rec.ownerGaii };
}
