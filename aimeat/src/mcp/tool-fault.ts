/**
 * @file src/mcp/tool-fault.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node MCP tool that fails inside the node is logged, reported to the operator and
 *   answered with a plain sentence, in the one place every tool is registered (mcp/index.ts).
 *
 *   WHAT WAS MISSING. REST has two safeguards for a fault: the operator's fault report
 *   (middleware/system-fault.ts) and the 500 text filter that logs the exception and shows the caller
 *   a sentence (middleware/internal-error-text.ts). Both read a REST envelope passed to res.json. A
 *   tool result is a JSON-RPC answer the MCP transport writes, so neither ran: a handler that threw
 *   was answered by the SDK with error.message as the tool text, and nothing logged it or told the
 *   operator (QA audit E1-01, D2-01, F5-02, E2-02, E5-01).
 *
 *   A THROW. Caught here. An error that carries an HTTP status other than 500 (a typed service error:
 *   a refusal, or an authored 503) is answered `CODE: message` as written.
 *   Every other throw is a fault: one log line with the tool, the caller, the request id, the message
 *   and the stack; one fault report to the operator (services/system-fault-report.ts, deduplicated
 *   per tool per hour); and the answer `INTERNAL_ERROR: <sentence with the request id>`. An McpError
 *   is the SDK's own protocol answer and is rethrown.
 *
 *   A CAUGHT ERROR A TOOL RETURNS. About 30 tools catch everything and return
 *   `Failed to …: ${err.message}`. Such a site wraps its result in withCaughtError(result, err), and
 *   this wrapper decides from the error itself: a database, system or programming error
 *   (isInternalException) is handled as a fault, as above; any other error's text was written for
 *   the caller and stays, with a warn line so the operator can still find it.
 *
 *   POSITION. Inside the next-step wrapper (mcp/error-next-step.ts), so the fault answer also says
 *   what to do next; outside the usage wrapper (mcp/tool-usage-wrap.ts), so the usage row still
 *   records the error class of a throw.
 * @structure withCaughtError(result, err) · isInternalException(err) · withToolFault(register, deps)
 * @usage
 *   const faulted = withToolFault(withErrorNextStep(noticed), { storage, config, principal });
 *   } catch (err) { return withCaughtError(fail(`Failed to publish app: ${(err as Error).message}`), err); }
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-16 — Initial (QA audit E1-01, D2-01, F5-02, E2-02, E5-01).
 */
import { ProtocolError } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { errorFields } from '../utils/error-fields.js';
import { currentRequestId } from '../utils/request-context.js';
import { generateRequestId } from '../utils/tracking-code.js';
import { redactCredentialText } from '../utils/redact-credentials.js';
import { reportSystemFault, FAULT_CODES } from '../services/system-fault-report.js';
import { internalErrorSentence } from '../middleware/internal-error-text.js';
import { resultErrorCode } from './tool-usage-wrap.js';

type AnyFn = (...args: unknown[]) => unknown;

interface ToolResult { content?: { type?: string; text?: string }[]; isError?: boolean }

/** The error a tool caught, carried on the result it returns. A symbol, so no JSON carries it. */
const CAUGHT = Symbol.for('aimeat.toolCaughtError');

/** Mark a failing tool result with the error the tool caught, for withToolFault to judge. */
export function withCaughtError<T extends object>(result: T, err: unknown): T {
  (result as { [CAUGHT]?: unknown })[CAUGHT] = err;
  return result;
}

const PROGRAMMING_ERRORS = new Set(['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError']);

/**
 * True when `err` is text no person wrote for the caller: a programming error, a database driver
 * error (Postgres fields or a SQLite code), a Node system error (errno, syscall), or an error that
 * wraps another as its cause (the storage providers' `<method> failed: …`).
 */
export function isInternalException(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (PROGRAMMING_ERRORS.has(err.name) || PROGRAMMING_ERRORS.has(err.constructor?.name)) return true;
  const e = err as Error & { code?: unknown; severity?: unknown; errno?: unknown; syscall?: unknown; cause?: unknown };
  if (err.name === 'DatabaseError' || err.name === 'SqliteError') return true;
  if (typeof e.code === 'string' && e.code.startsWith('SQLITE_')) return true;
  if (typeof e.severity === 'string' && typeof e.code === 'string') return true;
  if (e.errno !== undefined || typeof e.syscall === 'string') return true;
  return e.cause instanceof Error;
}

