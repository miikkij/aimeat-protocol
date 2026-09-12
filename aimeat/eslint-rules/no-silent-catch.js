/**
 * @file no-silent-catch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   stop meaning anything. So the rule reports exactly four shapes:
 *
 *     1. emptyCatch       — the body is empty or only comments.
 *     2. returnsAbsence   — the body only returns null/false/undefined/0/''/[]/{}, so a failure
 *                           becomes indistinguishable from "not found". The storage-layer bug class.
 *     3. discardsError    — the body never mentions the caught error, never throws, never logs and
 *                           never surfaces it.
 *     4. substitutesValue — the body answers with a value that is not an absence literal and says
 *                           nothing failed, so the caller gets a confident wrong answer.
 *
 *   WHY THE FOURTH WAS ADDED, three months after the others (2026-09-13). It is not a new idea but
 *   a hole inside the third: shape 2 recognises only absence LITERALS, and shape 3 asks for
 *   `!hasOtherReturn`, so ANY other return silenced it. `catch { return fallback }` therefore passed
 *   all three. It was found when `resolveGhii` was measured to have answered a database fault with
 *   the caller's bare account name, which on an owner session is the one value a stored record must
 *   never carry, inside `src/utils/` where this rule had been an error the whole time. The
 *   distinguishing question is NOT whether the handler returns something, which is often right, but
 *   whether the returned value SAYS something failed: `{ valid: false, reason: 'Invalid URL' }` does,
 *   `[creatorGhii]` does not. carriesFailure() is that test, and it is what keeps the rule from
 *   flagging the validator idiom (`new URL(x)` or `JSON.parse(x)` inside a function whose job is to
 *   decide whether the input is usable), which is most of this shape's population.
 *
 *   KNOWN LIMIT, deliberately left: a bare `return;` in a catch sets hasOtherReturn and carries no
 *   substitute, so no shape reports it. Widening that is its own measurement and its own decision.
 *
 *   Deliberate swallowing stays possible: log it (one line, and it becomes measurable in
 *   production), or carry an `eslint-disable-next-line aimeat/no-silent-catch -- <reason>`.
 * @structure
 *   - noSilentCatch: the rule module
 *   - walk(): minimal AST walker over a handler body (no dependency on a traversal lib)
 *   - carriesFailure(): does a returned expression say that something failed?
 * @usage
 *   'aimeat/no-silent-catch': 'error'
 *   'aimeat/no-silent-catch': ['error', { logNames: ['audit'] }]   // extra log-ish callee names
 * @version-history
 *   v1.1.0 — 2026-09-13 — Fourth shape, substitutesValue: a catch that answers with a value saying
 *     nothing failed. Closes the hole the other three left, found through resolveGhii's bare-name
 *     fallback. carriesFailure() keeps the validator idiom out of it.
 *   v1.0.0 — 2026-07-26 — Initial implementation (roadmap: silent-exception cleanup).
 */

/** Values that turn a failure into "absence". Returning one of these hides the error by design. */
const ABSENCE_LITERALS = new Set(['null', 'false', 'undefined', '0', "''", '""', '``', 'void 0', 'NaN']);

/** Callee name fragments that count as "this error was recorded". */
const DEFAULT_LOG_NAMES = [
  'logger', 'console', 'log', 'warn', 'error', 'info', 'debug', 'trace',
  'captureException', 'reportError', 'notify', 'audit', 'track', 'emitError',
  // The frontend's reporting channel (public/js/swallowed.js): a bounded, inspectable buffer rather
  // than console noise, because Rule 1b verification treats a clean console as evidence.
  'swallowed',
];

/** Callee name fragments that count as "this error reached someone who can act on it". */
const SURFACE_NAMES = new Set([
  'res', 'reply', 'response', 'reject', 'next', 'send', 'json', 'status',
  'setError', 'showError', 'toast', 'alert', 'fail', 'abort', 'exit',
]);

/**
 * Frontend state setters that put the FAILURE itself on screen — `setFailed(true)`,
 * `setErr('renderer')`. The user sees that something went wrong, which is the browser's equivalent
 * of a log line. Deliberately narrow: `setContacts([])` is NOT this, because turning a failure into
 * an empty list is exactly the "absence that looks like an answer" this rule exists to catch.
 */
const RE_SURFACE_SETTER = /^set(Err|Error|Failed|Failure|Broken|Unavailable)/;

/**
 * A returned object SAYS something failed when it carries one of these keys. `{ valid: false,
 * reason: 'Invalid URL format' }` is a refusal travelling back to the caller, which is the whole
 * legitimate reason a catch returns a value instead of throwing.
 */
