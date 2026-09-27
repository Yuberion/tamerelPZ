/**
 * Simple BBCode to HTML converter for Steam workshop descriptions and mod.info texts.
 * Escapes unsafe tags and converts common Steam BBCode tags to semantic HTML.
 */
export function bbcodeToHtml(bb: string): string {
  if (!bb) return ''
  return bb
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h3 class="ws-h1">$1</h3>')
    .replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h4 class="ws-h2">$1</h4>')
    .replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h5 class="ws-h3">$1</h5>')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span style="text-decoration: underline;">$1</span>')
    .replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi, '<del>$1</del>')
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1" class="ws-desc-img" alt="image" loading="lazy" />')
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noreferrer" class="ws-link">$2</a>')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noreferrer" class="ws-link">$1</a>')
    .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, '<ul class="ws-list">$1</ul>')
    .replace(/\[\*\]([^\n\r]*)/gi, '<li>$1</li>')
    .replace(/\r?\n/g, '<br />')
}
