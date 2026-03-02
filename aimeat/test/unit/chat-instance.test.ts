import { describe, it, expect } from 'vitest';
import { buildChatInstanceId, parseChatInstanceId } from '../../src/utils/gaii.js';

describe('ChatInstance ID utilities', () => {
  const nodeId = 'aimeat-finland-001-genesis';

  describe('buildChatInstanceId', () => {
    it('builds logged-in chat instance ID', () => {
      const id = buildChatInstanceId('claude', 'myapp', 'jouni', nodeId);
      expect(id).toBe('claude-myapp#jouni@aimeat-finland-001-genesis');
    });

    it('builds anonymous chat instance ID', () => {
      const id = buildChatInstanceId('chatgpt', 'anon-1709337600', 'anonymous', nodeId);
      expect(id).toBe('chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis');
    });
  });

  describe('parseChatInstanceId', () => {
    it('parses logged-in chat instance ID', () => {
      const parsed = parseChatInstanceId('claude-myapp#jouni@aimeat-finland-001-genesis');
      expect(parsed).toEqual({
        platform: 'claude',
        appName: 'myapp',
        ownerName: 'jouni',
        nodeId: 'aimeat-finland-001-genesis',
        full: 'claude-myapp#jouni@aimeat-finland-001-genesis',
        isAnonymous: false,
      });
    });

    it('parses anonymous chat instance ID', () => {
      const parsed = parseChatInstanceId('chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis');
      expect(parsed).toEqual({
        platform: 'chatgpt',
        appName: 'anon-1709337600',
        ownerName: 'anonymous',
        nodeId: 'aimeat-finland-001-genesis',
        full: 'chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis',
        isAnonymous: true,
      });
    });

    it('returns null for invalid ID', () => {
      expect(parseChatInstanceId('not-valid')).toBeNull();
    });

    it('parses multi-word platform names', () => {
      const parsed = parseChatInstanceId('github-copilot-vscode#jouni@aimeat-finland-001-genesis');
      expect(parsed).not.toBeNull();
      expect(parsed!.platform).toBe('github-copilot');
      expect(parsed!.appName).toBe('vscode');
    });
  });
});
