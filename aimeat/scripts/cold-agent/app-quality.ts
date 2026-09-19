/**
 * @file app-quality.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a cold agent's published app is like, beyond "it exists".
 *
 *   "Published" says the agent found the door. It does not say whether the app follows the build
 *   specification, and that is the question a change to the specification's wording has to be
 *   measured against: a calmer text that publishes as often and breaks more rules is worse. So the
 *   published bytes are read back and put through the node's own publish-time lint
 *   (services/app-artifact-lint.ts, the same function every publish door calls), plus a few facts
 *   the specification asks of every app and the lint does not look at.
 *
 *   Facts, not a score. Which of them matter is for whoever reads two reports side by side.
 * @structure appQuality(baseUrl, ownerName, filename, toolCalls) → AppQuality
 * @usage const q = await appQuality(ctx.baseUrl, ctx.ownerName, app.filename, ctx.metrics.toolCalls);
 * @version-history
 *   v1.2.0 — 2026-09-19 — The Design Book round trip (searched, adopted, proposed back), how many of
 *     the kit's components the page calls, how many styles it made for itself, the libraries it
 *     read about, and whether it keeps its own colours. The book held 90 parts and none from a
 *     builder; whether that starts to move is only visible if a run's report says what it did there.
 *   v1.1.0 — 2026-09-19 — The build track. The measurement passed three Classic apps in a row as
 *     good on the day the developer was handed a Classic app by a model that had started on
 *     Atelier and changed over because Classic was quicker to begin. Nothing here looked at which
 *     track an app was on, so the thing he was angry about was invisible to it.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';
import { genreKeptShare, ownClassNames } from '../../src/services/app-genre-fork.js';

export interface AppQuality {
    bytes: number;
    /** Pitfall ids the node's publish lint reports on these bytes. */
    blocking: string[];
    warnings: string[];
    /** Hosts other than the node that the app loads a script or a stylesheet from. The spec allows none. */
    externalHosts: string[];
    loadsAuthLib: boolean;
    viewportMeta: boolean;
    /** Whether the run read the build specification over MCP before it published, and which sections. */
    readSpec: boolean;
    sectionsRead: string[];
    /** Whether the publish carried the spec token the specification hands out. */
    sentSpecToken: boolean;
    /** What the head declares in `aimeat-track`, or null. */
    declaredTrack: string | null;
    /** Whether the page loads the Atelier kit, which is what makes an app an Atelier app. */
    loadsAtelier: boolean;
    /** The `aimeat-register` the head names: the genre it was forked from, or its own. Null when absent or still the shell's placeholder. */
    register: string | null;
    /** Whether the run read the ATELIER build specification over MCP, and which parts. */
    atelierPartsRead: string[];
    /** The languages the head declares. Two is the default on this node. */
    locales: string[];
    /** Whether the page reads its words from a dictionary, which is what lets the switch change them. */
    usesDictionary: boolean;
    /** The share of its genre's own styles the page kept, or null when it names no shipped genre. */
    genreKept: number | null;
    /** What the run did at the Design Book: looked, took a proven part, gave one back. */
    book: { searched: number; adopted: number; proposed: number };
    /** Distinct components of the Atelier kit the page calls (`AIMEAT.atelier.<name>(` or `a.<name>(`). */
    kitComponents: string[];
    /** Styles the page made for itself, beyond the kit and its genre. */
    ownStyles: number;
    /** `fixed` keeps its own colours, `follows` changes with the person's theme; null when not said. */
    light: string | null;
    /** Every template id the run fetched, in order: which shell or genre it started from, and what it moved to. */
    templatesFetched: string[];
}

interface Call { name: string; input: unknown; isError: boolean }

