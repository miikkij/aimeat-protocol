/**
 * @file src/services/app-artifact-lint.ts
 * @description What the node checks about an app's BYTES at publish, and the two findings it
 *   refuses to publish over.
 *
 *   THE PUBLISH THIS WAS WRITTEN AGAINST (aimeat.io, 2026-08-11). An app went live loading
 *   /lib/aimeat-auth.js and /lib/aimeat-data.js — both 404, the real path is /v1/libs/ — so it
 *   threw before drawing anything. Nothing in the publish path looked at the file. The response
 *   said "published", the catalogue card appeared, and the failure was discovered by opening it.
 *
 *   BLOCKING IS FOR "THIS CANNOT WORK", NEVER FOR "THIS COULD BE BETTER". Two findings block: an
 *   inline `<script>` that does not parse, and an asset URL this node answers 404 for. Both are
 *   claims about the bytes that can be PROVEN here, and both mean the app is broken for every
 *   visitor the moment it goes live. Everything else warns, for the same reason the AI-disclosure
 *   check warns (decision D2): a publish that fails is a publish that gets worked around.
 *
 *   THE PROBE FAILS OPEN ON INFRASTRUCTURE AND CLOSED ON EVIDENCE. Only a completed HTTP exchange
 *   answering 404/410 blocks. A timeout, a refused connection, a 5xx or a disabled probe produces
 *   NO finding: the node then has no evidence about that URL, and blocking a publish on the node's
 *   own network trouble would be a gate that fires when it is least useful. The probe only ever
 *   asks THIS node about its own paths — the destination is 127.0.0.1 on the node's own port, never
 *   a host taken from the uploaded HTML — so an app cannot make a publish reach anywhere.
 * @structure
 *   - AppArtifactFinding / AppArtifactLintResult — the shapes a publish response carries
 *   - lintAppArtifact(html, config) — the whole check: blocking[] + warnings[]
 *   - checkInlineScripts / collectAssetRefs / probeNodeAssets / checkTheme / checkMetas /
 *     checkAgentDataReads — one concern each
 * @usage
 *   import { lintAppArtifact } from './app-artifact-lint.js';
 *   const { blocking, warnings } = await lintAppArtifact(html, config);
 *   if (blocking.length) return refusal;
 * @version-history
 *   v1.0.0 — 2026-08-11 — initial: inline-JS parse + dead node asset URL (blocking); theme tokens,
 *     the head declarations and unscoped reads of agent-written data (warnings).
 */
import type { AimeatConfig } from '../config.js';
import { extractInlineScripts, moduleGoalAvailable, parseSource, selfTest } from '../utils/inline-script-parse.js';
import { logger } from '../utils/logger.js';

/**
 * One finding, shaped so an agent can act on it without prose parsing: a curated pitfall id, the
 * URL that explains it in full, and a message written for whoever built the app.
 */
export interface AppArtifactFinding {
  /** A curated appdev-pitfall id — GET /v1/appdev/pitfalls/{pitfall} has the full entry. */
  pitfall: string;
  severity: 'critical' | 'warn';
  message: string;
  /** Where the full entry lives. Node-relative, like every other link in a publish response. */
  url: string;
}

export interface AppArtifactLintResult {
  /** Proven-broken. The publish is refused and these are the reasons. */
  blocking: AppArtifactFinding[];
  /** Worth fixing. The app publishes anyway. */
  warnings: AppArtifactFinding[];
}

/** Only look at the head-ish part for declarations, as the posture check does. */
const SCAN_BYTES = 64 * 1024;

/** Belt on the probe: an app with a hundred asset refs must not turn one publish into a hundred. */
const MAX_PROBED_URLS = 25;
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 2500;

function finding(pitfall: string, severity: AppArtifactFinding['severity'], message: string): AppArtifactFinding {
  return { pitfall, severity, message, url: `/v1/appdev/pitfalls/${pitfall}` };
}

/**
 * THE publish-time artifact check — one function, so every door (inline, presigned, draft, MCP)
 * asks the same questions of the same bytes.
 */
