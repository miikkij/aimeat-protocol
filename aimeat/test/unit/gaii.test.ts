import { describe, it, expect } from 'vitest';
import {
    parseGAII,
    parseGEAI,
    buildGAII,
    validateAgentName,
    validateOwnerName,
    validateNodeId,
    isValidGAII,
    isValidGHII,
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

    // The node grammar carried a hardcoded `aimeat-` brand prefix until 2026-08-24, which made
    // every identity on an organisation node (innokas-finland-001-genesis) unparseable: MCP
    // task_create answered "Could not resolve caller identity" to a caller whose token the same
    // server had minted. The grammar is now any 3-64 chars of lowercase alphanumerics in at least
    // two hyphen-separated segments; the old test asserting `invalid-node` fails is inverted below
    // because it asserted exactly the prefix requirement this change removes.
    it('parses identities on nodes without the aimeat- prefix', () => {
        const result = parseGAII('claude-mcp-work#jounimiikki@innokas-finland-001-genesis');
        expect(result).toEqual({
            agent: 'claude-mcp-work',
            owner: 'jounimiikki',
            node: 'innokas-finland-001-genesis',
            full: 'claude-mcp-work#jounimiikki@innokas-finland-001-genesis',
        });
        expect(parseGAII('my-agent#my-owner@invalid-node')).not.toBeNull();
    });

    it('still rejects a node id with no hyphen (an email host, not a node)', () => {
        expect(parseGAII('my-agent#my-owner@localhost')).toBeNull();
    });
});

describe('parseGEAI', () => {
    it('parses an ecosystem identity on a non-aimeat node', () => {
        const result = parseGEAI('eco:drum-news#jounimiikki@innokas-finland-001-genesis');
        expect(result).toEqual({
            app: 'drum-news',
            owner: 'jounimiikki',
            node: 'innokas-finland-001-genesis',
            full: 'eco:drum-news#jounimiikki@innokas-finland-001-genesis',
        });
    });
});

describe('isValidGHII', () => {
    it('accepts owner identities on any hyphenated node', () => {
        expect(isValidGHII('jounimiikki@innokas-finland-001-genesis')).toBe(true);
        expect(isValidGHII('alice@aimeat-local-001-dev')).toBe(true);
    });

    it('rejects an email address (hyphenless host)', () => {
        expect(isValidGHII('alice@gmail')).toBe(false);
        expect(isValidGHII('alice@gmail.com')).toBe(false);
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
    it('accepts valid node IDs, branded or not', () => {
        expect(validateNodeId('aimeat-us-001-dev')).toBeNull();
        expect(validateNodeId('aimeat-eu-042-production')).toBeNull();
        expect(validateNodeId('innokas-finland-001-genesis')).toBeNull();
        expect(validateNodeId('not-a-node')).toBeNull();
    });

    it('rejects invalid node IDs', () => {
        expect(validateNodeId('gmail')).not.toBeNull();
        expect(validateNodeId('aimeat-US-001-dev')).not.toBeNull();
        expect(validateNodeId('-leading-hyphen')).not.toBeNull();
        expect(validateNodeId('trailing-hyphen-')).not.toBeNull();
        expect(validateNodeId('double--hyphen')).not.toBeNull();
        expect(validateNodeId('has.dots-in-it')).not.toBeNull();
        expect(validateNodeId(`${'a'.repeat(63)}-b`)).not.toBeNull();
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
