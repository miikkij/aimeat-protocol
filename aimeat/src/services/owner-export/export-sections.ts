/**
 * @file src/services/owner-export/export-sections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Five sections of the GDPR export (GET /v1/owners/:name/export, export.ts) that it
 *   did not carry until 2026-10-15 (feature-list audit #160): the person's published apps, their AI
 *   provenance records, their outside-account connections, the messages between them and their
 *   agents, and the apps they took. The export right (GDPR Articles 15 and 20) covers all of it.
 *
 *   WHAT STAYS OUT. A connection's credential (the encrypted token) never leaves: the person cannot
 *   decrypt it, and anyone holding the node's key could. An app's bytes and a taken app's stored
 *   copy are not personal data and can be large; each app is named with its versions, and the bytes
 *   are downloaded from GET /v1/apps/:owner/:filename.
 * @structure exportExtraSections(storage, ghii, agentGaiis) → { published_apps, connections,
 *   app_purchases } · exportAgentMessages(storage, agentGaii)
 * @usage
 *   const extra = await exportExtraSections(storage, ghii, agentGaiis);
 *   const messages = await exportAgentMessages(storage, agent.gaii);
 * @version-history
 *   2026-11-26 — Moved from routes/owners/ to services/owner-export/ (no Express in it), and the AI
 *     provenance records left this file: account-sections.ts reads them by keyset pages
 *     (provenancePages), because the offset pages here with a count each took 108 s on the largest
 *     account (wish-owner-data-export-as-a-chosen-parts-background-job).
 *   2026-10-15 — Initial (feature-list audit #160).
 */
import type { Storage } from '../../storage/interface.js';

/** Rows read per page from a paged listing. Far above what one account holds in practice. */
const PAGE = 500;

/** The person's published apps: the latest manifest of each, with its version numbers. */
async function publishedApps(storage: Storage, owners: string[]) {
  const out = [];
  for (const ownerGaii of owners) {
    const { apps } = await storage.listApps({ ownerGaii, limit: 100_000 });
    for (const app of apps) {
      const versions = await storage.listAppVersionSizes(app.ownerGaii, app.filename);
      out.push({
        owner_gaii: app.ownerGaii,
        filename: app.filename,
        name: app.manifest?.name ?? null,
        description: app.manifest?.description ?? null,
        latest_version: app.versionNumber,
        versions: versions.map(v => ({ version: v.versionNumber, size: v.size, created_at: v.createdAt })),
        mime_type: app.mimeType,
        parked: !!app.parked,
        forkable: !!app.forkable,
        operator_hidden: !!app.operatorHidden,
        protected_by_access_code: !!app.accessCode,
        created_at: app.createdAt,
      });
    }
  }
  return out;
}

/** Outside-account connections, without the credential. */
async function connections(storage: Storage, principals: string[]) {
  const out = [];
  for (const principal of principals) {
    for (const c of await storage.listConnections({ principal })) {
      out.push({
        id: c.id, principal: c.principal, provider: c.provider, mode: c.mode, instance: c.instance,
        account_label: c.accountLabel, external_id: c.externalId, scopes: c.scopes, status: c.status,
        expires_at: c.expiresAt, last_ok_at: c.lastOkAt, last_error: c.lastError,
        provider_client_id: c.providerClientId, created_at: c.createdAt, updated_at: c.updatedAt,
      });
    }
  }
  return out;
}

/** Apps the person or their agents took, without the stored copy of the app. */
async function appPurchases(storage: Storage, buyers: string[]) {
  const seen = new Set<string>();
  const out = [];
  for (const buyer of buyers) {
    for (const p of await storage.listAppPurchasesByBuyer(buyer)) {
      if (seen.has(p.transactionId)) continue;
      seen.add(p.transactionId);
      out.push({
        transaction_id: p.transactionId, buyer_gaii: p.buyerGaii, seller_gaii: p.sellerGaii,
        app_filename: p.appFilename, app_name: p.appName, app_version: p.appVersionNumber,
        license_type: p.licenseType, toll_morsels: p.tollMorsels, purchased_at: p.purchasedAt,
      });
    }
  }
  return out;
}

/** Three of the account-level sections account-sections.ts yields beside `memories`. */
export async function exportExtraSections(storage: Storage, ghii: string | undefined, agentGaiis: string[]) {
  const all = ghii ? [ghii, ...agentGaiis] : agentGaiis;
  return {
    published_apps: await publishedApps(storage, all),
    connections: await connections(storage, all),
    app_purchases: await appPurchases(storage, all),
  };
}

/** The messages between the person and one agent, oldest last as the store orders them. */
export async function exportAgentMessages(storage: Storage, agentGaii: string) {
  const out = [];
  for (let page = 1; ; page++) {
    const { messages, total } = await storage.listMessages(agentGaii, { page, perPage: PAGE });
    for (const m of messages) {
      out.push({
        id: m.id, thread_id: m.threadId, direction: m.direction, sender: m.senderGaii, content: m.content,
        status: m.status, linked_task_id: m.linkedTaskId ?? null, created_at: m.createdAt, processed_at: m.processedAt ?? null,
      });
    }
    if (messages.length < PAGE || page * PAGE >= total) break;
  }
  return out;
}
