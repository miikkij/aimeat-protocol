/**
 * @file scripts/check-identity-shortening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate for the identity rule in .claude/rules/security.md: an identity is shortened
 *   to an account name with `localAccountName()` or `localAccountOf()` (src/utils/gaii.ts), never by
 *   hand.
 *
 *   WHY. A visitor signed in from another node is named by its home GHII, `alice@their-node`. Cut at
 *   the `@`, that is `alice`, which is the LOCAL account of the same name, a different person. The
 *   session names the visitor correctly since 2026-09-24, and the September 2026 audit's check of that
 *   fix still found cuts like this in services the fix never touched. `localAccountName` cuts an
 *   identity of THIS node and returns another node's identity whole, so the name it gives finds
 *   nobody here; `localAccountOf` is the same cut for a caller that decides on it. This gate keeps
 *   the cutting in those two places.
 *
 *   WHAT IT READS. Every `.ts` file under src/ except utils/gaii.ts (the helper's home), src/static
 *   (browser code) and src/generated, parsed with the compiler, so a comment or a string that talks
 *   about `split('@')[0]` is not a finding. The shapes:
 *     split-at            x.split('@')[0], with or without a limit
 *     split-at-destructure  const [name] = x.split('@')
 *     slice-to-at         x.slice(0, x.indexOf('@')), and substring/substr, lastIndexOf; also
 *                         x.slice(0, at) where `at` was set from x.indexOf('@') above
 *     replace-from-at     x.replace(/@.*$/, '')
 *     regex-before-at     a regex that captures the run before an '@': /#([^@]+)@/
 *     parsed-owner        `.owner` read off parseGaiiLoose(…), parseGAII(…) or parseGEAI(…): straight
 *                         off the call, destructured from it, or off a variable holding it. A statement
 *                         that also reads that variable's `.node` uses the identity whole and is not
 *                         a finding.
 *
 *   ALLOWED names the places that are right as they are, per file, by the expression's own text,
 *   with the sentence that says why: an email's local part, the account on the node an identity
 *   names (for a call to that node), a value that can only be local. An entry is a decision, not a
 *   way around the gate: a new shortening fails, and so does an entry whose expression is gone.
 * @structure
 *   - shorteningFindings(file, source): the findings in one file (pure)
 *   - compareWithAllowed(found, allowed): new findings and stale entries (pure)
 *   - ALLOWED: file → { expression text → why it is right }
 *   - main(): walk src/, report; exit 1 on a new finding or a stale entry
 * @usage
 *   cd aimeat && pnpm check:identity-shortening          # the gate
 *   cd aimeat && pnpm check:identity-shortening --list   # every finding, allowed or not
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, F-1 as a class).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The helper's home: the one place an identity is cut. */
const HOME = 'src/utils/gaii.ts';

export interface Finding { line: number; shape: string; text: string }

const PARSERS = new Set(['parseGaiiLoose', 'parseGAII', 'parseGEAI']);

function unwrap(node: ts.Node): ts.Node {
  let cur = node;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAwaitExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

function isAt(node: ts.Node | undefined): boolean {
  if (!node) return false;
  if (ts.isStringLiteralLike(node)) return node.text === '@';
  return ts.isRegularExpressionLiteral(node) && node.text === '/@/';
}

/** `x.split('@')`, as a call. */
function isSplitAt(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'split' && isAt(node.arguments[0]);
}

/** A call to one of the identity parsers, whatever wraps it. */
function isParserCall(node: ts.Node): boolean {
  const n = unwrap(node);
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && PARSERS.has(n.expression.text);
}

/** The initializer a parse result is held from: `parse(x)`, `parse(x) ?? …`, `await parse(x)`. */
function holdsParse(init: ts.Expression | undefined): boolean {
  if (!init) return false;
  const n = unwrap(init);
  if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return holdsParse(n.left);
  return isParserCall(n);
}

function containsIndexOfAt(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && (n.expression.name.text === 'indexOf' || n.expression.name.text === 'lastIndexOf') && isAt(n.arguments[0])) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const FROM_AT = /^\/@(\.\*|\.\+|\[\^[^\]]*\][*+])\$?\/[a-z]*$/;
const BEFORE_AT = /\(\[\^[^\]]*@[^\]]*\][+*]\)@/;

