import { describe, it, expect } from 'vitest';
import { success, error } from '../../src/middleware/envelope.js';

describe('success envelope', () => {
    it('returns ok: true with correct structure', () => {
        const result = success('meat-us-001-dev', { foo: 'bar' });
        expect(result.ok).toBe(true);
        expect(result.protocol).toBe('aimeat');
        expect(result.version).toBe('v1');
        expect(result.node).toBe('meat-us-001-dev');
        expect(result.data).toEqual({ foo: 'bar' });
        expect(result.request_id).toMatch(/^req-[0-9a-f]{8}$/);
        expect(result.timestamp).toBeDefined();
        expect(result.error).toBeUndefined();
    });

    it('includes hints when provided', () => {
        const hints = [{ description: 'Next', method: 'GET', url: '/v1/next' }];
        const result = success('meat-us-001-dev', {}, hints);
        expect(result.hints).toBeDefined();
        expect(result.hints!.next_actions).toHaveLength(1);
        expect(result.hints!.next_actions[0].url).toBe('/v1/next');
        expect(result.hints!.help_url).toBe('/v1/docs');
    });

    it('omits hints when not provided', () => {
        const result = success('meat-us-001-dev', {});
        expect(result.hints).toBeUndefined();
    });

    it('includes meta when provided', () => {
        const result = success('meat-us-001-dev', {}, undefined, { page: 1, per_page: 20, total: 100 });
        expect(result.meta).toEqual({ page: 1, per_page: 20, total: 100 });
    });
});

describe('error envelope', () => {
    it('returns ok: false with error details', () => {
        const result = error('meat-us-001-dev', 'NOT_FOUND', 'Item not found');
        expect(result.ok).toBe(false);
        expect(result.protocol).toBe('aimeat');
        expect(result.version).toBe('v1');
        expect(result.node).toBe('meat-us-001-dev');
        expect(result.error).toEqual({ code: 'NOT_FOUND', message: 'Item not found' });
        expect(result.data).toBeUndefined();
        expect(result.request_id).toMatch(/^req-[0-9a-f]{8}$/);
    });

    it('includes default hints when none provided', () => {
        const result = error('meat-us-001-dev', 'ERR', 'fail');
        expect(result.hints).toBeDefined();
        expect(result.hints!.next_actions).toHaveLength(1);
        expect(result.hints!.next_actions[0].url).toBe('/v1/docs');
    });

    it('includes custom hints when provided', () => {
        const hints = [{ description: 'Retry', method: 'POST', url: '/v1/retry' }];
        const result = error('meat-us-001-dev', 'ERR', 'fail', 500, undefined, hints);
        expect(result.hints!.next_actions).toHaveLength(1);
        expect(result.hints!.next_actions[0].description).toBe('Retry');
    });

    it('includes error details when provided', () => {
        const result = error('meat-us-001-dev', 'VALIDATION', 'Invalid', 400, { field: 'name' });
        expect(result.error!.details).toEqual({ field: 'name' });
    });
});
