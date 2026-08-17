/**
 * @file src/services/file-text/xml.ts
 * @description The small amount of XML reading that Office formats need, and nothing more.
 *
 *   WHY NOT AN XML PARSER. A .docx and a .xlsx are machine-written by a handful of programs, and
 *   the parts we read (`<t>`, `<v>`, `<c>`, `<w:t>`) are a narrow, flat shape inside them. A general
 *   parser would add a dependency and a tree we would immediately walk back down to strings. What
 *   this file does instead is scan tags in order, which is also what makes a document readable: text
 *   comes out in the order a person wrote it, and a paragraph end is an event rather than a node.
 *
 *   ENTITIES ARE NOT OPTIONAL. A sheet exported from any real system has `&amp;` in it within the
 *   first hundred rows, and a company name with an ampersand rendered as `Smith &amp; Co` in a
 *   proposal is the kind of defect nobody reports and everybody notices.
 * @structure decodeXmlText(); attr(); eachTag()
 * @usage import { decodeXmlText, attr, eachTag } from './xml.js';
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: shared scanning for the docx and xlsx readers.
 */

/** Named entities XML defines. Everything else in a document arrives numeric. */
const NAMED: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/**
 * Text content as a person would read it.
 *
 * Numeric references are decoded with `fromCodePoint` rather than `fromCharCode`, because an emoji
 * or a CJK extension character above U+FFFF arrives as one reference and `fromCharCode` would
 * silently truncate it to a different character.
 */
export function decodeXmlText(raw: string): string {
    return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
            try { return String.fromCodePoint(code); } catch { return whole; }
        }
        const named = NAMED[body];
        return named === undefined ? whole : named;
    });
}

/** One attribute off a tag's raw text (`<c r="A1" t="s">` → `attr(tag, 'r')` → `A1`). */
export function attr(tagText: string, name: string): string | undefined {
    const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tagText);
    return m ? decodeXmlText(m[1]) : undefined;
}

/** What one scanned tag is. A self-closing tag reports as `open` with `selfClosing` set. */
export interface XmlTag {
    /** Local name with any namespace prefix intact: `w:t`, `c`, `si`. */
    name: string;
    kind: 'open' | 'close';
    selfClosing: boolean;
    /** The raw `<...>` text, for `attr()`. */
    raw: string;
    /** Text between this tag and the next one, already decoded. Empty for most tags. */
    textAfter: string;
}

/**
 * Every tag in document order, with the text that follows it.
 *
 * Comments, processing instructions and CDATA are skipped rather than parsed: none of the Office
 * parts we read use them for content, and treating a comment as text would put the producer's
 * internal notes into somebody's prompt.
 */
export function* eachTag(xml: string): Generator<XmlTag> {
    let i = 0;
    while (i < xml.length) {
        const lt = xml.indexOf('<', i);
        if (lt < 0) return;

        if (xml.startsWith('<!--', lt)) { i = skipPast(xml, lt, '-->'); continue; }
        if (xml.startsWith('<![CDATA[', lt)) { i = skipPast(xml, lt, ']]>'); continue; }
        if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) { i = skipPast(xml, lt, '>'); continue; }

        const gt = xml.indexOf('>', lt);
        if (gt < 0) return;
        const raw = xml.slice(lt, gt + 1);
        const close = raw[1] === '/';
        const selfClosing = raw[raw.length - 2] === '/';
        const nameMatch = /^<\/?\s*([^\s/>]+)/.exec(raw);
        if (!nameMatch) { i = gt + 1; continue; }

        const nextLt = xml.indexOf('<', gt + 1);
        const between = nextLt < 0 ? xml.slice(gt + 1) : xml.slice(gt + 1, nextLt);

        yield {
            name: nameMatch[1],
            kind: close ? 'close' : 'open',
            selfClosing: selfClosing && !close,
            raw,
            textAfter: between ? decodeXmlText(between) : '',
        };
        i = gt + 1;
    }
}

function skipPast(xml: string, from: number, terminator: string): number {
    const end = xml.indexOf(terminator, from);
    return end < 0 ? xml.length : end + terminator.length;
}
