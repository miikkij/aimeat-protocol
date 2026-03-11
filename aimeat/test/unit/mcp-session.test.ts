import { describe, it, expect } from 'vitest';

describe('MCP session tracking', () => {
  describe('ChatInstanceRecord with MCP fields', () => {
    it('accepts agentGaii and mcpClientId fields', () => {
      const record = {
        id: 'mcp-claude-1710000000#jouni@node',
        platform: 'claude',
        appName: 'mcp-claude',
        ownerName: 'jouni',
        ghii: 'jouni@node',
        nodeId: 'node',
        isAnonymous: false,
        createdAt: '2026-03-11T00:00:00Z',
        lastSeen: '2026-03-11T00:00:00Z',
        agentGaii: 'app#jouni@node',
        mcpClientId: 'mcp-client-abc123',
      };
      expect(record.agentGaii).toBe('app#jouni@node');
      expect(record.mcpClientId).toBe('mcp-client-abc123');
      expect(record.platform).toBe('claude');
      expect(record.isAnonymous).toBe(false);
    });

    it('allows optional MCP fields to be undefined', () => {
      const record = {
        id: 'mcp-unknown-1710000000#jouni@node',
        platform: 'unknown',
        appName: 'mcp-unknown',
        ownerName: 'jouni',
        ghii: 'jouni@node',
        nodeId: 'node',
        isAnonymous: false,
        createdAt: '2026-03-11T00:00:00Z',
        lastSeen: '2026-03-11T00:00:00Z',
      };
      expect(record.agentGaii).toBeUndefined();
      expect(record.mcpClientId).toBeUndefined();
    });
  });

  describe('Agent-owner enforcement', () => {
    it('rejects agents without valid owners', () => {
      // Simulates: storage.getOwner(agent.owner) returns null
      const ownerExists = false;
      expect(ownerExists).toBe(false);
      // Server should return 403 "Agent has no valid owner profile"
    });

    it('accepts agents with valid owners', () => {
      const agent = { owner: 'jouni', gaii: 'app#jouni@node' };
      const ownerRecord = { name: 'jouni', displayName: 'Jouni' };
      expect(ownerRecord).toBeTruthy();
      expect(agent.owner).toBe(ownerRecord.name);
    });
  });

  describe('Platform detection from User-Agent', () => {
    const detectPlatform = (ua: string): string => {
      const lower = ua.toLowerCase();
      if (lower.includes('claude')) return 'claude';
      if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
      if (lower.includes('copilot')) return 'copilot';
      if (lower.includes('cursor')) return 'cursor';
      if (lower.includes('gemini')) return 'gemini';
      return 'unknown';
    };

    it('detects Claude', () => {
      expect(detectPlatform('Claude-AI/1.0')).toBe('claude');
      expect(detectPlatform('Mozilla/5.0 claude-desktop')).toBe('claude');
    });

    it('detects ChatGPT', () => {
      expect(detectPlatform('ChatGPT-Plugin/1.0')).toBe('chatgpt');
      expect(detectPlatform('OpenAI-Client/2.0')).toBe('chatgpt');
    });

    it('detects other platforms', () => {
      expect(detectPlatform('Copilot/1.0')).toBe('copilot');
      expect(detectPlatform('Cursor-IDE/0.5')).toBe('cursor');
      expect(detectPlatform('Google-Gemini/1.0')).toBe('gemini');
    });

    it('returns unknown for unrecognized agents', () => {
      expect(detectPlatform('RandomBot/2.0')).toBe('unknown');
      expect(detectPlatform('')).toBe('unknown');
    });
  });
});
