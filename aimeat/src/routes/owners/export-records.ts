/**
 * @file src/routes/owners/export-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of the GDPR export (GET /v1/owners/:name/export, export.ts) that it did
 *   not carry until 2026-11-19 (feature audit 2026-11-19, item 4.2): the person's message threads
 *   and contacts, their companies and bookkeeping (invoices, vouchers, fiscal years), their outbound
 *   contacts and the mail sent to them, their agents' tasks with each task's events, their
 *   schedules, capabilities, installed packages, help questions, sharing groups, decision-model
 *   results and account events. The feature list promised "everything an account holds", and
 *   erasure already knew these stores (storage/erased-account-records.ts); the export did not.
 *
 *   SHAPE. Each record is given as the store holds it, because the export is for the person and for
 *   a program that takes their data elsewhere, and a renamed copy would drop whatever a later field
 *   adds. A message thread is the thread's summary with its messages; a task carries its events; a
 *   company carries its sending identity.
 *
 *   WHAT STAYS OUT. A company's mail password (only whether one is set, as every read shows it). A
 *   message attachment's bytes, like a stored file's: the attachment is named with its size and
 *   storage key, and the bytes are downloaded from their own endpoint.
 *
 *   SCOPE. Every read names the account's own GHII as the owner, so another account's rows are never
 *   read. A thread is the person's own mailbox copy (the other side keeps theirs).
 * @structure exportAccountRecords(storage, ghii, principals) · paged()
 * @usage
 *   const records = ghii ? await exportAccountRecords(storage, ghii, [ghii, ...agentGaiis]) : null;
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.2).
 */
import type { Storage } from '../../storage/interface.js';
import { toPublicSmtp } from '../../models/company-smtp-schemas.js';

/** Rows read per page. */
const PAGE = 500;
/** A ceiling on pages, so a store that ignores the offset cannot loop for ever. */
const MAX_PAGES = 2000;

/**
 * Every row of an offset-paged listing. The offset moves by what came back and the loop ends on an
 * empty page, so a store that caps a page below PAGE still gives every row.
 */
async function paged<T>(read: (limit: number, offset: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await read(PAGE, out.length);
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

/** The person's mailbox: each thread's summary and its messages, both directions. */
async function messageThreads(storage: Storage, ghii: string) {
  const out = [];
  for (const c of await storage.listConversations(ghii)) {
    const messages = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { messages: rows, total } = await storage.listConversation(ghii, c.conversationId, { page, perPage: PAGE });
      messages.push(...rows);
      if (rows.length < PAGE || page * PAGE >= total) break;
    }
    out.push({ ...c, messages });
  }
  return out;
}

/** Companies, each with its sending identity without the password. */
async function companies(storage: Storage, ghii: string) {
  const rows = await paged((limit, offset) => storage.listCompanies({ ownerGhii: ghii, limit, offset }));
  const out = [];
  for (const company of rows) {
    const smtp = await storage.getCompanySmtp(company.id);
    out.push({ ...company, smtp: smtp ? toPublicSmtp(smtp) : null });
  }
  return out;
}

/** The agents' tasks (filed under the owner), each with its events. */
async function agentTasks(storage: Storage, ghii: string) {
  const tasks = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { tasks: rows, total } = await storage.listAgentTasksByOwner(ghii, { page, perPage: PAGE });
    tasks.push(...rows);
    if (rows.length < PAGE || page * PAGE >= total) break;
  }
  const out = [];
  for (const task of tasks) {
    const events = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { events: rows, total } = await storage.listTaskEvents(task.id, { page, perPage: PAGE });
      events.push(...rows);
      if (rows.length < PAGE || page * PAGE >= total) break;
    }
    out.push({ ...task, events });
  }
  return out;
}

/** The decision model's results for the account, newest first (cursor-paged by time). */
async function aiDecisions(storage: Storage, ghii: string) {
  const out = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items } = await storage.listAiDecisions({ ownerGhii: ghii, limit: PAGE, ...(before ? { before } : {}) });
    out.push(...items);
    if (items.length < PAGE) break;
    before = items[items.length - 1].createdAt;
  }
  return out;
}

/** Sharing groups and the shares made to them, for the person and each agent. */
async function sharing(storage: Storage, principals: string[]) {
  const groups = [];
  const shares = [];
  for (const p of principals) {
    groups.push(...await storage.listSharingGroups(p));
    shares.push(...await storage.listGroupSharesByOwner(p));
  }
  return { groups, shares };
}

/** The account-level records the export did not carry before 2026-11-19. */
export async function exportAccountRecords(storage: Storage, ghii: string, principals: string[]) {
  const share = await sharing(storage, principals);
  return {
    message_threads: await messageThreads(storage, ghii),
    contacts: await storage.listContacts(ghii),
    companies: await companies(storage, ghii),
    invoices: await paged((limit, offset) => storage.listInvoices({ ownerGhii: ghii, limit, offset })),
    vouchers: await paged((limit, offset) => storage.listVouchers({ ownerGhii: ghii, limit, offset })),
    fiscal_years: await storage.listFiscalYears(ghii),
    outbound_contacts: await paged((limit, offset) => storage.listOutboundContacts({ ownerGhii: ghii, limit, offset })),
    outbound_messages: await paged((limit, offset) => storage.listOutboundMessages({ ownerGhii: ghii, limit, offset })),
    agent_tasks: await agentTasks(storage, ghii),
    scheduled_jobs: await storage.listScheduledJobs({ ownerScope: ghii }),
    capabilities: await storage.listCapabilitiesByOwner(ghii),
    package_instances: await paged(async (limit, offset) => (await storage.listInstances({ ownerGhii: ghii, limit, offset })).instances),
    help_questions: await storage.listHelpQuestionsByOwner(ghii, { limit: 100_000 }),
    sharing_groups: share.groups,
    group_shares: share.shares,
    ai_decisions: await aiDecisions(storage, ghii),
    account_events: [
      ...await paged((limit, offset) => storage.listAccountEvents({ ownerGhii: ghii, limit, offset })),
      ...await paged((limit, offset) => storage.listAccountEventArchive({ ownerGhii: ghii, limit, offset })),
    ],
  };
}
