/**
 * @file invariant-review.mjs
 * @description Complete, validated diff coverage before advancing the invariant checkpoint.
 * @version-history
 *  - 1.0.0 (2026-09-08): A2: git failures and partial reviews leave the checkpoint unchanged.
 */
import { createHash } from 'node:crypto';

const PATHS = 'aimeat/src python/aimeat-crewai';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const hash = text => createHash('sha256').update(text).digest('hex');

export function reviewCoverage(git, last, head) {
  try {
    if (!last) return { status: 'unreviewed', last: null, head, pendingCommits: null };
    git(`merge-base --is-ancestor ${last} ${head}`);
    const pendingCommits = Number(git(`rev-list --count ${last}..${head}`));
    if (!Number.isSafeInteger(pendingCommits) || pendingCommits < 0) throw new Error('Invalid commit count');
    return { status: pendingCommits ? 'pending' : 'current', last, head, pendingCommits };
  } catch {
    return { status: 'error', last, head, pendingCommits: null };
  }
}

export function reviewInvariantRange({ git, ask, store, head, date, cap = 60_000 }) {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Invalid review chunk size');
  const last = store.lastInvariantReviewCommit;
  if (last) git(`merge-base --is-ancestor ${last} ${head}`);
  const range = `${last || EMPTY_TREE}..${head}`;
  // Throw on a missing object, shallow history or git failure. Never interpret it as an empty diff.
  const diff = git(`diff ${range} -- ${PATHS}`);
  const stat = git(`diff --stat ${range} -- ${PATHS}`);
  const findings = [];
  const chunks = [];
  for (let offset = 0; offset < diff.length; offset += cap) {
    const text = diff.slice(Math.max(0, offset - 2000), offset + cap);
    const id = hash(`${range}|${offset}|${text}`);
    const out = ask({ range, stat, text, id, offset, total: diff.length });
    if (out?.reviewedChunk !== id || !Array.isArray(out.findings)
      || out.findings.some(f => ![5, 13, 14, 16].includes(f?.invariant)
        || typeof f.file !== 'string' || !f.file.trim() || typeof f.note !== 'string' || !f.note.trim())) {
      throw new Error(`Incomplete invariant review for chunk ${id}`);
    }
    chunks.push({ id, from: offset, to: Math.min(diff.length, offset + cap) });
    findings.push(...out.findings);
  }
  // No mutation before every chunk succeeds, including output validation. Keep every finding.
  const additions = findings.map(f => ({ ...f,
    id: hash(`${f.invariant}|${f.file}|${f.note}`).slice(0, 12), commitRange: range, date, status: 'open' }));
  const known = new Set(store.invariantFindings.map(f => f.id));
  for (const f of additions) if (!known.has(f.id)) { store.invariantFindings.push(f); known.add(f.id); }
  store.lastInvariantReviewCommit = head;
  store.invariantReviewCoverage = { range, paths: PATHS.split(' '), diffHash: hash(diff), characters: diff.length, chunks, date };
  return additions;
}
