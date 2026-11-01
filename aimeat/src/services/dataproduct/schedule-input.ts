/**
 * @file src/services/dataproduct/schedule-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a `dataproduct` schedule's input must be before it is stored: `{ name }`, naming
 *   a data product definition of the owner (plan doc-mvwxcas3dom3, D9.5). A leaf, as the refinery's
 *   is: services/schedule-write.ts imports it, and the build itself reaches back into the scheduler's
 *   neighbours.
 * @structure DATAPRODUCT_RUN_SCOPES · DATAPRODUCT_SCHEDULE_KIND · checkDataproductScheduleInput
 * @usage const bad = await checkDataproductScheduleInput(storage, ownerScope, body.input);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.5).
 */
import type { Storage } from '../../storage/interface.js';
import { PACKAGE_NAME_RE } from '../datapackage/contract.js';

/** The schedule kind that builds one data product on each fire. */
export const DATAPRODUCT_SCHEDULE_KIND = 'dataproduct' as const;

/** The words a build spends: the bytes of the package and its catalogue entry, as a publish asks. */
export const DATAPRODUCT_RUN_SCOPES = ['storage:write', 'memory:write'] as const;

/** The input names a product the owner has defined; checked on create and on edit. */
export async function checkDataproductScheduleInput(
    storage: Storage, ownerScope: string, raw: unknown,
): Promise<{ status: number; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string } | null> {
    const given = (raw as { name?: unknown } | null)?.name;
    const name = typeof given === 'string' ? given.trim() : '';
    if (!PACKAGE_NAME_RE.test(name)) {
        return { status: 400, code: 'INVALID_INPUT', message: 'input.name names the data product: lowercase letters, digits and dashes (the definition is dataproducts.<name>).' };
    }
    if (!(await storage.getMemory(ownerScope, `dataproducts.${name}`))) {
        return { status: 404, code: 'NOT_FOUND', message: `There is no data product definition at dataproducts.${name}.` };
    }
    return null;
}