export async function lintAppArtifact(html: string, config: AimeatConfig): Promise<AppArtifactLintResult> {
  const blocking: AppArtifactFinding[] = [];
  const warnings: AppArtifactFinding[] = [];

  blocking.push(...checkInlineScripts(html));

  const refs = collectAssetRefs(html, config);
  warnings.push(...refs.warnings);
  blocking.push(...await probeNodeAssets(refs.nodePaths, config));

  warnings.push(...checkTheme(html));
  warnings.push(...checkMetas(html));
  warnings.push(...checkAgentDataReads(html));

  return { blocking, warnings };
}

// ── Blocking check 1: does the app's own JavaScript compile? ────────────────────────────────────

/**
 * Parse every inline `<script>` body. A syntax error here is not a style opinion: the browser stops
 * at the same character, and everything the app was going to do after it never happens.
 *
 * `type="module"` blocks are skipped unless the process was started with --experimental-vm-modules,
 * because the alternative — parsing module source in script goal — reports a syntax error for a
 * correct `import` line. A false block is worse than a missed one: it teaches people that the gate
 * is wrong, and the next real finding gets worked around too.
 */
function checkInlineScripts(html: string): AppArtifactFinding[] {
  try {
    // The checker proves it still checks before it is trusted. If a sentinel ever parses, this
    // throws and the whole check is skipped rather than reporting passes it has not earned.
    selfTest();
  } catch (err) {
    logger.error('app-artifact-lint: the inline-script parser failed its own self-test — skipping the syntax check', { error: String(err) });
    return [];
  }

  const canParseModules = moduleGoalAvailable();
  const out: AppArtifactFinding[] = [];
  for (const block of extractInlineScripts(html)) {
    if (block.goal === 'module' && !canParseModules) continue;
    try {
      parseSource(block.source, `<script #${block.index}>`, block.goal);
    } catch (err) {
      out.push(finding('inline-js-does-not-parse', 'critical',
        `Inline <script> #${block.index} does not parse, so the browser stops there and the rest of the `
        + `app never runs: ${(err as Error).message}. Fix the syntax and publish again — locally, `
        + '`pnpm check:js-syntax --html your-app.html` parses every block the same way this does.'));
    }
  }
  return out;
}

// ── Blocking check 2: do the app's asset URLs exist on this node? ───────────────────────────────

interface AssetRefs {
  /** Same-node paths, deduped, ready to probe. */
  nodePaths: string[];
  /** Findings the classification itself produced (external hosts, relative paths). */
  warnings: AppArtifactFinding[];
}

/**
 * Every `<script src>` and stylesheet `<link href>`, sorted into "this node can answer for it" and
 * "this node cannot".
 *
 * An absolute URL on some other host is a warning, not a probe: the app CSP blocks external hosts,
 * so it is a real problem, but the node has no business making requests to a stranger's server
 * because someone published HTML naming it. A relative path is a warning too — a published app is
 * ONE file, so a sibling it refers to does not exist by construction.
 */
function collectAssetRefs(html: string, config: AimeatConfig): AssetRefs {
  const raw: string[] = [];
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const linkRe = /<link\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) raw.push(m[1] as string);
  while ((m = linkRe.exec(html)) !== null) {
    const attrs = m[1] ?? '';
    if (!/\brel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(attrs)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href) raw.push(href);
  }

  const nodeHosts = nodeHostnames(config);
  const nodePaths: string[] = [];
  const warnings: AppArtifactFinding[] = [];
  const seenPaths = new Set<string>();
  const seenExternal = new Set<string>();
  const seenRelative = new Set<string>();

  for (const ref of raw) {
    const value = ref.trim();
    if (!value || value.startsWith('#') || /^(data|blob|javascript|about):/i.test(value)) continue;

    if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
      const url = safeParseUrl(value.startsWith('//') ? `https:${value}` : value);
      if (!url) continue;
      const host = url.hostname.toLowerCase();
      if (nodeHosts.some(h => host === h || host.endsWith(`.${h}`))) {
        addPath(url.pathname + url.search);
        continue;
      }
      if (!seenExternal.has(host)) {
        seenExternal.add(host);
        warnings.push(finding('cdn-libs-blocked', 'warn',
          `This app loads assets from ${host}. The app CSP allows this node only, so on a hardened node `
          + 'the page goes blank. Use the node-vendored equivalent under /lib/ or /v1/libs/ — the build '
          + 'spec lists what exists.'));
      }
      continue;
    }

    if (value.startsWith('/')) { addPath(value); continue; }

    if (!seenRelative.has(value)) {
      seenRelative.add(value);
      warnings.push(finding('invented-lib-urls', 'warn',
        `"${value}" is a relative path, and a published app is ONE file with no siblings beside it — `
        + 'there is nothing for the browser to fetch there. Inline it, or load it from a node URL the '
        + 'build spec names.'));
    }
  }

  return { nodePaths, warnings };

  function addPath(path: string): void {
    if (seenPaths.has(path) || nodePaths.length >= MAX_PROBED_URLS) return;
    seenPaths.add(path);
    nodePaths.push(path);
  }
}

