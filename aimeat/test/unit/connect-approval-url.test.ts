/**
 * @file connect-approval-url.test.ts
 * @description The address `aimeat connect` prints for the owner to approve the agent must carry the
 *   user code. The consent page at /v1/agents/verify reads `?code=` and shows only "Missing code
 *   parameter" without it, so a bare verification_uri leaves the owner at an error page.
 * @version-history
 *   v1.0.0 -- 2026-10-14 -- Cover the bare-URL defect seen on innokas.aimeat.io.
 */
import { describe, it, expect } from 'vitest';
import { approvalUrl } from '../../src/cli/connect/auth.js';

describe('approvalUrl — the printed approval address carries the code', () => {
  it('uses verification_uri_complete when the node sends it', () => {
    expect(approvalUrl({
      user_code: '9NK3-8RZP',
      verification_uri: 'https://innokas.aimeat.io/v1/agents/verify',
      verification_uri_complete: 'https://innokas.aimeat.io/v1/agents/verify?code=9NK3-8RZP',
    })).toBe('https://innokas.aimeat.io/v1/agents/verify?code=9NK3-8RZP');
  });

  it('adds the code itself when the node sends only verification_uri', () => {
    expect(approvalUrl({
      user_code: '9NK3-8RZP',
      verification_uri: 'https://innokas.aimeat.io/v1/agents/verify',
    })).toBe('https://innokas.aimeat.io/v1/agents/verify?code=9NK3-8RZP');
  });
});
