/**
 * @file scripts/check-single-entry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A security decision that has one function of its own is made only through that
 *   function. The secaudit 2026-10 proposals C1 to C4 and C7 each moved hand copies of one decision
 *   into one function; this gate keeps the copies from coming back.
 *
 *   WHY. The October 2026 audit found the same decision written out by hand in many files, and the
 *   copies had drifted: a password checked without the account lock on one route, an account deleted
 *   without its agents and records on another, the operator's agent admitted on MCP and refused on
 *   REST. Each copy was right the day it was written. A machine can count them; a reviewer cannot.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except src/static and src/generated, tokenised with
 *   the compiler's scanner so comments are not findings, and each line rebuilt from its tokens with a
 *   space only between two words, so `roles ?.includes( 'operator' )` and `roles?.includes('operator')`
 *   are the same text.
 *   Each RULE is a pattern on that text and the files where it may appear, with a ceiling per file
 *   and the sentence that says why the file is right. The ceilings live in
 *   security/single-entry-baseline.json.
 *
 *   IT FAILS on a file that is not listed, a file over its ceiling, and a file UNDER its ceiling
 *   (lower the ceiling in the same change: the count only goes down, and a ceiling left high is room
 *   for the next copy). `--seed` writes today's counts for the rules named after it, keeping every
 *   reason already written; seeding forgives a backlog, so it is a decision, not maintenance.
 * @structure RULES · lineTexts(source) · count(rule) · main()
 * @usage
 *   cd aimeat && pnpm check:single-entry           # the gate
 *   cd aimeat && pnpm check:single-entry --list    # every file each rule counts
 *   cd aimeat && pnpm check:single-entry --seed operator-role   # rewrite one rule's ceilings
 * @version-history
 *   2026-11-05 — Rule scope-widen-at-mint also counts the step for the existing agents
 *     (givePlaceDefaultToEveryAgent, placeDefaultAfterSettings); the four mints are off the baseline and the
 *     approval doors are on it (codebase analysis 2026-11-03, decision 8b of 2026-11-05).
 *   v1.13.0 — 2026-11-04 — Rules aes-gcm and token-key: AES-256-GCM goes through utils/aes-gcm.ts
 *     (baseline empty), and a JWT is signed or verified by hand only where the baseline names the
 *     outside party whose key it uses (codebase analysis 2026-11-03, item B9).
 *   v1.12.0 — 2026-11-04 — Rule service-locator: the five running services are read from nodeContext()
 *     (services/node-context.ts); 93 of the 94 getActive* calls (69 of 70 files) moved, and the one left is the
 *     inactivity nudge, whose unit test mocks services/email.js (codebase analysis 2026-11-03, item D-i).
 *   v1.11.0 — 2026-11-04 — Rules scope-widen-at-mint and token-mint: the store place's default is added
 *     only at the doors the baseline names, and every issueJWT caller is listed with what it mints
 *     (codebase analysis 2026-11-03, item B7).
 *   v1.10.0 — 2026-11-04 — Rules principal-kind and payer-resolve: what kind of caller this is and who
 *     pays for its AI call are answered by services/caller-facts.ts and read from the CallerContext;
 *     13 hand classifier lines in 6 files and 33 door calls of aiPayerOf moved, so both baselines
 *     are empty (codebase analysis 2026-11-03, item B1).
 *   v1.9.0 — 2026-11-04 — Rule self-fetch: a request the node makes to itself goes through
 *     services/request-injector.ts; the baseline is the headless-browser modules and the tunnel's
 *     resolution origin (codebase analysis 2026-11-03, item D-j).
 *   v1.8.0 — 2026-11-04 — Rule mail-send: a mail goes out through sendMail (services/mail-gate.ts); the
 *     24 files that called the mail service directly moved onto it, so the baseline is empty. RULES is
 *     exported for its unit test (codebase analysis 2026-11-03, item B3).
 *   v1.7.0 — 2026-11-04 — Rule sale-booking: a sale's fee and shares are booked only by settlePurchase
 *     (commerce/settle-purchase.ts), with the purchase's last write (codebase analysis 2026-11-03, B2).
 *   v1.6.0 — 2026-11-04 — Rule config-write: a setting row is written through services/config-apply.ts,
 *     which applies the setting's own tighten-only rule (codebase analysis 2026-11-03, B4).
 *   v1.5.0 — 2026-11-04 — Rule verification-level-gate: an owner's address is proven by
 *     provenOwnerAddress, not by the account's verification level (codebase analysis 2026-11-03, A9).
 *   v1.4.0 — 2026-11-04 — Rule admin-password: the admin password is read only by its one check, its
 *     generation at boot and its masked display (codebase analysis 2026-11-03, item A12).
 *   v1.3.0 — 2026-11-04 — Rule ai-key-record: the legacy AI key record is read by hand only where the
 *     baseline says why (codebase analysis 2026-11-03, item A10).
 *   v1.2.0 — 2026-10-05 — Rules agent-role, wildcard-test and caller-built: the caller is the
 *     CallerContext (services/caller-context.ts), and the remaining hand tests and hand-built callers
 *     only go down (secaudit 2026-10, C9).
 *   v1.1.0 — 2026-10-05 — Rule html-escape: HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C1, C2 and C7).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'security', 'single-entry-baseline.json');

interface Rule {
  id: string;
  /** What the one function is, for the refusal. */
  label: string;
  /** Matched against each line rebuilt from its tokens, with no spaces. */
  pattern: RegExp;
  /** Directories under src/ the rule does not read: the function's own layer. */
  skipDirs?: string[];
}

