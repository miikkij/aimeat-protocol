/**
 * @file src/services/compliance/regulated-ai-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 14 of the compliance report: what AI models outside this server got of the
 *   regulated data domains (plan doc-mwnnp9xz9814, feature audit item 1.3). The operator's mode per
 *   domain with what the law row suggests, and the marks the content reader wrote in the period
 *   (classification/regulated-gate.ts): content that went (notify, protect, drop, or by an exception), what
 *   was held back, and every attempt on block content while an exception was in force, which is
 *   marked as exceptional and opened nothing.
 *
 *   WHERE THE MARKS ARE: the classification audit, action `regulated` for what went, `refused` and
 *   `exception` with a purpose that starts `regulated ` for the others. The audit is kept as long as
 *   the classification policy's retention says, so a period older than that reads empty, and the
 *   section says how long that is.
 *
 *   BOTH RINGS. The operator's report reads every mark; an owner's slice only the marks of content
 *   that is theirs (the audit row's owner).
 * @structure RegulatedAiSection · buildRegulatedAiSection()
 * @usage const regulated_ai = await buildRegulatedAiSection({ storage, config }, { since, ownerGhii });
 * @version-history
 *   v1.0.1 — 2026-11-21 — The mode drop counts as content that went.
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3).
 */
import type { Storage, ClassificationAuditRow } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { aiModesOf, COMPLIANCE_DOMAINS, type RegulatedAiMode } from '../../data/compliance-domains.js';
import { listClassificationAuditMerged } from '../classification/audit.js';
import { logger } from '../../utils/logger.js';

/** How many rows of each kind the section lists; the counts cover every row read. */
const LISTED = 50;
/** The most audit rows of each action read for one report. */
const READ_LIMIT = 1000;

export interface RegulatedAiMarkRow {
  at: string;
  action: 'regulated' | 'refused' | 'exception';
  domains: string;
  reader: string;
  reader_kind: string;
  scope: string;
  key: string;
  count: number;
  what: string;
}

export interface RegulatedAiSection {
  setting: {
    path: 'compliance.regulated_ai_modes';
    modes: Array<{ domain: string; name: string; mode: RegulatedAiMode; law_suggests_local: boolean }>;
    /** Domains whose law row suggests only a local model while their mode is more open. */
    suggestions: Array<{ domain: string; mode: RegulatedAiMode; suggested: 'local'; why: string }>;
  };
  marks: {
    from: string;
    to: string;
    /** How many items went to an outside model (notify, protect, drop, or by an exception). */
    sent: number;
    /** How many were held back. */
    held: number;
    /** Attempts on block content while an exception was in force: marked as exceptional, nothing opened. */
    exceptional: number;
    recent: RegulatedAiMarkRow[];
    exceptional_rows: RegulatedAiMarkRow[];
    /** True when a kind had more rows than the report reads: the counts are a lower bound then. */
    truncated: boolean;
    /** True when the marks could not be read: the counts are not known. */
    unavailable?: boolean;
  };
  note: string;
}

const isRegulated = (r: ClassificationAuditRow) => r.action === 'regulated' || (r.purpose ?? '').startsWith('regulated ');

function rowOf(r: ClassificationAuditRow): RegulatedAiMarkRow {
  const purpose = r.purpose ?? '';
  const colon = purpose.indexOf(': ');
  return {
    at: r.lastAt, action: r.action as RegulatedAiMarkRow['action'],
    domains: r.label.startsWith('domain:') ? r.label.slice('domain:'.length).split('+').join(', ') : r.label,
    reader: r.reader, reader_kind: r.readerKind, scope: r.scope, key: r.key, count: r.count,
    what: colon >= 0 ? purpose.slice(colon + 2) : purpose,
  };
}

export async function buildRegulatedAiSection(
  deps: { storage: Storage; config: Pick<AimeatConfig, 'regulatedAiModes'> },
  window: { from: string; to: string; ownerGhii?: string },
): Promise<RegulatedAiSection> {
  const modes = aiModesOf(deps.config.regulatedAiModes);
  const setting: RegulatedAiSection['setting'] = {
    path: 'compliance.regulated_ai_modes',
    modes: COMPLIANCE_DOMAINS.map(d => ({ domain: d.id, name: d.name.en, mode: modes[d.id] ?? 'notify', law_suggests_local: d.externalAi === 'refused' })),
    suggestions: COMPLIANCE_DOMAINS
      .filter(d => d.externalAi === 'refused' && (modes[d.id] ?? 'notify') !== 'local' && modes[d.id] !== 'block')
      .map(d => ({ domain: d.id, mode: modes[d.id] ?? 'notify', suggested: 'local' as const,
        why: `${d.name.en} falls under ${d.laws.join(', ')}; the law row suggests that only a model on this server reads it.` })),
  };
  const filter = { since: window.from, limit: READ_LIMIT, ...(window.ownerGhii ? { ownerGaii: window.ownerGhii } : {}) };
  let read: ClassificationAuditRow[][];
  try {
    read = await Promise.all((['regulated', 'refused', 'exception'] as const)
      .map(action => listClassificationAuditMerged(deps.storage, { ...filter, action })));
  } catch (err) {
    // The rest of the report stands without this section's marks, and the section says they are missing.
    logger.warn('compliance: the marks of the regulated data domains could not be read for the report', { error: String(err) });
    return {
      setting,
      marks: { from: window.from, to: window.to, sent: 0, held: 0, exceptional: 0, recent: [], exceptional_rows: [], truncated: false, unavailable: true },
      note: 'The marks could not be read for this report, so the counts are not known; the setting above is current.',
    };
  }
  const [sent, refused, exceptions] = read as [ClassificationAuditRow[], ClassificationAuditRow[], ClassificationAuditRow[]];
  const inWindow = (r: ClassificationAuditRow) => isRegulated(r) && r.lastAt <= window.to;
  const s = sent.filter(inWindow);
  const h = refused.filter(inWindow);
  const x = exceptions.filter(inWindow);
  const total = (rows: ClassificationAuditRow[]) => rows.reduce((n, r) => n + (r.count || 1), 0);
  const recent = [...s, ...h].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, LISTED).map(rowOf);
  return {
    setting,
    marks: {
      from: window.from, to: window.to,
      sent: total(s), held: total(h), exceptional: total(x),
      recent, exceptional_rows: x.slice(0, LISTED).map(rowOf),
      truncated: [sent, refused, exceptions].some(rows => rows.length >= READ_LIMIT),
    },
    note: 'A domain no entry of the setting names is notify: its content goes to an outside model as before, and each time a mark is written. '
      + 'The marks are kept as long as the classification audit is; an older period reads empty.',
  };
}
