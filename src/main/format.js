// Turns the raw accessibility tree (a flat list of nodes with depths) into readable,
// structured lines. This is generic: it only looks at UI Automation roles, never at
// which app the tree came from.

// UI Automation control type ids that matter for reading. Anything not listed is plain text.
// https://learn.microsoft.com/windows/win32/winauto/uiauto-controltype-ids
const KIND = {
  50000: 'control', // button
  50011: 'control', // menu item
  50019: 'control', // tab item
  50005: 'link',
  50004: 'input', // edit box
  50003: 'input', // combo box
  50007: 'item', // list item
  50024: 'item', // tree item
  50029: 'item' // data item (table row)
}
const DOCUMENT = 50030 // a web page or editor document
// Window chrome that never carries content: scrollbar, thumb, title bar, separator.
const SKIP = new Set([50014, 50027, 50037, 50038])

// UIA_MainLandmarkTypeId: the region an app marks as its main content (e.g. HTML <main>).
const MAIN_LANDMARK = 80002

export function formatTree(nodes) {
  // Prefer what is actually visible. Some apps mark everything offscreen,
  // so fall back to the whole tree if nothing is left.
  let visible = nodes.filter((n) => !n.offscreen)
  if (visible.length < 3) visible = nodes

  const lines = []
  const parentText = [] // text of the nearest ancestor at each depth, to drop repeats
  const regionAt = [] // region of the nearest landmark ancestor at each depth
  let url = null

  for (const n of visible) {
    const kind = KIND[n.type] ?? 'text'
    parentText.length = n.depth

    // Which part of the window is this in? Apps mark regions as landmarks:
    // "main" for the main content; navigation, search etc. count as "side".
    regionAt.length = n.depth
    let region = regionAt[n.depth - 1] ?? null
    // A landmark nested inside the main region (e.g. a "Primary pane") is still main.
    if (n.landmark && region !== 'main') region = n.landmark === MAIN_LANDMARK ? 'main' : 'side'
    regionAt[n.depth] = region

    // A browser's web page is a "document" whose value is the page URL.
    if (!url && n.type === DOCUMENT && looksLikeUrl(n.value)) url = n.value
    if (SKIP.has(n.type)) continue

    // Multi-line text (an editor's contents): keep its own lines.
    if (/[\r\n]/.test(n.value ?? '')) {
      const label = clean(n.name)
      if (label) lines.push({ depth: n.depth, kind, region, text: label })
      for (const raw of n.value.split(/\r\n|\r|\n/)) {
        const text = raw.replace(/\s+$/, '')
        if (text) lines.push({ depth: n.depth + 1, kind: 'body', region, text })
      }
      continue
    }

    const name = clean(n.name)
    const value = clean(n.value)
    // Show the value only when it adds something (e.g. what's typed in a box).
    let text = name
    if (value && value !== name && n.type !== DOCUMENT) text = name ? `${name}: ${value}` : value
    if (!text) continue

    // Containers often repeat their children's text; skip exact repeats of an ancestor.
    if (parentText.includes(text)) continue
    parentText[n.depth] = text

    lines.push({
      depth: n.depth,
      kind: n.heading ? 'heading' : kind,
      level: n.heading || undefined,
      region,
      text
    })
  }

  // Indent relative to the shallowest line, capped so deep trees stay readable.
  const minDepth = Math.min(...lines.map((l) => l.depth))
  for (const l of lines) l.depth = Math.min(l.depth - minDepth, 8)

  const text = lines.map((l) => '  '.repeat(l.depth) + l.text).join('\n')
  return { url, lines, text }
}

function clean(s) {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function looksLikeUrl(s) {
  return /^(https?|file|chrome|edge|about):/i.test(s ?? '')
}

// Many apps put an unread count in the title ("(3) WhatsApp", "(12) Inbox"). It changes
// with every new message, so leave it out; otherwise one chat splits into many sessions.
export function cleanTitle(title) {
  return title.replace(/^\(\d+\+?\)\s*/, '')
}
