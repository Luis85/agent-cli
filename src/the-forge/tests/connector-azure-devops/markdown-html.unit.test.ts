import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../../src/plugins/connector-azure-devops/domain/markdown-html.ts';

describe('Markdown to HTML blocks', () => {
  it.each([
    ['CRLF line endings', 'a\r\nb', '<p>a<br>b</p>'],
    ['lone CR line endings', 'a\rb', '<p>a<br>b</p>'],
    ['trimmed paragraph lines', '  text  \n next', '<p>text<br>next</p>'],
    ['a blank line between paragraphs', 'a\n\nb', '<p>a</p><p>b</p>'],
    ['a whitespace-only line between paragraphs', 'a\n  \nb', '<p>a</p><p>b</p>'],
    ['an empty document', '', ''],
  ])('splits paragraphs and line breaks: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([
    ['a level-one heading', '# Plan', '<h1>Plan</h1>'],
    ['a level-two heading', '## Sub', '<h2>Sub</h2>'],
    ['a level-six heading', '###### Six', '<h6>Six</h6>'],
    ['seven hashes are text', '####### Seven', '<p>####### Seven</p>'],
    ['a heading indented by three spaces', '   # x', '<h1>x</h1>'],
    ['four spaces of indentation are not a heading', '    # x', '<p># x</p>'],
    ['several spaces after the hashes', '#  Title', '<h1>Title</h1>'],
    ['a hash without a space is text or a tag', '#Title', '<p>#Title</p>'],
    ['a hash inside a line', 'a # b', '<p>a # b</p>'],
    ['a hash glued to a word', 'ab# x', '<p>ab# x</p>'],
    ['a closing sequence after a space', '# Title ##', '<h1>Title</h1>'],
    ['a closing sequence after several spaces', '# Title  ##', '<h1>Title</h1>'],
    ['a closing sequence followed by spaces', '## Title #   ', '<h2>Title</h2>'],
    ['a trailing hash glued to a word stays (C#)', '# C#', '<h1>C#</h1>'],
    ['a trailing hash glued to a word stays (F#)', '## Learn F#', '<h2>Learn F#</h2>'],
    ['a closing sequence alone is an empty heading', '### ###', '<h3></h3>'],
    ['a tag-like heading keeps its hash', '# #tag', '<h1>#tag</h1>'],
    ['inline markup in a heading', '# **Bold** plan', '<h1><strong>Bold</strong> plan</h1>'],
  ])('renders headings: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([
    ['dash items in one list', '- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['star and plus markers', '* a\n+ b', '<ul><li>a</li><li>b</li></ul>'],
    ['an indented item', '  - item', '<ul><li>item</li></ul>'],
    ['several spaces after the marker', '-  two', '<ul><li>two</li></ul>'],
    ['a dash inside a word', 'Well- done', '<p>Well- done</p>'],
    ['numbered items', '1. one\n2) two', '<ol><li>one</li><li>two</li></ol>'],
    ['a multi-digit number', '10. ten', '<ol><li>ten</li></ol>'],
    ['several spaces after the number', '1.  x', '<ol><li>x</li></ol>'],
    ['a number inside a sentence', 'Version 2. Next', '<p>Version 2. Next</p>'],
    ['a number glued to a word', 'v1. x', '<p>v1. x</p>'],
    ['a blank line splits a list', '- a\n\n- b', '<ul><li>a</li></ul><ul><li>b</li></ul>'],
    ['switching list kind', '- a\n1. b', '<ul><li>a</li></ul><ol><li>b</li></ol>'],
    ['a paragraph before a list', 'text\n- item', '<p>text</p><ul><li>item</li></ul>'],
    ['a paragraph after a list', '- a\ntext', '<ul><li>a</li></ul><p>text</p>'],
    ['a list between paragraphs', 'a\n- b\nc', '<p>a</p><ul><li>b</li></ul><p>c</p>'],
    ['inline markup in items', '- *em* and `x`', '<ul><li><em>em</em> and <code>x</code></li></ul>'],
  ])('renders lists: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([
    ['a quote', '> quote', '<blockquote>quote</blockquote>'],
    ['a quote without a space', '>quote', '<blockquote>quote</blockquote>'],
    ['an indented quote', '  > q', '<blockquote>q</blockquote>'],
    ['a greater-than sign inside text', 'x>y', '<p>x&gt;y</p>'],
    ['a paragraph before a quote', 'a\n> q', '<p>a</p><blockquote>q</blockquote>'],
    ['a list before a quote', '- a\n> q', '<ul><li>a</li></ul><blockquote>q</blockquote>'],
    ['a paragraph before a heading', 'a\n# H', '<p>a</p><h1>H</h1>'],
    ['a list before a heading', '- a\n# H', '<ul><li>a</li></ul><h1>H</h1>'],
  ])('renders quotes and block order: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([['a bullet', '- a'], ['a numbered item', '1. a'], ['a quote', '> a']])('keeps a whole line holding a Unicode line separator: %s', (_, start) => {
    expect(markdownToHtml(`${start}\u2028b`)).toContain('a\u2028b');
  });
});