/** The smallest statement-like unit around a node: a declaration, an expression statement, an if's condition. */
function statementOf(node: ts.Node): ts.Node {
  let cur = node;
  while (cur.parent && !ts.isStatement(cur) && !ts.isBlock(cur.parent) && !ts.isSourceFile(cur.parent)) {
    const p = cur.parent;
    if (ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isForStatement(p)
      || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isSwitchStatement(p) || ts.isCaseClause(p)
      || ts.isArrowFunction(p) || ts.isConditionalExpression(p)) return cur;
    cur = p;
  }
  return cur;
}

function readsNodeOf(unit: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'node' && ts.isIdentifier(unwrap(n.expression))
      && (unwrap(n.expression) as ts.Identifier).text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(unit);
  return found;
}

/**
 * Every place one file shortens an identity to its account part. Pure: a path and its text in,
 * findings out, in source order.
 */
export function shorteningFindings(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Finding[] = [];
  const add = (node: ts.Node, shape: string): void => {
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      shape,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 160),
    });
  };

  // Variables that hold a parse result, with the block that declares them and what they parsed; and
  // variables that hold the position of an '@', which a later slice(0, at) cuts at.
  const held: { name: string; scope: ts.Node; pos: number; init: string }[] = [];
  const atIndex: { name: string; scope: ts.Node; pos: number; init: string }[] = [];
  const declared = (node: ts.VariableDeclaration & { name: ts.Identifier; initializer: ts.Expression }) => {
    const scope = node.parent?.parent?.parent;
    return scope
      ? { name: node.name.text, scope, pos: node.getStart(sf), init: node.initializer.getText(sf).replace(/\s+/g, ' ') }
      : null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node) && ts.isNumericLiteral(node.argumentExpression)
      && node.argumentExpression.text === '0' && isSplitAt(unwrap(node.expression))) {
      add(node, 'split-at');
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [first, second] = node.arguments;
      if ((method === 'shift' || (method === 'at' && first && ts.isNumericLiteral(first) && first.text === '0'))
        && isSplitAt(unwrap(node.expression.expression))) {
        add(node, 'split-at');
      } else if ((method === 'slice' || method === 'substring' || method === 'substr')
        && first && ts.isNumericLiteral(first) && first.text === '0' && second && containsIndexOfAt(second)) {
        add(node, 'slice-to-at');
      } else if ((method === 'replace' || method === 'replaceAll') && first && ts.isRegularExpressionLiteral(first)
        && FROM_AT.test(first.text) && second && ts.isStringLiteralLike(second) && second.text === '') {
        add(node, 'replace-from-at');
      }
    } else if (ts.isRegularExpressionLiteral(node) && BEFORE_AT.test(node.text)) {
      add(node, 'regex-before-at');
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isArrayBindingPattern(node.name) && node.name.elements.length > 0
        && !ts.isOmittedExpression(node.name.elements[0]) && isSplitAt(unwrap(node.initializer))) {
        add(node, 'split-at-destructure');
      } else if (ts.isObjectBindingPattern(node.name) && holdsParse(node.initializer)
        && node.name.elements.some((el) => ((el.propertyName && ts.isIdentifier(el.propertyName)) ? el.propertyName.text : (ts.isIdentifier(el.name) ? el.name.text : '')) === 'owner')) {
        add(node, 'parsed-owner');
      } else if (ts.isIdentifier(node.name) && holdsParse(node.initializer)) {
        const d = declared(node as ts.VariableDeclaration & { name: ts.Identifier; initializer: ts.Expression });
        if (d) held.push(d);
      } else if (ts.isIdentifier(node.name) && containsIndexOfAt(node.initializer)
        && ts.isCallExpression(unwrap(node.initializer))) {
        const d = declared(node as ts.VariableDeclaration & { name: ts.Identifier; initializer: ts.Expression });
        if (d) atIndex.push(d);
      }
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'owner') {
      const target = unwrap(node.expression);
      if (isParserCall(target)) add(node, 'parsed-owner');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // The nearest declaration of a name in scope says what it holds, so a finding can name it.
  const nearest = (list: typeof held, name: string, at: number) => list
    .filter((h) => h.name === name && h.pos < at && h.scope.getStart(sf) <= at && at <= h.scope.getEnd())
    .sort((a, b) => b.pos - a.pos)[0];
  const addHeld = (node: ts.Node, shape: string, init: string): void => {
    found.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      shape,
      text: `${node.getText(sf).replace(/\s+/g, ' ')} ← ${init}`.slice(0, 160),
    });
  };

  if (held.length || atIndex.length) {
    const parsedNames = new Set(held.map((h) => h.name));
    const indexNames = new Set(atIndex.map((h) => h.name));
    const second = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'owner') {
        const target = unwrap(node.expression);
        if (ts.isIdentifier(target) && parsedNames.has(target.text)) {
          const source = nearest(held, target.text, node.getStart(sf));
          if (source && !readsNodeOf(statementOf(node), target.text)) addHeld(node, 'parsed-owner', source.init);
        }
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['slice', 'substring', 'substr'].includes(node.expression.name.text)) {
        // x.slice(0, at), where `at` was set from x.indexOf('@') or x.lastIndexOf('@') above.
        const [first, end] = node.arguments;
        const index = end ? unwrap(end) : undefined;
        if (first && ts.isNumericLiteral(first) && first.text === '0' && index && ts.isIdentifier(index)
          && indexNames.has(index.text)) {
          const source = nearest(atIndex, index.text, node.getStart(sf));
          if (source) addHeld(node, 'slice-to-at', source.init);
        }
      }
      ts.forEachChild(node, second);
    };
    second(sf);
    found.sort((a, b) => a.line - b.line);
  }
  return found;
}

