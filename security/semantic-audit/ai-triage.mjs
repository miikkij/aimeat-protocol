/**
 * @file ai-triage.mjs
 * @description The AI triage pass of the semantic security audit, run headless via `claude -p`.
 * Two jobs: (1) every guard finding that has no acknowledgment in triage-store.json is classified
 * as a legitimate pattern or as needing a human, with a one-sentence reason that lands in the
 * report; (2) the invariants no static rule can see (5 federation-verify, 13 normalized-value,
 * 14 refuse-before-write, 16 deprecation policy) are reviewed against the git diff since the last
 * reviewed commit. Verdicts are written into triage-store.json (committed), so a triaged finding
 * stays triaged until the code at that site changes.
 *
 * Run from aimeat/:  pnpm audit:triage    (then pnpm audit:report to render)
 * @version-history
 *  - 1.2.0 (2026-08-23): CodeQL alerts join the triage too, via the same code-scanning fetch
 *    (generalized to fetchCodeScanningFindings). CodeQL is the generic JS/TS suite, not the identity
 *    model, so the prompt carries a CodeQL branch and each finding's security-severity; a
 *    belt-and-braces path filter drops any stray test/vendored/doc hit.
 *  - 1.1.0 (2026-08-23): Semgrep taint findings join the same triage — read from the GitHub
 *    code-scanning alerts the CI job uploads (Semgrep does not run on Windows), fingerprinted from
 *    rule + file + the flagged line's current text. Claude calls are batched (15 findings each).
 *  - 1.0.0 (2026-08-23): first version — finding triage + non-static invariant review.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { GUARDS } from './report-content.mjs';
import { ROOT, astScan, fingerprintOf, loadStore, saveStore, norm, resolveClaudeBin } from './audit-lib.mjs';

const MODEL = process.env.AIMEAT_TRIAGE_MODEL || 'opus';
const DIFF_CAP = 60_000;
const claudeBin = resolveClaudeBin();
if (!claudeBin) {
  console.error('Ei claude-binääriä: aseta AIMEAT_CLAUDE_BIN tai asenna Claude Code.');
  process.exit(1);
}

const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const today = new Date().toISOString().slice(0, 10);
const head = git('rev-parse --short HEAD');

/** One headless claude call: prompt on stdin, read-only tools, JSON object out. */
function askClaude(prompt) {
  const raw = execFileSync(claudeBin, [
    '-p', '--output-format', 'json', '--model', MODEL,
    '--allowedTools', 'Read,Grep,Glob',
  ], { cwd: ROOT, input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const envelope = JSON.parse(raw);
  if (envelope.is_error) throw new Error(`claude -p epäonnistui: ${String(envelope.result).slice(0, 300)}`);
  const text = String(envelope.result || '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

const store = loadStore();
const known = new Set(store.entries.map(e => e.fingerprint));

/**
 * Semgrep and CodeQL do not run on the Windows dev machine, so their findings are read from where
 * they DO land: the GitHub code-scanning alerts the CI jobs upload. The fingerprint is built from
 * the alert's rule + file + the current text of the flagged line, read locally — same invalidation
 * rule as ast-grep: edit the line and the acknowledgment dies. `source` labels which tool; CodeQL
 * alerts also carry a security-severity, kept for the report and the prompt's priority sense.
 */
function fetchCodeScanningFindings(toolName, source) {
  try {
    const repo = execSync('gh repo view --json nameWithOwner -q .nameWithOwner',
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const raw = execSync(
      `gh api "repos/${repo}/code-scanning/alerts?per_page=100&state=open&tool_name=${encodeURIComponent(toolName)}" --paginate`,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const alerts = JSON.parse(raw.replace(/\]\s*\[/g, ','));
    return alerts.map(a => {
      const file = a.most_recent_instance?.location?.path;
      const line = a.most_recent_instance?.location?.start_line ?? 1;
      if (!file) return null;
      // Only findings in code we ship; CodeQL default queries reach vendored/test paths the
      // workflow's paths-ignore already drops, but a belt-and-braces filter here keeps a stray one out.
      if (/(^|\/)(test|tests)\//.test(file) || /\/dist\//.test(file) || /\.min\.js$/.test(file) || file.startsWith('docs/')) return null;
      let text = '';
      try { text = readFileSync(resolve(ROOT, file), 'utf8').split('\n')[line - 1] ?? ''; } catch { return null; }
      return {
        ruleId: a.rule?.id ?? source, file, text, range: { start: { line: line - 1 } },
        source, alertNumber: a.number,
        severity: a.rule?.security_severity_level ?? a.rule?.severity ?? null,
        ruleDesc: a.rule?.description ?? '',
      };
    }).filter(Boolean);
  } catch {
    process.stderr.write(`   (${toolName}-hälytyksiä ei saatu GitHubista — gh puuttuu tai ei oikeuksia. Jatketaan ilman.)\n`);
    return [];
  }
}

// ── 1. Triage the guard findings that have no acknowledgment yet ──
process.stderr.write('1/2 Ajetaan vahdit ja triagetaan uudet osumat…\n');
const astFindings = astScan('aimeat/src').map(f => ({ ...f, source: 'ast-grep' }));
const findings = [
  ...astFindings,
  ...fetchCodeScanningFindings('Semgrep OSS', 'semgrep'),
  ...fetchCodeScanningFindings('CodeQL', 'codeql'),
];
const fresh = findings
  .map(f => ({ ...f, fingerprint: fingerprintOf(f) }))
  .filter(f => !known.has(f.fingerprint));

if (fresh.length === 0) {
  process.stderr.write('   Ei uusia osumia — kaikki jo kuitattu.\n');
} else {
  const BATCH = 15;
  process.stderr.write(`   ${fresh.length} uutta osumaa AI-katselmointiin (malli: ${MODEL}, erissä à ${BATCH})…\n`);
  const ruleDocs = GUARDS.map(g => `- rule \`${g.id}\`: ${g.why}\n  Triage guidance so far: ${g.triage}`).join('\n');
  const header = [
    'You are the triage reviewer of a security audit for the AIMEAT node (TypeScript, Express 5).',
    'The tools over-report by design; your job is to decide, per finding, whether the flagged site',
    'is a legitimate, known-safe pattern or something a human must confirm. Findings come from THREE',
    'tools, and each block below is tagged with which:',
    '  - ast-grep (structural) and Semgrep taint (interprocedural) — the identity invariants. Semgrep',
    '    follows req.auth.sub through variables and calls into a storage argument; its rule file with',
    '    the known sanitizers is security/semantic-audit/semgrep/resolve-identity.yml.',
    '  - CodeQL — the generic JS/TS security suite (injection, path traversal, ReDoS, clear-text',
    '    logging, XSS, SSRF, …). A CodeQL finding is NOT about the identity model; judge whether the',
    '    flagged data flow is actually reachable and exploitable in THIS code, or a known-safe usage',
    '    (a constant/allowlisted input, a value already validated upstream, a log line with no secret,',
    '    a regex over bounded input). Default to "confirm" for anything touching untrusted input that',
    '    you cannot prove safe by reading the surrounding code.',
    '',
    'ast-grep rule background (Finnish, from the audit report content):',
    ruleDocs,
    '',
    'Known-safe patterns for the identity findings: an agent/ecosystem-session branch where `sub`',
    'already IS the full identity; attribution fields (reviewedBy, performedBy, …) that record who',
    'acted and are never a retrieval key; inline GHII construction `${sub}@${nodeId}`; a door that',
    'also carries requireAuth()/requireScope() so the flagged check is not the only gate; ownership',
    'of a non-account resource.',
    'You may Read any file in the repo (rules live in security/semantic-audit/, auth middleware in',
    'aimeat/src/auth/middleware.ts) to verify how a flagged site actually behaves — prefer reading',
    'over guessing when the context below is not conclusive.',
    '',
    'Verdicts: "legit" = provably safe (a known-safe identity pattern, or a CodeQL flow you can show',
    'is not exploitable); "confirm" = a human must look (default when uncertain, and the default for',
    'a real-looking CodeQL vulnerability). The reason must be ONE sentence, written in natural',
    'Finnish, naming the concrete evidence (what the surrounding code does), because it is printed in',
    'a Finnish report.',
    '',
  ];
  const contextOf = (f) => {
    const file = norm(f.file);
    const line = (f.range?.start?.line ?? 0) + 1;
    try {
      const src = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
      const a = Math.max(0, line - 26);
      const b = Math.min(src.length, line + 25);
      return src.slice(a, b).map((l, j) => `${a + j + 1}: ${l}`).join('\n');
    } catch { return '(file unreadable)'; }
  };

  let legit = 0, confirm = 0;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH).filter(f => !known.has(f.fingerprint));
    if (!batch.length) continue;
    const blocks = batch.map((f, j) => {
      const line = (f.range?.start?.line ?? 0) + 1;
      const sev = f.severity ? `\nseverity: ${f.severity}` : '';
      const desc = f.ruleDesc ? `\nwhat the rule flags: ${f.ruleDesc}` : '';
      return `### Finding ${j + 1}\nfingerprint: ${f.fingerprint}\ntool: ${f.source}\nrule: ${f.ruleId}${sev}${desc}\nfile: ${norm(f.file)}:${line}\nmatched: ${String(f.text || '').slice(0, 300)}\ncontext:\n\`\`\`ts\n${contextOf(f)}\n\`\`\``;
    });
    const prompt = [...header, blocks.join('\n\n'), '',
      'Respond with ONLY this JSON object, no prose around it:',
      '{"verdicts":[{"fingerprint":"…","verdict":"legit"|"confirm","reason":"…"}]}',
      `Include exactly ${batch.length} verdicts, one per fingerprint listed above.`,
    ].join('\n');

    const out = askClaude(prompt);
    const byFp = new Map((out.verdicts || []).map(v => [v.fingerprint, v]));
    for (const f of batch) {
      // Identical matched text in the same file shares a fingerprint; one entry covers them all.
      if (known.has(f.fingerprint)) continue;
      known.add(f.fingerprint);
      const v = byFp.get(f.fingerprint);
      const verdict = v?.verdict === 'legit' ? 'legit' : 'confirm';
      verdict === 'legit' ? legit++ : confirm++;
      store.entries.push({
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        file: norm(f.file),
        line: (f.range?.start?.line ?? 0) + 1,
        source: f.source,
        ...(f.alertNumber !== undefined ? { alertNumber: f.alertNumber } : {}),
        ...(f.severity ? { severity: f.severity } : {}),
        verdict,
        reason: v?.reason || 'AI ei antanut verdiktiä — ihmisen katsottava.',
        decidedBy: 'ai',
        date: today,
        commit: head,
      });
    }
    process.stderr.write(`   erä ${Math.floor(i / BATCH) + 1}: ${batch.length} osumaa katselmoitu.\n`);
  }
  process.stderr.write(`   ✓ ${legit} kuitattu lailliseksi, ${confirm} odottaa ihmistä.\n`);
}

// ── 2. Review the non-static invariants against the diff since the last reviewed commit ──
process.stderr.write('2/2 Katselmoidaan ei-staattiset invariantit (5, 13, 14, 16)…\n');
const last = store.lastInvariantReviewCommit;
const range = last ? `${last}..HEAD` : 'HEAD~10..HEAD';
let diff = '';
try { diff = git(`diff ${range} -- aimeat/src python/aimeat-crewai`); } catch { diff = ''; }
if (!diff.trim()) {
  process.stderr.write('   Ei uusia muutoksia katselmoitavana.\n');
  store.lastInvariantReviewCommit = head;
} else {
  const stat = git(`diff --stat ${range} -- aimeat/src python/aimeat-crewai`).split('\n').slice(-40).join('\n');
  const capped = diff.length > DIFF_CAP;
  const prompt = [
    'You are reviewing a diff of the AIMEAT node for the four security invariants that static',
    'analysis cannot check. Read their full definitions first:',
    'docs/coding-guidelines/security-development-dna.md, invariants 5, 13, 14 and 16:',
    '  5  — federation signature verification is unconditional, never behind a flag or branch;',
    '  13 — a gate reads the normalized/derived value, never the raw request field or header;',
    '  14 — refuse before you write: every check happens before the state change it protects;',
    '  16 — deprecating names the flag, the default and the removal version; marked is not removed.',
    '',
    `Commit range: ${range}. File stat:\n${stat}`,
    '',
    capped
      ? `The diff is larger than the inline cap. Read the changed files yourself with Read/Grep. Inline head of the diff follows:\n${diff.slice(0, DIFF_CAP)}`
      : `The diff:\n${diff}`,
    '',
    'Report ONLY genuine concerns where the diff plausibly violates one of the four invariants —',
    'an ordering problem, a raw value at a gate, a conditional around a signature verify, or a',
    'deprecation without flag/default/version. No style notes. The note must be ONE sentence in',
    'natural Finnish naming the file and the concrete concern. An empty list is the expected result',
    'for a clean diff.',
    '',
    'Respond with ONLY this JSON object:',
    '{"findings":[{"invariant":5|13|14|16,"file":"…","note":"…"}]}',
  ].join('\n');

  const out = askClaude(prompt);
  const found = (out.findings || []).slice(0, 20);
  for (const f of found) {
    store.invariantFindings.push({
      id: createHash('sha256').update(`${f.invariant}|${f.file}|${f.note}`).digest('hex').slice(0, 12),
      invariant: f.invariant,
      file: f.file,
      note: f.note,
      commitRange: range,
      date: today,
      status: 'open',
    });
  }
  store.lastInvariantReviewCommit = head;
  process.stderr.write(found.length
    ? `   🟠 ${found.length} havaintoa kirjattu — ne näkyvät raportissa kunnes suljettu.\n`
    : '   ✓ Ei invarianttihuolia tässä muutosvälissä.\n');
}

saveStore(store);
process.stderr.write(`\n✅ Triage-muisti päivitetty: ${store.entries.length} kuittausta, ${store.invariantFindings.filter(f => f.status === 'open').length} avointa invarianttihavaintoa.\n`);
process.stderr.write('   Aja seuraavaksi: pnpm audit:report\n');