/**
 * A thrown error a service raised with an answer in it: an HTTP status other than 500 (a refusal, or
 * an authored 502/503 such as "not running on this node"). Its code, or REQUEST_ERROR as the REST
 * error handler names it. A 500 or no status is a fault.
 */
function authoredErrorOf(err: unknown): { code: string; message: string } | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { code?: unknown; status?: unknown; statusCode?: unknown; httpStatus?: unknown };
  const status = [e.status, e.statusCode, e.httpStatus].find((s): s is number => typeof s === 'number');
  if (status === undefined || status === 500 || status < 400 || status > 599) return null;
  return { code: typeof e.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(e.code) ? e.code : 'REQUEST_ERROR', message: err.message };
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((c) => c.text ?? '').join(' ');
}

export interface ToolFaultDeps {
  storage: Storage;
  config: AimeatConfig;
  /** The session's principal (GAII), for the log line. */
  principal: () => string;
}

/** Log, report and answer one fault of tool `name`. */
function faultAnswer(deps: ToolFaultDeps, name: string, err: unknown): ToolResult {
  const ref = currentRequestId() ?? generateRequestId();
  const sentence = internalErrorSentence(ref);
  logger.error(`[mcp-fault] ${name}: the tool failed inside the node`, {
    request_id: ref, tool: name, principal: deps.principal(), ...errorFields(err),
  });
  void reportSystemFault({ storage: deps.storage, config: deps.config }, {
    code: 'INTERNAL_ERROR', route: name, method: 'MCP', requestId: ref, shown: sentence,
  });
  return { content: [{ type: 'text', text: `INTERNAL_ERROR: ${sentence}` }], isError: true };
}

export function withToolFault(register: AnyFn, deps: ToolFaultDeps): AnyFn {
  return (...args: unknown[]) => {
    const name = args[0] as string;
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== 'function') return register(...args);

    const guarded = async (...handlerArgs: unknown[]): Promise<unknown> => {
      let result: ToolResult | undefined;
      try {
        result = await (handler as AnyFn)(...handlerArgs) as ToolResult | undefined;
      } catch (err) {
        if (err instanceof ProtocolError) throw err;
        const authored = authoredErrorOf(err);
        if (authored) return { content: [{ type: 'text', text: `${authored.code}: ${redactCredentialText(authored.message)}` }], isError: true };
        return faultAnswer(deps, name, err);
      }
      if (!result || typeof result !== 'object' || result.isError !== true) return result;

      const caught = (result as { [CAUGHT]?: unknown })[CAUGHT];
      if (caught !== undefined) {
        if (isInternalException(caught)) return faultAnswer(deps, name, caught);
        // Text the code wrote for the caller: it stays, and the operator still gets a line.
        logger.warn(`[mcp] ${name}: the tool answered a caught error`, {
          request_id: currentRequestId(), tool: name, principal: deps.principal(), ...errorFields(caught),
        });
        return {
          ...result,
          content: (result.content ?? []).map((c) => (typeof c.text === 'string' ? { ...c, text: redactCredentialText(c.text) } : c)),
        };
      }

      // A tool that answered a fault code itself (`INTERNAL_ERROR: …`) is reported like a REST fault.
      const code = resultErrorCode(textOf(result));
      if (code && FAULT_CODES.has(code)) {
        const ref = currentRequestId() ?? generateRequestId();
        logger.warn(`[mcp] ${name}: the tool answered ${code}`, { request_id: ref, tool: name, principal: deps.principal() });
        void reportSystemFault({ storage: deps.storage, config: deps.config }, {
          code, route: name, method: 'MCP', requestId: ref, shown: textOf(result).slice(0, 500),
        });
      }
      return result;
    };

    const next = [...args];
    next[last] = guarded;
    return register(...next);
  };
}
