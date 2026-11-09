/**
 * @file erased-account-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 28 identity columns an account erasure left as they were, and what each one gets
 *   now: the row is deleted with the account, or it stays for somebody else and names the erased
 *   person by the erasure's pseudonym (erased-party.ts). Both storage providers run this one list from
 *   their owner cascade, so the rule cannot drift between them.
 *
 *   WHY. A deleted username is released for reuse (decision 2026-08-10). A row that kept `name@node`
 *   in one of these columns belonged to whoever registered the name next: the inbox, the usage
 *   history, the company and its books, a mail server password, the packages installed. The columns
 *   were listed in security/storage-owner-relations.json with the decision "required" since
 *   2026-09-27 (QA audit 2026-10-14, K3; findings P3-02 and F15-01).
 *
 *   THE RULE. A row that is only this person's own is deleted: their mailbox copies, usage meters,
 *   account events, contact permissions, outbound lists and messages, their mail server credential and
 *   their package installations. A row somebody else still needs, or that the law keeps, stays and
 *   names the person by the pseudonym: bookkeeping (invoices, vouchers, fiscal years, number series)
 *   and the company it belongs to, which accounting law keeps for years after the account; and the
 *   attribution on things that outlive their author (an organism, a shared conversation, a workspace
 *   row, a shared MCP server, a sign-in connection, a published package, a review or discussion, a
 *   component version, a publish attempt, a realtime room, a subdomain site). Pseudonymised rows are
 *   no longer readable through the name, so the next holder of the name inherits none of them.
 *
 *   One pseudonym value per identity of the person (`<pseudonym>`, `<pseudonym>.1`, …), as the
 *   classification audit does, so two identities of one person cannot meet on a unique key such as
 *   FinanceVoucher (ownerGhii, fiscalYearId, voucherNumber).
 * @structure ErasedAccountRecordRule · ERASED_ACCOUNT_RECORDS · erasedIdentities(name, ghiis, actors) ·
 *   RECEIVER_PRINCIPAL_COLUMNS · receiverPrincipalPatterns(name, ghiis)
 * @usage
 *   for (const rule of ERASED_ACCOUNT_RECORDS) { … rule.pg or rule.sqlite, rule.column, rule.action }
 * @version-history
 *   v1.3.0 — 2026-11-08 — The person's receiver principals (`receiver:<name>/<receiver>@<node>`), found
 *     in the row and classification-audit columns a receiver writes, are pseudonymised like the
 *     agents (RECEIVER_PRINCIPAL_COLUMNS, receiverPrincipalPatterns; secaudit2026nov08b round 15).
 *   v1.2.0 — 2026-10-25 — ReleasedComponentName.holder, pseudonymised: the next holder of an account
 *     name does not inherit the bare extension and cortex names the erased account released (owner
 *     namespaces wish, secaudit2026oct22).
 *   v1.1.0 — 2026-10-22 — WorkspaceRow.updatedBy and the three writer columns of WorkspaceRowRevision,
 *     pseudonymised like WorkspaceRow.createdBy (secaudit 2026-10, v80).
 *   v1.0.0 — 2026-10-14 — Initial: the 28 relations left "required" (QA audit 2026-10-14, K3).
 */

export interface ErasedAccountRecordRule {
  /** The table name on Postgres. */
  pg: string;
  /** The same table on SQLite. */
  sqlite: string;
  /** The identity column, the same name on both providers. */
  column: string;
  /** delete: the row goes with the account. pseudonymise: the row stays and names the erasure's pseudonym. */
  action: 'delete' | 'pseudonymise';
}

