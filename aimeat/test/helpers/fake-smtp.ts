/**
 * @file test/helpers/fake-smtp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A real SMTP server for tests, and enough MIME parsing to assert on what arrived.
 *
 *   WHY IT EXISTS. The node's email service has two states: off, or a real nodemailer transport
 *   against a real server. Every `.env.test.*` leaves AIMEAT_SMTP_HOST unset, so until this helper
 *   the whole of src/services/email.ts and src/services/email-templates.ts was never executed by any
 *   suite, and the secrets those paths turn on (a six-digit code, a link carrying a token, an access
 *   code that is also a password) are exposed by no route. A suite that starts this, points a node
 *   at it, and reads the message back is testing the node's own transport and templates rather than
 *   a stub of them.
 *
 *   IT ANSWERS EVERY COMMAND, ALWAYS. `withRetry` in email.ts retries four times with 1/3/9 second
 *   delays, so a command this server leaves unanswered costs the calling suite thirteen seconds per
 *   message rather than failing outright. The default branch is 250 for that reason.
 *
 *   WHAT IT DOES NOT ADVERTISE MATTERS AS MUCH. No STARTTLS, so nodemailer stays in the clear
 *   against loopback, which is what `secure: false` already means. AUTH is advertised only when a
 *   suite asks for it, which is how the `auth:` branch of createEmailService() gets executed:
 *   set AIMEAT_SMTP_USER on the node and `requireAuth: true` here, and the credentials really cross
 *   the wire.
 *
 *   THE PARSER IS THE OTHER HALF. "A message arrived" proves almost nothing; the assertions worth
 *   making are about the code inside it, the link, the subject, the Reply-To, a custom header and an
 *   attachment's filename and bytes. So the raw message is unstuffed (nodemailer doubles a leading
 *   dot), the headers are unfolded, RFC 2047 encoded words are decoded, multipart bodies are split
 *   on their boundary, and each leaf part is decoded from base64 or quoted-printable. The recipient
 *   a message is matched on is the SMTP envelope's RCPT TO, not the To: header, because a suite that
 *   registers several accounts must never be handed another account's secret.
 * @structure
 *   - startFakeSmtp(opts) -> FakeSmtp: listen, collect, waitForMail, clear, close
 *   - parseMail(raw, recipients) -> ParsedMail: headers, subject, text, attachments
 *   - decodeWords / decodePart / unfoldHeaders: the MIME half, exported for a direct assertion
 * @usage
 *   const smtp = await startFakeSmtp({ port: 40295, requireAuth: true });
 *   const mail = await smtp.waitForMail('alice@aimeat.test', /\b\d{6}\b/);
 *   await smtp.close();
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Lifted from the inline sink in test/e2e-magic-link-refusal.ts (which
 *     keeps its own copy) and grown a MIME parser, dot-unstuffing and an optional AUTH round.
 */
import { createServer, type Server, type Socket } from 'node:net';

const CRLF = '\r\n';
const END_OF_DATA = `${CRLF}.${CRLF}`;

/** One decoded attachment part. `content` is the decoded bytes; `rawBody` is what crossed the wire. */
export interface MailAttachment {
    filename: string;
    contentType: string;
    /** The part's Content-Transfer-Encoding, verbatim. `base64` is what nodemailer uses for binary. */
    encoding: string;
    rawBody: string;
    content: Buffer;
}

export interface ParsedMail {
    /** The message exactly as it arrived, dot-unstuffed. */
    raw: string;
    /** Header names lower-cased, values unfolded. First occurrence wins. */
    headers: Record<string, string>;
    /** The SMTP envelope recipients (RCPT TO), which is who the node actually addressed. */
    recipients: string[];
    /** The Subject header, with RFC 2047 encoded words decoded. */
    subject: string;
    /** Every non-attachment part, decoded and concatenated. */
    text: string;
    attachments: MailAttachment[];
}

export interface FakeSmtpOptions {
    port: number;
    host?: string;
    /**
     * Advertise AUTH PLAIN and accept whatever is offered. The point is not to check the password
     * (this is a sink) but to make nodemailer walk the authenticated branch of the transport.
     */
    requireAuth?: boolean;
}

