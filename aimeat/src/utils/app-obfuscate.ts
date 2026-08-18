/**
 * @file app-obfuscate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Obfuscate an app's inline <script> blocks at serve time (the `obfuscate`
 *   protection flag). Uses javascript-obfuscator with a CONSERVATIVE preset — mangled
 *   identifiers + string-array encoding, but NO control-flow flattening / dead-code
 *   injection / self-defending (those have a high breakage risk on arbitrary app code).
 *   External `<script src>`, ES `module` scripts, and non-JS `<script type>` blocks are
 *   left untouched; any block that fails to obfuscate is served as-is. Obfuscation must
 *   never break an app. HONEST LIMIT: this raises reverse-engineering cost; it cannot
 *   make client code secret (the browser still runs it).
 * @structure obfuscateInlineScripts(html) — obfuscate inline JS, return the new HTML
 * @usage utils/app-protect.ts
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial (Phase 3 copy-protection).
 */
import JavaScriptObfuscator from 'javascript-obfuscator';

const OPTIONS = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal' as const,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'] as ['base64'],
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false,
  // Deliberately OFF — high breakage risk on arbitrary third-party app code.
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
};

/**
 * Obfuscate every inline JS `<script>` block in the HTML. Skips external (src),
 * ES-module, and non-JS scripts; serves any block that throws unchanged.
 */
export function obfuscateInlineScripts(html: string): string {
  return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs: string, code: string) => {
    if (/\bsrc\s*=/i.test(attrs)) return match;   // external script — nothing inline to obfuscate
    // Only plain JavaScript blocks; leave module / application/json / text/html templates alone.
    if (/\btype\s*=/i.test(attrs) && !/\btype\s*=\s*["']?(text\/javascript|application\/javascript)["']?/i.test(attrs)) return match;
    if (!code.trim()) return match;
    try {
      return `<script${attrs}>${JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode()}</script>`;
    } catch {
      return match;   // never break the app
    }
  });
}
