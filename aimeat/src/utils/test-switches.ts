/**
 * @file test-switches.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The test-only settings that are in force on a node other people can reach, each with
 *   the sentence the operator is told. The same treatment the test money handler has
 *   (utils/test-money-guard.ts): the setting keeps working wherever it is set, so a test or staging
 *   value carried over to a live node is not refused, but on a node whose public URL is not a
 *   loopback address the start log says so (config-posture.ts) and the Security page shows it as
 *   critical (services/security-overview.ts). A loopback node, which is what the E2E runner and
 *   `pnpm sandbox` start, gets no warning. Before this, five of these had no warning anywhere and dev
 *   mode had one start-log line (QA audit D8-01).
 * @structure TestSwitch · testSwitchesOnPublicNode(config)
 * @usage for (const s of testSwitchesOnPublicNode(config)) logger.warn(s.message);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D8-01).
 */
import { isLoopbackBaseUrl } from './test-money-guard.js';

/** One test-only setting that is on, and what it does to a live node. */
export interface TestSwitch { env: string; message: string }

/** The config fields these switches are read from. */
export interface TestSwitchConfig {
  baseUrl: string;
  devMode: boolean;
  testMode: boolean;
  x402Enabled: boolean;
  x402TestFacilitator: boolean;
  adminSetupOpenAfterFirstOperator: boolean;
  finvoiceOperator: string;
  connectFakeBaseUrl: string;
}

const TURN_OFF = 'To turn it off, remove the variable from this node\'s environment and restart the node.';

/** Every test-only setting in force on a node whose public URL is not a loopback address; empty otherwise. */
export function testSwitchesOnPublicNode(config: TestSwitchConfig): TestSwitch[] {
  if (isLoopbackBaseUrl(config.baseUrl)) return [];
  const on: TestSwitch[] = [];
  if (config.x402Enabled && config.x402TestFacilitator) {
    on.push({ env: 'AIMEAT_X402_TEST_FACILITATOR', message: `AIMEAT_X402_TEST_FACILITATOR=true is ACTIVE on a public node: the x402 payment check is a test double that accepts any well-formed proof of the right amount, so a buyer can complete a USD or EUR checkout without paying. ${TURN_OFF}` });
  }
  if (config.testMode) {
    on.push({ env: 'AIMEAT_TEST_MODE', message: `AIMEAT_TEST_MODE=true is ACTIVE on a public node: registering a name that is already taken erases that account and all its data and creates a new one. ${TURN_OFF}` });
  }
  if (config.devMode) {
    on.push({ env: 'AIMEAT_DEV_MODE', message: `AIMEAT_DEV_MODE=true is ACTIVE on a public node: security checks are relaxed and a duplicate registration can erase an account. ${TURN_OFF}` });
  }
  if (config.adminSetupOpenAfterFirstOperator) {
    on.push({ env: 'AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR', message: `AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR=true is ACTIVE on a public node: anyone with the admin password can still create operator accounts at /v1/admin/setup/register. ${TURN_OFF}` });
  }
  if (config.finvoiceOperator === 'mock') {
    on.push({ env: 'AIMEAT_FINVOICE_OPERATOR', message: `AIMEAT_FINVOICE_OPERATOR=mock is ACTIVE on a public node: e-invoices are marked as sent to a test double and reach nobody. Set it to rest with a real operator, or remove it. ${TURN_OFF}` });
  }
  if (config.connectFakeBaseUrl) {
    on.push({ env: 'AIMEAT_CONNECT_FAKE_BASE_URL', message: `AIMEAT_CONNECT_FAKE_BASE_URL is set on a public node: three test providers appear in the list of outside accounts people can connect. ${TURN_OFF}` });
  }
  return on;
}
