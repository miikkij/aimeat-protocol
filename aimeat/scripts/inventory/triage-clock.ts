/**
 * @file scripts/inventory/triage-clock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The clock on a ratchet's triage. Shared by the three exemption files that carry
 *   reasoned clearances rather than bare counts.
 *
 *   WHY IT EXISTS, and it is the sharpest thing the 2026-09-06 code review found. A triaged entry is
 *   a CLAIM ABOUT CODE — "this door is right because X" — and code moves. `route-scope-exemptions`
 *   cleared `POST /v1/packages` with a justification that states its own precondition out loud ("if
 *   the node is ever set to 'operator' this branch becomes a no-op"), and `config.ts` later made
 *   exactly that true. The clearance became false and the gate went on reporting green, because
 *   nothing re-reads the reasoning written into a triage file. `protocol-versions.json` already had
 *   the answer for external specs: a date, and a ceiling on how old it may get.
 *
 *   THE CLOCK RUNS ON TRIAGED ENTRIES ONLY. A `SEEDED` line is an open question that everyone already
 *   knows is unanswered; ageing it would produce noise about debt nobody has claimed to have
 *   understood. What ages is the sentence that says "I read this and it is fine".
 *
 *   AND A TRIAGED ENTRY WITHOUT A DATE IS ITSELF A FAILURE, not a pass. Otherwise the clock is opted
 *   out of by omission, which is the same shape as every other defect in that review.
 * @structure TRIAGE_STAMP; triageAge(reason); staleTriage(exempt, maxAgeDays)
 * @usage
 *   const { stale, undated } = staleTriage(file.exempt, file.maxAgeDays);
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial, from the review finding that a clearance can expire in silence.
 */

/** The stamp a triaged line carries, e.g. `… [triaged 2026-08-16]`. */
export const TRIAGE_STAMP = /\[triaged (\d{4}-\d{2}-\d{2})\]/;

/** Whole days since an ISO day, floored. */
export function daysSince(day: string): number {
    const then = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
    return Math.floor((Date.now() - then) / 86_400_000);
}

export interface StaleEntry { key: string; day: string; age: number }

export interface TriageClockResult {
    /** Triaged entries whose stamp is older than the ceiling. */
    stale: StaleEntry[];
    /** Triaged entries carrying no stamp at all — the clock cannot be skipped by omission. */
    undated: string[];
    /** How many entries the clock actually watched. */
    watched: number;
}

/**
 * Read the clock over one exemption map.
 *
 * `SEEDED` lines are skipped: they are the untriaged backlog, and a date on them would claim a
 * reading nobody did.
 */
export function staleTriage(exempt: Record<string, string>, maxAgeDays: number): TriageClockResult {
    const stale: StaleEntry[] = [];
    const undated: string[] = [];
    let watched = 0;
    for (const [key, reason] of Object.entries(exempt)) {
        if (reason.startsWith('SEEDED')) continue;
        watched++;
        const m = TRIAGE_STAMP.exec(reason);
        if (!m) { undated.push(key); continue; }
        const age = daysSince(m[1]);
        if (age > maxAgeDays) stale.push({ key, day: m[1], age });
    }
    return { stale, undated, watched };
}

/** The lines a gate prints when the clock has run out. Shared so all three read alike. */
export function reportTriageClock(name: string, res: TriageClockResult, maxAgeDays: number): boolean {
    let bad = false;
    if (res.undated.length) {
        bad = true;
        console.error(`\n✖ ${res.undated.length} triaged ${name} entr(ies) carry no [triaged YYYY-MM-DD] stamp.`);
        console.error('  A clearance with no date cannot be re-checked, which is how one of these went');
        console.error('  quietly false for three weeks. Add the day you read it.');
        for (const k of res.undated.slice(0, 20)) console.error(`    ${k}`);
        if (res.undated.length > 20) console.error(`    …and ${res.undated.length - 20} more`);
    }
    if (res.stale.length) {
        bad = true;
        console.error(`\n✖ ${res.stale.length} ${name} clearance(s) not re-read in over ${maxAgeDays} days:`);
        for (const s of res.stale) console.error(`    ${s.key}  [triaged ${s.day}, ${s.age} days ago]`);
        console.error('  Read the code again. If the reason still holds, restamp it with today; if it');
        console.error('  does not, fix the code. Re-stamping without reading is the failure this catches.');
    }
    return bad;
}
