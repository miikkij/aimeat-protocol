/**
 * @file mcp-capability-use-setting.test.ts
 * @description The node setting mcp.capability_use_approval (services/mcp-client/capability-use-setting.ts),
 *   value by value: the order from open to strict, the refusal an AI credential gets for a more open
 *   value and the person in person does not, and the environment's parse with its default. The E2E
 *   suite test/e2e-mcp-proxy.ts Phase 5f drives the same rule through PUT /v1/admin/config and the
 *   invoke route.
 * @version-history
 *   v1.1.0 — 2026-11-04 — The operator's owner-level PAT is the person and may change the setting either
 *     way (Jouni, 2026-11-04; codebase analysis 2026-11-03, PAT ruling); the agent is still refused.
 *   v1.0.0 — 2026-11-03 — Initial (secaudit2026nov02d round 13b).
 */
import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_USE_APPROVAL_PATH, CAPABILITY_USE_APPROVAL_LABEL, capabilityUseApprovalLoosens, capabilityUseApprovalChangeRefusal,
} from '../../src/services/mcp-client/capability-use-setting.js';
import { mcpCapabilityUseApprovalFrom, MCP_CAPABILITY_USE_APPROVAL_VALUES } from '../../src/config/types-agent-access.js';
import en from '../../locales/en.json' with { type: 'json' };

const person = { roles: ['owner', 'operator'] };
const agent = { roles: ['agent'] };
const pat = { roles: ['owner', 'operator'], via: 'pat' };

describe('mcp.capability_use_approval', () => {
  it('orders off, operators, ask from open to strict', () => {
    expect([...MCP_CAPABILITY_USE_APPROVAL_VALUES]).toEqual(['off', 'operators', 'ask']);
    expect(capabilityUseApprovalLoosens('ask', 'operators')).toBe(true);
    expect(capabilityUseApprovalLoosens('operators', 'off')).toBe(true);
    expect(capabilityUseApprovalLoosens('ask', 'off')).toBe(true);
    expect(capabilityUseApprovalLoosens('off', 'operators')).toBe(false);
    expect(capabilityUseApprovalLoosens('operators', 'ask')).toBe(false);
    expect(capabilityUseApprovalLoosens('ask', 'ask')).toBe(false);
    // A value the setting does not take is the validator's to refuse, not this rule's.
    expect(capabilityUseApprovalLoosens('ask', 'never')).toBe(false);
  });

  it('refuses an AI credential a more open value with PERSON_REQUIRED, naming the setting in details', () => {
    // The owner-level PAT is the person since 2026-11-04 (Jouni; codebase analysis 2026-11-03, PAT
    // ruling): it is asserted below with the person.
    for (const caller of [agent]) {
      const r = capabilityUseApprovalChangeRefusal(caller, 'ask', 'operators');
      expect(r?.status).toBe(403);
      expect(r?.code).toBe('PERSON_REQUIRED');
      expect(r?.details).toEqual({ setting: CAPABILITY_USE_APPROVAL_PATH, from: 'ask', to: 'operators' });
      expect(r?.message).toContain('Admin, Config');
      expect(r?.message).toContain(CAPABILITY_USE_APPROVAL_LABEL);
    }
  });

  it('lets an AI credential make it stricter, and the person in person change it either way', () => {
    expect(capabilityUseApprovalChangeRefusal(agent, 'off', 'operators')).toBeNull();
    expect(capabilityUseApprovalChangeRefusal(agent, 'operators', 'ask')).toBeNull();
    expect(capabilityUseApprovalChangeRefusal(person, 'ask', 'off')).toBeNull();
    expect(capabilityUseApprovalChangeRefusal(pat, 'ask', 'off')).toBeNull();
  });

  it('reads the environment, operators when unset or unknown', () => {
    expect(mcpCapabilityUseApprovalFrom(undefined)).toBe('operators');
    expect(mcpCapabilityUseApprovalFrom('')).toBe('operators');
    expect(mcpCapabilityUseApprovalFrom('sometimes')).toBe('operators');
    expect(mcpCapabilityUseApprovalFrom(' ASK ')).toBe('ask');
    expect(mcpCapabilityUseApprovalFrom('off')).toBe('off');
  });

  it('names the setting with the label the Config tab shows', () => {
    expect((en as { dashboard: Record<string, string> }).dashboard.cfg_mcp_capability_use_approval).toBe(CAPABILITY_USE_APPROVAL_LABEL);
  });
});
