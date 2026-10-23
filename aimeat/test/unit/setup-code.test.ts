/**
 * @file test/unit/setup-code.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-time setup code (src/services/setup-code.ts): which nodes ask for it, that a
 *   code matches only itself, that take() lets one caller through, and that release() puts a code
 *   back when the owner could not be created.
 * @version-history
 *   2026-10-23 — Both functions take fromLoopback: a loopback base URL waives the code only for a request
 *     from loopback (secaudit2026oct22).
 *   2026-10-16 — setupCodeRefusal: the refusal the setup and the registration routes answer (Jouni, 2026-10-16).
 *   2026-10-16 — Initial (Jouni, 2026-10-16: first-owner setup needs a one-time code on a public node).
 */
import { describe, it, expect } from 'vitest';
import { SetupCodeGate, normalizeSetupCode, setupCodeGateFor, setupCodeRefusal, setupCodeRequired } from '../../src/services/setup-code.js';

describe('setupCodeRequired', () => {
    it('asks on any base URL that is not loopback, a private LAN address included, whoever asks', () => {
        expect(setupCodeRequired({ baseUrl: 'https://node.example' }, false)).toBe(true);
        expect(setupCodeRequired({ baseUrl: 'https://node.example' }, true)).toBe(true);
        expect(setupCodeRequired({ baseUrl: 'http://192.168.1.20:40050' }, true)).toBe(true);
    });
    it('does not ask a request from loopback on a loopback base URL', () => {
        expect(setupCodeRequired({ baseUrl: 'http://localhost:40050' }, true)).toBe(false);
        expect(setupCodeRequired({ baseUrl: 'http://127.0.0.1:40050' }, true)).toBe(false);
        expect(setupCodeRequired({ baseUrl: 'http://[::1]:40050' }, true)).toBe(false);
    });
    // secaudit2026oct22: a node in Docker keeps the default http://localhost base URL while compose
    // publishes its port on every address of the host; the base URL alone let the first visitor in.
    it('asks a request from another machine on a loopback base URL', () => {
        expect(setupCodeRequired({ baseUrl: 'http://localhost:40050' }, false)).toBe(true);
    });
});

describe('SetupCodeGate', () => {
    it('issues a code in three groups of four, and matches it whatever the case, spaces or hyphens', () => {
        const gate = new SetupCodeGate();
        const code = gate.issue();
        expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
        expect(gate.pending).toBe(true);
        expect(gate.matches(code)).toBe(true);
        expect(gate.matches(code.toLowerCase().replace(/-/g, ' '))).toBe(true);
    });
    it('refuses a wrong code, an empty one and a value that is not a string', () => {
        const gate = new SetupCodeGate();
        const code = gate.issue();
        const wrong = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
        expect(gate.matches(wrong)).toBe(false);
        expect(gate.matches('')).toBe(false);
        expect(gate.matches(undefined)).toBe(false);
        expect(gate.matches({ code })).toBe(false);
    });
    it('matches nothing before a code is issued', () => {
        const gate = new SetupCodeGate();
        expect(gate.pending).toBe(false);
        expect(gate.matches('0000-0000-0000')).toBe(false);
        expect(gate.take('0000-0000-0000')).toBe(false);
    });
    it('lets one take through: the second take of the same code is refused', () => {
        const gate = new SetupCodeGate();
        const code = gate.issue();
        expect(gate.take(code)).toBe(true);
        expect(gate.take(code)).toBe(false);
        gate.commit();
        expect(gate.pending).toBe(false);
        expect(gate.matches(code)).toBe(false);
    });
    it('puts a taken code back when the owner could not be created', () => {
        const gate = new SetupCodeGate();
        const code = gate.issue();
        expect(gate.take(code)).toBe(true);
        gate.release();
        expect(gate.pending).toBe(true);
        expect(gate.take(code)).toBe(true);
    });
    it('a new code replaces the old one, and clear() leaves none', () => {
        const gate = new SetupCodeGate();
        const first = gate.issue();
        const second = gate.issue();
        expect(gate.matches(first)).toBe(first === second);
        expect(gate.matches(second)).toBe(true);
        gate.clear();
        expect(gate.matches(second)).toBe(false);
    });
});

describe('setupCodeRefusal', () => {
    it('asks nothing of a request from loopback on a loopback node', () => {
        expect(setupCodeRefusal({ baseUrl: 'http://localhost:40050' }, undefined, true)).toBeNull();
    });
    it('asks a request from another machine on a loopback node, and takes the code the start log printed', () => {
        const config = { baseUrl: 'http://localhost:40050' };
        const code = setupCodeGateFor(config).issue();
        expect(setupCodeRefusal(config, undefined, false)?.code).toBe('SETUP_CODE_REQUIRED');
        expect(setupCodeRefusal(config, code, false)).toBeNull();
    });
    it('answers SETUP_CODE_REQUIRED with no code waiting or none sent, SETUP_CODE_INVALID for a wrong one, null for the right one', () => {
        const config = { baseUrl: 'https://node.example' };
        expect(setupCodeRefusal(config, 'ABCD-EFGH-JKMN', false)?.code).toBe('SETUP_CODE_REQUIRED');
        const code = setupCodeGateFor(config).issue();
        expect(setupCodeRefusal(config, '', false)?.code).toBe('SETUP_CODE_REQUIRED');
        expect(setupCodeRefusal(config, (code[0] === 'A' ? 'B' : 'A') + code.slice(1), false)?.code).toBe('SETUP_CODE_INVALID');
        expect(setupCodeRefusal(config, code, false)).toBeNull();
    });
});

describe('normalizeSetupCode', () => {
    it('reads O as 0 and I or L as 1', () => {
        expect(normalizeSetupCode('o1l-ix')).toBe('0111X');
    });
});

describe('setupCodeGateFor', () => {
    it('gives one gate per config object', () => {
        const a = {};
        const b = {};
        expect(setupCodeGateFor(a)).toBe(setupCodeGateFor(a));
        expect(setupCodeGateFor(a)).not.toBe(setupCodeGateFor(b));
    });
});