export interface FakeSmtp {
    port: number;
    /** Every message received, oldest first. */
    inbox: ParsedMail[];
    /** How many AUTH commands were answered. Zero when the transport never authenticated. */
    authAttempts: number;
    waitForMail(to: string, match: RegExp, timeoutMs?: number): Promise<ParsedMail>;
    /** Everything addressed to one recipient, for a test that counts rather than matches. */
    mailTo(to: string): ParsedMail[];
    clear(): void;
    close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Undo the transparency dot SMTP requires on a body line that starts with one. */
function unstuffDots(message: string): string {
    return message.replace(/^\.\./, '.').replace(/\r\n\.\./g, `${CRLF}.`);
}

/** Split a header block into a lower-cased map, joining continuation lines onto their header. */
export function unfoldHeaders(headerBlock: string): Record<string, string> {
    const out: Record<string, string> = {};
    let current = '';
    const flush = (): void => {
        const colon = current.indexOf(':');
        if (colon > 0) {
            const name = current.slice(0, colon).trim().toLowerCase();
            if (!(name in out)) out[name] = current.slice(colon + 1).trim();
        }
        current = '';
    };
    for (const line of headerBlock.split(/\r?\n/)) {
        if (/^[ \t]/.test(line) && current) { current += ` ${line.trim()}`; continue; }
        if (current) flush();
        current = line;
    }
    if (current) flush();
    return out;
}

/** Decode RFC 2047 encoded words, which is how a non-ASCII subject or filename crosses the wire. */
export function decodeWords(value: string): string {
    // Adjacent encoded words are separated by whitespace that is not part of the text.
    const glued = value.replace(/\?=\s+=\?/g, '?==?');
    return glued.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset: string, enc: string, data: string) => {
        const utf8 = /utf-?8/i.test(charset);
        if (enc.toUpperCase() === 'B') {
            const buf = Buffer.from(data, 'base64');
            return utf8 ? buf.toString('utf-8') : buf.toString('latin1');
        }
        const bytes = data
            .replace(/_/g, ' ')
            .replace(/=([0-9A-Fa-f]{2})/g, (_x, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        const buf = Buffer.from(bytes, 'latin1');
        return utf8 ? buf.toString('utf-8') : buf.toString('latin1');
    });
}

/** Decode one leaf part's body according to its Content-Transfer-Encoding. */
export function decodePart(body: string, encoding: string): Buffer {
    const enc = encoding.trim().toLowerCase();
    if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
    if (enc === 'quoted-printable') {
        const joined = body.replace(/=\r?\n/g, '');
        const bytes = joined.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        return Buffer.from(bytes, 'latin1');
    }
    return Buffer.from(body, 'utf-8');
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Collected { text: string[]; attachments: MailAttachment[] }

/** Walk one MIME section, recursing through multipart containers into their leaves. */
function walkSection(section: string, out: Collected): void {
    const sep = /\r?\n\r?\n/.exec(section);
    const headerBlock = sep ? section.slice(0, sep.index) : section;
    const body = sep ? section.slice(sep.index + sep[0].length) : '';
    const headers = unfoldHeaders(headerBlock);
    const contentType = headers['content-type'] ?? 'text/plain';

    const boundary = /boundary="?([^";]+)"?/i.exec(contentType);
    if (/^multipart\//i.test(contentType) && boundary) {
        const parts = body.split(new RegExp(`--${escapeRegExp(boundary[1])}(?:--)?\r?\n?`));
        for (const part of parts.slice(1)) {
            if (part.trim()) walkSection(part, out);
        }
        return;
    }

