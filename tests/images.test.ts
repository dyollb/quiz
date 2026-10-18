import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractKeywords, queryFromQuestion, searchCommons } from '../src/lib/images'

describe('extractKeywords', () => {
  it('strips German stopwords and keeps content words', () => {
    expect(extractKeywords('Wie heißt die Hauptstadt der Schweiz?')).toEqual(['hauptstadt', 'schweiz'])
  })

  it('strips English stopwords', () => {
    expect(extractKeywords('What is the capital of Switzerland?')).toEqual(['capital', 'switzerland'])
  })

  it('caps the number of words, preferring longer (rarer) tokens', () => {
    const words = extractKeywords('der Erdkern besteht aus Eisen und Nickel unter der Erdkruste', 3)
    expect(words).toHaveLength(3)
    expect(words).toContain('erdkruste') // longest content word survives
  })

  it('preserves original word order in the output', () => {
    expect(extractKeywords('hauptstadt schweiz bern')).toEqual(['hauptstadt', 'schweiz', 'bern'])
  })

  it('returns nothing for stopword-only input', () => {
    expect(extractKeywords('was ist das?')).toEqual([])
  })
})

describe('queryFromQuestion', () => {
  it('merges prompt keywords with the correct answer', () => {
    const q = queryFromQuestion('Wie heißt die Hauptstadt der Schweiz?', ['Bern', 'Zürich'])
    // Correct answer included; wrong distractor (Zürich) contributes at most its own keywords,
    // but prompt + first answer should dominate.
    expect(q).toContain('hauptstadt')
    expect(q).toContain('schweiz')
    expect(q).toContain('bern')
    expect(q.split(' ').length).toBeLessThanOrEqual(5)
  })

  it('deduplicates words appearing in prompt and answer', () => {
    const q = queryFromQuestion('Was ist ein Vulkan?', ['Vulkan'])
    expect(q.split(' ')).toEqual(['vulkan'])
  })

  it('handles umlaut spellings case-insensitively', () => {
    const q = queryFromQuestion('Wie heißt die Hauptstadt?', ['Bern'])
    expect(q).toBe('hauptstadt bern')
  })
})

describe('searchCommons', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockResponses(...bodies: Array<Record<string, unknown>>) {
    const calls: string[] = []
    let i = 0
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url))
      const body = bodies[Math.min(i, bodies.length - 1)]
      i++
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    })
    return calls
  }

  function pageBody(titles: string[]) {
    const pages: Record<string, unknown> = {}
    titles.forEach((title, idx) => {
      pages[String(idx)] = {
        title: `File:${title}`,
        index: idx + 1,
        imageinfo: [{ url: `https://example.org/${idx}.jpg`, mime: 'image/jpeg', width: 100, height: 100 }],
      }
    })
    return titles.length ? { query: { pages } } : {}
  }

  it('returns nothing for a sentence of only stopwords without fetching', async () => {
    const calls = mockResponses(pageBody([]))
    const res = await searchCommons('was ist das?')
    expect(res).toEqual([])
    expect(calls).toHaveLength(0)
  })

  function gsrsearch(url: string): string {
    const raw = new URL(url).searchParams.get('gsrsearch') ?? ''
    return raw
  }

  it('falls back to OR search when the strict AND search is empty', async () => {
    const calls = mockResponses(pageBody([]), pageBody(['Bern old town']))
    const res = await searchCommons('hauptstadt schweiz bern')
    expect(calls).toHaveLength(2)
    expect(gsrsearch(calls[0])).toBe('filetype:bitmap hauptstadt schweiz bern')
    expect(gsrsearch(calls[1])).toContain('"hauptstadt" OR "schweiz" OR "bern"')
    expect(res).toHaveLength(1)
    expect(res[0].title).toBe('Bern old town')
  })

  it('falls back to dropping the bitmap filter as a last attempt', async () => {
    const calls = mockResponses(pageBody([]), pageBody([]), pageBody(['Bern cathedral.svg']))
    const res = await searchCommons('hauptstadt schweiz bern')
    expect(calls).toHaveLength(3)
    expect(gsrsearch(calls[2])).not.toContain('filetype:bitmap')
    expect(res).toHaveLength(1)
  })

  it('returns strict results without retrying when they exist', async () => {
    const calls = mockResponses(pageBody(['Bundeshaus Bern']))
    const res = await searchCommons('hauptstadt schweiz bern')
    expect(calls).toHaveLength(1)
    expect(res[0].title).toBe('Bundeshaus Bern')
  })
})
