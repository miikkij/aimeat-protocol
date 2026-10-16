/**
 * @file test/unit/denial-coverage.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description check:denial-coverage reads which refusal a suite asks about. The first detector
 *   returned true on the first 401 or 403 in any assert condition, so an anonymous 401 or
 *   `assert(r.status !== 403)` passed a gate labelled "Every suite asks what a second principal gets"
 *   (QA audit 2026-10-16, P3-08). These pin the three answers.
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit P3-08).
 */
import { describe, expect, it } from 'vitest';
import { denialKind, hasDenialAssertion } from '../../scripts/check-denial-coverage.js';

describe('denialKind', () => {
    it('a 403 on an authenticated call is a second-principal refusal', () => {
        expect(denialKind("assert(r.status === 403, 'another owner is refused');")).toBe('second-principal');
        expect(denialKind("assert([403, 404].includes(r.status), 'hidden or refused');")).toBe('second-principal');
    });

    it('an MCP refusal counts, and its positive control does not', () => {
        expect(denialKind("assert(body.result.isError === true, 'refused');")).toBe('second-principal');
        expect(denialKind("assert(!body.result.isError, 'works for the owner');")).toBe('none');
    });

    it('a 401 alone is anonymous-only: it says a credential is asked for, not whose data is reached', () => {
        expect(denialKind("assert(r.status === 401, `expected 401, got ${r.status}`);")).toBe('anonymous-only');
    });

    it('a status compared with !== is a positive control, not a refusal', () => {
        expect(denialKind("assert(r.status !== 403, 'the operator may');")).toBe('none');
        expect(denialKind("assert(r.status != 403, 'the operator may');")).toBe('none');
        expect(denialKind("assert(r.status === 401, 'anon');\nassert(r.status !== 403, 'operator');")).toBe('anonymous-only');
    });

    it('a number in the message is not the condition', () => {
        expect(denialKind("assert(ok, 'expected 403 eventually');")).toBe('none');
    });

    it('hasDenialAssertion still answers whether any refusal is asked about', () => {
        expect(hasDenialAssertion("assert(r.status === 401, 'anon');")).toBe(true);
        expect(hasDenialAssertion("assert(r.status !== 403, 'operator');")).toBe(false);
    });
});
