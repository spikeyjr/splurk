const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('splurk', {
  pickVault:    ()                            => ipcRenderer.invoke('splurk:pick-vault'),
  pickParent:   ()                            => ipcRenderer.invoke('splurk:pick-parent'),
  createVault:  (parentPath, vaultName)       => ipcRenderer.invoke('splurk:create-vault', parentPath, vaultName),
  openVault:    (vaultPath)                   => ipcRenderer.invoke('splurk:open-vault', vaultPath),
  readFile:     (absolutePath)                => ipcRenderer.invoke('splurk:read-file', absolutePath),
  writeFile:    (absolutePath, content)       => ipcRenderer.invoke('splurk:write-file', absolutePath, content),
  createFile:   (fileName)                    => ipcRenderer.invoke('splurk:create-file', fileName),
  deleteFile:   (absolutePath)                => ipcRenderer.invoke('splurk:delete-file', absolutePath),
  getGraph:     ()                            => ipcRenderer.invoke('splurk:get-graph'),
  gitStatus:    ()                            => ipcRenderer.invoke('splurk:git-status'),
  gitPush:      ()                            => ipcRenderer.invoke('splurk:git-push'),
})
