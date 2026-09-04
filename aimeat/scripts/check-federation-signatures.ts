/**
 * @file scripts/check-federation-signatures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every federation door that WRITES is either authorized by the node's own owner or by
 *   a peer's Ed25519 signature. Neither is not an option, and until this script nothing read the
 *   place where that is decided.
 *
 *   WHY THIS ONE IS NOT COVERED ELSEWHERE. `check:route-scopes` skips `/v1/federation/*` on purpose:
 *   there is no auth middleware there by design, because a scope word is meaningless for a peer node
 *   and asking those routes for one would fill the exemption file with noise. That decision is right
 *   and it leaves the largest unauthenticated WRITE surface on the node with no gate at all —
 *   thirty-odd doors that any host on the internet can POST to. The protection is a call to
 *   `verify(peer.publicKey, payload, signature)` inside the handler, one line among hundreds, and
 *   deleting it looks like a refactor.
 *
 *   THE TWO SHAPES, and the reason this is a gate rather than a count. A federation route is either
 *   INBOUND from a peer, where the peer's signature is the whole credential, or OWNER-INITIATED
 *   ("link my node to that one"), where the owner's session is. Both are legitimate. What must not
 *   exist is a third shape: a write door with no gate on the chain and no signature check in the
 *   body. A per-file count cannot see the difference — one file here holds eight write doors and two
 *   verify calls and is entirely correct — so the unit is the door.
 * @structure
 *   - VERIFIERS: the functions that count as proving a peer signed this
 *   - collectFederationWrites(): every non-GET door under src/routes/federation*, with its guards
 *     and whether its own handler body verifies
 *   - ALLOWED: the doors that have neither, each with the sentence that makes it safe
 *   - main(): report; --strict exits 1 on a door that is in none of those three states
 * @usage
 *   cd aimeat && pnpm check:federation-signatures            # report
 *   cd aimeat && pnpm check:federation-signatures --strict   # the hook/CI gate
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. The door inventory counted 300 REST doors reachable with no
 *     credential and 55 of those writing; 18 were federation, which is the one group no gate was
 *     watching.
 */
import ts from 'typescript';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES } from './check-route-scopes.js';
import { callsInside } from './inventory/entries.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');

/**
 * What counts as proof that a peer signed this request. One name, deliberately: `verify` from
 * `src/auth/keypair.ts` is the only Ed25519 verification in the federation routes today (17 call
 * sites), and a second way of doing the same thing is the drift this gate exists to notice. Adding a
 * name here is a decision, not a formality.
 */
const VERIFIERS = ['verify', 'verifyDetached', 'verifyPeerSignature'];

/** A door with neither an owner gate nor a signature check, and the sentence that makes it safe. */
const ALLOWED: Record<string, string> = {
    'src/routes/federation-auth.ts:POST:/v1/federation/auth/verify':
        'The cross-node password login itself: a remote node asks this node, the home node, whether '
        + 'someone signing in there as username@thisNode gave the right password. The credential IS '
        + 'the password in the body, compared by verifyPassword against the stored hash, so no '
        + 'session and no peer relationship can exist yet by construction. Bounded by the login rate '
        + 'limit and a five-minute timestamp window, and it answers the same FEDERATION_AUTH_FAILED '
        + 'whether the account is missing, has no password or gave the wrong one.',
    // POST /v1/federation/genesis-memory-read was here on 2026-09-04, listed as an open question:
    // requireAuth alone, so any principal carrying the account name could make this node fan out one
    // request per active genesis peer whatever it had been granted. It carries requireScope('memory:read')
    // now, which is a gate, so it leaves this list by being fixed rather than by being forgiven.
};

interface Door {
    /** `POST /v1/federation/ping` */
    id: string;
    file: string;
    line: number;
    guards: string[];
    /** An authorization middleware on the chain, directly or through a guard-array constant. */
    gated: boolean;
    /** Does the handler body itself call one of VERIFIERS? */
    verifies: boolean;
}

const WRITE_VERBS = new Set(['post', 'put', 'patch', 'delete']);

