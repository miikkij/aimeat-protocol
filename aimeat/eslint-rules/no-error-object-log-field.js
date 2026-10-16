/**
 * @file no-error-object-log-field.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Custom ESLint rule: a caught error is not passed as a log field. Reports
 *   `logger.<level>('…', { error: err })` and `{ err }` where the value is the parameter of a
 *   `catch` clause or of a function passed to `.catch(…)`.
 *
 *   WHY. JSON writes an Error as `{}`, because its message and stack are not enumerable fields, so
 *   33 log calls of this shape recorded that something failed and not what (QA audit E1-04, F5-07,
 *   S5-07). The logger now turns an Error field into its message and stack (utils/logger.ts), and
 *   this rule keeps the call sites on the one form that says so where it is written:
 *   `logger.error('…', { ...errorFields(err), id })` (utils/error-fields.ts). A field that holds `String(err)` or
 *   `err.message` is not reported.
 * @structure noErrorObjectLogField: the rule module
 * @usage 'aimeat/no-error-object-log-field': 'error'
 * @version-history
 *   2026-10-16 — Initial (QA audit E1-04, F5-07, S5-07).
 */

const LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug', 'verbose', 'silly', 'log', 'http']);

/** True when `node` is `logger.<level>(…)` (also `this.logger.<level>` and `log.<level>`). */
function isLoggerCall(node) {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  if (callee.property.type !== 'Identifier' || !LOG_LEVELS.has(callee.property.name)) return false;
  const obj = callee.object;
  const name = obj.type === 'Identifier' ? obj.name
    : obj.type === 'MemberExpression' && !obj.computed && obj.property.type === 'Identifier' ? obj.property.name
      : '';
  return name === 'logger' || name === 'log';
}

/** True when the variable is a catch parameter or the first parameter of a `.catch(fn)` handler. */
function isCaughtValue(variable) {
  if (!variable) return false;
  return variable.defs.some((def) => {
    if (def.type === 'CatchClause') return true;
    if (def.type !== 'Parameter') return false;
    const fn = def.node;
    if (!fn || fn.params[0] !== def.name) return false;
    const call = fn.parent;
    return !!call && call.type === 'CallExpression' && call.arguments[0] === fn
      && call.callee.type === 'MemberExpression' && !call.callee.computed
      && call.callee.property.type === 'Identifier' && call.callee.property.name === 'catch';
  });
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
}

export const noErrorObjectLogField = {
  meta: {
    type: 'problem',
    docs: { description: 'A caught error is logged through errorFields(err), not as an object field' },
    messages: {
      errorObject: 'The caught value "{{name}}" is passed as a log field. Write { ...errorFields({{name}}) } (utils/error-fields.ts) so the line carries its message and stack.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        if (!isLoggerCall(node)) return;
        for (const arg of node.arguments) {
          if (arg.type !== 'ObjectExpression') continue;
          for (const prop of arg.properties) {
            if (prop.type !== 'Property' || prop.value.type !== 'Identifier') continue;
            const scope = sourceCode.getScope ? sourceCode.getScope(prop.value) : context.getScope();
            if (isCaughtValue(findVariable(scope, prop.value.name))) {
              context.report({ node: prop, messageId: 'errorObject', data: { name: prop.value.name } });
            }
          }
        }
      },
    };
  },
};
