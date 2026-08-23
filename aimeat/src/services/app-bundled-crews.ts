/**
 * @file src/services/app-bundled-crews.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The crew-defs an app bundles inside its own HTML, so `manifest.cortex.agents`
 *   survives a PACKAGE install.
 *
 *   WHAT WAS BROKEN. Bundling itself works and is in production (NOSTE ships two crews on its app
 *   record). The PACKAGE door dropped them: `component-registrar.ts` builds an installed app's
 *   manifest by hand as `{ name, description, version, category, tags, authorDisplay, usesCortex }`
 *   with no `cortex` key at all, so a package whose app shipped crews installed an app with none —
 *   in silence, which is the part that cost the time.
 *
 *   WHY THE HTML IS THE CARRIER. The publish route takes crew-defs as a request field, and a
 *   package has no request: it has components. `PackageComponent` is `{ id, type, label, content,
 *   contentHash, dependencies }`, and `package-zip.ts` carries exactly `content` per component, so a
 *   new field on the type would be dropped by export/import and the same silence would come back by
 *   another road. The app's own HTML is already where this node reads a declaration FROM
 *   (`<meta name="aimeat-ai">` in app-ai-posture.ts, `<meta name="aimeat-scopes">` in
 *   app-agent-surface.ts), and it is the one thing every door and the ZIP carry unchanged.
 *
 *   A `<meta>` cannot hold an array of objects, so the block is a JSON script tag. Reading it is
 *   deliberately forgiving: a malformed declaration returns null rather than throwing, because it
 *   must never be able to fail an install — the same rule `parseAiPosture` follows for a publish.
 *   Validation against the crew-def contract stays where it already is (`validateCortexAgents`), so
 *   this file decides only "is there a block and is it shaped like a list of crew-defs".
 * @structure MAX_CREWS_BYTES · CREWS_BLOCK_RE · parseBundledCrews(html)
 * @usage
 *   import { parseBundledCrews } from './app-bundled-crews.js';
 *   const crews = parseBundledCrews(appHtml);   // null when the app declares none
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070): the carrier that lets a package ship agents.
 */
import { logger } from '../utils/logger.js';

/**
 * Largest crews block read. An app is capped at 5 MB and a crew-def is prose, so 256 kB is far
 * above any real declaration; the cap exists so a pathological app cannot make every install parse
 * megabytes. Over it, the block is ignored the same way a malformed one is.
 */
const MAX_CREWS_BYTES = 256 * 1024;

/**
 * `<script type="application/json" id="aimeat-crews"> … </script>`, attributes in any order.
 * Scanned over the whole document rather than the head, because this block is content-sized and an
 * author will reasonably put it at the end of the body next to the rest of their JSON.
 */
const CREWS_BLOCK_RE = /<script\b[^>]*\bid\s*=\s*["']aimeat-crews["'][^>]*>([\s\S]*?)<\/script\s*>/i;

/**
 * The crew-defs an app declares in its own HTML, or null when it declares none or the declaration
 * is unreadable.
 *
 * Never throws. The shape check is only "a non-empty array of plain objects" — whether each entry
 * is a VALID crew-def is `validateCortexAgents`'s job, and duplicating that here would be a second
 * definition of the same contract.
 */
export function parseBundledCrews(html: string): Record<string, unknown>[] | null {
    const m = CREWS_BLOCK_RE.exec(html);
    if (!m) return null;

    const body = m[1].trim();
    if (!body) return null;
    if (Buffer.byteLength(body, 'utf-8') > MAX_CREWS_BYTES) {
        logger.warn('app-bundled-crews: crews block over the size cap — ignored', {
            bytes: Buffer.byteLength(body, 'utf-8'), cap: MAX_CREWS_BYTES,
        });
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (err) {
        // An unreadable declaration must not be able to fail an install, so it reads as "none
        // declared". Logged rather than swallowed: the author needs to be able to find out why
        // their crews did not travel.
        logger.warn('app-bundled-crews: crews block is not valid JSON — treated as no crews', {
            error: String(err),
        });
        return null;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const allObjects = parsed.every(
        (c) => typeof c === 'object' && c !== null && !Array.isArray(c),
    );
    if (!allObjects) {
        logger.warn('app-bundled-crews: crews block is not a list of objects — treated as no crews');
        return null;
    }

    return parsed as Record<string, unknown>[];
}
