/**
 * @file src/services/aml/gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who does anti-money-laundering obliged work on this node, and the refusal the setting
 *   AIMEAT_AML_MODE makes (decision decision-aml-velvoitteet-ovat-operaattorin-aktivoima-tila):
 *     report  nothing is refused; the Compliance page lists the findings;
 *     none    neither the node nor its owners do obliged work: an organism's declaration that it is an
 *             obliged entity is refused with 403 AML_NOT_OFFERED;
 *     owners  an organism that declared itself an obliged entity does that work here;
 *     node    the operator is an obliged entity itself; owners' declarations are accepted too.
 *
 *   A DECLARATION THAT EXISTS STAYS. The refusal runs when a document is written, never on one already
 *   stored: a change of mode removes nothing, and the compliance report lists what is left as a
 *   finding for a person to decide. A write that keeps the same declarations it already had is not
 *   refused either, so a person can still record a review in an organism's document.
 * @structure AML_NOT_OFFERED · amlMode · AmlDeclarationAt · readAmlDeclarations · amlDocRefusal
 * @usage const refused = await amlDocRefusal(deps, scope, doc); if (refused) throw refused;
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AmlMode } from '../../config/data-access.js';
import { listDocs, readDoc, type ComplianceScope } from '../compliance/docs.js';
import type { AmlDeclaration, ComplianceDocs } from '../compliance/docs-schemas.js';

export const AML_NOT_OFFERED = 'AML_NOT_OFFERED';

/** The mode in force; the code default is `report`. */
export function amlMode(config: Pick<AimeatConfig, 'amlMode'> | null | undefined): AmlMode {
  return config?.amlMode ?? 'report';
}

/** One declaration with the scope that keeps it. */
export interface AmlDeclarationAt { scope: ComplianceScope; declaration: AmlDeclaration }

/** Every stored declaration, node's and organisms'. */
export async function readAmlDeclarations(storage: Storage, nodeId: string): Promise<AmlDeclarationAt[]> {
  const out: AmlDeclarationAt[] = [];
  for (const d of await listDocs(storage, nodeId, 'aml')) {
    for (const i of d.doc.items) if (i.type === 'declaration') out.push({ scope: d.scope, declaration: i });
  }
  return out;
}

const declarationIds = (doc: ComplianceDocs['aml']): string[] =>
  doc.items.filter(i => i.type === 'declaration').map(i => i.id).sort();

/**
 * The refusal for storing `next` as the `aml` document of `scope`, or null. Asked by the one write
 * path the REST route and the MCP tool share (services/compliance/docs-ops.ts).
 */
export async function amlDocRefusal(
  deps: { storage: Storage; config: Pick<AimeatConfig, 'amlMode' | 'nodeId'> },
  scope: ComplianceScope,
  next: ComplianceDocs['aml'],
): Promise<{ status: 403; code: typeof AML_NOT_OFFERED; message: string } | null> {
  if (amlMode(deps.config) !== 'none' || scope.kind !== 'organism') return null;
  const wanted = declarationIds(next);
  if (!wanted.length) return null;
  const stored = declarationIds(await readDoc(deps.storage, deps.config.nodeId, 'aml', scope));
  if (wanted.every(id => stored.includes(id))) return null;
  return {
    status: 403, code: AML_NOT_OFFERED,
    message: 'The operator has set that no one on this server is an anti-money-laundering obliged entity, so an organism cannot declare itself one here. '
      + 'Ask the operator (support@operators): the setting AIMEAT_AML_MODE decides it, and "owners" lets an organism be an obliged entity here. Declarations made before stay.',
  };
}
