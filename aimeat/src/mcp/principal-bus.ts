/**
 * @file src/mcp/principal-bus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event bus behind the 2026-07-28 listen streams (mcp/modern-endpoint.ts): each
 *   stream remembers the principal that opened it, and a resource change reaches only the streams of
 *   the principal whose namespace changed.
 *
 *   WHY NOT THE SDK'S OWN BUS. InMemoryServerEventBus hands every event to every open
 *   `subscriptions/listen` stream; its filter (listenFilterAccepts) reads the notification types a
 *   stream asked for and nothing about who asked. So owner B's agent heard
 *   `notifications/resources/list_changed` within a second of every new private key owner A wrote:
 *   no key name, no content, but the timing of another person's writes. The 2025-era session code
 *   never leaked it, because core.ts forwards an event only when `evt.agentGaii` is the session's
 *   own principal. This bus asks the same question on the modern code path.
 *
 *   HOW A STREAM GETS ITS PRINCIPAL. The SDK's listen router calls subscribe() synchronously while it
 *   builds the stream, inside the request modern-endpoint.ts serves, and that request runs inside
 *   `runAs(principal, ...)`. subscribe() reads the principal from that AsyncLocalStorage. A listener
 *   that subscribes outside it has no principal and hears broadcasts only, never a per-principal
 *   event: the safe direction.
 *
 *   WHAT STAYS A BROADCAST. `tools/list_changed` goes to every stream, as decision 2026-10-20 item 7
 *   accepted: each client re-reads its own principal-scoped tool list. Resource events are not part
 *   of that decision and are per principal here.
 * @structure PrincipalBus { runAs(principal, fn) · publish(event) · publishTo(principal, event) · subscribe(listener) }
 * @usage
 *   const bus = new PrincipalBus(onerror);
 *   createMcpHandler(factory, { bus });
 *   bus.runAs(principal, () => handler.fetch(request));   // the listen request
 *   bus.publishTo(evt.agentGaii, { kind: 'resources_list_changed' });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-mcp-kuuntelukanava-kertoo-toisen-omistajan-muistikirjoituste).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerEvent, ServerEventBus } from '@modelcontextprotocol/server';

type Listener = (event: ServerEvent) => void;

export class PrincipalBus implements ServerEventBus {
    private readonly listeners = new Map<Listener, string | undefined>();
    private readonly current = new AsyncLocalStorage<string>();

    constructor(private readonly onerror?: (error: Error) => void) {}

    /** Run `fn` as `principal`: a listen stream opened inside it belongs to that principal. */
    runAs<T>(principal: string, fn: () => T): T {
        return this.current.run(principal, fn);
    }

    /** Every open stream that asked for this notification type. */
    publish(event: ServerEvent): void {
        for (const listener of [...this.listeners.keys()]) this.deliver(listener, event);
    }

    /** Only the streams `principal` opened. */
    publishTo(principal: string, event: ServerEvent): void {
        for (const [listener, owner] of [...this.listeners]) {
            if (owner !== undefined && owner === principal) this.deliver(listener, event);
        }
    }

    subscribe(listener: Listener): () => void {
        this.listeners.set(listener, this.current.getStore());
        let live = true;
        return () => {
            if (!live) return;
            live = false;
            this.listeners.delete(listener);
        };
    }

    /** The number of open streams (tests). */
    get listenerCount(): number {
        return this.listeners.size;
    }

    private deliver(listener: Listener, event: ServerEvent): void {
        try {
            listener(event);
        } catch (error) {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
    }
}
