/**
 * @file src/utils/test-money-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the test-only money handler (`test.money`, commerce/test-money-handler.ts)
 *   may run on this node. The handler settles EUR and USD with no real payment, so a node that
 *   anyone outside this machine can reach must never register it or route a money call to it.
 *
 *   THE SIGNAL IS THE NODE'S OWN ADDRESS. The E2E runner, the in-process suites and `pnpm sandbox`
 *   all start a node whose public URL is a loopback address (localhost, *.localhost, 127.0.0.0/8,
 *   [::1]). A node that people reach from the internet cannot have one. A private LAN address does
 *   not count, and neither does AIMEAT_SECURITY_PROFILE=local: both describe nodes other people use.
 *
 *   WHY THE NODE STILL STARTS. aimeat.io ran with AIMEAT_TEST_MONEY_HANDLER=true on 2026-10-11. A
 *   start refusal would have taken it down at the next deploy; ignoring the flag closes the hole
 *   at the same deploy and keeps the node up. The refusal is still loud: the start log says it
 *   (config-posture.ts) and the Security page shows it as critical (services/security-overview.ts).
 * @structure isLoopbackBaseUrl · testMoneyHandlerActive · testMoneyHandlerRefused
 * @usage if (testMoneyHandlerActive(config)) registerPaymentHandler(testMoneyPaymentHandler());
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-testiraha-ei-voi-olla-p-ll-tuotantonodessa-test-money).
 */

/** The two config fields the decision reads. */
interface TestMoneyConfig { testMoneyHandler: boolean; baseUrl: string }

/** Is this address one only this machine can reach? */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;   // an address that does not parse is not a test node's
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '[::1]' || host === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** The flag is set and the node is a test node: register test.money and let hold-book pick it. */
export function testMoneyHandlerActive(config: TestMoneyConfig): boolean {
  return config.testMoneyHandler === true && isLoopbackBaseUrl(config.baseUrl);
}

/** The flag is set on a node others can reach: it is ignored, and the operator is told. */
export function testMoneyHandlerRefused(config: TestMoneyConfig): boolean {
  return config.testMoneyHandler === true && !isLoopbackBaseUrl(config.baseUrl);
}
