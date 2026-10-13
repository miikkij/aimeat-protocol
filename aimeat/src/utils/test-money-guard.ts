/**
 * @file src/utils/test-money-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the test-only money handler (`test.money`, commerce/test-money-handler.ts)
 *   runs on this node, and whether the operator must be warned about it. The handler settles EUR
 *   and USD with no real payment.
 *
 *   THE FLAG DECIDES, ON ANY NODE. AIMEAT_TEST_MONEY_HANDLER=true registers test.money whatever the
 *   node's address is, so the money path can be tested in production before the flag is turned off
 *   (ruling decision-testiraha-toimii-julkisella-nodella-kun-operaattori-kytkee-s, 2026-10-13). The
 *   operator accepts the risk while the flag is on.
 *
 *   THE ADDRESS DECIDES THE WARNING. The E2E runner, the in-process suites and `pnpm sandbox` all
 *   start a node whose public URL is a loopback address (localhost, *.localhost, 127.0.0.0/8,
 *   [::1]); there the flag is ordinary and nothing warns. On any other address (a private LAN
 *   address and AIMEAT_SECURITY_PROFILE=local included, because both describe nodes other people
 *   use) any buyer can complete a money checkout without paying, so the start log says so
 *   (config-posture.ts) and the Security page shows it as critical (services/security-overview.ts).
 * @structure isLoopbackBaseUrl · testMoneyHandlerActive · testMoneyHandlerOnPublicNode
 * @usage if (testMoneyHandlerActive(config)) registerPaymentHandler(testMoneyPaymentHandler());
 * @version-history
 *   v2.0.0 — 2026-10-13 — The flag is in force on every node again; the loopback check only decides
 *     the warning. testMoneyHandlerRefused is replaced by testMoneyHandlerOnPublicNode (ruling
 *     decision-testiraha-toimii-julkisella-nodella-kun-operaattori-kytkee-s).
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

/** The flag is set: register test.money and let hold-book pick it, on any node. */
export function testMoneyHandlerActive(config: TestMoneyConfig): boolean {
  return config.testMoneyHandler === true;
}

/** The flag is set on a node others can reach: it is in force, and the operator is warned. */
export function testMoneyHandlerOnPublicNode(config: TestMoneyConfig): boolean {
  return testMoneyHandlerActive(config) && !isLoopbackBaseUrl(config.baseUrl);
}
