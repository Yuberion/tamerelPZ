/**
 * Simple BBCode to HTML converter for Steam workshop descriptions and mod.info texts.
 * Escapes unsafe tags and converts common Steam BBCode tags to semantic HTML.
 */
function sanitizeLink(raw: string): string | null {
  const clean = raw.trim().replace(/["'<>]/g, '')
  if (/^(https?|steam):\/\//i.test(clean)) {
    return clean
  }
  return null
}

function sanitizeImage(raw: string): string | null {
  const clean = raw.trim().replace(/["'<>]/g, '')
  if (/^https?:\/\//i.test(clean) || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(clean)) {
    return clean
  }
  return null
}

export function bbcodeToHtml(bb: string): string {
  if (!bb) return ''
  return bb
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h3 class="ws-h1">$1</h3>')
    .replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h4 class="ws-h2">$1</h4>')
    .replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h5 class="ws-h3">$1</h5>')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span style="text-decoration: underline;">$1</span>')
    .replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi, '<del>$1</del>')
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, src) => {
      const safe = sanitizeImage(src)
      return safe ? `<img src="${safe}" class="ws-desc-img" alt="image" loading="lazy" />` : ''
    })
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, rawUrl, text) => {
      const safe = sanitizeLink(rawUrl)
      return safe ? `<a href="${safe}" target="_blank" rel="noreferrer" class="ws-link">${text}</a>` : text
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, rawUrl) => {
      const safe = sanitizeLink(rawUrl)
      return safe ? `<a href="${safe}" target="_blank" rel="noreferrer" class="ws-link">${safe}</a>` : rawUrl
    })
    .replace(/\[list\]([\s\S]*?)\[\/list\]/gi, '<ul class="ws-list">$1</ul>')
    .replace(/\[\*\]([^\n\r]*)/gi, '<li>$1</li>')
    .replace(/\r?\n/g, '<br />')
}
