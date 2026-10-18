/**
 * @file test/helpers/classification-caps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Take every audience cap off the node's classifications, for a suite that tests
 *   something other than the caps. A new node's default labels carry the caps of decision 10.1 from
 *   its first start (plan doc-mvdipuyqraas, L5.1): Internal, the label of all unlabelled content, may
 *   be shown to signed-in accounts at most, so with classification on an unlabelled public write is
 *   refused. A suite that writes public content to test the reader, the federation exit or an agent's
 *   clearance takes the caps off first, as an operator of such a node may; the caps themselves are
 *   tested in e2e-classification-defaults.ts and e2e-classification-audience-cap.ts.
 * @structure takeOffAudienceCaps(base, operatorToken)
 * @usage await takeOffAudienceCaps(BASE, op.token);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L5.1).
 */

/** The operator stores the node policy with no cap on any label. Throws when either call fails. */
export async function takeOffAudienceCaps(base: string, operatorToken: string): Promise<void> {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` };
    const read = await fetch(`${base}/v1/classification/policy?level=node`, { headers });
    const body = await read.json() as { data?: { effective?: { labels?: Array<Record<string, unknown>> } & Record<string, unknown> } };
    const effective = body.data?.effective;
    if (read.status !== 200 || !effective?.labels) throw new Error(`node policy: ${read.status} ${JSON.stringify(body).slice(0, 300)}`);
    const policy = { ...effective, labels: effective.labels.map(l => ({ ...l, maxAudience: null })) };
    const put = await fetch(`${base}/v1/classification/policy`, { method: 'PUT', headers, body: JSON.stringify({ level: 'node', policy }) });
    if (put.status !== 200) throw new Error(`node policy without caps: ${put.status} ${(await put.text()).slice(0, 300)}`);
}
