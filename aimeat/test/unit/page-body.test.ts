import { describe, it, expect } from 'vitest';
import { renderMarkdownBody, injectPageBody } from '../../src/utils/page-body.js';
import type { AimeatConfig } from '../../src/config.js';
import type { PublicPage } from '../../src/data/public-pages.js';

/**
 * THE HOLE THIS FILE IS THE MEMORY OF.
 *
 * Every public page on aimeat.io answered with the same spa.html shell, whose body carries 203
 * characters, identical on all of them. The head had described each page correctly since July, so
 * a reader that ran JavaScript saw the real page and everything anyone had thought to check was
 * green — while Bing, Copilot, DuckDuckGo and the three AI search crawlers named in robots.txt got
 * twelve copies of one near-empty document.
 *
 * The renderer here is the small, safe half of the fix: the page's own authored markdown, rendered
 * into the document that is actually sent. It is deliberately a subset, so what these tests are
 * about is the two things a hand-written renderer gets wrong. It must not emit markup the source
 * did not authorise, and it must not turn a link into an execution path.
 */

const cfg = (over: Partial<AimeatConfig> = {}): AimeatConfig => ({
  baseUrl: 'https://node.example',
  nodeId: 'node-example-001',
  ...over,
} as AimeatConfig);

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  path: '/v1/thing',
  title: 'The thing',
  description: 'A description long enough to work as a meta description on a real page.',
  changefreq: 'weekly',
  priority: '0.5',
  markdown: 'Plain prose.',
  ...over,
});

describe('renderMarkdownBody', () => {
  it('renders the constructs the registry is written in', () => {
    const html = renderMarkdownBody([
      '## A section',
      '',
      'A paragraph that runs',
      'across two source lines.',
      '',
      '- first',
      '- second',
      '',
      '1. step one',
      '2. step two',
      '',
      '> a standfirst',
      '',
      '```',
      'code line',
      '```',
      '',
      'Some `inline code` and **bold** and a [link](https://example.com/x).',
    ].join('\n'));

    expect(html).toContain('<h3>A section</h3>');
    expect(html).toContain('<p>A paragraph that runs across two source lines.</p>');
    expect(html).toContain('<ul><li>first</li><li>second</li></ul>');
    expect(html).toContain('<ol><li>step one</li><li>step two</li></ol>');
    expect(html).toContain('<blockquote><p>a standfirst</p></blockquote>');
    expect(html).toContain('<pre><code>code line</code></pre>');
    expect(html).toContain('<code class="md-code">inline code</code>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/x">link</a>');
  });

  // The source is ours, which is a reason to be careful rather than a reason not to be: this text
  // is rendered into a page on the operator's own domain, and a renderer that passes markup
  // through is one careless edit away from being the hole.
  it('emits no markup the source did not ask for', () => {
    const html = renderMarkdownBody('A <script>alert(1)</script> and a <b>tag</b> and an & ampersand.');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('refuses a link scheme that is not a link', () => {
    const js = renderMarkdownBody('[press me](javascript:alert(1))');
    expect(js).not.toContain('href');
    expect(js).toContain('press me');

    const data = renderMarkdownBody('[press me](data:text/html,<script>alert(1)</script>)');
    expect(data).not.toContain('href');
  });

  it('keeps the schemes a page legitimately uses', () => {
    expect(renderMarkdownBody('[a](/v1/portal)')).toContain('href="/v1/portal"');
    expect(renderMarkdownBody('[a](#section)')).toContain('href="#section"');
    expect(renderMarkdownBody('[a](mailto:x@example.com)')).toContain('href="mailto:x@example.com"');
  });

  it('leaves a code span alone instead of formatting inside it', () => {
    const html = renderMarkdownBody('Use `**not bold**` here.');
    expect(html).toContain('<code class="md-code">**not bold**</code>');
    expect(html).not.toContain('<strong>');
  });

  // The placeholder the code-span pass uses must not be forgeable from the source text, or a page
  // could address another page's code span by writing the placeholder itself.
  it('cannot be made to restore a code span the source did not open', () => {
    const html = renderMarkdownBody('A number 0 alone, and `real` code.');
    expect(html).toContain('A number 0 alone');
    expect(html).toContain('<code class="md-code">real</code>');
  });
});

describe('injectPageBody', () => {
  const shell = '<body>\n  <div id="app"></div>\n  <footer>f</footer>\n</body>';

  it('puts the page body after the app root, with the title as a heading', () => {
    const out = injectPageBody(shell, page({ markdown: 'Hello.' }), cfg(), { isShell: true });
    expect(out).toContain('<div id="app"></div>');
    expect(out).toContain('<div id="crawler-body" class="md-body"><h2>The thing</h2>');
    expect(out.indexOf('id="crawler-body"')).toBeGreaterThan(out.indexOf('id="app"'));
    expect(out).toContain('<p>Hello.</p>');
  });

  it('substitutes the node\'s own base URL and id', () => {
    const out = injectPageBody(
      shell, page({ markdown: 'See {{BASE_URL}}/v1/x on {{NODE_ID}}.' }), cfg(), { isShell: true },
    );
    expect(out).toContain('https://node.example/v1/x');
    expect(out).toContain('node-example-001');
    expect(out).not.toContain('{{BASE_URL}}');
  });

  it('takes a built body over the registry summary when one is given', () => {
    const out = injectPageBody(
      shell, page({ markdown: 'the summary' }), cfg(), { isShell: true, markdown: 'the built body' },
    );
    expect(out).toContain('the built body');
    expect(out).not.toContain('the summary');
  });

  // Three ways this must decline, each one a page that would otherwise get a second copy of itself
  // or a block of text belonging to nothing.
  it('declines when the document is not the shell', () => {
    const out = injectPageBody(shell, page(), cfg(), { isShell: false });
    expect(out).toBe(shell);
  });

  it('declines when the page has no authored body', () => {
    const out = injectPageBody(shell, page({ markdown: undefined }), cfg(), { isShell: true });
    expect(out).toBe(shell);
  });

  it('declines when the route is not a registry page', () => {
    const out = injectPageBody(shell, undefined, cfg(), { isShell: true });
    expect(out).toBe(shell);
  });

  it('declines when the document has no app root to sit beside', () => {
    const other = '<body><main>real content</main></body>';
    expect(injectPageBody(other, page(), cfg(), { isShell: true })).toBe(other);
  });

  it('escapes a page title rather than letting it close the block', () => {
    const out = injectPageBody(shell, page({ title: 'A </div><script>x</script> title' }), cfg(), { isShell: true });
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});
