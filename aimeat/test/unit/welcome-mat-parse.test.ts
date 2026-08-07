/**
 * @file welcome-mat-parse.test.ts
 * @description Unit tests for reading a welcome mat out of a chat paste (aimeat_remake/
 *   03-welcome-mat.md, phase 2). The six fixtures the phase names, one per level plus the
 *   rejection: clean HTML, HTML in a fenced code block, HTML buried in chatter, HTML with no
 *   <head> metadata, a body fragment with no doctype, and plain prose with no HTML at all.
 *   The first five parse. The sixth is rejected, and the rejection names what was missing —
 *   "try again" teaches nothing, "it should start with <!doctype html>" teaches the next attempt.
 * @usage cd aimeat && pnpm exec vitest run test/unit/welcome-mat-parse.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */
import { describe, it, expect } from 'vitest';
import {
    parseWelcomeMat,
    readWelcomeMatMeta,
    WELCOME_MAT_BEGIN,
    WELCOME_MAT_END,
} from '../../src/services/welcome-mat-parse.js';

/** The page the prompt asks for, metadata and all. */
const FULL_PAGE = `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8">
  <title>Jounin tervetuloamatto</title>
  <meta name="aimeat-welcome-mat" content="1">
  <meta name="aimeat-author-says" content="Jouni">
  <meta name="ai-model" content="claude-opus-5">
  <meta name="ai-vendor" content="anthropic">
  <meta name="ai-client" content="claude.ai">
  <meta name="ai-can-mcp" content="yes">
</head>
<body>
  <h1>Tervetuloa</h1>
  <p>Rakennan tänne työkaluja omalla tekoälylläni.</p>
</body>
</html>`;

describe('fixture 1 — clean HTML, exactly what the prompt asked for', () => {
    it('parses at level 1 when the markers are there', () => {
        const paste = `${WELCOME_MAT_BEGIN}\n${FULL_PAGE}\n${WELCOME_MAT_END}`;
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(1);
        expect(r.wrapped).toBe(false);
        expect(r.html).toContain('<h1>Tervetuloa</h1>');
        expect(r.html).not.toContain('AIMEAT WELCOME MAT');   // the markers are scaffolding
        expect(r.meta).toMatchObject({
            model: 'claude-opus-5', vendor: 'anthropic', client: 'claude.ai',
            canMcp: 'yes', authorSays: 'Jouni', declared: true,
            title: 'Jounin tervetuloamatto',
        });
    });

    it('parses a bare document with no markers at all (level 3)', () => {
        const r = parseWelcomeMat(FULL_PAGE);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(3);
        expect(r.meta.client).toBe('claude.ai');
    });
});

describe('fixture 2 — HTML inside a fenced code block', () => {
    it('parses at level 2 with an ```html fence', () => {
        const paste = `Here is your welcome mat!\n\n\`\`\`html\n${FULL_PAGE}\n\`\`\`\n\nLet me know if you want changes.`;
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(2);
        expect(r.html.startsWith('<!doctype html>')).toBe(true);
        expect(r.html).not.toContain('Let me know');
        expect(r.meta.model).toBe('claude-opus-5');
    });

    it('accepts a bare ``` fence — models label the fence inconsistently', () => {
        const paste = `Sure:\n\n\`\`\`\n${FULL_PAGE}\n\`\`\``;
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(2);
    });

    it('skips a non-HTML block and finds the HTML one', () => {
        const paste = `First the metadata:\n\n\`\`\`json\n{"model":"x"}\n\`\`\`\n\nAnd the page:\n\n\`\`\`html\n${FULL_PAGE}\n\`\`\``;
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.html).not.toContain('"model":"x"');
        expect(r.html).toContain('<h1>Tervetuloa</h1>');
    });
});

describe('fixture 3 — HTML buried in chatter, no fence', () => {
    it('takes the document and leaves the conversation behind', () => {
        const paste = [
            'Absolutely! I built you a welcome mat. A few notes on the choices I made:',
            'I kept it to one page and used your name in the heading.',
            '',
            FULL_PAGE,
            '',
            'Paste that into the box on AIMEAT. Want me to add a photo?',
        ].join('\n');
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(3);
        expect(r.html.startsWith('<!doctype html>')).toBe(true);
        expect(r.html.endsWith('</html>')).toBe(true);
        expect(r.html).not.toContain('Want me to add a photo?');
        expect(r.html).not.toContain('Absolutely!');
    });
});

