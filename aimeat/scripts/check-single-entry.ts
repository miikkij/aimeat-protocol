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
 *   SILENT DROPS (2026-11-21). The rules after token-key are not security decisions but traps that
 *   docs/pitfalls.md used to describe in prose: a part of the work that is dropped without a word
 *   (a task created past its wake, a router that is not there when its flag is off, an app record
 *   read under the other name, a child process under the unit's environment) or a page that writes
 *   the wrong thing (a long model call under a 30 s timeout, a request without the session on a
 *   signed-in-only node, a format from the language, a colour that repeats). Each label carries what
 *   the pitfalls entry explained.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except src/static and src/generated, tokenised with
 *   the compiler's scanner so comments are not findings, and each line rebuilt from its tokens with a
 *   space only between two words, so `roles ?.includes( 'operator' )` and `roles?.includes('operator')`
 *   are the same text.
 *   A rule with `tree: 'public'` reads the browser code instead: every `.js` and `.mjs` file under
 *   public/ except public/lib (vendored), through the same scanner. `onlyDirs` narrows a rule to
 *   the files under the directories it names.
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
 *   v1.14.0 — 2026-11-21 — A public/ mode (`tree: 'public'`) and `onlyDirs`; eight rules from the
 *     pitfall analysis of 2026-11-21: task-create (§58), flag-mount (§79), app-record-key (§107),
 *     child-env (§12), and in public/ long-ai-call (§9), closed-node-fetch (§124), locale-format
 *     (§81, the hand decimal comma and the language-picked tag the ESLint rule cannot see) and
 *     palette-cycle (§76).
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
  /** Directories (or files) the rule does not read: the function's own layer. */
  skipDirs?: string[];
  /** Which tree the rule reads: the node's TypeScript under src/ (the default), or the browser code under public/. */
  tree?: 'src' | 'public';
  /** When set, the rule reads only files under these directories. */
  onlyDirs?: string[];
}