export const RULES: Rule[] = [
  {
    id: 'password-verify',
    label: 'An account password is checked only by checkPassword (services/password-check.ts), which applies the account lock (C1)',
    pattern: /\bverifyPassword\(/,
  },
  {
    id: 'delete-owner',
    label: 'An account is deleted only by eraseOwner (services/owner-erasure.ts), which also clears what the storage cascade does not reach: memory, consents, sessions, grants, audit rows (C7)',
    pattern: /\bstorage\.deleteOwner\(/,
  },
  {
    id: 'operator-role',
    label: 'An operator check asks isOperatorCaller or operatorOverride (services/operator-override.ts), so the operator\'s agent holding operator:admin passes on REST as on MCP and a pass in another person\'s account writes the operator trail (C2)',
    pattern: /roles\)?\??\.includes\(['"]operator['"]\)/,
    // utils/operator-account.ts is the account-record question, isOperatorAccount.
    skipDirs: ['src/auth/', 'src/utils/operator-account.ts'],
  },
  {
    id: 'scope-test',
    label: 'Whether a principal holds a scope is asked with scopeIsCovered, and the node ceiling with exceedsCeiling (utils/scope-coverage.ts), which know the words no wildcard carries (C3)',
    // A domain wildcard built or written by hand: includes(`${domain}:*`) or includes('memory:*').
    pattern: /includes\((`\$\{[^}]+\}:\*`|['"][a-z-]+:\*['"])\)/,
    skipDirs: ['src/utils/scope-coverage.ts'],
  },
  {
    id: 'uncapped-read',
    label: 'A response body is read under a ceiling with readJson, readText, readBodyCapped or readBodyPrefix (utils/read-capped.ts): json(), text() and arrayBuffer() hold the whole body before anything measures it (C6)',
    // An empty-argument body read; Express's res.json(x) takes an argument and is not one.
    pattern: /\.(json|text|arrayBuffer)\(\)/,
    // src/data holds app, cortex and extension code shipped as data: it runs in a browser tab or an
    // extension sandbox, not on the node.
    skipDirs: ['src/utils/read-capped.ts', 'src/data/'],
  },
  {
    id: 'operator-route',
    label: 'An operator route is gated by requireOperator(storage) (auth/middleware.ts), which admits the operator\'s agent holding operator:admin as the MCP admin tools do (C2)',
    pattern: /requireRole\(['"]operator['"]\)/,
    skipDirs: ['src/auth/'],
  },
  {
    id: 'html-escape',
    label: 'HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (C8)',
    // A hand-written escaper's `<` step, `.replace(/</g, '&lt;')`, as the rebuilt line reads it.
    pattern: /replace\(\/<\/g,['"]&lt;['"]\)/,
    // src/data holds app and cortex code shipped as data, which runs in a browser, not on the node.
    skipDirs: ['src/utils/html-escape.ts', 'src/data/'],
  },
  {
    id: 'owner-role',
    label: 'The account holder in person is asked with isOwnerInPerson (utils/gaii.ts), which also refuses an agent, an ecosystem app, an app grant and a visitor (C4)',
    pattern: /roles\)?\??\.includes\(['"]owner['"]\)/,
    skipDirs: ['src/auth/', 'src/utils/gaii.ts'],
  },
  {
    id: 'email-pattern',
    label: 'An e-mail address is checked with isValidEmail (utils/email-validator.ts), which also caps the length (M2)',
    pattern: /\[\^\\s@\]\+@/,
    skipDirs: ['src/utils/email-validator.ts', 'src/data/', 'src/static/'],
  },
  {
    id: 'agent-name-pattern',
    label: 'An agent name is checked with validateAgentName or isValidAgentName (utils/gaii.ts); the looser {1,63} pattern admitted names no agent can have (M2)',
    pattern: /\[a-z0-9\]\[a-z0-9-\]\{1,63\}\$/,
    skipDirs: ['src/utils/gaii.ts'],
  },
  {
    id: 'agent-role',
    label: 'What kind of principal a caller is, is asked of its caller object (services/caller-context.ts: kind, inPerson), built once per request (callerOf) or per MCP session (C9)',
    pattern: /roles\)?\??\.includes\(['"]agent['"]\)/,
    // caller-facts.ts is where the caller object's kind, via and reader kind are answered (B1).
    skipDirs: ['src/auth/', 'src/utils/gaii.ts', 'src/services/caller-context.ts', 'src/services/caller-facts.ts'],
  },
  {
    id: 'wildcard-test',
    label: 'A held scope is asked with scopeIsCovered (utils/scope-coverage.ts) or the caller object\'s has(word); a hand `includes(\'*\')` misses the words no wildcard carries (C9)',
    pattern: /includes\(['"]\*['"]\)/,
    skipDirs: ['src/utils/scope-coverage.ts', 'src/data/', 'src/static/'],
  },
  {
    id: 'caller-built',
    label: 'A caller is the CallerContext (services/caller-context.ts), not an object built at the call site with a literal role: the MCP session\'s comes from register-all.ts, a request\'s from callerOf (C9)',
    pattern: /roles:\[['"]agent['"]\]/,
    skipDirs: ['src/services/caller-context.ts', 'src/auth/'],
  },
  {
    id: 'verification-level-gate',
    label: 'Whether an owner\'s address is proven is asked with provenOwnerAddress (services/owner-mail-address.ts), which compares the flag and the hash; the account\'s verificationLevel stays when the address changes, so a mail gate that compares it mails an unproven address (codebase analysis 2026-11-03, A9)',
    // A comparison of the level with a number: `g.verificationLevel<1`, `(r.verificationLevel??0)>=1`.
    pattern: /verificationLevel(\?\?\d+\))?(<|>|<=|>=|===|!==|==|!=)\d/,
  },
  {
    id: 'ai-key-record',
    label: 'Whose key pays for an AI call is asked of prepareAiCall (services/ai/completion.ts), which knows the node\'s key, its allowance and the free model; the legacy key record read by hand is how six notebook features refused a person the node would have paid for (codebase analysis 2026-11-03, A10)',
    pattern: /getMemory\([^)]*['"]openrouter\.apikey['"]\)/,
    skipDirs: ['src/services/ai/', 'src/services/secret-records.ts'],
  },
  {
    id: 'admin-password',
    label: 'The node\'s admin password is checked only by checkAdminPassword (services/admin-password.ts), with one count of wrong passwords per address for every route that takes it (codebase analysis 2026-11-03, A12)',
    pattern: /\bconfig\.adminPassword\b/,
  },
  {
    id: 'config-write',
    label: 'A setting row is written and removed through services/config/apply.ts (applyConfigChanges, storeConfigValue, resetConfigValue), where the rule that an AI may only make a setting stricter is read from the setting\'s row; a write elsewhere skips it, as DELETE did before d1f37bb4a (codebase analysis 2026-11-03, B4)',
    pattern: /\.(setConfigValue|deleteConfigValue)\(/,
    skipDirs: ['src/storage/'],
  },
  {
    id: 'mail-send',
    label: 'A mail goes out through sendMail (services/mail-gate.ts), whose intent says whose mail it is: an owner mail asks provenOwnerAddress and the sender\'s daily limit, a third-party mail shows the account\'s turn or the reason it has none (codebase analysis 2026-11-03, B3)',
    // A call of an EmailService send method. sendNotification is also the web-push method, so it
    // counts only on an object whose name does not say push (pushService, push, webpush).
    pattern: /\.(sendVerificationCode|sendMagicLink|sendInvite|sendKeyInvite|sendKeyCredentials|sendRaw|sendWithAttachments)\(|(^|[^\w$])(?![\w$]*push)[\w$]+[!?]?\.sendNotification\(|\)[!?]?\.sendNotification\(/i,
    // email.ts defines the methods; push.ts is the web-push service, whose own method is sendNotification.
    skipDirs: ['src/services/mail-gate.ts', 'src/services/email.ts', 'src/services/push.ts'],
  },
  {
    id: 'request-caller-built',
    label: 'A route\'s caller is callerOf(req) (middleware/caller.ts), built once per request with its answers on it, not an object copied field by field from req.auth (C9)',
    pattern: /roles:req\.auth!?\.roles/,
    skipDirs: ['src/middleware/caller.ts', 'src/auth/'],
  },
  {
    id: 'self-fetch',
    label: 'A request the node makes to itself goes through services/request-injector.ts, in process with no socket; only the modules that load real pages in a headless browser address 127.0.0.1 on the node\'s port (codebase analysis 2026-11-03, D-j)',
    // A template literal that addresses 127.0.0.1 on a port expression: `http://127.0.0.1:${config.port}`.
    pattern: /127\.0\.0\.1:\$\{[\w.]*port\}/,
    // The injector builds the origin. src/cli is the connector, a process of its own whose local
    // daemon listens on a port of its own.
    skipDirs: ['src/services/request-injector.ts', 'src/cli/'],
  },
  {
    id: 'principal-kind',
    label: 'What kind of caller a credential or an identity is, is answered by services/caller-facts.ts (credentialKind, readerOf, principalKindOf, usageActorOfPrincipal, usageActorOfRoles) and carried on the CallerContext; eleven hand classifiers disagreed, and an ecosystem app was planned as the owner in person (codebase analysis 2026-11-03, B1)',
    // A kind literal returned straight from a role or identity-shape test:
    // `if(roles.includes('app'))return'app'`, `if(p.startsWith('eco:'))return'eco'`.
    pattern: /(includes\(['"](#|owner|operator|agent|ecosystem|app|federated)['"]\)|startsWith\((['"]eco:['"]|ECO_PREFIX)\)|isGEAI\([^)]*\))\)*return['"](owner|person|agent|eco|ecosystem|app|human|ai|visitor|anonymous)['"]/,
    skipDirs: ['src/services/caller-facts.ts'],
  },
  {
    id: 'payer-resolve',
    label: 'Who pays for an AI call is the caller\'s `payer` (callerOf(req).payer on REST, principalCaller(principal).payer where only the identity is held; services/caller-facts.ts payerOfPrincipal), not resolved again at each door (codebase analysis 2026-11-03, B1)',
    pattern: /\b(aiPayerOf|payerOfPrincipal)\(/,
    // caller-facts.ts holds the rule; agent-ai-keys.ts keeps aiPayerOf as its one-line read for the
    // tests that import it. services/ai/caller-context.ts maps the payer onto the planner's caller class.
    skipDirs: ['src/services/caller-facts.ts', 'src/services/agent/ai-keys.ts'],
  },
  {
    id: 'scope-widen-at-mint',
    label: 'An agent\'s scopes are decided when it is approved and kept on its record; a token mint copies them and adds nothing. The store place\'s default (services/place-agent-scopes.ts) is given only at a door that approves an agent and by the step for the existing agents, each listed with why in the baseline, so no mint can widen (codebase analysis 2026-11-03, B7; decision 8b of 2026-11-05; round 13 had four commits on this default alone)',
    pattern: /\b(widenForPlace|widenAndAnnounce|applyPlaceDefault|givePlaceDefaultToEveryAgent|placeDefaultAfterSettings)\(/,
    // The default's own module.
    skipDirs: ['src/services/place-agent-scopes.ts'],
  },
  {
    id: 'token-mint',
    label: 'A token is minted by issueJWT (auth/jwt.ts) only at a door the baseline names with what it mints and where its roles and scopes come from, so a new mint is a sentence somebody writes (codebase analysis 2026-11-03, B7)',
    pattern: /\bissueJWT\(/,
    skipDirs: ['src/auth/jwt.ts'],
  },
  {
    id: 'sale-booking',
    label: 'A sale\'s platform fee and beneficiary shares are booked only by settlePurchase (commerce/settle-purchase.ts), in one transaction with the purchase\'s last write, so a write that fails leaves no fee and no share booked (codebase analysis 2026-11-03, B2)',
    pattern: /\b(bookBeneficiaryShares|recordMoneyPlatformFee)\(/,
    // The two writers themselves: their own definitions.
    skipDirs: ['src/commerce/beneficiary-book.ts', 'src/commerce/platform-fee.ts'],
  },
  {
    id: 'service-locator',
    label: 'The node\'s running scheduler, mail service, AI job service, workflow engine and connector tunnel manager are read from nodeContext() (services/node-context.ts), which initializeServices fills; the five getActive* handles that held them one by one may only be called fewer times (codebase analysis 2026-11-03, D-i)',
    pattern: /\bgetActive(Scheduler|EmailService|AiJobService|WorkflowEngine|ConnectTunnelManager)\(/,
    // email.ts defines getActiveEmailService, the one handle kept for a unit test that mocks that module.
    skipDirs: ['src/services/email.ts'],
  },
  {
    id: 'aes-gcm',
    label: 'A value is encrypted with AES-256-GCM only through gcmSeal and gcmOpen (utils/aes-gcm.ts), the node\'s one implementation, which the stored secrets, the TOTP secrets, the node key and the short-lived claim rows use (codebase analysis 2026-11-03, B9)',
    pattern: /\bcreate(Cipheriv|Decipheriv)\(/,
    skipDirs: ['src/utils/aes-gcm.ts'],
  },
  {
    id: 'token-key',
    label: 'A token the node signs or verifies for itself goes through signFor and verifyFor (auth/node-signer.ts), which sign each kind with its purpose\'s own key; a file that signs or verifies a JWT by hand is listed with the outside party whose key it uses (codebase analysis 2026-11-03, B9)',
    pattern: /\bjwtVerify\(|\.setProtectedHeader\(/,
    skipDirs: ['src/auth/node-signer.ts'],
  },
];

interface FileEntry { count: number; why: string }
type Baseline = { note: string; rules: Record<string, Record<string, FileEntry>> };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'static' || name === 'generated' || name === 'node_modules') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const WORD = /[\w$]/;

/** One space between two word tokens (`async function f`), none around punctuation. */
function joinToken(line: string, token: string): string {
  return line && WORD.test(line.slice(-1)) && WORD.test(token[0] ?? '') ? `${line} ${token}` : line + token;
}

/** Each line's tokens, spaced only between words; comments and whitespace are not tokens. */
export function lineTexts(source: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const lines: string[] = [];
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (pos: number): number => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  // Inside `${ … }` the closing brace ends the expression, not a block: the scanner is told so, or
  // it reads the rest of the template as code (or the rest of the file as a template).
  const braces: ('block' | 'template')[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.TemplateHead) braces.push('template');
    else if (kind === ts.SyntaxKind.OpenBraceToken) braces.push('block');
    else if (kind === ts.SyntaxKind.CloseBraceToken) {
      if (braces.pop() === 'template') {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateMiddle) braces.push('template');
      }
    }
    const line = lineOf(scanner.getTokenStart());
    lines[line] = joinToken(lines[line] ?? '', scanner.getTokenText());
    // A regex literal, read as a division by the scanner, would swallow the line's tokens wrongly;
    // ask for it again as a regex when a slash follows something that cannot end an expression.
    if (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) {
      const prev = (lines[line] ?? '').slice(0, -1);
      if (prev === '' || /[=(,:!&|?{};[]$/.test(prev)) {
        scanner.reScanSlashToken();
        lines[line] = joinToken(prev, scanner.getTokenText());
      }
    }
    kind = scanner.scan();
  }
  return lines.map((l) => l ?? '');
}

function countAll(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = Object.fromEntries(RULES.map((r) => [r.id, {}]));
  for (const file of walk(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const lines = lineTexts(readFileSync(file, 'utf-8'));
    for (const rule of RULES) {
      if (rule.skipDirs?.some((d) => rel.startsWith(d))) continue;
      const n = lines.filter((l) => rule.pattern.test(l)).length;
      if (n > 0) out[rule.id]![rel] = n;
    }
  }
  return out;
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE)) return { note: '', rules: {} };
  return JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline;
}

export function main(): boolean {
  const args = process.argv.slice(2);
  const counts = countAll();
  const baseline = readBaseline();

  if (args[0] === '--seed') {
    const ids = args.slice(1);
    for (const rule of RULES) {
      if (ids.length > 0 && !ids.includes(rule.id)) continue;
      const old = baseline.rules[rule.id] ?? {};
      baseline.rules[rule.id] = Object.fromEntries(Object.entries(counts[rule.id]!).sort(([a], [b]) => a.localeCompare(b))
        .map(([file, count]) => [file, { count, why: old[file]?.why ?? 'UNREVIEWED' }]));
    }
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Seeded ${ids.length ? ids.join(', ') : 'every rule'} into ${path.relative(ROOT, BASELINE)}.`);
    return true;
  }

  const problems: string[] = [];
  for (const rule of RULES) {
    const allowed = baseline.rules[rule.id] ?? {};
    const found = counts[rule.id]!;
    if (args.includes('--list')) {
      console.log(`\n${rule.id}: ${rule.label}`);
      for (const [file, n] of Object.entries(found)) console.log(`  ${String(n).padStart(3)}  ${file}  ${allowed[file] ? '' : '(not listed)'}`);
    }
    for (const [file, n] of Object.entries(found)) {
      const entry = allowed[file];
      if (!entry) problems.push(`${rule.id}: ${file} has ${n}, and the file is not listed. ${rule.label}.`);
      else if (n > entry.count) problems.push(`${rule.id}: ${file} has ${n}, its ceiling is ${entry.count}. ${rule.label}.`);
      else if (n < entry.count) problems.push(`${rule.id}: ${file} has ${n}, under its ceiling ${entry.count}: lower the ceiling in security/single-entry-baseline.json.`);
    }
    for (const file of Object.keys(allowed)) {
      if (!(file in found)) problems.push(`${rule.id}: ${file} is listed and has none any more: remove its entry.`);
    }
  }

  const total = RULES.map((r) => `${r.id} ${Object.values(counts[r.id]!).reduce((a, b) => a + b, 0)}`).join(' · ');
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error(`\n${problems.length} problem(s). Counts: ${total}.`);
    return false;
  }
  console.log(`✓ single entry: ${total}`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main() ? 0 : 1);
}
