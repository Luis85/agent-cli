/**
 * A minimal, safe Markdown → HTML conversion for Azure DevOps HTML description fields. Every character of the
 * input is escaped before markup is added, links are kept only for http(s) and mailto targets, and raw HTML in the
 * note stays visible text. It covers headings, paragraphs, line breaks, bullet and numbered lists, block quotes,
 * fenced code, inline code, bold, italics, links and wikilinks (shown as their text).
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  const open: { list: { tag: 'ul' | 'ol'; items: string[] } | null } = { list: null };
  const flushParagraph = () => { if (paragraph.length > 0) html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = []; };
  const flushList = () => {
    const list = open.list;
    if (list) html.push(`<${list.tag}>${list.items.map(item => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    open.list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (index++; index < lines.length && !closesFence(lines[index]!, fence[1]!); index++) code.push(lines[index]!);
      html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(?:#+\s*$)?(.*?)(?:\s+#+)?\s*$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line), numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line), quote = /^\s*>\s?(.*)$/.exec(line);
    if (line.trim() === '') flush();
    else if (heading) { flush(); html.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`); }
    else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (open.list?.tag !== tag) { flushList(); open.list = { tag, items: [] }; }
      open.list!.items.push((bullet ?? numbered)![1]!);
    } else if (quote) { flush(); html.push(`<blockquote>${inline(quote[1]!)}</blockquote>`); }
    else { flushList(); paragraph.push(line.trim()); }
  }
  flush();
  return html.join('');
}

/** A CommonMark closing fence: up to three spaces, a run of the opener's character at least as long as the opener, then only whitespace. */
function closesFence(line: string, opener: string): boolean {
  const run = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
  return run !== undefined && run[0] === opener[0] && run.length >= opener.length;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const safeHref = (href: string) => /^(https?:|mailto:)/i.test(href);

/**
 * Inline markup over escaped text. Code spans (a backtick run closed by a run of the same length) and link targets are
 * protected from further formatting by `<cN>` tokens, which escaped text cannot contain. A link target may hold one
 * level of balanced parentheses.
 */
function inline(text: string): string {
  const tokens: string[] = [];
  const token = (value: string) => `<c${tokens.push(value) - 1}>`;
  let result = escape(text).replace(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (_, _run: string, code: string) => token(`<code>${code}</code>`));
  result = result
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label: string, href: string) => (safeHref(href) ? `<a href="${token(href)}">${label}</a>` : label))
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/\*([^*]+)\*|\b_([^_]+)_\b/g, (_, a?: string, b?: string) => `<em>${a ?? b}</em>`);
  return result.replace(/<c(\d+)>/g, (_, index: string) => tokens[Number(index)]!);
}
