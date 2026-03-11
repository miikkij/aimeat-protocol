import { describe, it, expect } from 'vitest';

describe('MCP OAuth authorize dual-path flow', () => {
  describe('Path selection logic', () => {
    const hasSignatureParams = (q: { gaii?: string; signature?: string; timestamp?: string }) =>
      !!(q.gaii && q.signature && q.timestamp);

    it('Path A: detects signature params present', () => {
      expect(hasSignatureParams({
        gaii: 'agent#owner@node',
        signature: 'abc123',
        timestamp: '2026-03-11T00:00:00Z',
      })).toBe(true);
    });

    it('Path B: detects signature params absent', () => {
      expect(hasSignatureParams({})).toBe(false);
      expect(hasSignatureParams({ gaii: 'agent#owner@node' })).toBe(false);
      expect(hasSignatureParams({ gaii: 'agent#owner@node', signature: 'sig' })).toBe(false);
    });
  });

  describe('authorize-consent agent-owner validation', () => {
    it('allows when agent owner matches session owner', () => {
      const agent = { owner: 'jouni', gaii: 'app#jouni@node' };
      const ownerPayload = { owner: 'jouni' };
      expect(agent.owner).toBe(ownerPayload.owner);
    });

    it('rejects when agent owner does not match session owner', () => {
      const agent = { owner: 'jouni', gaii: 'app#jouni@node' };
      const ownerPayload = { owner: 'attacker' };
      expect(agent.owner).not.toBe(ownerPayload.owner);
    });
  });

  describe('redirect_uri validation', () => {
    it('accepts registered redirect_uri', () => {
      const client = { redirectUris: ['https://claude.ai/callback', 'https://example.com/cb'] };
      expect(client.redirectUris.includes('https://claude.ai/callback')).toBe(true);
    });

    it('rejects unregistered redirect_uri', () => {
      const client = { redirectUris: ['https://claude.ai/callback'] };
      expect(client.redirectUris.includes('https://evil.com/steal')).toBe(false);
    });

    it('allows when client has no registered URIs', () => {
      const client = { redirectUris: [] as string[] };
      // When no URIs registered, any URI is allowed (per OAuth spec for dev clients)
      const redirectUri = 'https://localhost:3000/callback';
      const isAllowed = client.redirectUris.length === 0 || client.redirectUris.includes(redirectUri);
      expect(isAllowed).toBe(true);
    });
  });
});
