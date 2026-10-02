/**
 * @file free-port.ts
 * @description A port nothing listens on at this moment, chosen by the operating system, for a node
 *   a suite spawns for itself.
 *
 *   WHY NOT A PORT DERIVED FROM THE LANE. e2e-capabilities (41000 + lane % 100) and
 *   e2e-capability-webhook-update (41100 + lane % 100) took fixed numbers, and on Linux those sit
 *   inside the range the kernel hands out as the local port of an outgoing connection (32768-60999).
 *   The Postgres sweep holds many connections to one address, which tends to get the same local
 *   ports night after night, and on 2026-09-30 and 2026-10-02 one of them held 41104 when the
 *   allowlist node tried to listen there: EADDRINUSE, seven assertions red, on that backend only.
 *   A port the kernel just handed us is one no connection holds.
 *
 *   THE PROBE BINDS WHAT THE NODE BINDS. The node listens with no host, which is `::` and every
 *   address; a probe on 127.0.0.1 alone can call a port free that is held on `::` (pitfalls §77b).
 * @usage const port = await freePort();
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial, from e2e-peer-registration-proof.ts's own copy.
 */
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

/** A port nothing listens on at this moment. */
export async function freePort(): Promise<number> {
    const s = createServer();
    await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.listen(0, () => resolve());
    });
    const port = (s.address() as AddressInfo).port;
    await new Promise<void>(resolve => s.close(() => resolve()));
    return port;
}