export async function appQuality(baseUrl: string, ownerName: string, filename: string, toolCalls: Call[]): Promise<AppQuality> {
    const res = await fetch(`${baseUrl}/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}?mode=inline`);
    const html = res.ok ? await res.text() : '';
    const lint = html
        ? await lintAppArtifact(html, { baseUrl, nodeId: 'cold-agent' } as AimeatConfig)
        : { blocking: [], warnings: [] };
    const node = new URL(baseUrl).host;
    const hosts = new Set<string>();
    for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:)?\/\/([^/"']+)/gi)) {
        if (m[2] !== node) hosts.add(m[2]);
    }
    const tiers = toolCalls
        .filter(c => c.name === 'aimeat_handbook_get' && !c.isError)
        .map(c => String((c.input as { tier?: unknown } | null)?.tier ?? ''))
        .filter(t => t === 'build-app' || t.startsWith('build-app/'));
    const publish = toolCalls.filter(c => /^aimeat_app_(publish|draft_publish)$/.test(c.name));
    const atelierTiers = toolCalls
        .filter(c => c.name === 'aimeat_handbook_get' && !c.isError)
        .map(c => String((c.input as { tier?: unknown } | null)?.tier ?? ''))
        .filter(t => t === 'build-app-atelier' || t.startsWith('build-app-atelier/'));
    const templates = toolCalls
        .filter(c => c.name === 'aimeat_app_template_get' && !c.isError)
        .map(c => String((c.input as { id?: unknown } | null)?.id ?? ''))
        .filter(Boolean);
    const meta = (name: string): string | null => {
        const m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'));
        return m ? m[1].trim() : null;
    };
    const register = meta('aimeat-register');
    return {
        bytes: html.length,
        blocking: lint.blocking.map(f => f.pitfall),
        warnings: lint.warnings.map(f => f.pitfall),
        externalHosts: [...hosts],
        loadsAuthLib: /\/v1\/libs\/aimeat-auth\.js/.test(html),
        viewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
        readSpec: tiers.includes('build-app'),
        sectionsRead: tiers.filter(t => t !== 'build-app').map(t => t.slice('build-app/'.length)),
        sentSpecToken: publish.some(c => /"spec_token"\s*:\s*"(spec|atelier)-/.test(JSON.stringify(c.input))),
        declaredTrack: meta('aimeat-track'),
        // The node's own test (loadsAtelierKit in app-artifact-lint.ts): the script OR the
        // stylesheet. A forked genre is a committed page on the kit's stylesheet and boot script and
        // may never call the component library; the first version of this line asked for the script
        // only and failed a run that had read three parts of the specification and forked a genre.
        loadsAtelier: /aimeat-atelier\.(js|css)/i.test(html),
        register: register && !/^REPLACE-ME/i.test(register) ? register : null,
        atelierPartsRead: atelierTiers.map(t => t.slice('build-app-atelier'.length).replace(/^\//, '') || 'start'),
        templatesFetched: [...new Set(templates)],
        book: {
            searched: toolCalls.filter(c => c.name === 'aimeat_designbook_search' || c.name === 'aimeat_designbook_get').length,
            adopted: toolCalls.filter(c => c.name === 'aimeat_designbook_adopt' && !c.isError).length,
            proposed: toolCalls.filter(c => c.name === 'aimeat_designbook_propose' && !c.isError).length,
        },
        kitComponents: [...new Set([...html.matchAll(/\b(?:AIMEAT\.atelier|[aA])\.([a-z][A-Za-z]+)\s*\(/g)].map(m => m[1]).filter(n => !['app', 'i18n', 'status', 'describe', 'length', 'push', 'map', 'filter', 'forEach', 'slice', 'join', 'indexOf', 'concat', 'sort', 'reduce', 'find', 'some', 'every', 'includes', 'call', 'apply', 'then'].includes(n)))],
        ownStyles: ownClassNames(html).length,
        light: meta('aimeat-light'),
        locales: (meta('aimeat-locales') ?? '').split(/\s+/).filter(Boolean),
        usesDictionary: /i18n\.use\(|AIMEAT\.i18n|data-t=|data-i18n/.test(html),
        genreKept: register && register.startsWith('genre-') ? genreKeptShare(html, register.slice('genre-'.length)) : null,
    };
}

/** Is this an Atelier app in fact and not in name: the kit is loaded and the register is a real one. */
export const onAtelier = (q: AppQuality): boolean => q.loadsAtelier && !!q.register;

/** One line for the report: what was wrong first, then what was read. */
export function describeQuality(q: AppQuality): string {
    const wrong = [
        ...q.blocking.map(b => `blocking ${b}`),
        ...q.warnings.map(w => `warning ${w}`),
        ...q.externalHosts.map(h => `loads from ${h}`),
        // A Classic app mounts sign-in itself, so the library has to be there. An Atelier page gets
        // it from the shell or the boot script, and a page nobody signs in to needs none.
        ...(q.loadsAuthLib || onAtelier(q) ? [] : ['no aimeat-auth']),
        ...(q.viewportMeta ? [] : ['no viewport meta']),
    ];
    // "The spec" is the Classic one; the Atelier parts are reported beside the track.
    const read = q.readSpec ? `read the Classic spec${q.sectionsRead.length ? ' + ' + q.sectionsRead.join(', ') : ''}`
        : onAtelier(q) ? 'Classic spec not read, as it should be' : 'did NOT read the spec';
    const track =`${onAtelier(q) ? 'ATELIER' : q.loadsAtelier ? 'Atelier kit, no register' : 'CLASSIC'}${q.register ? ' (' + q.register.slice(0, 40) + ')' : ''}`
        + `; Atelier spec ${q.atelierPartsRead.length ? 'read: ' + q.atelierPartsRead.join(', ') : 'not read'}`
        + `; templates ${q.templatesFetched.length ? q.templatesFetched.join(' → ') : 'none'}`
        + `; languages ${q.locales.join(' ') || 'NONE DECLARED'}${q.locales.length >= 2 && !q.usesDictionary ? ' (declared, but no dictionary in the page)' : ''}`
        + (q.genreKept === null ? '' : `; kept ${Math.round(q.genreKept * 100)} % of its genre`)
        + `; light ${q.light ?? 'not said'}`
        + `; Design Book searched ${q.book.searched}, adopted ${q.book.adopted}, proposed ${q.book.proposed}`
        + `; kit components ${q.kitComponents.length ? q.kitComponents.join(' ') : 'none'}; own styles ${q.ownStyles}`;
    return `${track}; ${Math.round(q.bytes / 1024)} kB; ${wrong.length ? wrong.join(', ') : 'nothing the lint or the head checks object to'}; ${read}; spec token ${q.sentSpecToken ? 'sent' : 'not sent'}`;
}
