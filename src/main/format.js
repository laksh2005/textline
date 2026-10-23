// Turns the raw accessibility tree (a flat list of nodes with depths) into readable,
// structured lines. This is generic: it only looks at UI Automation roles, never at
// which app the tree came from.

// UI Automation control type ids -> short role names.
// https://learn.microsoft.com/windows/win32/winauto/uiauto-controltype-ids
const ROLES = {
  50000: 'button',
  50002: 'checkbox',
  50003: 'combobox',
  50004: 'edit',
  50005: 'link',
  50006: 'image',
  50007: 'listitem',
  50008: 'list',
  50011: 'menuitem',
  50014: 'scrollbar',
  50018: 'tab',
  50019: 'tabitem',
  50020: 'text',
  50021: 'toolbar',
  50023: 'tree',
  50024: 'treeitem',
  50026: 'group',
  50027: 'thumb',
  50028: 'datagrid',
  50029: 'dataitem',
  50030: 'document',
  50032: 'window',
  50033: 'pane',
  50036: 'table',
  50037: 'titlebar',
  50038: 'separator'
}

// Window chrome that never carries content.
const SKIP = new Set(['scrollbar', 'thumb', 'separator', 'titlebar'])

export function formatTree(nodes) {
  // Prefer what is actually visible. Some apps mark everything offscreen,
  // so fall back to the whole tree if nothing is left.
  let visible = nodes.filter((n) => !n.offscreen)
  if (visible.length < 3) visible = nodes

  const lines = []
  const parentText = [] // text of the nearest ancestor at each depth, to drop repeats
  let url = null

  for (const n of visible) {
    const role = ROLES[n.type] ?? 'other'
    parentText.length = n.depth

    // A browser's web page is a "document" whose value is the page URL.
    if (!url && role === 'document' && looksLikeUrl(n.value)) url = n.value
    if (SKIP.has(role)) continue

    const name = clean(n.name)
    const value = clean(n.value)
    // Show the value only when it adds something (e.g. what's typed in a box).
    let text = name
    if (value && value !== name && role !== 'document') text = name ? `${name}: ${value}` : value
    if (!text) continue

    // Containers often repeat their children's text; skip exact repeats of an ancestor.
    if (parentText.includes(text)) continue
    parentText[n.depth] = text

    const kind = n.heading ? 'heading' : kindOf(role)
    lines.push({ depth: n.depth, kind, level: n.heading || undefined, role, text })
  }

  // Indent relative to the shallowest line, capped so deep trees stay readable.
  const minDepth = Math.min(...lines.map((l) => l.depth))
  for (const l of lines) l.depth = Math.min(l.depth - minDepth, 8)

  const text = lines.map((l) => '  '.repeat(l.depth) + l.text).join('\n')
  return { url, lines, text }
}

function kindOf(role) {
  if (role === 'listitem' || role === 'dataitem' || role === 'treeitem') return 'item'
  if (role === 'link') return 'link'
  if (role === 'edit' || role === 'combobox') return 'input'
  if (role === 'button' || role === 'menuitem' || role === 'tabitem') return 'control'
  return 'text'
}

function clean(s) {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function looksLikeUrl(s) {
  return /^(https?|file|chrome|edge|about):/i.test(s ?? '')
}
