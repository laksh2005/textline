// Tests for the tree -> text formatter. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTree } from '../src/main/format.js'

// UI Automation control type ids used below.
const WINDOW = 50032,
  DOCUMENT = 50030,
  TEXT = 50020,
  EDIT = 50004,
  BUTTON = 50000,
  LINK = 50005,
  SCROLLBAR = 50014

const node = (depth, type, name, extra = {}) => ({
  depth,
  type,
  name,
  value: '',
  heading: 0,
  offscreen: false,
  ...extra
})

test('finds the browser URL from the web document value', () => {
  const { url } = formatTree([
    node(0, WINDOW, 'Chrome'),
    node(1, DOCUMENT, 'Page', { value: 'https://example.com/a' })
  ])
  assert.equal(url, 'https://example.com/a')
})

test('keeps headings, links and inputs as distinct kinds', () => {
  const { lines } = formatTree([
    node(0, WINDOW, 'App'),
    node(1, TEXT, 'Inbox', { heading: 1 }),
    node(1, LINK, 'Open'),
    node(1, EDIT, 'Search', { value: 'hello' }),
    node(1, BUTTON, 'Send')
  ])
  assert.deepEqual(
    lines.map((l) => [l.kind, l.text]),
    [
      ['text', 'App'],
      ['heading', 'Inbox'],
      ['link', 'Open'],
      ['input', 'Search: hello'],
      ['control', 'Send']
    ]
  )
})

test('splits editor text on any line break, including CR-only (Notepad)', () => {
  const { lines } = formatTree([
    node(0, WINDOW, 'Notepad'),
    node(1, DOCUMENT, 'Text editor', { value: 'first\rsecond\r\nthird\n' })
  ])
  assert.deepEqual(
    lines.filter((l) => l.kind === 'body').map((l) => l.text),
    ['first', 'second', 'third']
  )
})

test('drops window chrome and text repeated from an ancestor', () => {
  const { lines } = formatTree([
    node(0, WINDOW, 'Chat'),
    node(1, TEXT, 'Alice: hi'),
    node(2, TEXT, 'Alice: hi'),
    node(1, SCROLLBAR, 'Vertical')
  ])
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Chat', 'Alice: hi']
  )
})

test('skips offscreen elements, but keeps everything if an app marks all offscreen', () => {
  const visible = formatTree([
    node(0, WINDOW, 'W'),
    node(1, TEXT, 'on screen'),
    node(1, TEXT, 'scrolled away', { offscreen: true }),
    node(1, TEXT, 'also on screen')
  ])
  assert.ok(!visible.text.includes('scrolled away'))

  const allOff = formatTree([
    node(0, WINDOW, 'W', { offscreen: true }),
    node(1, TEXT, 'only text', { offscreen: true })
  ])
  assert.ok(allOff.text.includes('only text'))
})