/** A finding's key in ALLOWED: the expression's own text. */
export const keyOf = (f: Finding): string => f.text;

export interface Verdict {
  fresh: { file: string; finding: Finding }[];
  stale: { file: string; text: string }[];
  empty: { file: string; text: string }[];
  allowedHits: number;
}

/** Does an ALLOWED key cover this file: the file itself, or a directory (a key ending in `/`) above it. */
const covers = (key: string, file: string): boolean => key === file || (key.endsWith('/') && file.startsWith(key));

/** Findings no entry allows, and entries no finding needs. Pure. */
export function compareWithAllowed(found: Map<string, Finding[]>, allowed: Record<string, Record<string, string>>): Verdict {
  const verdict: Verdict = { fresh: [], stale: [], empty: [], allowedHits: 0 };
  const has = (o: Record<string, string>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  for (const [file, list] of found) {
    const keys = Object.keys(allowed).filter((key) => covers(key, file));
    for (const finding of list) {
      if (keys.some((key) => has(allowed[key], keyOf(finding)))) verdict.allowedHits++;
      else verdict.fresh.push({ file, finding });
    }
  }
  for (const [key, entries] of Object.entries(allowed)) {
    const texts = new Set<string>();
    for (const [file, list] of found) if (covers(key, file)) list.forEach((f) => texts.add(keyOf(f)));
    for (const [text, why] of Object.entries(entries)) {
      if (!texts.has(text)) verdict.stale.push({ file: key, text });
      if (!why.trim()) verdict.empty.push({ file: key, text });
    }
  }
  return verdict;
}

/**
 * The places that are right as they are: file → { the expression's text → why }.
 * Each sentence says what the shortened value is and why no visitor's name can reach it.
 */
export const ALLOWED: Record<string, Record<string, string>> = {
  // ── The connector CLI: it runs on the person's own machine, not on the node ──
  'src/cli/connect/auth.ts': {
    '/#([^@]+)@/': 'The connector reads its own account name out of the GAII the node it signed in to just issued; it runs on the person\'s machine, where no visitor reaches it.',
    "cliOwner.split('@')[0]": 'The owner the person typed on the command line, as the last fallback for the same name; the connector runs on their machine, where no visitor reaches it.',
  },
  'src/cli/connect/mcp/tools/exchange.ts': {
    "owner.split('@')[0]": 'The connector builds the app path of a provider the agent named; the node it calls looks that name up itself, with its own rules.',
  },
  'src/cli/connect/clients/index.ts': {
    "stem.slice(0, at) ← stem.indexOf('@')": 'Reads the AGENT name out of a stored `{agent}@{owner}.token` file name on the person\'s machine; not an account name.',
  },
  'src/cli/connect/keychain.ts': {
    "stem.slice(0, at) ← stem.indexOf('@')": 'Reads the AGENT name out of a stored `{agent}@{owner}.token` file name on the person\'s machine; not an account name.',
  },

  // ── A typed or stored name whose node is checked, or handed on with it ──
  'src/routes/ghii/register-login.ts': {
    "username.substring(0, atIdx) ← username.indexOf('@')": 'A name typed at registration: a node after the \'@\' other than this one is refused on the next line, so the name before it is always this node\'s.',
    "display_name.split('@')[0]": 'A display name typed at registration: an old front end sent the GHII there, and the text before its \'@\' is the name the person chose. Nothing is looked up by it.',
  },
  'src/routes/ghii/web-verify.ts': {
    "username.substring(0, atIdx) ← username.indexOf('@')": 'A name typed at registration: a node after the \'@\' other than this one is refused on the next line, so the name before it is always this node\'s.',
    "display_name.split('@')[0]": 'A display name typed at registration: an old front end sent the GHII there, and the text before its \'@\' is the name the person chose. Nothing is looked up by it.',
  },
  'src/routes/ghii/attach-email.ts': {
    "loginName.substring(0, atIdx) ← loginName.indexOf('@')": 'A typed login name: a node after the \'@\' other than this one is refused on the next line, so the name before it is always this node\'s.',
  },
  'src/services/invitations.ts': {
    "name.substring(0, atIdx) ← name.indexOf('@')": 'A typed invitee name: a node after the \'@\' other than this one returns null first, so the name before it is always this node\'s.',
  },
  'src/services/external-login.ts': {
    "username.substring(0, atIdx) ← username.indexOf('@')": 'Normalizes a typed username and hands another node\'s suffix back as `remoteNode`, so the caller sees that the name is not this node\'s.',
    "email?.split('@')[0]": 'Suggests a name for a NEW account from its email\'s local part; the name is then validated and made unique, and never looks up an existing account.',
  },
  'src/utils/login-identifier.ts': {
    "value.substring(0, at) ← value.indexOf('@')": 'Classifies a typed sign-in name: a name of another node comes back with that node as `federatedNodeId`, and the login asks that node about it.',
  },
  'src/commerce/beneficiary-release.ts': {
    "ghii.slice(0, at) ← ghii.lastIndexOf('@')": 'Splits a beneficiary GHII into name and node; the name is looked up only when the node is this node\'s.',
  },
  'src/services/consent.ts': {
    "ghii.slice(0, atIdx) ← ghii.lastIndexOf('@')": 'A `ghii:name@node` consent recipient matches only when the accessor\'s name AND node are equal to it.',
  },

  // ── Not an identity ──
  'src/routes/agent-integration.ts': {
    "since.substring(0, atIdx) ← since.lastIndexOf('@')": 'An inbox paging cursor, `timestamp@id`; not an identity.',
  },
  'src/services/component-versions.ts': {
    "raw.slice(0, at) ← raw.lastIndexOf('@')": 'A pinned component reference, `name@1.2.0`; not an identity.',
  },
  'src/utils/env-config/shared.ts': {
    '/\\/\\/([^@]+)@/': 'Masks the credentials in a connection URL (//user:pass@host) for display; a URL, not an identity.',
  },

  // ── An email address, not an identity ──
  'src/routes/admin-features.ts': {
    "[local, domain] = u.notificationEmail.split('@')": 'Masks a notification email for the operator\'s owner list (a***@example.com); an email, not an identity.',
  },
  'src/routes/saml-login.ts': {
    "email?.split('@')[0]": 'The local part of the email the identity provider sent, as a display name when it sent none; an email, not an identity.',
  },
  'src/services/oidc-providers.ts': {
    "email?.split('@')[0]": 'The local part of the email the identity provider sent, as a display name when it sent none; an email, not an identity.',
  },
  'src/services/scim-users.ts': {
    "userName.split('@')[0]": 'A SCIM userName is the directory\'s login (an email or UPN); its local part is a display name or the base of a NEW account\'s name, which is then made unique.',
  },

  // ── A name a person types for a new account ──
  'src/routes/invite-accept.ts': {
    "username.split('@')[0]": 'The name a person types for the account they are creating; an email-shaped entry is cut to its local part and then validated and checked for uniqueness like any new name.',
  },
  'src/routes/organisms/workspace-access.ts': {
    "uname.split('@')[0]": 'The name a person types for the account they are creating from an email invitation; it is then validated and checked for uniqueness like any new name.',
  },

  // ── The identity is used whole ──
  'src/routes/exchange.ts': {
    "[local, node, ...rest] = v.split('@')": 'Validates a grant target in both halves, refuses one whose node is not this node, and returns the target whole.',
  },
  'src/services/discovery/normalize.ts': {
    '{ owner, node } = parseGaiiLoose(idOrName)': 'Turns an agent\'s identity into its owner\'s GHII on the SAME node; the node is kept, so nothing is cut to an account name.',
  },
  'src/services/local-identity.ts': {
    '{ agent, owner, node } = parseGaiiLoose(id)': 'Names the owner and the node together in the sentence that says why an address did not resolve; nothing is looked up by it.',
  },
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(path.join(ROOT, dir)).sort()) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      if (rel === 'src/static' || rel === 'src/generated') continue;
      walk(rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && rel !== HOME) {
      out.push(rel);
    }
  }
}

