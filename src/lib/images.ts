/**
 * Wikimedia Commons image search for the dev-only quiz builder.
 * Public CORS-enabled API, no key required. https://commons.wikimedia.org/w/api.php
 */

export interface CommonsImage {
  title: string
  /** Scaled-down preview URL for the search grid. */
  thumbUrl: string
  /** Full image URL (fetched + packaged when the user selects it). */
  fullUrl: string
  width: number
  height: number
  /** Human license label, e.g. "CC BY-SA 4.0". */
  license: string
  /** "Artist — Title" attribution line when available. */
  credit: string
}

const API = 'https://commons.wikimedia.org/w/api.php'
const THUMB_WIDTH = 320

interface CsResultPage {
  title: string
  index?: number
  imageinfo?: Array<{
    url: string
    thumburl?: string
    thumbwidth?: number
    width: number
    height: number
    extmetadata?: Record<
      string,
      { value?: string; html?: string } | undefined
    >
  }>
}

function stripHtml(s: string | undefined): string {
  if (!s) return ''
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Wikimedia Commons search is a keyword match (AND over all tokens) against file
 * names and description text — full sentences almost never match, in any
 * language. So we strip stopwords (EN/DE/FR), keep the few most substantial
 * words, and fall back to OR-matching when the strict AND search is empty.
 */
export async function searchCommons(query: string, limit = 12): Promise<CommonsImage[]> {
  const keywords = extractKeywords(query, 6)
  if (keywords.length === 0) return []
  const attempts = [
    // 1. strict: all keywords must appear (best precision)
    `filetype:bitmap ${keywords.join(' ')}`,
    // 2. any keyword is enough (fixes sentence / low-hit queries)
    keywords.length > 1
      ? `filetype:bitmap ${keywords.map((k) => `"${k}"`).join(' OR ')}`
      : keywords[0],
    // 3. drop the bitmap filter too (lets SVGs and other indexed matches through)
    keywords.length > 1 ? keywords.join(' OR ') : '',
  ].filter(Boolean)
  let results: CommonsImage[] = []
  for (const gsrsearch of attempts) {
    results = await fetchCommonsSearch(gsrsearch, limit)
    if (results.length > 0) return results
  }
  return results
}

async function fetchCommonsSearch(gsrsearch: string, limit: number): Promise<CommonsImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch,
    gsrnamespace: '6', // File: namespace
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
  })
  const res = await fetch(`${API}?${params}`)
  if (!res.ok) throw new Error(`Commons search failed: HTTP ${res.status}`)
  const data = (await res.json()) as { query?: { pages?: Record<string, CsResultPage> } }
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  )
  const out: CommonsImage[] = []
  for (const page of pages) {
    const info = page.imageinfo?.[0]
    if (!info) continue
    const mime = (info as unknown as { mime?: string }).mime
    if (mime && !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime)) continue
    const meta = info.extmetadata ?? {}
    const license = stripHtml(meta.LicenseShortName?.value ?? meta.LicenseShortName?.html) || 'Unknown license'
    const artist = stripHtml(meta.Artist?.value ?? meta.Artist?.html)
    const title = page.title.replace(/^File:/, '')
    out.push({
      title,
      thumbUrl: info.thumburl ?? info.url,
      fullUrl: info.url,
      width: info.width,
      height: info.height,
      license,
      credit: artist ? `${artist} — ${title} (${license}, Wikimedia Commons)` : `${title} (${license}, Wikimedia Commons)`,
    })
  }
  return out
}

/**
 * Derive a first-guess search query from a question prompt.
 * @deprecated Prefer {@link queryFromQuestion}, which also uses the correct answers.
 */
export function keywordsFromPrompt(prompt: string): string {
  return extractKeywords(prompt).join(' ')
}

/**
 * Build a Commons search query from a question: keywords from the prompt plus
 * the correct answer text(s). The correct answer is often the exact thing to
 * picture (e.g. "Bern" for "Wie heißt die Hauptstadt der Schweiz?").
 */
export function queryFromQuestion(prompt: string, correctAnswerTexts: string[]): string {
  const words = [...extractKeywords(prompt, 4), ...correctAnswerTexts.flatMap((t) => extractKeywords(t, 2))]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const w of words) {
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(w)
  }
  return unique.slice(0, 5).join(' ')
}

/**
 * Lowercase, drop punctuation and stopwords (EN/DE/FR), and keep at most
 * `maxWords` of the most substantial tokens — Commons search ANDs all tokens,
 * so long queries return nothing.
 */
export function extractKeywords(text: string, maxWords = 5): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[?!.,;:()"'«»„“”]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  // Prefer informationally "rarer" words: longer tokens first, original order as tiebreak.
  return tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.length - a.t.length || a.i - b.i)
    .slice(0, maxWords)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.t)
}

const STOPWORDS = new Set([
  // English
  'what', 'whats', 'which', 'who', 'whos', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'the', 'a', 'an', 'of', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does',
  'did', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'not', 'no', 'with', 'from', 'by',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'as', 'if', 'than',
  'then', 'so', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
  // German (incl. umlaut and ue/ae/oe spellings)
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einer', 'einem',
  'eines', 'kein', 'keine', 'wie', 'heißt', 'heisst', 'was', 'wer', 'wen', 'wem', 'wo',
  'woher', 'wohin', 'wann', 'warum', 'wieso', 'welche', 'welcher', 'welches', 'welchen',
  'ist', 'sind', 'war', 'waren', 'sein', 'seine', 'haben', 'hat', 'hatte', 'werden',
  'wurde', 'man', 'mit', 'von', 'zu', 'zum', 'zur', 'in', 'im', 'an', 'am', 'auf',
  'aus', 'bei', 'nach', 'vor', 'durch', 'für', 'ohne', 'um', 'als', 'dass', 'daß',
  'wenn', 'weil', 'über', 'ueber', 'unter', 'oder', 'und', 'nicht', 'nein', 'ja',
  'es', 'er', 'sie', 'es', 'ihr', 'ihre', 'sein', 'sie', 'auch', 'noch', 'schon',
  'mal', 'denn', 'aber', 'sondern', 'do',
  // French (basics)
  'le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'ou', 'est', 'sont', 'que',
  'qui', 'quoi', 'où', 'quand', 'comment', 'pourquoi', 'quel', 'quelle', 'dans', 'sur',
  'avec', 'pour', 'pas', 'ne', 'ce', 'cette', 'ils', 'elles', 'on',
])