describe('Markdown to HTML fenced code', () => {
  it.each([
    ['a backtick fence', '```\n<script>\n```', '<pre><code>&lt;script&gt;</code></pre>'],
    ['a tilde fence', '~~~\ncode\n~~~', '<pre><code>code</code></pre>'],
    ['one or two tildes are text', '~\n~~\ncode', '<p>~<br>~~<br>code</p>'],
    ['an info string', '```ts\nconst a = 1;\n```', '<pre><code>const a = 1;</code></pre>'],
    ['multi-line code keeps its newlines', '```\na\nb\n```', '<pre><code>a\nb</code></pre>'],
    ['an empty block', '```\n```\nafter', '<pre><code></code></pre><p>after</p>'],
    ['an unclosed fence runs to the end', '```\ncode\n# not a heading', '<pre><code>code\n# not a heading</code></pre>'],
    ['a paragraph before the fence', 'text\n```\ncode\n```', '<p>text</p><pre><code>code</code></pre>'],
    ['a list before the fence', '- a\n```\ncode\n```', '<ul><li>a</li></ul><pre><code>code</code></pre>'],
    ['markup inside code is literal', '```\n**x** [y](https://y)\n```', '<pre><code>**x** [y](https://y)</code></pre>'],
    ['an opener indented by three spaces', '   ```\ncode\n```', '<pre><code>code</code></pre>'],
    ['a tab-indented fence in a list item', '- step\n\t```bash\n\trm *x* _y_\n\t```', '<ul><li>step</li></ul><pre><code>rm *x* _y_</code></pre>'],
    ['a four-space fence in a numbered item', '1. step\n    ```\n    a*b*c\n      nested\n    ```', '<ol><li>step</li></ol><pre><code>a*b*c\n  nested</code></pre>'],
    ['a code line loses at most the opener indentation', '  ```\n    a\n\tb\n  ```', '<pre><code>  a\n\tb</code></pre>'],
    ['a line within three columns of the opener stays code', '    ```\n a\n    ```', '<pre><code>a</code></pre>'],
    ['a tab after spaces reaches the next tab stop', '  \t```\n a\n  \t```', '<pre><code>a</code></pre>'],
    ['a blank line stays in an indented fence', '\t```\n\n\ta\n\t```', '<pre><code>\na</code></pre>'],
    ['a whitespace-only line stays in an indented fence', '\t\t```\n  \n\t\ta\n\t\t```', '<pre><code>\na</code></pre>'],
    ['a line leaving the list item ends the fence', '\t```\ncode\n# H', '<pre><code></code></pre><p>code</p><h1>H</h1>'],
    ['backticks inside a line are not a fence', 'Use ``` here', '<p>Use ``` here</p>'],
    ['a backtick info string cannot hold a backtick', '```foo``` bar', '<p><code>foo</code> bar</p>'],
    ['a tilde info string may hold backticks', '~~~ a`b\ncode\n~~~', '<pre><code>code</code></pre>'],
  ])('opens fences: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([
    ['a line with an info string does not close', '```\ncode\n```js\nmore\n```', '<pre><code>code\n```js\nmore</code></pre>'],
    ['a shorter run does not close a longer fence', '````\n```\ninner\n```\n````', '<pre><code>```\ninner\n```</code></pre>'],
    ['the other fence character does not close', '~~~\na\n```\n~~~', '<pre><code>a\n```</code></pre>'],
    ['backticks do not close a tilde fence either', '```\na\n~~~\n```', '<pre><code>a\n~~~</code></pre>'],
    ['a longer run with trailing spaces closes', '```\na\n`````  \nb', '<pre><code>a</code></pre><p>b</p>'],
    ['a closer indented by three spaces', '```\na\n   ```\nb', '<pre><code>a</code></pre><p>b</p>'],
    ['a closer indented by four spaces is code', '```\na\n    ```\nb', '<pre><code>a\n    ```\nb</code></pre>'],
    ['a closer three columns past an indented opener', '\t```\n\ta\n\t   ```\nb', '<pre><code>a</code></pre><p>b</p>'],
    ['a closer four columns past an indented opener is code', '\t```\n\ta\n\t    ```', '<pre><code>a\n    ```</code></pre>'],
    ['a closer less indented than its opener', '\t```\n\ta\n ```\nb', '<pre><code>a</code></pre><p>b</p>'],
    ['a line ending in a fence run is code', '```\na ```\nb', '<pre><code>a ```\nb</code></pre>'],
    ['text after the closing run is code','```\na\n``` x\nb', '<pre><code>a\n``` x\nb</code></pre>'],
  ])('closes fences like CommonMark: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });
});

