/**
 * @file src/routes/owners/export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GDPR data export for one owner as one JSON answer: GET /v1/owners/:name/export. The
 *   sections and what each holds are read by services/owner-export/account-sections.ts; this route
 *   decides who may call it and writes the answer a piece at a time. For a large account the person
 *   chooses parts and gets ZIP files from the background export (routes/owners/exports.ts).
 * @structure registerOwnerExportRoute(router, config, storage)
 * @usage
 *   import { registerOwnerExportRoute } from './owners/export.js';
 *   registerOwnerExportRoute(router, config, storage);
 * @version-history
 *   2026-11-26 — The answer is written section by section and a list a page at a time
 *     (services/owner-export/json-stream.ts), with the sections read by account-sections.ts. One
 *     res.json() of the whole export passed V8's string limit on the largest account of a production
 *     node and answered 500 after 108 s; the AI provenance records are read by keyset pages now, which
 *     was most of those seconds. The answer's keys and order are unchanged
 *     (wish-owner-data-export-as-a-chosen-parts-background-job).
 *   2026-11-19 — Seventeen sections the export lacked (export-records.ts): `message_threads`,
 *     `contacts`, `companies`, `invoices`, `vouchers`, `fiscal_years`, `outbound_contacts`,
 *     `outbound_messages`, `agent_tasks`, `scheduled_jobs`, `capabilities`, `package_instances`,
 *     `help_questions`, `sharing_groups`, `group_shares`, `ai_decisions`, `account_events`. The
 *     existing sections are unchanged (feature audit 2026-11-19, item 4.2).
 *   2026-11-04 — `memories` carries the account's service namespace records after its own records
 *     (services/service-records.ts); none exist before a service writes one, so the export is unchanged
 *     until then (codebase analysis 2026-11-03, item B6).
 *   2026-10-23 — An export logs itself as a done data subject request in the node's request list
 *     (plan doc-mvlftkh9zmc9, C4.3).
 *   2026-10-15 — Five parts the export lacked (export-sections.ts): `published_apps`,
 *     `ai_provenance`, `connections` (never the credential), `app_purchases`, and per agent
 *     `messages` (feature-list audit #160).
 *   v2.1.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v2.0.0 — 2026-09-30 — Decided by Jouni 2026-09-30: this GDPR export takes the person's own
 *     organism records again (no leave(): the legal right to their own data), and names them in
 *     `classified_organism_content` { count, keys, note }. `left_out` is gone from this route; the
 *     ordinary export (GET /v1/memory/export, the bundle) keeps it.
 *   v1.9.0 — 2026-09-29 — TARGET-082 review: memory passes leave() with the destination `export`
 *     after show(), so an organism's record held under the person's or an agent's name stays
 *     behind; the answer names it in `left_out` ({ key, label, reason }).
 *   v1.8.0 — 2026-09-29 — Memory values pass presentMemories (classification reader + credential
 *     mask, TARGET-082).
 *   v1.7.0 — 2026-09-26 — `work_provided` and `work_requested` beside `memories`: the person's own
 *     work under their GHII, what they published and asked for in person, with the disputes on it.
 *   v1.6.0 — 2026-09-20 — A credential record is redacted here too (shownMemoryValue), for the owner's
 *     memories and their agents' alike. The person loses nothing: they cannot decrypt it, and the key
 *     itself lives at the provider.
 *   v1.5.0 — 2026-09-14 — requireLocalSession. requireOwnerPrincipal admits a federated login,
 *     which carries roles ['owner'] and the local part of the visitor's HOME name, so the name
 *     comparison matched the LOCAL account and a visitor exported everything it had ever stored.
 *   v1.4.0 — 2026-09-09 — The `listings`, `purchases` and per-agent `escrow_holds` sections are gone
 *     with the storage methods behind them.
 *   v1.3.0 — 2026-09-08 — Three sections that existed for values nothing produced (organism
 *     memberships, flags filed, the consent audit's pending buffer). All three found by e2e-owner-export.
 *   v1.2.0 — 2026-08-29 — The owner's OWN memory entries and storage files are in the export.
 *   v1.1.0 — 2026-08-11 — Security audit H-1/H-7: behind requireOwnerPrincipal().
 *   v1.0.0 — 2026-08-07 — Extracted from routes/owners.ts (max-file-lines).
 */
