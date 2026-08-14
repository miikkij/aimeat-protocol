import { describe, it, expect } from 'vitest';
import {
    parseGAII,
    buildGAII,
    validateAgentName,
    validateOwnerName,
    validateNodeId,
    isValidGAII,
    RESERVED_NAMES,
} from '../../src/utils/gaii.js';

describe('buildGAII', () => {
    it('constructs agent#owner@node format', () => {
        expect(buildGAII('my-agent', 'my-owner', 'aimeat-us-001-dev')).toBe('my-agent#my-owner@aimeat-us-001-dev');
    });
});

describe('parseGAII', () => {
    it('parses a valid GAII string', () => {
        const result = parseGAII('my-agent#my-owner@aimeat-us-001-dev');
        expect(result).toEqual({
            agent: 'my-agent',
            owner: 'my-owner',
            node: 'aimeat-us-001-dev',
            full: 'my-agent#my-owner@aimeat-us-001-dev',
        });
    });

    it('returns null for invalid format', () => {
        expect(parseGAII('bad-format')).toBeNull();
        expect(parseGAII('')).toBeNull();
        expect(parseGAII('agent@node')).toBeNull();
        expect(parseGAII('agent#owner')).toBeNull();
    });

    it('rejects names that are too short', () => {
        expect(parseGAII('a#my-owner@aimeat-us-001-dev')).toBeNull();
        expect(parseGAII('my-agent#b@aimeat-us-001-dev')).toBeNull();
    });

    it('rejects uppercase characters', () => {
        expect(parseGAII('My-Agent#my-owner@aimeat-us-001-dev')).toBeNull();
    });

    it('rejects invalid node format', () => {
        expect(parseGAII('my-agent#my-owner@invalid-node')).toBeNull();
    });
});

describe('isValidGAII', () => {
    it('returns true for valid GAII', () => {
        expect(isValidGAII('agent01#owner01@aimeat-us-001-dev')).toBe(true);
    });

    it('returns false for invalid GAII', () => {
        expect(isValidGAII('nope')).toBe(false);
    });
});

describe('validateAgentName', () => {
    it('accepts valid names', () => {
        expect(validateAgentName('my-agent')).toBeNull();
        expect(validateAgentName('agent01')).toBeNull();
        expect(validateAgentName('abc')).toBeNull();
    });

    it('rejects short names', () => {
        expect(validateAgentName('ab')).not.toBeNull();
        expect(validateAgentName('a')).not.toBeNull();
    });

    it('rejects names with uppercase', () => {
        expect(validateAgentName('MyAgent')).not.toBeNull();
    });

    it('rejects names starting/ending with hyphen', () => {
        expect(validateAgentName('-agent')).not.toBeNull();
        expect(validateAgentName('agent-')).not.toBeNull();
    });

    it('rejects reserved names', () => {
        expect(validateAgentName('admin')).toContain('reserved');
        expect(validateAgentName('system')).toContain('reserved');
        expect(validateAgentName('root')).toContain('reserved');
    });
});

describe('validateOwnerName', () => {
    it('accepts valid names', () => {
        expect(validateOwnerName('my-owner')).toBeNull();
    });

    it('rejects reserved names', () => {
        expect(validateOwnerName('admin')).toContain('reserved');
    });

    it('rejects invalid format', () => {
        expect(validateOwnerName('AB')).not.toBeNull();
    });
});

describe('validateNodeId', () => {
    it('accepts valid node IDs', () => {
        expect(validateNodeId('aimeat-us-001-dev')).toBeNull();
        expect(validateNodeId('aimeat-eu-042-production')).toBeNull();
    });

    it('rejects invalid node IDs', () => {
        expect(validateNodeId('not-a-node')).not.toBeNull();
        expect(validateNodeId('aimeat-US-001-dev')).not.toBeNull();
        expect(validateNodeId('')).not.toBeNull();
    });
});

describe('RESERVED_NAMES', () => {
    it('contains expected reserved names', () => {
        expect(RESERVED_NAMES.has('admin')).toBe(true);
        expect(RESERVED_NAMES.has('system')).toBe(true);
        expect(RESERVED_NAMES.has('root')).toBe(true);
        expect(RESERVED_NAMES.has('operator')).toBe(true);
    });

    it('does not contain non-reserved names', () => {
        expect(RESERVED_NAMES.has('my-agent')).toBe(false);
    });
});