export const RULES: Rule[] = [
  {
    id: 'password-verify',
    label: 'An account password is checked only by checkPassword (services/password-check.ts), which applies the account lock (C1)',
    pattern: /\bverifyPassword\(/,
  },
  {
    id: 'delete-owner',
    label: 'An account is deleted only by eraseOwner (services/owner/erasure.ts), which also clears what the storage cascade does not reach: memory, consents, sessions, grants, audit rows (C7)',
    pattern: /\bstorage\.deleteOwner\(/,
  },
  {
    id: 'operator-role',
    label: 'An operator check asks isOperatorCaller or operatorOverride (services/operator/override.ts), so the operator\'s agent holding operator:admin passes on REST as on MCP and a pass in another person\'s account writes the operator trail (C2)',
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
    label: 'Whether an owner\'s address is proven is asked with provenOwnerAddress (services/owner/mail-address.ts), which compares the flag and the hash; the account\'s verificationLevel stays when the address changes, so a mail gate that compares it mails an unproven address (codebase analysis 2026-11-03, A9)',
    // A comparison of the level with a number: `g.verificationLevel<1`, `(r.verificationLevel??0)>=1`.
    pattern: /verificationLevel(\?\?\d+\))?(<|>|<=|>=|===|!==|==|!=)\d/,
  },
  {
    id: 'ai-key-record',
    label: 'Whose key pays for an AI call is asked of prepareAiCall (services/ai/completion.ts), which knows the node\'s key, its allowance and the free model; the legacy key record read by hand is how six notebook features refused a person the node would have paid for (codebase analysis 2026-11-03, A10)',
    pattern: /getMemory\([^)]*['"]openrouter\.apikey['"]\)/,
    skipDirs: ['src/services/ai/', 'src/services/secret/records.ts'],
  },
  {
    id: 'admin-password',
    label: 'The node\'s admin password is checked only by checkAdminPassword (services/node-admin/password.ts), with one count of wrong passwords per address for every route that takes it (codebase analysis 2026-11-03, A12)',
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
    label: 'A request the node makes to itself goes through services/request/injector.ts, in process with no socket; only the modules that load real pages in a headless browser address 127.0.0.1 on the node\'s port (codebase analysis 2026-11-03, D-j)',
    // A template literal that addresses 127.0.0.1 on a port expression: `http://127.0.0.1:${config.port}`.
    pattern: /127\.0\.0\.1:\$\{[\w.]*port\}/,
    // The injector builds the origin. src/cli is the connector, a process of its own whose local
    // daemon listens on a port of its own.
    skipDirs: ['src/services/request/injector.ts', 'src/cli/'],
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
    label: 'The node\'s running scheduler, mail service, AI job service, workflow engine and connector tunnel manager are read from nodeContext() (services/node/context.ts), which initializeServices fills; the five getActive* handles that held them one by one may only be called fewer times (codebase analysis 2026-11-03, D-i)',
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
  // ── Silent drops (pitfall analysis 2026-11-21). Each rule below replaces or shrinks a
  // docs/pitfalls.md entry (§9, 76 and 79 are gone; §12, 58, 81, 107 and 124 point here), and its
  // label carries what the entry explained. ──
  {
    id: 'task-create',
    label: 'An agent task is created through createTask (services/agent/task-write.ts), which validates the body, dedupes, and then wakes the agent (webhook, connector tunnel, live view); a second writer that calls storage.createAgentTask itself inherits none of that, and a nightly workflow ran 0 of 6 steps with everything reporting healthy (docs/pitfalls.md §58). A file listed here sends its own wake',
    pattern: /\.createAgentTask\(/,
    skipDirs: ['src/storage/', 'src/services/agent/task-write.ts'],
  },
  {
    id: 'flag-mount',
    label: 'A router behind a feature flag is mounted with flaggedMounts() (server-bootstrap/flagged-mount.ts), so a switched-off feature answers 503 FEATURE_DISABLED with its setting; a bare `if (config.xEnabled)` around a mount leaves no router, the caller gets 404, and every refusal the router documents is dead code; the realtime page drew the same zeros for "switched off" as for "quiet"',
    // The `if` that opens such a block: `if(config.calibratorEnabled){`. A negated test is a guard, not a mount.
    pattern: /^if\(config\.\w+Enabled\b/,
    // The files that mount the routers; the service start-up beside them switches services, not routes.
    onlyDirs: ['src/server-bootstrap/routes-loader'],
  },
  {
    id: 'app-record-key',
    label: 'A record beside an app is addressed by its own store\'s key builder: appToolsKey(filename) (models/app-tool-schemas.ts) for the tool list, which keeps `.html`, and appDataMapKey(appId) (services/data-map/data-map-types.ts) for the data map, which does not. A hand-built `apps.${…}.tools` or `.datamap` key with the other name reads nothing, and a missing record looks like an app without one (docs/pitfalls.md §107)',
    pattern: /`apps\.\$\{[^`]*\}\.(tools|datamap)`/,
    skipDirs: ['src/models/app-tool-schemas.ts', 'src/services/data-map/data-map-types.ts'],
  },
  {
    id: 'child-env',
    label: 'A program the node starts inherits the environment the systemd unit gives node itself (LD_PRELOAD for jemalloc, MALLOC_CONF, NODE_OPTIONS) unless the launch names its own `env`; with them the headless browser died on every launch under the unit and worked from a shell, so a shell is no stand-in for the unit (deploy/aimeat.service; docs/pitfalls.md §12). Each file listed here says what environment its child gets; browserLaunchEnv() (services/screenshot-capture.ts) is the one that drops the three',
    pattern: /(^|[^.\w$])(spawn|spawnSync|execFile|execFileSync|fork|execSync)\(/,
    // src/cli is the connector: a process of its own on the person's machine, not under the unit.
    // src/data holds app code shipped as data, which runs in a browser or an extension sandbox.
    skipDirs: ['src/cli/', 'src/data/'],
  },
  {
    id: 'long-ai-call',
    tree: 'public',
    label: 'A call from the SPA that waits for a model goes through api(path, { method, body, timeoutMs: 1_800_000, retries: 0 }) (public/js/api.js); apiPost aborts it at 30 s, so a long completion, transcription or decision fails mid-flight while the provider still bills it (an app\'s way is AIMEAT.ai.job, registry entry long-ai-calls-timeout)',
    pattern: /\bapiPost\(['"`]\/v1\/ai\/(complete|transcribe|image|decide|embed)\b/,
  },
  {
    id: 'closed-node-fetch',
    tree: 'public',
    label: 'On a signed-in-only node a request the browser makes on its own carries no session: a view reads with apiGet or closedNodeFetch (public/js/closed-node-fetch.js) and draws an API picture with sessionSrc (public/js/session-src.js). A plain fetch(\'/v1/…\') or an <img src="/v1/…"> answers 401 SIGN_IN_REQUIRED to a person who is signed in, and every test that sends a Bearer token stays green (docs/pitfalls.md §124)',
    // The global fetch, not a session's own (`session.fetch(` adds the credential), and a picture whose
    // address is an API path written into the template.
    pattern: /(^|[^.\w$])fetch\(['"`]\/v1\/|\bsrc=["']\/v1\//,
    skipDirs: ['public/js/closed-node-fetch.js', 'public/js/session-src.js', 'public/js/api.js'],
  },
  {
    id: 'locale-format',
    tree: 'public',
    label: 'A number, date or time on a page is written by public/js/format.js (num, date, time, dateTime, money, percent, compact), which follows the reader\'s regional format and time zone. A decimal comma put in by hand (`.replace(\'.\', \',\')`) or a locale tag picked from the UI language (`getLocale() === \'fi\' ? \'fi-FI\' : …`) writes the format of the language, not the reader\'s; language, format and zone are three separate settings (docs/pitfalls.md §81). A raw Intl or toLocale*String call is the ESLint rule aimeat/no-raw-locale-format',
    pattern: /replace\(['"]\.['"],['"],['"]\)|getLocale\(\)===?['"][a-z]{2}['"]\?['"][a-z]{2}-[A-Z]{2}['"]/,
    skipDirs: ['public/js/format.js'],
  },
  {
    id: 'palette-cycle',
    tree: 'public',
    label: 'A data series takes its colour from colorForIndex (public/components/UsageChart.js), which never repeats one; a palette indexed with `i % palette.length` gives the thirteenth series the first one\'s colour, and in a stacked chart two segments of one colour cannot be told apart. Past a dozen series, fold the rest into "Other" or draw rows with a bar, which need no colour at all',
    pattern: /%[\w$.]*(PALETTE|COLORS|COLOURS|INK|palette|colors|colours|ink)[\w$]*\.length\]/,
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

/**
 * The browser code under public/: every `.js` and `.mjs` file except public/lib, which holds vendored
 * libraries, and the cortex libraries' build output. Each is read with the same scanner, so a comment
 * or a string that names the pattern is not a finding, and template text is (an `<img src="/v1/…">`).
 */
function walkPublic(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || full === path.join(ROOT, 'public', 'lib')) continue;
      walkPublic(full, out);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

function countAll(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = Object.fromEntries(RULES.map((r) => [r.id, {}]));
  const trees: Array<['src' | 'public', string[]]> = [
    ['src', walk(path.join(ROOT, 'src'))],
    ['public', walkPublic(path.join(ROOT, 'public'))],
  ];
  for (const [tree, files] of trees) {
    const rules = RULES.filter((r) => (r.tree ?? 'src') === tree);
    for (const file of files) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const applicable = rules.filter((r) => !r.skipDirs?.some((d) => rel.startsWith(d))
        && (!r.onlyDirs || r.onlyDirs.some((d) => rel.startsWith(d))));
      if (applicable.length === 0) continue;
      const lines = lineTexts(readFileSync(file, 'utf-8'));
      for (const rule of applicable) {
        const n = lines.filter((l) => rule.pattern.test(l)).length;
        if (n > 0) out[rule.id]![rel] = n;
      }
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
