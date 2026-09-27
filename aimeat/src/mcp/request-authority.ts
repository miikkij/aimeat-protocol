/**
 * @file src/mcp/request-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Request-local credentials for a long-lived MCP server. Reuses VerifiedToken;
 *   no session may lend its bearer or permission snapshot to a concurrent request.
 * @version-history
 *   v1.0.0 -- 2026-09-27 -- Bind session principals and expose request-local scopes to registrations.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { VerifiedToken } from '../auth/jwt.js';

interface RequestAuthority { token: string; auth: VerifiedToken }

/** Identity and delegation stay fixed; token expiry, session id and scopes may change on refresh. */
export function sameMcpPrincipal(initial: VerifiedToken, current: VerifiedToken): boolean {
  const principalRoles = (auth: VerifiedToken) => auth.roles.filter(role => role !== 'operator').sort().join(',');
  return initial.sub === current.sub && initial.owner === current.owner && initial.node === current.node
    && principalRoles(initial) === principalRoles(current)
    && initial.app_grant === current.app_grant && initial.app === current.app
    && initial.eco_app === current.eco_app && initial.homeNode === current.homeNode
    && !!initial.federated === !!current.federated && !!initial.anonymous === !!current.anonymous;
}

/**
 * Registrations historically accept an array, including closures that read it after awaiting I/O.
 * This read-only view preserves that interface while every array operation reads THIS request's
 * snapshot. A shared mutable session array would let a concurrent, broader token widen a call.
 */
export function mcpRequestAuthority() {
  const context = new AsyncLocalStorage<RequestAuthority>();
  const scopes = new Proxy<string[]>([], {
    get(_target, property) {
      const current = context.getStore()?.auth.scopes ?? [];
      const value: unknown = Reflect.get(current, property);
      return typeof value === 'function' ? value.bind(current) : value;
    },
    set() { throw new TypeError('MCP request scopes are read-only'); },
  });
  return {
    scopes,
    token: () => context.getStore()?.token,
    run<T>(token: string, auth: VerifiedToken, operation: () => T): T {
      const snapshot = { ...auth, scopes: [...auth.scopes] };
      Object.freeze(snapshot.scopes);
      return context.run({ token, auth: snapshot }, operation);
    },
  };
}

/** The SDK reads enabled for discovery AND dispatch. Compute it from the current request. */
export function withRequestPermission(
  register: (...args: unknown[]) => unknown,
  allows: (name: string) => boolean,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const tool = register(...args) as { enabled: boolean } | undefined;
    if (!tool) return tool;
    let enabled = tool.enabled;
    Object.defineProperty(tool, 'enabled', {
      configurable: true,
      enumerable: true,
      get: () => enabled && allows(args[0] as string),
      set: (value: boolean) => { enabled = value; },
    });
    return tool;
  };
}
