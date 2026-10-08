/**
 * @file free-port.ts
 * @description The port for a node a suite starts for itself: a block of a hundred that belongs to
 *   that suite, plus the last two digits of the lane's own port, so two lanes never share one.
 *
 *   WHY BELOW 32768. Linux hands out every port from 32768 to 60999 on its own: as the local port of
 *   an outgoing connection, and to any `listen(0)`. Windows and macOS do the same from 49152. A
 *   fixed number in that range was taken by a database connection on the Postgres sweeps of
 *   2026-09-30 and 2026-10-02 (41104, EADDRINUSE). Asking the system for a free port instead
 *   (v1.0.0) lost a race: the probe closes, the node takes seconds to boot, and on 2026-10-08
 *   another suite's stub server got the same number from its own `listen(0)` first, so the node
 *   could not bind and the suite talked to the stub (`{"ok":true}` to everything). Nothing hands out
 *   a port below 32768 by itself, so a number there stays free until the suite that owns it binds.
 *
 *   THE BLOCKS. 31000 e2e-capabilities, 31100 e2e-capability-webhook-update, 31200 and 31300
 *   e2e-federation-packages (nodes A and B). A new suite takes the next free hundred below 32700.
 * @usage const port = suitePort(31000, BASE);
 * @version-history
 *   v2.0.0 — 2026-10-08 — suitePort(block, base) replaces freePort(): a fixed port below the range
 *     the system hands out, because the probe-then-boot window lost to another suite's listen(0).
 *   v1.0.0 — 2026-10-02 — Initial, from e2e-peer-registration-proof.ts's own copy.
 */

/**
 * `block` (a multiple of 100 from 30000 to 32600) plus the last two digits of the lane's port, read
 * from the suite's base URL.
 */
export function suitePort(block: number, base: string): number {
    if (!Number.isInteger(block) || block % 100 !== 0 || block < 30000 || block > 32600) {
        throw new Error(`suitePort: block must be a multiple of 100 from 30000 to 32600, got ${block}`);
    }
    return block + (Number(new URL(base).port || '80') % 100);
}