const FAILURE_KEYS = new Set(['error', 'errors', 'reason', 'message', 'code', 'detail', 'details', 'problem']);

/** The same, said the other way: a flag that is FALSE is a refusal. `{ ok: true }` is not. */
const FALSIFIABLE_KEYS = new Set(['ok', 'valid', 'success', 'applied', 'allowed', 'authorized', 'authorised', 'verified']);

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

/**
 * Does this returned expression say that something failed? Anywhere inside it: a key from
 * FAILURE_KEYS, or a FALSIFIABLE_KEYS flag set to false or to a negation. Read on the whole
 * expression rather than its top level, because a refusal is often nested one deep
 * (`{ status: 400, body: { code: 'X' } }`).
 */
function carriesFailure(argument) {
  let found = false;
  walk(argument, (node) => {
    if (node.type !== 'Property' || !node.key) return;
    const name = node.key.name ?? node.key.value;
    if (typeof name !== 'string') return;
    if (FAILURE_KEYS.has(name)) { found = true; return; }
    if (!FALSIFIABLE_KEYS.has(name) || !node.value) return;
    const v = node.value;
    const isFalse = (v.type === 'Literal' && v.value === false)
      || (v.type === 'UnaryExpression' && v.operator === '!');
    if (isFalse) found = true;
  });
  return found;
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
          // Shape 4 is OFF by default, and that is a measurement rather than timidity: turning it on
          // in eslint.config.js today reports 87 sites across the two directories this rule is
          // already an error in, so every session's pre-commit would refuse every commit until all
          // 87 were triaged. It is on in scripts/check-silent-catch.ts, which counts them against a
          // seeded baseline and refuses only a NEW one. When the backlog reaches zero this becomes
          // one line in the config.
          substitutes: { type: 'boolean' },
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
      substitutesValue:
        'This catch answers the failure with {{value}}, a value that does not say anything failed, '
        + 'so the caller receives a confident wrong answer rather than an error. Return a value that '
        + 'carries the failure (ok: false, a reason, a code), let the error propagate, log it, or add '
        + 'eslint-disable-next-line aimeat/no-silent-catch -- <why this substitute is the right answer>.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const logNames = new Set([...DEFAULT_LOG_NAMES, ...(options.logNames || [])]);
    const reportSubstitutes = options.substitutes === true;
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
      /** Returns of a non-absence value that says nothing failed. */
      const substituteReturns = [];
      /** At least one return DOES say it failed, so the handler surfaces through its return value. */
      let hasFailureReturn = false;

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
              else if (SURFACE_NAMES.has(seg) || RE_SURFACE_SETTER.test(seg)) hasSurface = true;
            }
            break;
          }
          case 'ReturnStatement': {
            if (!node.argument) { hasOtherReturn = true; break; }
            const text = sourceCode.getText(node.argument).trim();
            if (ABSENCE_LITERALS.has(text) || text === '[]' || text === '{}') { absenceReturns.push({ node, text }); break; }
            hasOtherReturn = true;
            if (carriesFailure(node.argument)) hasFailureReturn = true;
            else substituteReturns.push({ node, text });
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
          if (carriesFailure(body)) hasFailureReturn = true;
          else substituteReturns.push({ node: body, text });
        }
      }

      return {
        hasThrow, hasLog, hasSurface, usesParam, statementCount, absenceReturns, hasOtherReturn,
        hasAwait, substituteReturns, hasFailureReturn,
      };
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
        return;
      }
      // Answers with a SUBSTITUTE. This is the hole the three shapes above left, and it is the one
      // that costs most: shape 2 sees only absence LITERALS, and any other return silences shape 3,
      // so `catch { return fallback }` passed every one of them. resolveGhii answered a database
      // fault with the caller's bare account name for six months inside a directory this rule has
      // been an error in the whole time (2026-09-12). A return that says it failed is still fine,
      // which is what carriesFailure() is for; an await is left alone here as it is in shape 3,
      // because a handler that awaits is doing cleanup rather than answering.
      // `!usesParam` belongs here for the same reason it belongs in shape 3: a handler that mentions
      // the caught error has looked at it, and `return e.message` IS the failure travelling back.
      // Leaving it out took src/mcp from 2 findings to 37, every one of them correct code.
      if (reportSubstitutes && !f.usesParam && !f.hasFailureReturn && f.substituteReturns.length > 0 && !f.hasAwait) {
        context.report({
          node: f.substituteReturns[0].node,
          messageId: 'substitutesValue',
          data: { value: f.substituteReturns[0].text.slice(0, 40) },
        });
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
