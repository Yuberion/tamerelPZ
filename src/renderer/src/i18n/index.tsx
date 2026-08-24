import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  EN,
  EN_PLURALS,
  RU,
  RU_PLURALS,
  type Lang,
  type PluralKey,
  type TKey
} from './dict'

export type { Lang, TKey } from './dict'

const STORAGE_KEY = 'pz.lang'

function readStoredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch {
    /* private mode / storage disabled: fall through to detection */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

/**
 * Module-level mirror of the active language.
 *
 * `format.ts` needs the locale but is a set of pure helpers called from dozens of
 * render paths, so threading a `lang` argument through every call site would be
 * noise. It reads this instead. The value is updated synchronously inside
 * `setLang` *before* the state update, so the re-render that follows already sees
 * the new locale. Nothing else may write it.
 */
let currentLang: Lang = readStoredLang()

export function getLang(): Lang {
  return currentLang
}

/** `[one, few, many]` slot for `n` — English collapses to one/other. */
export function pluralIndex(lang: Lang, n: number): 0 | 1 | 2 {
  if (lang === 'en') return n === 1 ? 0 : 1
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 0
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1
  return 2
}

export function translate(
  lang: Lang,
  key: TKey,
  params?: Record<string, string | number>
): string {
  const raw = lang === 'ru' ? RU[key] : EN[key]
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

export function pluralWord(lang: Lang, key: PluralKey, n: number): string {
  const forms = lang === 'ru' ? RU_PLURALS[key] : EN_PLURALS[key]
  return forms[pluralIndex(lang, n)]
}

/**
 * Narrow a runtime-built key to `TKey`.
 *
 * The validator sends rule ids over IPC and the renderer maps them to
 * `wbrule.*` entries. A rule added in main before its dictionary entry exists
 * would otherwise reach `translate()` as an unknown key and throw on the
 * placeholder replace, so callers check first and fall back to the raw id.
 */
export function hasKey(key: string): key is TKey {
  return key in EN
}

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  /** Translate a key, optionally interpolating `{name}` placeholders. */
  t: (key: TKey, params?: Record<string, string | number>) => string
  /** The correctly inflected noun phrase for `n` — does not include the number. */
  p: (key: PluralKey, n: number) => string
}

const I18nContext = createContext<I18n | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang)

  const setLang = useCallback((next: Lang) => {
    currentLang = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* persistence is best-effort */
    }
    setLangState(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const api = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      toggleLang: () => setLang(lang === 'ru' ? 'en' : 'ru'),
      t: (key, params) => translate(lang, key, params),
      p: (key, n) => pluralWord(lang, key, n)
    }),
    [lang, setLang]
  )

  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