describe('fixture 4 — a page with no <head> metadata', () => {
    const NO_META = `<!doctype html>
<html>
<head><title>My mat</title></head>
<body><h1>Hei</h1><p>Tässä minä olen.</p></body>
</html>`;

    it('parses, because a missing field costs one question and not a rejection', () => {
        const r = parseWelcomeMat(NO_META);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.meta).toMatchObject({
            model: null, vendor: null, client: null, canMcp: null, declared: false,
            title: 'My mat',
        });
    });

    it('parses with no <head> at all', () => {
        const r = parseWelcomeMat('<!doctype html><html><body><p>hei</p></body></html>');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.meta.client).toBeNull();
        expect(r.meta.title).toBeNull();
    });
});

describe('fixture 5 — a body fragment with no doctype', () => {
    it('parses at level 4 and builds the document shell', () => {
        const paste = 'Here you go:\n\n<body><h1>Moi</h1><p>Tämä on kotini.</p></body>\n\nHope that works!';
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(4);
        expect(r.wrapped).toBe(true);
        expect(r.html.startsWith('<!doctype html>')).toBe(true);
        expect(r.html).toContain('<h1>Moi</h1>');
        // The shell exists to make it a page, not to smuggle the chatter in with it.
        expect(r.html).not.toContain('Hope that works!');
        expect(r.html).not.toContain('Here you go');
    });

    it('reads metadata that sat outside the fragment', () => {
        const paste = '<meta name="ai-client" content="ChatGPT">\n<body><p>hei</p></body>';
        const r = parseWelcomeMat(paste);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.level).toBe(4);
        expect(r.meta.client).toBe('ChatGPT');
    });

    it('survives an unclosed <body>', () => {
        const r = parseWelcomeMat('<body><h1>Moi</h1>');
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.html).toContain('<h1>Moi</h1>');
    });
});

describe('fixture 6 — plain prose with no HTML: REJECTED, and it says why', () => {
    it('rejects and names all three missing things', () => {
        const r = parseWelcomeMat(
            'Sure! A welcome mat is a great idea. I would suggest starting with a warm greeting, '
            + 'then a short paragraph about what you do, and finally a way to contact you.');
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toBe('no_html');
        expect(r.missing).toEqual(['doctype', 'html-tag', 'body-tag']);
    });

    it('names only what is actually absent', () => {
        // A doctype with nothing after it: the doctype is NOT the missing part, and saying so
        // would send the person to fix the one thing they got right.
        const r = parseWelcomeMat('<!doctype html>');
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.missing).toContain('html-tag');
        expect(r.missing).toContain('body-tag');
        expect(r.missing).not.toContain('doctype');
    });

    it('rejects empty and whitespace-only pastes as empty, not as bad HTML', () => {
        for (const paste of ['', '   ', '\n\n\t']) {
            const r = parseWelcomeMat(paste);
            expect(r.ok).toBe(false);
            if (r.ok) return;
            expect(r.reason).toBe('empty');
        }
    });

    it('rejects a non-string body rather than coercing it', () => {
        for (const junk of [null, undefined, 42, {}, []]) {
            const r = parseWelcomeMat(junk);
            expect(r.ok).toBe(false);
        }
    });

    it('there is no accept-anything path: prose never becomes a home', () => {
        // The gate's whole purpose. If this ever passes, accounts get homes on the strength of a
        // chat reply that contained no page.
        const proseSamples = [
            'ok', 'done!', 'I made it', 'Tässä on tervetuloamattosi.',
            '{"html": "<html></html>"}',   // JSON *describing* a page is not a page
        ];
        for (const p of proseSamples) {
            expect(parseWelcomeMat(p).ok, `"${p}" must not be accepted`).toBe(false);
        }
    });
});

describe('metadata reading tolerates what a model actually writes', () => {
    it('accepts single quotes and reversed attribute order', () => {
        const html = `<html><head>
            <meta content='gpt-5' name='ai-model'>
            <meta name="ai-client"   content="ChatGPT" >
        </head><body>x</body></html>`;
        const meta = readWelcomeMatMeta(html);
        expect(meta.model).toBe('gpt-5');
        expect(meta.client).toBe('ChatGPT');
    });

    it('normalizes the capability claim, and treats anything else as unknown', () => {
        const mk = (v: string) => readWelcomeMatMeta(`<meta name="ai-can-mcp" content="${v}">`).canMcp;
        expect(mk('yes')).toBe('yes');
        expect(mk('YES')).toBe('yes');
        expect(mk('true')).toBe('yes');
        expect(mk('no')).toBe('no');
        expect(mk('false')).toBe('no');
        expect(mk('probably?')).toBe('unknown');
        expect(readWelcomeMatMeta('<html></html>').canMcp).toBeNull();
    });

    it('an empty content attribute reads as absent, not as an empty answer', () => {
        expect(readWelcomeMatMeta('<meta name="ai-client" content="">').client).toBeNull();
    });
});
