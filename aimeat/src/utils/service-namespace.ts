/**
 * @file src/utils/service-namespace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The name of an account's service namespace, `svc:<owner>@<node>`: where the services
 *   of this node keep records for that account (services/service-records.ts). No principal resolves
 *   to it, because an owner name and an agent name are lowercase letters, digits and hyphens
 *   (utils/gaii.ts), so the `svc:` form can never be a caller's own identity, and localAccountName
 *   reads it as no account (`svc:alice`). The memory routes that take a namespace from the caller ask
 *   isServiceNamespace and refuse it (utils/own-door-keys.ts, services/memory-bin.ts).
 * @structure SERVICE_NAMESPACE_PREFIX · serviceNamespaceOf(ownerGhii) · isServiceNamespace(id) ·
 *   ownerOfServiceNamespace(id)
 * @usage import { isServiceNamespace } from '../utils/service-namespace.js';
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B6).
 */
import { isValidGHII } from './gaii.js';

/** What every service namespace starts with. No principal's identity can start with it. */
export const SERVICE_NAMESPACE_PREFIX = 'svc:';

/** The service namespace of the account `ownerGhii` (`alice@node`). Throws for anything else. */
export function serviceNamespaceOf(ownerGhii: string): string {
  if (typeof ownerGhii !== 'string' || !isValidGHII(ownerGhii)) {
    throw new Error(`A service namespace belongs to an account identity (name@node), not to "${String(ownerGhii)}"`);
  }
  return `${SERVICE_NAMESPACE_PREFIX}${ownerGhii}`;
}

/** True iff `id` names a service namespace. */
export function isServiceNamespace(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(SERVICE_NAMESPACE_PREFIX);
}

/** The account identity whose service namespace `id` is, or null when `id` is none. */
export function ownerOfServiceNamespace(id: unknown): string | null {
  if (!isServiceNamespace(id)) return null;
  const ghii = (id as string).slice(SERVICE_NAMESPACE_PREFIX.length);
  return isValidGHII(ghii) ? ghii : null;
}
