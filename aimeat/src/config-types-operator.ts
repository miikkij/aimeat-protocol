/**
 * @file src/config-types-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator identity block (OperatorConfig, OperatorType): who runs this node, as the
 *   privacy policy, the terms and a data processing agreement name them. Moved verbatim from
 *   config-types.ts, which re-exports both, so services/config-schema-operator.ts can name the keys
 *   without importing config-types.ts (that import closed a cycle through services/config-sealing.ts).
 * @structure OperatorType · OperatorConfig
 * @usage import type { OperatorConfig } from './config-types-operator.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Moved from config-types.ts unchanged.
 */

/**
 * Operator info rendered into the public privacy policy at `/v1/privacy`.
 * AIMEAT is open-source self-hostable -- every node operator becomes the
 * data controller for their node and MUST identify themselves on the policy.
 * Defaults are deliberately empty so unconfigured deployments fail loudly
 * (503 on the privacy page) rather than silently shipping the upstream
 * author's information.
 */
export type OperatorType = 'natural_person' | 'company' | 'organisation' | 'association';

export interface OperatorConfig {
  /** Legal name of the controller (person or org). */
  name: string;
  /** Controller type. Drives display strings ("a natural person" / "a company" ...). */
  type: OperatorType;
  /**
   * Business/registration identifier of the controller (Finnish Y-tunnus "NNNNNNN-N", VAT id,
   * company number — whatever the jurisdiction issues). Empty for a natural person. This is what
   * makes a node a COMPANY node: an ODPS listing's dataHolder, an invoice and a contract all need
   * the legal identity, and it belongs to whoever runs the node rather than to a separate object.
   */
  businessId: string;
  /** Postal address. GDPR requires a contact address for the controller. */
  address: string;
  /** Country of operation (e.g. "Finland"). Used in international-transfers section. */
  country: string;
  /** Primary privacy contact email. */
  email: string;
  /** Security contact email. Falls back to `email` when empty. */
  securityEmail: string;
  /** Hosting provider name (e.g. "Scaleway SAS"). */
  hostingName: string;
  /** Optional URL of the hosting provider for the privacy-page link. */
  hostingUrl: string;
  /** Hosting jurisdiction (e.g. "France (EU/EEA)"). */
  hostingLocation: string;
  /** Name of the national data-protection supervisory authority. */
  supervisoryName: string;
  /** URL of the supervisory authority (e.g. https://tietosuoja.fi). */
  supervisoryUrl: string;
  /** Effective date of the privacy policy (YYYY-MM-DD). */
  effectiveDate: string;
  /** When the policy text was last edited (YYYY-MM-DD). Empty falls back to effectiveDate. */
  policyUpdatedDate: string;
  /** Privacy policy version string. */
  policyVersion: string;
  /**
   * The data protection officer, or the person who answers data protection questions, as one line
   * ("Name, email"). Annex I of a data processing agreement names it (compliance-agreements-generate.ts).
   */
  dpoContact?: string;
  /** Who signs data processing agreements for the operator, and in which role. Annex I prints both. */
  signerName?: string;
  signerRole?: string;
  /**
   * The line at the foot of every mail this node sends, in place of "Sent by AIMEAT Protocol" and the
   * profile note under it ("AIMEAT · aimeat.io", a shop's own name). Empty keeps the default.
   */
  emailFooter?: string;
}
