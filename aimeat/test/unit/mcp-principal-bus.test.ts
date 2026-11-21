/**
 * @file test/unit/mcp-principal-bus.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PrincipalBus (src/mcp/principal-bus.ts): a listen stream remembers the principal it was
 *   opened as, publishTo reaches that principal's streams only, publish reaches every stream, and a
 *   stream opened outside runAs hears broadcasts and never a per-principal event.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-mcp-kuuntelukanava-kertoo-toisen-omistajan-muistikirjoituste).
 */
import { describe, it, expect } from 'vitest';
import type { ServerEvent } from '@modelcontextprotocol/server';
import { PrincipalBus } from '../../src/mcp/principal-bus.js';

const LIST: ServerEvent = { kind: 'resources_list_changed' };
const TOOLS: ServerEvent = { kind: 'tools_list_changed' };

function stream(bus: PrincipalBus, principal?: string) {
    const heard: string[] = [];
    const listen = () => bus.subscribe(e => heard.push(e.kind));
    const unsubscribe = principal === undefined ? listen() : bus.runAs(principal, listen);
    return { heard, unsubscribe };
}

describe('PrincipalBus', () => {
    it('reaches only the named principal with publishTo', () => {
        const bus = new PrincipalBus();
        const alice = stream(bus, 'claude#alice@node');
        const bob = stream(bus, 'claude#bob@node');
        bus.publishTo('claude#alice@node', LIST);
        expect(alice.heard).toEqual(['resources_list_changed']);
        expect(bob.heard).toEqual([]);
    });

    it('reaches every stream with publish', () => {
        const bus = new PrincipalBus();
        const alice = stream(bus, 'claude#alice@node');
        const bob = stream(bus, 'claude#bob@node');
        bus.publish(TOOLS);
        expect(alice.heard).toEqual(['tools_list_changed']);
        expect(bob.heard).toEqual(['tools_list_changed']);
    });

    it('gives a stream opened outside runAs broadcasts only', () => {
        const bus = new PrincipalBus();
        const nobody = stream(bus);
        bus.publishTo('claude#alice@node', LIST);
        bus.publish(TOOLS);
        expect(nobody.heard).toEqual(['tools_list_changed']);
    });

    it('stops delivering after unsubscribe, and one failing listener does not stop the others', () => {
        const errors: string[] = [];
        const bus = new PrincipalBus(e => errors.push(e.message));
        bus.runAs('claude#alice@node', () => bus.subscribe(() => { throw new Error('boom'); }));
        const alice = stream(bus, 'claude#alice@node');
        bus.publishTo('claude#alice@node', LIST);
        expect(alice.heard).toEqual(['resources_list_changed']);
        expect(errors).toEqual(['boom']);
        alice.unsubscribe();
        bus.publishTo('claude#alice@node', LIST);
        expect(alice.heard).toHaveLength(1);
        expect(bus.listenerCount).toBe(1);
    });
});
