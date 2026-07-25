// Link previews are shipped markup, and the failure mode is silent: iMessage
// and Slack simply show a bare URL when a tag is missing or relative, and
// nobody notices until someone shares the game. These assert the contract the
// scrapers actually enforce.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')

const content = (attr: string, value: string): string | null => {
  const re = new RegExp(`<meta[^>]*${attr}="${value}"[^>]*>`, 'i')
  const tag = re.exec(html)?.[0]
  return tag ? (/content="([^"]*)"/.exec(tag)?.[1] ?? null) : null
}

describe('link preview metadata', () => {
  it('carries the tags every scraper reads', () => {
    for (const [attr, name] of [
      ['property', 'og:title'],
      ['property', 'og:description'],
      ['property', 'og:image'],
      ['property', 'og:url'],
      ['property', 'og:type'],
      ['name', 'twitter:card'],
      ['name', 'twitter:image'],
    ] as const) {
      expect(content(attr, name), `${name} present`).toBeTruthy()
    }
  })

  it('uses absolute https urls — a relative og:image is dropped silently', () => {
    for (const [attr, name] of [
      ['property', 'og:image'],
      ['property', 'og:url'],
      ['name', 'twitter:image'],
    ] as const) {
      expect(content(attr, name), `${name} absolute`).toMatch(/^https:\/\//)
    }
  })

  it('points at a raster card of the size the previews expect', () => {
    // SVG og:images are ignored by iMessage, Slack and Twitter alike.
    expect(content('property', 'og:image')).toMatch(/\.png$/)
    expect(content('property', 'og:image:width')).toBe('1200')
    expect(content('property', 'og:image:height')).toBe('630')
    const card = new URL('../../../public/social-card.png', import.meta.url)
    const bytes = readFileSync(card)
    expect(bytes.byteLength, 'card is a real file').toBeGreaterThan(10_000)
    // PNG header, then the IHDR width/height as big-endian 32-bit ints.
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBe(1200)
    expect(bytes.readUInt32BE(20)).toBe(630)
  })

  it('points at the site the game actually deploys to', () => {
    // The deploy is langui.sh/loadfactor, not the github.io default — a card
    // hosted at the wrong origin 404s and the preview falls back to a bare
    // link, which is exactly the failure this file exists to prevent.
    const origin = 'https://langui.sh/loadfactor/'
    expect(content('property', 'og:url')).toBe(origin)
    expect(content('property', 'og:image')).toBe(`${origin}social-card.png`)
    expect(content('name', 'twitter:image')).toBe(`${origin}social-card.png`)
    expect(/<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]).toBe(origin)
  })

  it('keeps the description short enough to survive a preview card', () => {
    const d = content('property', 'og:description') ?? ''
    expect(d.length).toBeGreaterThan(60)
    expect(d.length).toBeLessThan(300)
  })
})
