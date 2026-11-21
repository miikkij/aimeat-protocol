/**
 * @file no-fetch-host-header.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: a `Host` header in the headers of a `fetch()` call, a
 *   `new Request()` or a `new Headers()`, written as an object literal.
 *
 *   Why this rule exists. undici, which is Node's fetch, drops `Host` as a forbidden header without a
 *   word. A suite (e2e-companies) set it to test origin isolation, and the intended request was never
 *   once made: its 404s came from the default host and proved nothing about the origin it named. A
 *   request that has to carry a chosen Host goes through node:http, which sends it:
 *   `test/helpers/host-request.ts`.
 * @structure
 *   - noFetchHostHeader: the rule module
 *   - headersObject(): the object literal a call passes as its headers, if any
 * @usage
 *   'aimeat/no-fetch-host-header': 'error'   (test/ in eslint.config.js)
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial; replaces docs/pitfalls.md §19's first bullet.
 */

/** @param {any} node the key of a property */
function isHostKey(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name.toLowerCase() === 'host';
  if (node.type === 'Literal') return typeof node.value === 'string' && node.value.toLowerCase() === 'host';
  return false;
}

/** The name a call's callee ends in: `fetch`, `globalThis.fetch`, `Request`, `Headers`. */
function calleeName(callee) {
  if (!callee) return '';
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return '';
}

/**
 * The object literal holding the headers a call sends: the second argument's `headers` for fetch and
 * Request, the first argument for Headers.
 * @param {any} node a CallExpression or NewExpression
 */
function headersObject(node) {
  const name = calleeName(node.callee);
  if (name === 'Headers') return node.arguments[0]?.type === 'ObjectExpression' ? node.arguments[0] : null;
  if (name !== 'fetch' && name !== 'Request') return null;
  const init = node.arguments[1];
  if (!init || init.type !== 'ObjectExpression') return null;
  const prop = init.properties.find(p => p.type === 'Property' && !p.computed
    && ((p.key.type === 'Identifier' && p.key.name === 'headers') || (p.key.type === 'Literal' && p.key.value === 'headers')));
  return prop && prop.value.type === 'ObjectExpression' ? prop.value : null;
}

export const noFetchHostHeader = {
  meta: {
    type: 'problem',
    docs: { description: 'fetch() drops a Host header without a word; send it through test/helpers/host-request.ts' },
    schema: [],
    messages: {
      host: 'fetch (undici) drops a Host header without a word, so this request goes to the default host and the test proves nothing about the one it names. Send it through test/helpers/host-request.ts, which uses node:http and sends Host as written.',
    },
  },
  create(context) {
    function check(node) {
      const headers = headersObject(node);
      if (!headers) return;
      for (const p of headers.properties) {
        if (p.type === 'Property' && !p.computed && isHostKey(p.key)) context.report({ node: p, messageId: 'host' });
      }
    }
    return { CallExpression: check, NewExpression: check };
  },
};
