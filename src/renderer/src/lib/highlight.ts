export interface Token {
  text: string
  cls?: 'com' | 'str' | 'num' | 'kw' | 'key' | 'op' | 'tag' | 'attr'
}

const LUA_RE =
  /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[\[[\s\S]*?\]\])|(\b\d+(?:\.\d+)?\b)|\b(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while|self)\b/g

const JSON_RE = /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b/gi

const XML_RE = /(<!--[\s\S]*?-->)|(<\/?[\w:.-]+)|([\w:.-]+)(?==")|("(?:\\.|[^"\\])*")|(\/?>)/g

const INI_RE = /^([^=\n]+?)(=)(.*)$/

function pushPlain(out: Token[], text: string): void {
  if (text) out.push({ text })
}

function tokenizeWithRegex(
  text: string,
  re: RegExp,
  map: (m: RegExpExecArray) => Token[]
): Token[] {
  const out: Token[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) pushPlain(out, text.slice(last, m.index))
    out.push(...map(m))
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  pushPlain(out, text.slice(last))
  return out
}

/** Tiny, dependency-free tokenizer used by the file preview pane. */
export function highlight(text: string, lang: string | undefined): Token[] {
  switch (lang) {
    case 'lua':
      return tokenizeWithRegex(text, LUA_RE, (m) => [
        {
          text: m[0],
          cls: m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : 'kw'
        }
      ])
    case 'json':
      return tokenizeWithRegex(text, JSON_RE, (m) => {
        if (m[1]) {
          const tokens: Token[] = [{ text: m[1], cls: m[2] ? 'key' : 'str' }]
          if (m[2]) tokens.push({ text: m[2], cls: 'op' })
          return tokens
        }
        return [{ text: m[0], cls: m[3] ? 'num' : 'kw' }]
      })
    case 'xml':
      return tokenizeWithRegex(text, XML_RE, (m) => [
        {
          text: m[0],
          cls: m[1] ? 'com' : m[2] ? 'tag' : m[3] ? 'attr' : m[4] ? 'str' : 'tag'
        }
      ])
    case 'ini':
      return text.split(/(\n)/).flatMap<Token>((line) => {
        if (line === '\n') return [{ text: line }]
        const trimmed = line.trimStart()
        if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';')) {
          return [{ text: line, cls: 'com' }]
        }
        const m = INI_RE.exec(line)
        if (!m) return [{ text: line }]
        return [
          { text: m[1] ?? '', cls: 'key' },
          { text: m[2] ?? '', cls: 'op' },
          { text: m[3] ?? '', cls: 'str' }
        ]
      })
    default:
      return [{ text }]
  }
}