function main(): void {
  const list = process.argv.includes('--list');
  const files: string[] = [];
  walk('src', files);
  const found = new Map<string, Finding[]>();
  let total = 0;
  for (const file of files) {
    const hits = shorteningFindings(file, readFileSync(path.join(ROOT, file), 'utf8'));
    if (!hits.length) continue;
    found.set(file, hits);
    total += hits.length;
  }
  const verdict = compareWithAllowed(found, ALLOWED);
  if (list) {
    const fresh = new Set(verdict.fresh.map(({ file, finding }) => `${file}:${finding.line}:${finding.text}`));
    for (const [file, hits] of found) {
      for (const f of hits) {
        const ok = !fresh.has(`${file}:${f.line}:${f.text}`);
        console.log(`${ok ? 'allowed' : 'NEW    '}  ${file}:${f.line}  ${f.shape}  ${f.text}`);
      }
    }
  }
  console.log(`Identity shortening: ${files.length} files read; ${total} found, ${verdict.allowedHits} allowed, `
    + `${verdict.fresh.length} new, ${verdict.stale.length} stale.`);
  if (verdict.fresh.length) {
    console.error('');
    console.error('An identity is shortened to an account name with localAccountName() for a lookup, or with');
    console.error('localAccountOf() when the answer decides something (src/utils/gaii.ts). Both keep a visitor from');
    console.error('another node from becoming the local account of the same name. If this place is right as it is,');
    console.error('add its expression to ALLOWED in scripts/check-identity-shortening.ts with the sentence that says why.');
    for (const { file, finding } of verdict.fresh) console.error(`  ${file}:${finding.line}  ${finding.shape}  ${finding.text}`);
  }
  if (verdict.stale.length) {
    console.error('');
    console.error('ALLOWED names an expression the file no longer has; delete the entry:');
    for (const { file, text } of verdict.stale) console.error(`  ${file}  ${text}`);
  }
  for (const { file, text } of verdict.empty) console.error(`  ${file}  ${text}: an ALLOWED entry without a reason`);
  if (verdict.fresh.length || verdict.stale.length || verdict.empty.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
