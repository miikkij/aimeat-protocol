/**
 * @file subdomain-site.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for operator-managed subdomain → site mappings
 *              (subdomain_sites). A mapping serves a published app at the root of
 *              `<subdomain>.<apex>` or 301-redirects to an external URL.
 * @structure SubdomainSiteRepository — CRUD keyed by lowercase subdomain label.
 * @usage import type { SubdomainSiteRepository } from './repositories/subdomain-site.repository.js';
 * @version-history
 *   v1.1.0 — 2026-10-25 — updateSubdomainSite also writes `origin`, and listSubdomainSitesPage reads the
 *     table a bounded page at a time (secaudit2026oct22).
 *   v1.0.0 — 2026-06-12 — Initial: subdomain routing (operator-only management)
 */
import type { SubdomainSiteRecord } from '../interface.js';

export interface SubdomainSiteRepository {
  createSubdomainSite(site: SubdomainSiteRecord): Promise<SubdomainSiteRecord>;
  getSubdomainSite(subdomain: string): Promise<SubdomainSiteRecord | null>;
  listSubdomainSites(): Promise<SubdomainSiteRecord[]>;
  /**
   * One page of mappings in byte order of the label, those after `after` (keyset paging). `limit` is
   * held to 1..500. An empty page is the end.
   */
  listSubdomainSitesPage(query: { after?: string; limit: number }): Promise<SubdomainSiteRecord[]>;
  updateSubdomainSite(
    subdomain: string,
    updates: Partial<Pick<SubdomainSiteRecord, 'kind' | 'target' | 'enabled' | 'updatedAt' | 'origin'>>,
  ): Promise<SubdomainSiteRecord | null>;
  deleteSubdomainSite(subdomain: string): Promise<boolean>;
}
