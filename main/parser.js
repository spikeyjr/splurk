// main/parser.js
// ─────────────────────────────────────────────
// Scans all .md files in a vault and builds the
// { nodes, links } graph structure from [[wikilinks]].
// Called after every autosave to keep the graph live.
// ─────────────────────────────────────────────

const { readVault, readFile } = require('./fileSystem')

// Matches [[Any Link Text]] or [[link|alias]]
// Captures the link target (before any | pipe)
const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g

/**
 * Parse the full vault and return graph-ready data.
 *
 * Returns:
 * {
 *   nodes: [ { id: 'fileName', relativePath, absolutePath } ],
 *   links: [ { source: 'fileName', target: 'otherFileName' } ]
 * }
 *
 * Nodes that are linked-to but don't exist yet are included
 * as "ghost" nodes (no absolutePath) so the graph shows them.
 */
function parseVault(vaultPath) {
  const files = readVault(vaultPath)

  // Map from name → file info for quick lookup
  const fileMap = new Map()
  for (const f of files) {
    fileMap.set(f.name.toLowerCase(), f)
  }

  const nodes = files.map(f => ({
    id: f.name,
    relativePath: f.relativePath,
    absolutePath: f.absolutePath,
    ghost: false
  }))

  const links = []
  const ghostNames = new Set()

  for (const file of files) {
    let content
    try {
      content = readFile(file.absolutePath)
    } catch {
      continue
    }

    let match
    WIKILINK_RE.lastIndex = 0

    while ((match = WIKILINK_RE.exec(content)) !== null) {
      const target = match[1].trim()
      const targetKey = target.toLowerCase()

      // Add ghost node if target file doesn't exist yet
      if (!fileMap.has(targetKey) && !ghostNames.has(targetKey)) {
        ghostNames.add(targetKey)
        nodes.push({ id: target, ghost: true })
      }

      links.push({ source: file.name, target })
    }
  }

  // Deduplicate links (same source → same target)
  const seen = new Set()
  const uniqueLinks = links.filter(l => {
    const key = `${l.source}→${l.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { nodes, links: uniqueLinks }
}

/**
 * Parse a single file's outgoing links.
 * Used for a quick incremental update after autosave.
 */
function parseFileLinks(fileName, content) {
  const links = []
  let match
  WIKILINK_RE.lastIndex = 0

  while ((match = WIKILINK_RE.exec(content)) !== null) {
    links.push({ source: fileName, target: match[1].trim() })
  }

  return links
}

module.exports = { parseVault, parseFileLinks }
