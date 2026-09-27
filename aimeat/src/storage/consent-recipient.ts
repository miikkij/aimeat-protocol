/**
 * @file consent-recipient.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure consent-recipient matching and summary shared by storage and services.
 * @structure matchesRecipient; countConsentRecipients
 * @version-history 1.0.0 2026-09-27 Extract existing behavior without transport dependencies.
 */
import { globMatchSimple } from './pattern-utils.js';

/**
 * Check whether a consent record's recipient field matches a given accessor.
 *
 * Supported recipient patterns:
 * - `*`                      — wildcard, matches any accessor
 * - exact GAII               — matches only that specific GAII
 * - `ghii:username@node`     — matches all agents owned by that GHII user on that node
 * - `domain:*.pattern`       — matches all agents whose home node matches the glob
 * - `node:node-id`           — matches all agents on a specific node
 * - `organism.{id}`          — placeholder (requires async lookup, handled separately)
 */
export function matchesRecipient(
  recipient: string,
  accessorGaii: string,
  accessorOwner: string,
  accessorNode: string,
): boolean {
  // Wildcard — everyone
  if (recipient === '*') return true;

  // Exact GAII match
  if (recipient === accessorGaii) return true;

  // GHII user — all agents under this human identity on a specific node
  if (recipient.startsWith('ghii:')) {
    const ghii = recipient.slice(5); // "username@node"
    const atIdx = ghii.lastIndexOf('@');
    if (atIdx === -1) return false;
    const username = ghii.slice(0, atIdx);
    const node = ghii.slice(atIdx + 1);
    return accessorOwner === username && accessorNode === node;
  }

  // Domain glob — match accessor's home node ID
  if (recipient.startsWith('domain:')) {
    const pattern = recipient.slice(7); // "*.health-network.fi"
    return globMatchSimple(pattern, accessorNode);
  }

  // Specific node — all agents on that node
  if (recipient.startsWith('node:')) {
    const nodeId = recipient.slice(5);
    return accessorNode === nodeId;
  }

  // Organism membership — not handled here (requires async storage lookup)
  // The storage layer should handle organism.{id} patterns separately
  if (recipient.startsWith('organism.')) {
    return false; // Placeholder — resolved at storage layer
  }

  return false;
}

export function countConsentRecipients(consents: readonly { recipient: string }[]) {
  const byType = { wildcard: 0, gaii: 0, ghii: 0, organism: 0, domain: 0, node: 0 };
  for (const c of consents) {
    if (c.recipient === '*') byType.wildcard++;
    else if (c.recipient.startsWith('ghii:')) byType.ghii++;
    else if (c.recipient.startsWith('organism.')) byType.organism++;
    else if (c.recipient.startsWith('domain:')) byType.domain++;
    else if (c.recipient.startsWith('node:')) byType.node++;
    else byType.gaii++;
  }
  return byType;
}
