/**
 * @file public/components/ProofLedger.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The proof ledger: which model built with a library and whether it passed, as a
 *   five-column typewriter table (the model, the verdict in green or coral, the tokens, the date,
 *   the evidence's file with its full path as the tooltip). On a phone it keeps the model and the
 *   verdict. A page passes the rows; it never writes a class. Its look is
 *   css/components/proof-ledger.css (.proof-ledger).
 * @structure ProofLedger({ rows: [{ key, model, pass, verdict, tokens, date, evidence, evidenceTitle }] })
 * @usage html`<${ProofLedger} rows=${proofs.map((pr) => ({ key: pr.model + pr.date, model: pr.model,
 *   pass: pr.verdict === 'pass', verdict: pr.verdict === 'pass' ? x('proofPass') : x('proofFail'),
 *   tokens: pr.tokens ? `${num(pr.tokens)} tok` : '', date: pr.date || '', evidence: file, evidenceTitle: pr.evidence }))} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Libraries page's proof ledger as a component, same markup
 *     (page group G8).
 *   v1.1.0 — 2026-09-27 — Draws its own name: .lb-proof is .proof-ledger (a move).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function ProofLedger({ rows = [] }) {
  return html`<div class="proof-ledger">${rows.map((r) => html`
    <div key=${r.key + ':m'}>${r.model}</div><div key=${r.key + ':v'} class=${r.pass ? 'ok' : 'no'}>${r.verdict}</div><div key=${r.key + ':t'}>${r.tokens}</div><div key=${r.key + ':d'}>${r.date}</div><div key=${r.key + ':e'} title=${r.evidenceTitle || ''}>${r.evidence}</div>`)}</div>`;
}

export default ProofLedger;
