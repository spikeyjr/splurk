// main/fileSystem.js
// ─────────────────────────────────────────────
// All direct filesystem operations live here.
// ipc.js calls these — nothing else touches fs.
// ─────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

/**
 * Recursively collect all .md files under a directory.
 * Returns an array of objects: { name, relativePath, absolutePath }
 */
function readVault(vaultPath) {
  const results = []

  function walk(dir, base = '') {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.error('[fileSystem] readVault walk error:', err.message)
      return
    }

    for (const entry of entries) {
      // Skip hidden files/dirs (e.g. .git, .obsidian)
      if (entry.name.startsWith('.')) continue

      const rel = base ? `${base}/${entry.name}` : entry.name
      const abs = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(abs, rel)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push({
          name: entry.name.replace(/\.md$/, ''),
          relativePath: rel,
          absolutePath: abs
        })
      }
    }
  }

  walk(vaultPath)
  return results
}

/**
 * Read a single file's text content.
 * Returns the string, or throws on error.
 */
function readFile(absolutePath) {
  return fs.readFileSync(absolutePath, 'utf8')
}

/**
 * Write text content to a file.
 * Creates the file if it doesn't exist.
 */
function writeFile(absolutePath, content) {
  // Ensure the directory exists
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content, 'utf8')
}

/**
 * Create a new empty .md file in the vault.
 * Returns the new file's info object.
 */
function createFile(vaultPath, fileName) {
  // Sanitize name — strip illegal chars, ensure .md extension
  const safe = fileName.replace(/[/\\?%*:|"<>]/g, '-').replace(/\.md$/, '')
  const absPath = path.join(vaultPath, `${safe}.md`)

  if (fs.existsSync(absPath)) {
    throw new Error(`File already exists: ${safe}.md`)
  }

  fs.writeFileSync(absPath, `# ${safe}\n\n`, 'utf8')

  return {
    name: safe,
    relativePath: `${safe}.md`,
    absolutePath: absPath
  }
}

/**
 * Delete a .md file from the vault.
 */
function deleteFile(absolutePath) {
  fs.unlinkSync(absolutePath)
}

module.exports = { readVault, readFile, writeFile, createFile, deleteFile }