describe('Markdown to HTML inline markup', () => {
  it.each([
    ['ampersands, quotes and apostrophes', 'a & "b" it\'s <x>', '<p>a &amp; &quot;b&quot; it&#39;s &lt;x&gt;</p>'],
    ['bold with stars and underscores', '**bold** __strong__', '<p><strong>bold</strong> <strong>strong</strong></p>'],
    ['italics with stars and underscores', '*em* _it_', '<p><em>em</em> <em>it</em></p>'],
    ['underscores inside words', 'snake_case_name', '<p>snake_case_name</p>'],
    ['a bare wikilink', '[[Note]] and [[A b]]', '<p>Note and A b</p>'],
    ['an aliased wikilink', '[[Note|shown]]', '<p>shown</p>'],
    ['a code span protects markup', '`**x** [[y]]`', '<p><code>**x** [[y]]</code></p>'],
    ['a code span escapes HTML', '`a<b>`', '<p><code>a&lt;b&gt;</code></p>'],
    ['a double-backtick span holds a backtick', '``a`b``', '<p><code>a`b</code></p>'],
    ['a span closes only at a run of equal length', '`a``b`', '<p><code>a``b</code></p>'],
    ['an unmatched backtick run stays text', '``a` b', '<p>``a` b</p>'],
    ['eleven code spans on one line', Array.from('abcdefghijk', c => `\`${c}\``).join(' '), `<p>${Array.from('abcdefghijk', c => `<code>${c}</code>`).join(' ')}</p>`],
  ])('formats text: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });

  it.each([
    ['an https link', '[docs](https://example.com)', '<p><a href="https://example.com">docs</a></p>'],
    ['an http link', '[x](http://a.b)', '<p><a href="http://a.b">x</a></p>'],
    ['a mailto link in any case', '[mail](MAILTO:a@b.c)', '<p><a href="MAILTO:a@b.c">mail</a></p>'],
    ['an escaped query string', '[x](https://a.b?q=1&r="2")', '<p><a href="https://a.b?q=1&amp;r=&quot;2&quot;">x</a></p>'],
    ['balanced parentheses in the target', '[x](https://en.wikipedia.org/wiki/Foo_(bar))', '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">x</a></p>'],
    ['text after a link in parentheses', '([x](https://a.b)) and (c)', '<p>(<a href="https://a.b">x</a>) and (c)</p>'],
    ['emphasis markers in the target stay literal', '[x](https://a.b/*a*b/__init__)', '<p><a href="https://a.b/*a*b/__init__">x</a></p>'],
    ['markup in the label', '[**b** _i_](https://a.b)', '<p><a href="https://a.b"><strong>b</strong> <em>i</em></a></p>'],
    ['backticks in the target stay literal', '[x](https://a.b/`code`)', '<p><a href="https://a.b/`code`">x</a></p>'],
    ['backticks in the target stay escaped', '[x](https://a.b/`"q<`)', '<p><a href="https://a.b/`&quot;q&lt;`">x</a></p>'],
    ['code in the label and the target', '`a` [b](https://c.d/`e`) `f`', '<p><code>a</code> <a href="https://c.d/`e`">b</a> <code>f</code></p>'],
    ['backticks in a target after ten code spans', `${'`c` '.repeat(10)}[x](https://a.b/\`d\`)`, `<p>${'<code>c</code> '.repeat(10)}<a href="https://a.b/\`d\`">x</a></p>`],
    ['a target in backticks is not a scheme','[x](`https://a.b`)', '<p>x</p>'],
    ['a target with a space is not a link', '[x](a b)', '<p>[x](a b)</p>'],
    ['an unbalanced target is not a link', '[x](https://a.b/(c)', '<p>[x](https://a.b/(c)</p>'],
    ['a javascript target keeps only the label', '[x](javascript:alert(1))', '<p>x</p>'],
    ['a scheme must start the target', '[x](javascript:https://a.b)', '<p>x</p>'],
    ['a relative target keeps only the label', '[x](notes/a.md)', '<p>x</p>'],
    ['raw HTML stays text', '<img src=x onerror=alert(1)>', '<p>&lt;img src=x onerror=alert(1)&gt;</p>'],
  ])('keeps only safe links: %s', (_, markdown, html) => {
    expect(markdownToHtml(markdown)).toBe(html);
  });
});