    const encoding = headers['content-transfer-encoding'] ?? '7bit';
    const content = decodePart(body, encoding);
    const disposition = headers['content-disposition'] ?? '';
    const named = /filename="?([^";]+)"?/i.exec(disposition) ?? /name="?([^";]+)"?/i.exec(contentType);
    if (/attachment/i.test(disposition) && named) {
        out.attachments.push({
            filename: decodeWords(named[1]),
            contentType: contentType.split(';')[0].trim(),
            encoding: encoding.trim(),
            rawBody: body,
            content,
        });
        return;
    }
    out.text.push(content.toString('utf-8'));
}

/** Parse one received message. `recipients` comes from the envelope, never from the To: header. */
export function parseMail(raw: string, recipients: string[]): ParsedMail {
    const message = unstuffDots(raw);
    const sep = /\r?\n\r?\n/.exec(message);
    const headers = unfoldHeaders(sep ? message.slice(0, sep.index) : message);
    const collected: Collected = { text: [], attachments: [] };
    walkSection(message, collected);
    return {
        raw: message,
        headers,
        recipients,
        subject: decodeWords(headers['subject'] ?? ''),
        text: collected.text.join('\n'),
        attachments: collected.attachments,
    };
}

/** An address out of `MAIL FROM:<a@b>` / `RCPT TO:<a@b>`, angle brackets and parameters removed. */
function envelopeAddress(line: string): string {
    const angled = /<([^>]*)>/.exec(line);
    if (angled) return angled[1].trim().toLowerCase();
    const colon = line.indexOf(':');
    return (colon === -1 ? '' : line.slice(colon + 1).trim().split(/\s+/)[0]).toLowerCase();
}

/**
 * Start the server and resolve once it is listening.
 *
 * The DATA terminator can arrive split across TCP chunks, which is ordinary rather than exotic, so
 * the buffer is never cleared blindly: only what is provably before the marker is consumed and the
 * last four characters stay behind.
 */
export function startFakeSmtp(opts: FakeSmtpOptions): Promise<FakeSmtp> {
    const inbox: ParsedMail[] = [];
    let authAttempts = 0;

    const greeting = ['250-aimeat-test'];
    if (opts.requireAuth) greeting.push('250-AUTH PLAIN');
    greeting.push('250 8BITMIME');
    const ehloReply = greeting.join(CRLF) + CRLF;

    const server: Server = createServer((socket: Socket) => {
        let buffer = '';
        let inData = false;
        let message = '';
        let recipients: string[] = [];
        socket.setEncoding('utf-8');
        socket.write(`220 aimeat-test ESMTP${CRLF}`);
        socket.on('data', chunk => {
            buffer += chunk;
            for (;;) {
                if (inData) {
                    const end = buffer.indexOf(END_OF_DATA);
                    if (end === -1) {
                        if (buffer.length > 4) { message += buffer.slice(0, -4); buffer = buffer.slice(-4); }
                        return;
                    }
                    message += buffer.slice(0, end);
                    buffer = buffer.slice(end + END_OF_DATA.length);
                    inbox.push(parseMail(message, recipients));
                    message = '';
                    recipients = [];
                    inData = false;
                    socket.write(`250 2.0.0 Ok: queued${CRLF}`);
                    continue;
                }
                const nl = buffer.indexOf(CRLF);
                if (nl === -1) return;
                const line = buffer.slice(0, nl);
                buffer = buffer.slice(nl + CRLF.length);
                const verb = line.slice(0, 4).toUpperCase();
                if (verb === 'EHLO') socket.write(ehloReply);
                else if (verb === 'HELO') socket.write(`250 aimeat-test${CRLF}`);
                else if (verb === 'AUTH') { authAttempts++; socket.write(`235 2.7.0 Accepted${CRLF}`); }
                else if (verb === 'RCPT') { recipients.push(envelopeAddress(line)); socket.write(`250 2.1.5 Ok${CRLF}`); }
                else if (verb === 'DATA') { inData = true; socket.write(`354 End data with <CR><LF>.<CR><LF>${CRLF}`); }
                else if (verb === 'QUIT') { socket.write(`221 Bye${CRLF}`); socket.end(); return; }
                else socket.write(`250 2.0.0 Ok${CRLF}`);
            }
        });
        socket.on('error', () => { /* a client hanging up mid-session is not a test's business */ });
    });

    const api: FakeSmtp = {
        port: opts.port,
        inbox,
        get authAttempts() { return authAttempts; },
        mailTo(to: string): ParsedMail[] {
            const needle = to.toLowerCase();
            return inbox.filter(m => m.recipients.some(r => r === needle));
        },
        async waitForMail(to: string, match: RegExp, timeoutMs = 10_000): Promise<ParsedMail> {
            // A global regex carries lastIndex between calls, so the pattern is rebuilt without it.
            const pattern = new RegExp(match.source, match.flags.replace(/[gy]/g, ''));
            const start = Date.now();
            for (;;) {
                for (const mail of api.mailTo(to)) {
                    if (pattern.test(mail.subject) || pattern.test(mail.text) || pattern.test(mail.raw)) return mail;
                }
                if (Date.now() - start > timeoutMs) {
                    const seen = inbox.map(m => `${m.recipients.join(',')}: ${m.subject}`).join(' | ') || 'nothing';
                    throw new Error(`no mail to ${to} matching ${match} after ${timeoutMs}ms. Inbox: ${seen}`);
                }
                await sleep(120);
            }
        },
        clear(): void { inbox.length = 0; },
        close(): Promise<void> { return new Promise(resolve => server.close(() => resolve())); },
    };

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve(api));
    });
}
