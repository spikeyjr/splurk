// main/git.js
// ─────────────────────────────────────────────
// simple-git wrapper for Splurk.
// All git operations are async and return
// { success, message } so the renderer can
// show status without crashing on errors.
// ─────────────────────────────────────────────

let simpleGit
try {
  simpleGit = require('simple-git')
} catch {
  // simple-git not installed yet — stubs will no-op gracefully
  simpleGit = null
}

function getGit(vaultPath) {
  if (!simpleGit) throw new Error('simple-git is not installed')
  return simpleGit(vaultPath)
}

/**
 * Check if the vault directory is a git repo.
 */
async function isRepo(vaultPath) {
  try {
    const git = getGit(vaultPath)
    await git.status()
    return true
  } catch {
    return false
  }
}

/**
 * git pull — run on vault open.
 * Uses whatever remote/branch is already configured.
 */
async function pull(vaultPath) {
  try {
    const git = getGit(vaultPath)
    const result = await git.pull()
    return {
      success: true,
      message: result.summary.changes > 0
        ? `Pulled ${result.summary.changes} change(s)`
        : 'Already up to date'
    }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

/**
 * git add . && git commit -m "msg" && git push
 * Run on app quit.
 */
async function push(vaultPath, message = 'splurk: auto-sync') {
  try {
    const git = getGit(vaultPath)

    // Check if there's anything to commit
    const status = await git.status()
    if (status.isClean()) {
      return { success: true, message: 'Nothing to commit' }
    }

    await git.add('.')
    await git.commit(message)
    await git.push()

    return { success: true, message: `Pushed ${status.files.length} file(s)` }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

/**
 * Get a short status summary — used by the status bar.
 * Returns { clean, ahead, behind, modified }
 */
async function getStatus(vaultPath) {
  try {
    const git = getGit(vaultPath)
    const s = await git.status()
    return {
      success: true,
      clean: s.isClean(),
      ahead: s.ahead,
      behind: s.behind,
      modified: s.files.length
    }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

module.exports = { isRepo, pull, push, getStatus }
