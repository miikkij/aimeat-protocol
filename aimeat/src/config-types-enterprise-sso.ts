/**
 * @file src/config-types-enterprise-sso.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Enterprise SSO configuration (BR-04): the two runtime switches for organisation
 *   sign-in (SAML) and provisioning (SCIM). Mixed into AimeatConfig the same way
 *   SocialLoginConfig is. Both are ORDINARY runtime-mutable config keys on purpose: an
 *   organisation node's host pins them read-only with AIMEAT_SEALED_CONFIG_KEYS
 *   (services/config-sealing.ts) rather than with a new immutable flag — sealing is the existing
 *   mechanism for "the second party may read this and must not change it".
 * @structure EnterpriseSsoConfig.
 * @usage export interface AimeatConfig extends …, EnterpriseSsoConfig { … }
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */

export interface EnterpriseSsoConfig {
  /**
   * Master switch for the public SSO doors: SAML login, the ACS, the SCIM endpoint and the public
   * SP metadata all answer 503 FEATURE_DISABLED when off. The operator's connection-management
   * routes stay available either way, so a node is configured first and switched on second.
   * Default false. Env AIMEAT_SSO_ENABLED, dot-path sso.enabled.
   */
  ssoEnabled: boolean;
  /**
   * Freeze connection management: every write to /v1/admin/sso/* answers 403 while set. For an
   * organisation node whose host wants "who may sign in" to take a deploy, seal THIS key —
   * then no operator session can thaw it. Default false. Env AIMEAT_SSO_CONNECTIONS_LOCKED,
   * dot-path sso.connections_locked.
   */
  ssoConnectionsLocked: boolean;
}
