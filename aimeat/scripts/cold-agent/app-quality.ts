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
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';

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
    return {
        bytes: html.length,
        blocking: lint.blocking.map(f => f.pitfall),
        warnings: lint.warnings.map(f => f.pitfall),
        externalHosts: [...hosts],
        loadsAuthLib: /\/v1\/libs\/aimeat-auth\.js/.test(html),
        viewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
        readSpec: tiers.includes('build-app'),
        sectionsRead: tiers.filter(t => t !== 'build-app').map(t => t.slice('build-app/'.length)),
        sentSpecToken: publish.some(c => /"spec_token"\s*:\s*"spec-/.test(JSON.stringify(c.input))),
    };
}

/** One line for the report: what was wrong first, then what was read. */
export function describeQuality(q: AppQuality): string {
    const wrong = [
        ...q.blocking.map(b => `blocking ${b}`),
        ...q.warnings.map(w => `warning ${w}`),
        ...q.externalHosts.map(h => `loads from ${h}`),
        ...(q.loadsAuthLib ? [] : ['no aimeat-auth']),
        ...(q.viewportMeta ? [] : ['no viewport meta']),
    ];
    const read = q.readSpec ? `read the spec${q.sectionsRead.length ? ' + ' + q.sectionsRead.join(', ') : ''}` : 'did NOT read the spec';
    return `${Math.round(q.bytes / 1024)} kB; ${wrong.length ? wrong.join(', ') : 'nothing the lint or the head checks object to'}; ${read}; spec token ${q.sentSpecToken ? 'sent' : 'not sent'}`;
}