/** In the order security/storage-owner-relations.json lists them. */
export const ERASED_ACCOUNT_RECORDS: readonly ErasedAccountRecordRule[] = [
  // Attribution on a shared server, connection or workspace row: the thing belongs to a node or an organism.
  { pg: 'McpServer', sqlite: 'mcp_servers', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'SsoConnection', sqlite: 'sso_connections', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'WorkspaceRow', sqlite: 'workspace_rows', column: 'createdBy', action: 'pseudonymise' },
  // A row's last writer and its kept revisions name people the same way (secaudit 2026-10, v80).
  { pg: 'WorkspaceRow', sqlite: 'workspace_rows', column: 'updatedBy', action: 'pseudonymise' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'updatedBy', action: 'pseudonymise' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'replacedBy', action: 'pseudonymise' },
  // Version and publication history.
  { pg: 'ComponentVersion', sqlite: 'component_versions', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'PublishAttempt', sqlite: 'publish_attempts', column: 'publisher', action: 'pseudonymise' },
  // The account's own usage meters and account events.
  { pg: 'UsageCall', sqlite: 'usage_calls', column: 'ownerGhii', action: 'delete' },
  { pg: 'UsageCallArchive', sqlite: 'usage_calls_archive', column: 'ownerGhii', action: 'delete' },
  { pg: 'UsageRollup', sqlite: 'usage_rollup', column: 'ownerGhii', action: 'delete' },
  { pg: 'AccountEvent', sqlite: 'account_events', column: 'ownerGhii', action: 'delete' },
  { pg: 'AccountEventArchive', sqlite: 'account_events_archive', column: 'ownerGhii', action: 'delete' },
  // Bookkeeping, which accounting law keeps: it stays, without the name.
  { pg: 'FinanceInvoice', sqlite: 'finance_invoices', column: 'ownerGhii', action: 'pseudonymise' },
  { pg: 'FinanceVoucher', sqlite: 'finance_vouchers', column: 'ownerGhii', action: 'pseudonymise' },
  { pg: 'FinanceFiscalYear', sqlite: 'finance_fiscal_years', column: 'ownerGhii', action: 'pseudonymise' },
  { pg: 'FinanceCounter', sqlite: 'finance_counters', column: 'ownerGhii', action: 'pseudonymise' },
  { pg: 'Company', sqlite: 'companies', column: 'ownerGhii', action: 'pseudonymise' },
  // A live mail credential, and the person's outbound contacts and messages.
  { pg: 'CompanySmtp', sqlite: 'company_smtp', column: 'ownerGhii', action: 'delete' },
  { pg: 'OutboundContact', sqlite: 'outbound_contacts', column: 'ownerGhii', action: 'delete' },
  { pg: 'OutboundMessage', sqlite: 'outbound_messages', column: 'ownerGhii', action: 'delete' },
  // The person's mailbox copies and contact permissions. The other side keeps its own copy.
  { pg: 'ContactConsent', sqlite: 'contact_consents', column: 'ownerGhii', action: 'delete' },
  { pg: 'DirectMessage', sqlite: 'direct_messages', column: 'ownerGhii', action: 'delete' },
  // Things that outlive their creator or author.
  { pg: 'Conversation', sqlite: 'conversations', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'Organism', sqlite: 'organisms', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'Package', sqlite: 'packages', column: 'authorGhii', action: 'pseudonymise' },
  { pg: 'TemplateDiscussion', sqlite: 'template_discussions', column: 'authorGhii', action: 'pseudonymise' },
  { pg: 'TemplateReview', sqlite: 'template_reviews', column: 'authorGhii', action: 'pseudonymise' },
  // An installation is the account's own.
  { pg: 'PackageInstance', sqlite: 'package_instances', column: 'ownerGhii', action: 'delete' },
  // Shared published resources: the creator's identity must not pass to the next holder of the name.
  { pg: 'RealtimeRoom', sqlite: 'realtime_rooms', column: 'createdBy', action: 'pseudonymise' },
  { pg: 'SubdomainSite', sqlite: 'subdomain_sites', column: 'createdBy', action: 'pseudonymise' },
  // A released bare extension or cortex name: only its holder reinstalls under it, so the next holder
  // of the account name must not inherit it (services/component-address.ts).
  { pg: 'ReleasedComponentName', sqlite: 'released_component_names', column: 'holder', action: 'pseudonymise' },
];

/**
 * Every value one of these columns may hold for the person, each with the pseudonym it becomes: the
 * bare name, each GHII, and each agent or ecosystem app acting for them. The first identity takes the
 * pseudonym itself and every other one `<pseudonym>.<n>`.
 */
export function erasedIdentities(name: string, ghiis: string[], actors: string[], pseudonym: string): Array<{ identity: string; replacement: string }> {
  return [...new Set([...ghiis, name, ...actors])].map((identity, i) => ({ identity, replacement: i ? `${pseudonym}.${i}` : pseudonym }));
}

/**
 * The columns a receiver of the person writes its principal into (`receiver:<name>/<receiver>@<node>`,
 * services/receivers/contract.ts receiverPrincipalOf): the rows it appends to a row space and their
 * kept revisions (services/receivers/receive.ts runSpace), and the classification audit of what it
 * read back (it reads as its principal). A receiver is a service record that the erasure removes, and
 * one deleted before the account left its rows as well, so the values are found in these columns,
 * not in a table of receivers. The principal holds the bare account name, which is released for reuse,
 * so a later account's receiver of the same name had the same principal and took the rows as its own
 * (secaudit2026nov08b round 15, receiver-principal-not-pseudonymised).
 */
export const RECEIVER_PRINCIPAL_COLUMNS: ReadonlyArray<Pick<ErasedAccountRecordRule, 'pg' | 'sqlite' | 'column'>> = [
  { pg: 'WorkspaceRow', sqlite: 'workspace_rows', column: 'createdBy' },
  { pg: 'WorkspaceRow', sqlite: 'workspace_rows', column: 'updatedBy' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'createdBy' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'updatedBy' },
  { pg: 'WorkspaceRowRevision', sqlite: 'workspace_row_revisions', column: 'replacedBy' },
  { pg: 'ClassificationAudit', sqlite: 'classification_audit', column: 'reader' },
];

/** LIKE has its own wildcards. A stored identity must match itself and nothing wider. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

/**
 * LIKE patterns, escaped with a backslash, for every receiver principal of the person:
 * `receiver:<name>/<any receiver>@<node>` for the node of each GHII. An account name holds no '/', so
 * the pattern cannot reach another account's receivers.
 */
export function receiverPrincipalPatterns(name: string, ghiis: string[]): string[] {
  const nodes = [...new Set(ghiis.map(g => g.slice(g.lastIndexOf('@') + 1)).filter(Boolean))];
  return nodes.map(node => `receiver:${escapeLike(name)}/%@${escapeLike(node)}`);
}
