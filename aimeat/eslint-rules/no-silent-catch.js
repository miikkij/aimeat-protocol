/**
 * @file no-silent-catch.js
 * @description Custom ESLint rule: a caught error must leave a trace. Reports catch clauses (and
 *   `.catch(fn)` handlers) that discard the error — no log, no rethrow, no surfacing to the caller.
 *
 *   Why this rule exists. On 2026-07-26 a field report said aimeat_extension_install answered
 *   `200 success:true` while leaving both the manifest and the scripts untouched. The cause was two
 *   lines: a storage method ending in `catch { return null; }`, and a caller reading that null as
 *   "here is your record". A failed write became a successful deploy, and the false success is what
 *   made it expensive — it ended the investigation instead of starting one. A repo-wide count found
 *   909 sites of the same shape, of which only 205 stated any intent.
 *
 *   What is ACCEPTABLE, and why the rule is not simply "log or throw": a handler that puts the error
 *   into an HTTP response, rejects a promise, returns a typed failure carrying the message, or shows
 *   it in the UI has surfaced it. Flagging those would force disables everywhere and the rule would
 *   stop meaning anything. So the rule reports exactly three shapes:
 *
 *     1. emptyCatch     — the body is empty or only comments.
 *     2. returnsAbsence — the body only returns null/false/undefined/0/''/[]/{}, so a failure becomes
 *                         indistinguishable from "not found". This is the storage-layer bug class.
 *     3. discardsError  — the body never mentions the caught error, never throws, never logs and
 *                         never surfaces it.
 *
 *   Deliberate swallowing stays possible: log it (one line, and it becomes measurable in
 *   production), or carry an `eslint-disable-next-line aimeat/no-silent-catch -- <reason>`.
 * @structure
 *   - noSilentCatch: the rule module
 *   - walk(): minimal AST walker over a handler body (no dependency on a traversal lib)
 * @usage
 *   'aimeat/no-silent-catch': 'error'
 *   'aimeat/no-silent-catch': ['error', { logNames: ['audit'] }]   // extra log-ish callee names
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial implementation (roadmap: silent-exception cleanup).
 */

/** Values that turn a failure into "absence". Returning one of these hides the error by design. */
const ABSENCE_LITERALS = new Set(['null', 'false', 'undefined', '0', "''", '""', '``', 'void 0', 'NaN']);

/** Callee name fragments that count as "this error was recorded". */
const DEFAULT_LOG_NAMES = [
  'logger', 'console', 'log', 'warn', 'error', 'info', 'debug', 'trace',
  'captureException', 'reportError', 'notify', 'audit', 'track', 'emitError',
];

/** Callee name fragments that count as "this error reached someone who can act on it". */
const SURFACE_NAMES = new Set([
  'res', 'reply', 'response', 'reject', 'next', 'send', 'json', 'status',
  'setError', 'showError', 'toast', 'alert', 'fail', 'abort', 'exit',
]);

const isBlock = (n) => n && n.type === 'BlockStatement';

/**
 * Walk every node reachable from `root`, calling `visit`. ESLint gives one visitor per node type at
 * the top level, so a handler body has to be inspected manually. Kept deliberately small: it only
 * needs to find throws, calls and identifier uses.
 */