function sourceFiles(): ts.SourceFile[] {
    const config = ts.readConfigFile(join(AIMEAT, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, AIMEAT);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
    // Forces the binder, which is what sets node.parent. Without it every parent is undefined and
    // any walk that asks "what encloses this" silently answers nothing.
    program.getTypeChecker();
    return program.getSourceFiles().filter(f =>
        !f.isDeclarationFile
        && /[/\\]src[/\\]routes[/\\]federation/.test(f.fileName)
        && !f.fileName.includes('node_modules'));
}

/**
 * The middleware arguments of a `router.verb(path, ...middleware, handler)` call, by name. A guard
 * reaches the chain in four shapes and all four live in this repo: a call `requireAuth()`, a bare
 * identifier, a spread `...operator` of a const array, and the array passed whole.
 */
function guardNames(call: ts.CallExpression): string[] {
    const out: string[] = [];
    for (const arg of call.arguments.slice(1, -1)) {
        const inner = ts.isSpreadElement(arg) ? arg.expression : arg;
        if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) out.push(inner.expression.text);
        else if (ts.isIdentifier(inner)) out.push(inner.text);
    }
    return out;
}

/**
 * The guard arrays declared anywhere in the file: `const peerGate = [requireAuth(), requireRole('owner')]`.
 * Resolved across the whole file rather than per statement, because a chain is declared at the top
 * and used two hundred lines down.
 */
function gatedArrayNames(source: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    const visit = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
            && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
            const inside = callsInside(n.initializer);
            if (GATES.some(g => inside.has(g))) names.add(n.name.text);
        }
        ts.forEachChild(n, visit);
    };
    visit(source);
    return names;
}

export function collectFederationWrites(files: ts.SourceFile[]): Door[] {
    const doors: Door[] = [];
    for (const source of files) {
        const arrays = gatedArrayNames(source);
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                const verb = node.expression.name.text;
                const first = node.arguments[0];
                if (WRITE_VERBS.has(verb) && first && ts.isStringLiteral(first) && node.arguments.length >= 2) {
                    const handler = node.arguments[node.arguments.length - 1];
                    const guards = guardNames(node);
                    doors.push({
                        id: `${verb.toUpperCase()} ${first.text}`,
                        file: relative(AIMEAT, source.fileName).split('\\').join('/'),
                        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                        guards,
                        // A guard-array constant authorizes as surely as the calls it holds, which is
                        // why `arrays` is resolved for the whole file before any door is read.
                        gated: guards.some(g => GATES.includes(g) || arrays.has(g)),
                        verifies: VERIFIERS.some(v => callsInside(handler).has(v)),
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return doors;
}

const softKey = (d: Door): string => `${d.file}:${d.id.replace(' ', ':')}`;

function main(): void {
    const strict = process.argv.includes('--strict');
    const doors = collectFederationWrites(sourceFiles());

    const owned = doors.filter(d => d.gated);
    const signed = doors.filter(d => !d.gated && d.verifies);
    const neither = doors.filter(d => !d.gated && !d.verifies);

    console.log('');
    console.log('  Federation write doors: owner-gated, peer-signed, or neither');
    console.log('  ' + '─'.repeat(62));
    console.log(`  write doors        ${String(doors.length).padStart(3)}`);
    console.log(`  owner-gated        ${String(owned.length).padStart(3)}   an authorization middleware on the chain`);
    console.log(`  peer-signed        ${String(signed.length).padStart(3)}   the handler verifies an Ed25519 signature`);
    console.log(`  neither            ${String(neither.length).padStart(3)}`);
    console.log(`  listed with reason ${String(Object.keys(ALLOWED).length).padStart(3)}`);
    console.log('');

    const unlisted = neither.filter(d => ALLOWED[softKey(d)] === undefined);
    const stale = Object.keys(ALLOWED).filter(k => !neither.some(d => softKey(d) === k));

    if (unlisted.length > 0) {
        console.log('  NEITHER OWNER-GATED NOR PEER-SIGNED:');
        for (const d of unlisted) {
            console.log(`    ${d.id}`);
            console.log(`      ${d.file}:${d.line}${d.guards.length ? `  [${d.guards.join(' ')}]` : '  [no middleware]'}`);
        }
        console.log('');
        console.error('✖ A federation write door is reachable by any host on the internet. Its credential is');
        console.error('  either the owner\'s session or the peer\'s signature; with neither, the body of the');
        console.error('  request is the only thing deciding what happens. If one of these is genuinely safe,');
        console.error('  add it to ALLOWED in this script with the sentence that says why.');
        if (strict) process.exit(1);
        return;
    }

    if (stale.length > 0) {
        console.log(`  ✓ ${stale.length} listed door${stale.length === 1 ? '' : 's'} now gated or signed. Remove from ALLOWED:`);
        for (const k of stale) console.log(`    ${k}`);
        return;
    }

    console.log('  ✓ every federation write door is owner-gated or peer-signed');
}

main();