/** The hostnames that mean "this node": the apex from the base URL, plus its app-origin parent. */
function nodeHostnames(config: AimeatConfig): string[] {
  const out = new Set<string>();
  const apex = safeParseUrl(config.baseUrl)?.hostname.toLowerCase();
  if (apex) out.add(apex);
  return [...out];
}

function safeParseUrl(value: string): URL | null {
  // An unparseable URL is the ANSWER here, not a failure: the caller asks "is this a URL" and acts
  // on "no". Logging every malformed href an app happens to contain would be noise about the app.
  // eslint-disable-next-line aimeat/no-silent-catch -- "not a URL" is a result, not an error
  try { return new URL(value); } catch { return null; }
}

/**
 * Ask THIS node whether each path exists.
 *
 * The request goes to 127.0.0.1 on the node's own listening port — a fixed destination, with only
 * the path coming from the uploaded HTML — so this is the server asking itself a question, not
 * outbound traffic an app can aim. Anything other than a 404/410 leaves no finding: see the file
 * header on failing open.
 */
async function probeNodeAssets(paths: string[], config: AimeatConfig): Promise<AppArtifactFinding[]> {
  if (!config.appAssetProbe || paths.length === 0) return [];

  const dead: string[] = [];
  for (let i = 0; i < paths.length; i += PROBE_CONCURRENCY) {
    const slice = paths.slice(i, i + PROBE_CONCURRENCY);
    const answers = await Promise.all(slice.map(async (path) => ({ path, status: await probeOne(path, config) })));
    for (const a of answers) if (a.status === 404 || a.status === 410) dead.push(a.path);
  }
  if (dead.length === 0) return [];

  return [finding('invented-lib-urls', 'critical',
    `This node answers 404 for ${dead.length === 1 ? 'an asset this app loads' : 'assets this app loads'}: `
    + `${dead.join(', ')}. The app would throw before it drew anything. The SDK libraries live under `
    + '/v1/libs/ (aimeat-auth.js, aimeat-data.js, …) and the vendored packs under /lib/ — take the exact '
    + 'URLs from GET /v1/prompts/build-app rather than guessing one that looks right.')];
}

