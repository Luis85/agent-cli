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
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (index++; index < lines.length && !lines[index]!.trimStart().startsWith(fence[1]!); index++) code.push(lines[index]!);
      html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
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

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const safeHref = (href: string) => /^(https?:|mailto:)/i.test(href);

/** Inline markup over escaped text; code spans are protected from further formatting by `<cN>` tokens, which escaped text cannot contain. */
function inline(text: string): string {
  const codes: string[] = [];
  let result = escape(text).replace(/`([^`]+)`/g, (_, code: string) => { codes.push(`<code>${code}</code>`); return `<c${codes.length - 1}>`; });
  result = result
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => (safeHref(href) ? `<a href="${href}">${label}</a>` : label))
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/\*([^*]+)\*|\b_([^_]+)_\b/g, (_, a?: string, b?: string) => `<em>${a ?? b}</em>`);
  return result.replace(/<c(\d+)>/g, (_, index: string) => codes[Number(index)]!);
}
