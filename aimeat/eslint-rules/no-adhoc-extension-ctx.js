/**
 * @file no-adhoc-extension-ctx.js
 * @description Custom ESLint rule: an `ExtensionCtx` is built by services/extension-ctx.ts, never by
 *   hand at a call site. Reports an object literal typed as `ExtensionCtx`.
 *
 *   Why this rule exists. Four roads reach the extension sandbox: the two REST invoke handlers, the
 *   MCP tool, and the scheduler. Each assembled its own capability object, roughly 200 lines of it,
 *   and they were never the same twice. What the August 2026 audit found, one omission per copy:
 *
 *     - the scheduler wrote memory with no size or key-count limit, so an extension on a clock
 *       could fill the database, while the same extension invoked by a person could not;
 *     - the scheduler fetched with a bare `fetch`, so a scheduled run had no SSRF guard at all;
 *     - the MCP tool ran the script without the paywall, so a priced action was free through a tool
 *       call and metered over HTTP, and a cross-owner call skipped the entitlement check with it;
 *     - the MCP tool's wallet had no per-call debit ceiling, which the REST one has always had;
 *     - the MCP tool ignored a script's request for a private memory value and wrote it public;
 *     - the MCP tool read a response body by the Content-Type header alone, so a feed that renders
 *       correctly over REST came back as mojibake through a tool call;
 *     - the tiered email rule, which decides whether a sandboxed script may mail a stranger, was
 *       typed out three times.
 *
 *   None of those is a hard bug to spot in isolation. All of them are invisible when the same
 *   capability is written four times and a reader has one copy in front of them. The rule is not
 *   about tidiness: a guard that lives at the call site is a guard the next call site will not have.
 *
 *   What to do instead: call `buildExtensionCtx()` and pass the capabilities your road can honestly
 *   offer. A capability that genuinely differs by road (a wallet, a notification recipient, whether
 *   email is reachable at all) is a parameter. A guard is not.
 *
 *   Allowed by design: services/extension-ctx.ts itself, and tests that need a stub context.
 * @structure
 *   - noAdhocExtensionCtx: the rule module
 * @usage
 *   'aimeat/no-adhoc-extension-ctx': 'error'
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 4: one sandbox context, one set of guards).
 */

/** The file that IS the builder, plus test stubs. Matched against the ESLint filename (either slash). */
const ALLOWED = [
  'services/extension-ctx.ts',
  '/test/',
  '\\test\\',
];

/** Does this type annotation say `ExtensionCtx`? Covers `ExtensionCtx` and `Partial<ExtensionCtx>`. */
function namesExtensionCtx(typeAnnotation) {
  if (!typeAnnotation) return false;
  const t = typeAnnotation.type === 'TSTypeAnnotation' ? typeAnnotation.typeAnnotation : typeAnnotation;
  if (!t) return false;
  if (t.type === 'TSTypeReference') {
    const n = t.typeName;
    if (n?.type === 'Identifier' && n.name === 'ExtensionCtx') return true;
    // Partial<ExtensionCtx>, Readonly<ExtensionCtx>, …
    const args = t.typeArguments ?? t.typeParameters;
    return !!args?.params?.some(p => namesExtensionCtx(p));
  }
  return false;
}

export const noAdhocExtensionCtx = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Build an ExtensionCtx with buildExtensionCtx(), not as an object literal at the call site',
    },
    schema: [],
    messages: {
      adhoc:
        'Build the sandbox context with buildExtensionCtx() from services/extension-ctx.js instead of '
        + 'assembling it here. The guards live inside the builder on purpose: the memory quota, '
        + 'safeFetch, the per-call debit ceiling and the email authorization rule. Every hand-built '
        + 'copy this replaced was missing at least one of them, and a different one each time. '
        + 'Capabilities that genuinely differ by road (wallet, notify recipient, whether email is '
        + 'reachable) are parameters; guards are not.',
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename?.() ?? '').replace(/\\/g, '/');
    if (ALLOWED.some(a => filename.includes(a.replace(/\\/g, '/')))) return {};

    return {
      // const ctx: ExtensionCtx = { … }
      VariableDeclarator(node) {
        if (node.init?.type !== 'ObjectExpression') return;
        if (!namesExtensionCtx(node.id?.typeAnnotation)) return;
        context.report({ node: node.init, messageId: 'adhoc' });
      },
      // executeExtensionAction(script, { … } as ExtensionCtx, …) and `satisfies ExtensionCtx`
      TSAsExpression(node) {
        if (node.expression?.type !== 'ObjectExpression') return;
        if (!namesExtensionCtx(node.typeAnnotation)) return;
        context.report({ node: node.expression, messageId: 'adhoc' });
      },
      TSSatisfiesExpression(node) {
        if (node.expression?.type !== 'ObjectExpression') return;
        if (!namesExtensionCtx(node.typeAnnotation)) return;
        context.report({ node: node.expression, messageId: 'adhoc' });
      },
    };
  },
};