/** The status of one path, or null when the node could not get an answer at all. */
async function probeOne(path: string, config: AimeatConfig): Promise<number | null> {
  let target: URL;
  try {
    target = new URL(path, `http://127.0.0.1:${config.port}`);
  } catch (err) {
    // A path the URL parser rejects is not a path this node could answer for either. No finding:
    // the check reports what it PROVED, and it proved nothing here.
    logger.debug('app-artifact-lint: unparseable asset path — no finding recorded', { path, error: String(err) });
    return null;
  }
  try {
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      // Named so this reads as what it is in an access log, and so a handler can tell it from a
      // visitor. No Host header: `fetch` forbids setting one, and a loopback request without it is
      // treated as the node's apex, which is where these paths live.
      headers: { 'User-Agent': 'aimeat-publish-asset-probe', Accept: '*/*' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Nothing here reads the body; cancelling releases the socket immediately.
    await res.body?.cancel().catch((err: unknown) => {
      logger.debug('app-artifact-lint: releasing the probe body failed, which changes no answer', { path, error: String(err) });
    });
    return res.status;
  } catch (err) {
    logger.debug('app-artifact-lint: asset probe could not reach this node — no finding recorded', { path, error: String(err) });
    return null;
  }
}

// ── Warnings ────────────────────────────────────────────────────────────────────────────────────

/**
 * Does the app let the user's own light/dark and palette choices reach it?
 *
 * The observable failure is small and infuriating: the switch in the login pill flips
 * `<html data-theme>`, the app painted its own colours from `prefers-color-scheme`, and the control
 * does nothing. Flagged only when the app carries NEITHER the platform stylesheet NOR any theme
 * token, so an app that themes properly and happens to mention a media query stays quiet.
 */
function checkTheme(html: string): AppArtifactFinding[] {
  const usesPlatformTheme = /aimeat-theme\.css|aimeat-daisyui-bridge\.css|daisyui@5\.css/i.test(html);
  const usesTokens = /var\(\s*--(color-|text-|elev-|motion-|aimeat-)/i.test(html);
  const ownColorScheme = /@media[^{]*prefers-color-scheme/i.test(html);
  const ownHexes = (html.match(/[:\s]#[0-9a-f]{3,8}\b/gi) ?? []).length;

  if (usesPlatformTheme || usesTokens) return [];
  if (!ownColorScheme && ownHexes < 6) return [];

  return [finding('hardcoded-theme-colors', 'warn',
    'This app paints its own colours (no platform theme stylesheet and no theme tokens'
    + (ownColorScheme ? ', and it decides light/dark from prefers-color-scheme' : '')
    + '), so the login pill\'s light/dark switch and palette picker do nothing for its chrome — the '
    + 'user clicks and nothing happens. Load /lib/aimeat-theme.css and style with the tokens '
    + '(var(--color-primary), base-100/200/300); then all five palettes work for free and the user\'s '
    + 'stored choice wins over the OS preference.')];
}

/**
 * The three declarations in the head, checked once and reported once.
 *
 * Each is optional in the sense that the app still runs, and each changes what the platform can do
 * for it: scopes decide what the sign-in asks for, locales draw the language switch in the login
 * pill, and `aimeat-app` is how the page names itself on a per-app subdomain, where the filename
 * cannot be read off the URL.
 */
function checkMetas(html: string): AppArtifactFinding[] {
  const head = html.slice(0, SCAN_BYTES);
  const has = (name: string) => new RegExp(`<meta\\b[^>]*name\\s*=\\s*["']${name}["']`, 'i').test(head);
  const missing: string[] = [];
  if (!has('aimeat-app')) missing.push('`aimeat-app` (your published filename — on an app subdomain the page cannot work it out, and AIMEATAgentFace.publish needs it)');
  if (!has('aimeat-scopes')) missing.push('`aimeat-scopes` (what sign-in asks the user to approve; without it the app gets the default grant only, so ai:use and memory:delete are unavailable)');
  if (!has('aimeat-locales')) missing.push('`aimeat-locales` (the languages you have — this is what draws the language switch in the login pill; declare one language and nothing renders)');
  if (missing.length === 0) return [];

  return [finding('app-meta-declarations', 'warn',
    `The head declares none of: ${missing.join('; ')}. They are one line each and the build spec shows `
    + 'the exact form.')];
}

/**
 * An app that only READS, and never says whose namespace it is reading.
 *
 * Data an agent writes over MCP lands under the AGENT's GAII, not the owner's. An app-grant token is
 * role `app` and gets no owner-scope broadening, so `list({prefix})` legitimately returns nothing
 * and the app shows an empty screen to the very owner whose fleet produced the data. Flagged only
 * for the exact signature of that failure — the app reads, never writes, and names no namespace
 * anywhere — so a normal app storing its own data stays quiet.
 */
function checkAgentDataReads(html: string): AppArtifactFinding[] {
  const reads = /AIMEAT\.data\.(list|get|count)\s*\(/.test(html);
  if (!reads) return [];
  const writes = /AIMEAT\.data\.(set|remove|delete)\s*\(/.test(html);
  if (writes) return [];
  const scoped = /ownerScope|owner_scope|\bagent\s*:|getPublic\s*\(/.test(html);
  if (scoped) return [];

  return [finding('namespace-rule', 'warn',
    'This app reads memory and never writes any, and no read names a namespace — so every value it '
    + 'shows was written by something else. If that something else is one of the owner\'s agents, its '
    + 'keys live under the agent\'s GAII and these reads return nothing: the owner signs in and sees an '
    + 'empty app. Pass `{ ownerScope: true }` to cover the owner and all their agents, or `{ agent: '
    + '"name#owner@node" }` for one of them.')];
}
