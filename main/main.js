// main/main.js
// ─────────────────────────────────────────────
// Splurk — Electron main process
// Spawns the BrowserWindow, loads the renderer,
// registers all IPC handlers, and handles git
// push on app quit.
// ─────────────────────────────────────────────

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./ipc')
const git = require('./git')

// Keep a global ref so the window isn't GC'd
let mainWindow = null

// Track the currently open vault path
global.currentVault = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f14',
    titleBarStyle: 'hiddenInset',   // clean look on Linux too
    frame: false,                    // custom titlebar
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,        // security: renderer can't access Node directly
      nodeIntegration: false,        // security: no raw Node in renderer
      sandbox: false                 // needed for preload to use require()
    }
  })

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Open devtools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── App lifecycle ──────────────────────────────

app.whenReady().then(() => {
  // Register all IPC handlers before window opens
  registerIpcHandlers(ipcMain)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // On Linux/Windows, quit when all windows close
  if (process.platform !== 'darwin') app.quit()
})

// ── Git push on quit (Phase 4 hook — wired up now, logic fills in later) ──
app.on('before-quit', async (e) => {
  if (!global.currentVault) return  // no vault open, just quit

  // Prevent immediate quit so we can await the push
  e.preventDefault()

  try {
    await git.push(global.currentVault)
    console.log('[splurk] git push complete — exiting')
  } catch (err) {
    console.warn('[splurk] git push failed (maybe no remote):', err.message)
  } finally {
    // Remove listener so the next quit() call goes through
    app.removeAllListeners('before-quit')
    app.quit()
  }
})