function walk(root, visit) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }
    if (typeof node.type === 'string') visit(node);
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const value = node[key];
      if (value && typeof value === 'object') stack.push(value);
    }
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export const noSilentCatch = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a caught error to be logged, rethrown, or surfaced to the caller',
    },
    schema: [
      {
        type: 'object',
        properties: {
          logNames: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      emptyCatch:
        'This catch discards the error with no trace. Log it (logger.warn/error), rethrow it, or add '
        + 'eslint-disable-next-line aimeat/no-silent-catch -- <why swallowing is correct here>.',
      returnsAbsence:
        'Returning {{value}} from a catch makes a FAILURE indistinguishable from "not found", and '
        + 'callers report that as success. Let the error propagate, or log it before returning.',
      discardsError:
        'The caught error is never logged, rethrown or surfaced, so this failure is invisible in '
        + 'production. Log it, or add eslint-disable-next-line aimeat/no-silent-catch -- <reason>.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const logNames = new Set([...DEFAULT_LOG_NAMES, ...(options.logNames || [])]);
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Classify a handler body. `paramName` is the caught binding, when it has one. */
    function inspect(body, paramName) {
      let hasThrow = false;
      let hasLog = false;
      let hasSurface = false;
      let usesParam = false;
      let statementCount = 0;
      const absenceReturns = [];
      let hasOtherReturn = false;
      let hasAwait = false;

      if (isBlock(body)) statementCount = body.body.length;

      walk(isBlock(body) ? body.body : body, (node) => {
        switch (node.type) {
          case 'ThrowStatement':
            hasThrow = true;
            break;
          case 'AwaitExpression':
            hasAwait = true;
            break;
          case 'Identifier':
            // Only the caught binding is tracked by name. Log/surface detection looks at CALLEES
            // below — matching bare identifiers would let a local variable named `info` or `error`
            // silence the rule.
            if (paramName && node.name === paramName) usesParam = true;
            break;
          case 'CallExpression': {
            const segments = sourceCode.getText(node.callee).split(/[.?[\]()]+/).filter(Boolean);
            for (const seg of segments) {
              if (logNames.has(seg)) hasLog = true;
              else if (SURFACE_NAMES.has(seg)) hasSurface = true;
            }
            break;
          }
          case 'ReturnStatement': {
            if (!node.argument) { hasOtherReturn = true; break; }
            const text = sourceCode.getText(node.argument).trim();
            if (ABSENCE_LITERALS.has(text) || text === '[]' || text === '{}') absenceReturns.push({ node, text });
            else hasOtherReturn = true;
            break;
          }
          default:
            break;
        }
      });

      // A bare arrow body (`.catch(() => null)`) is an expression, not a block: treat the expression
      // itself as the returned value.
      if (!isBlock(body)) {
        const text = sourceCode.getText(body).trim();
        if (ABSENCE_LITERALS.has(text) || text === '[]' || text === '{}') {
          absenceReturns.push({ node: body, text });
        } else if (!hasThrow && !hasLog) {
          hasOtherReturn = true;
        }
      }

      return { hasThrow, hasLog, hasSurface, usesParam, statementCount, absenceReturns, hasOtherReturn, hasAwait };
    }

    /** Report on a handler body, or stay quiet when the error was handled. */
    function check(node, body, paramName) {
      const f = inspect(body, paramName);
      if (f.hasThrow || f.hasLog || f.hasSurface) return;

      // Empty or comment-only.
      if (isBlock(body) && f.statementCount === 0) {
        context.report({ node, messageId: 'emptyCatch' });
        return;
      }
      // Only gives back an absence value.
      if (f.absenceReturns.length > 0 && !f.hasOtherReturn) {
        context.report({
          node: f.absenceReturns[0].node,
          messageId: 'returnsAbsence',
          data: { value: f.absenceReturns[0].text },
        });
        return;
      }
      // Does something, but never touches the error and never tells anyone.
      if (!f.usesParam && !f.hasOtherReturn && !f.hasAwait) {
        context.report({ node, messageId: 'discardsError' });
      }
    }

    return {
      CatchClause(node) {
        check(node, node.body, node.param && node.param.type === 'Identifier' ? node.param.name : null);
      },
      CallExpression(node) {
        // `.catch(handler)` — the promise-level equivalent of a catch block.
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        if (!callee.property || callee.property.name !== 'catch') return;
        const handler = node.arguments[0];
        if (!handler) return;
        if (handler.type !== 'ArrowFunctionExpression' && handler.type !== 'FunctionExpression') return;
        const param = handler.params[0];
        check(handler, handler.body, param && param.type === 'Identifier' ? param.name : null);
      },
    };
  },
};