import type { Router, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireLocalSession } from '../../auth/middleware.js';
import { error, success } from '../../middleware/envelope.js';
import { readerFor } from '../../services/classification/reader.js';
import { isOperatorCaller, operatorOverride } from '../../services/operator/override.js';
import { ownerExportSections } from '../../services/owner-export/account-sections.js';
import { sectionsAsJsonObject } from '../../services/owner-export/json-stream.js';
import { appendRequest } from '../../services/compliance/docs.js';
import { logger } from '../../utils/logger.js';

/** Pieces are gathered to about this many characters before one write, so a page of small rows is one write. */
const WRITE_CHUNK = 64 * 1024;

/** Write the pieces to the response, waiting whenever the socket asks it to. */
async function writeAll(res: Response, pieces: AsyncIterable<string>): Promise<void> {
  let buf = '';
  const flush = async (): Promise<void> => {
    if (!buf) return;
    const ok = res.write(buf);
    buf = '';
    if (!ok) await new Promise<void>((resolve, reject) => {
      const done = (): void => { res.off('drain', done); res.off('close', closed); resolve(); };
      const closed = (): void => { res.off('drain', done); reject(new Error('the client closed the connection')); };
      res.once('drain', done);
      res.once('close', closed);
    });
  };
  for await (const piece of pieces) {
    buf += piece;
    if (buf.length >= WRITE_CHUNK) await flush();
  }
  await flush();
}

/** Mount GET /v1/owners/:name/export on an existing router. */
export function registerOwnerExportRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/owners/:name/export — GDPR data export (account holder or operator), every section the
  // account holds in one JSON answer.
  //
  // requireLocalSession for the same reason the deletion route has it: a federated login mints
  // `owner` as the local part of the visitor's HOME name with roles ['owner'], so
  // requireOwnerPrincipal admitted a visitor called `alice` and the name comparison below matched
  // the LOCAL alice. Found by the AI triage of 2026-09-13.
  router.get('/v1/owners/:name/export', requireAuth(), requireLocalSession(), requireOwnerPrincipal(), async (req, res) => {
    const name = req.params.name as string;
    // The operator half asks isOperatorCaller, as the MCP tools do. The operator trail is written once
    // the account is known to exist, so a mistyped name leaves no row in a feed that a later account of
    // that name would inherit.
    const own = req.auth!.owner === name;
    if (!own && !(await isOperatorCaller(storage, req.auth))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only export your own data'));
      return;
    }
    const owner = await storage.getOwner(name);
    if (!owner) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner not found: ${name}`));
      return;
    }
    if (!own && !(await operatorOverride(storage, config, req.auth, { ownerOf: name, area: 'account', action: 'export', subject: name }))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only export your own data'));
      return;
    }

    // The envelope as success() writes it, opened before `data` and closed after it, so the answer is
    // the same JSON a res.json() wrote, written a section at a time.
    const marker = '\u0000aimeat-export-data\u0000';
    const envelope = JSON.stringify(success(config.nodeId, marker));
    const at = envelope.indexOf(JSON.stringify(marker));
    const prefix = `${envelope.slice(0, at)}{`;
    const suffix = `}${envelope.slice(at + JSON.stringify(marker).length)}`;

    // The export is an access and portability request the node answered (GDPR art. 15 and 20): it
    // logs itself in the node's request list (plan doc-mvlftkh9zmc9, C4.3), before the answer as always.
    const answeredAt = new Date().toISOString();
    await appendRequest(storage, config.nodeId, { kind: 'node' }, {
      kind: 'portability', subject: name, receivedAt: answeredAt, status: 'done', closedAt: answeredAt,
      channel: 'node', auto: true, ...(own ? {} : { notes: 'Exported by the operator.' }),
    }).catch(err => logger.warn('export: the export was not logged as a data subject request', { name, error: String(err) }));

    const sections = ownerExportSections({ storage, config }, {
      name, owner, reader: readerFor({ storage, config }, req.auth), memories: true, provenance: true,
    });
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // A large answer is not held by a buffering reverse proxy (nginx reads this header).
    res.setHeader('X-Accel-Buffering', 'no');
    try {
      await writeAll(res, sectionsAsJsonObject(sections, prefix, suffix));
      res.end();
    } catch (err) {
      // The status line is sent, so a failure can only end the connection: the client sees a cut
      // answer, never a whole one that lacks a section.
      logger.error('export: the export stopped before its end', { name, error: String(err) });
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
