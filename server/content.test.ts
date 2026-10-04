import { describe, expect, test } from 'bun:test'
import { cleanContent, ContentValidationError } from './content'
import { maxHtmlLength } from '../shared/content'

const valid = {
  title: 'Welcome to <span>Palianytsia Bread</span>',
  subtitle: 'Baked with <em>care</em>.',
  story: '<p>Our bread.</p><p><strong>Slowly fermented.</strong></p>',
}

describe('front page HTML validation', () => {
  test('preserves supported formatting and paragraphs', () => {
    expect(cleanContent(valid)).toEqual(valid)
  })

  test('removes executable HTML, event handlers, styles, and unsafe links', () => {
    const content = cleanContent({
      ...valid,
      story: '<script>alert(1)</script><p onclick="alert(1)" style="color:red">Bread <a href="javascript:alert(1)">link</a><img src=x onerror="alert(1)"></p>',
    })
    expect(content.story).toBe('<p>Bread <a>link</a></p>')
  })

  test('keeps safe links and removes block tags from the title', () => {
    expect(cleanContent({ ...valid, title: '<p>Hello <a href="https://example.com">bread</a></p>' }).title)
      .toBe('Hello <a href="https://example.com">bread</a>')
  })

  test('rejects incomplete, blank, non-text, and oversized fields', () => {
    for (const input of [null, [], {}, { ...valid, story: 1 }, { ...valid, title: '<script>hidden()</script>' }, { ...valid, title: '<p>&nbsp;</p>' }, { ...valid, story: 'x'.repeat(maxHtmlLength + 1) }]) {
      expect(() => cleanContent(input)).toThrow(ContentValidationError)
    }
  })
})
