const { dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fileSystem = require('./fileSystem')
const parser = require('./parser')
const git = require('./git')

function registerIpcHandlers(ipcMain) {

  ipcMain.handle('splurk:pick-vault', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Splurk Vault',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const vaultPath = result.filePaths[0]
    global.currentVault = vaultPath
    return vaultPath
  })

  ipcMain.handle('splurk:pick-parent', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose where to create your vault',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('splurk:create-vault', async (_e, parentPath, vaultName) => {
    const vaultPath = path.join(parentPath, vaultName)
    try {
      fs.mkdirSync(vaultPath, { recursive: true })
      global.currentVault = vaultPath
      return { success: true, vaultPath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('splurk:open-vault', async (_e, vaultPath) => {
    global.currentVault = vaultPath
    const files = fileSystem.readVault(vaultPath)
    const graph = parser.parseVault(vaultPath)
    git.pull(vaultPath).then(r => console.log('[git] pull:', r.message))
    return { files, graph }
  })

  ipcMain.handle('splurk:read-file', async (_e, absolutePath) => {
    try {
      return { success: true, content: fileSystem.readFile(absolutePath) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('splurk:write-file', async (_e, absolutePath, content) => {
    try {
      fileSystem.writeFile(absolutePath, content)
      const graph = global.currentVault ? parser.parseVault(global.currentVault) : null
      return { success: true, graph }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('splurk:create-file', async (_e, fileName) => {
    try {
      if (!global.currentVault) throw new Error('No vault open')
      const fileInfo = fileSystem.createFile(global.currentVault, fileName)
      return { success: true, file: fileInfo }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('splurk:delete-file', async (_e, absolutePath) => {
    try {
      fileSystem.deleteFile(absolutePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('splurk:get-graph', async () => {
    if (!global.currentVault) return { nodes: [], links: [] }
    return parser.parseVault(global.currentVault)
  })

  ipcMain.handle('splurk:git-status', async () => {
    if (!global.currentVault) return { success: false }
    return git.getStatus(global.currentVault)
  })

  ipcMain.handle('splurk:git-push', async () => {
    if (!global.currentVault) return { success: false, message: 'No vault open' }
    return git.push(global.currentVault)
  })
}

module.exports = { registerIpcHandlers }
