import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, ViewPlugin, Decoration } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { marked } from 'marked'
import ForceGraph from 'force-graph'

// ── State ─────────────────────────────────────
const state = {
  vaultPath: null,
  files: [],
  graphData: { nodes: [], links: [] },
  tabs: [],
  activeTab: null,
  previewMode: false,
  editorView: null,
  graph: null,
  graphOpen: false,
  commandPaletteOpen: false,
}

// ── DOM ───────────────────────────────────────
const $vaultSelector  = document.getElementById('vault-selector')
const $app            = document.getElementById('app')
const $btnPickVault   = document.getElementById('btn-pick-vault')
const $btnNewVault    = document.getElementById('btn-new-vault')
const $vaultName      = document.getElementById('vault-name')
const $fileTree       = document.getElementById('file-tree')
const $editorEmpty    = document.getElementById('editor-empty')
const $cmHost         = document.getElementById('codemirror-host')
const $previewHost    = document.getElementById('preview-host')
const $tabList        = document.getElementById('tab-list')
const $statusFile     = document.getElementById('status-file')
const $statusGit      = document.getElementById('status-git')
const $statusSave     = document.getElementById('status-save')
const $statusMode     = document.getElementById('status-mode')
const $btnNewFile     = document.getElementById('btn-new-file')
const $btnClose       = document.getElementById('btn-close')
const $btnToggleMode  = document.getElementById('btn-toggle-mode')
const $btnGraphView   = document.getElementById('btn-graph-view')
const $graphOverlay   = document.getElementById('graph-overlay')
const $btnCloseGraph  = document.getElementById('btn-close-graph')
const $graphCanvas    = document.getElementById('graph-canvas')

// ── Marked config ─────────────────────────────
marked.setOptions({ breaks: true, gfm: true })

// ── CodeMirror theme ──────────────────────────
const splurkTheme = EditorView.theme({
  '&': { height: '100%', background: '#0d0f14', color: '#d4d8e4', fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px' },
  '.cm-content': { padding: '32px 48px', maxWidth: '780px', margin: '0 auto', caretColor: '#6c8aff' },
  '.cm-focused': { outline: 'none' },
  '.cm-line': { lineHeight: '1.85' },
  '.cm-cursor': { borderLeftColor: '#6c8aff', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { background: 'rgba(108,138,255,0.2) !important' },
  '.cm-activeLine': { background: 'rgba(108,138,255,0.04)' },
  '.cm-gutters': { background: '#13161d', border: 'none', color: '#454d63' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true })

// ── Wikilink highlight plugin ─────────────────
const wikilinkDeco = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view) }
  update(update) { if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view) }
  build(view) {
    const decos = []
    const re = /\[\[([^\]]+)\]\]/g
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to)
      let m
      re.lastIndex = 0
      while ((m = re.exec(text)) !== null) {
        decos.push(Decoration.mark({ class: 'cm-wikilink' }).range(from + m.index, from + m.index + m[0].length))
      }
    }
    return Decoration.set(decos, true)
  }
}, { decorations: v => v.decorations })

// ── Build editor ──────────────────────────────
function buildEditor(content, onChange) {
  if (state.editorView) { state.editorView.destroy(); state.editorView = null }
  $cmHost.innerHTML = ''

  const view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        splurkTheme,
        EditorView.lineWrapping,
        wikilinkDeco,
        EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()) }),
        // Click on [[wikilink]]
        EditorView.domEventHandlers({
          click(e, view) {
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
            if (pos == null) return
            const doc = view.state.doc.toString()
            // Find if click is inside [[...]]
            let start = pos, end = pos
            while (start > 0 && doc[start - 1] !== '[') start--
            while (end < doc.length && doc[end] !== ']') end++
            const region = doc.slice(Math.max(0, start - 2), end + 2)
            const m = region.match(/\[\[([^\]|#]+)/)
            if (m && e.metaKey || e.ctrlKey) {
              navigateToWikilink(m[1].trim())
            }
            // Check if we're inside a wikilink by scanning around cursor
            const before = doc.lastIndexOf('[[', pos)
            const after = doc.indexOf(']]', pos)
            if (before !== -1 && after !== -1 && before < pos && after > pos) {
              const target = doc.slice(before + 2, after).split('|')[0].split('#')[0].trim()
              if (e.ctrlKey || e.metaKey) navigateToWikilink(target)
            }
          }
        }),
      ]
    }),
    parent: $cmHost
  })

  state.editorView = view
  setTimeout(() => view.focus(), 30)
  return view
}

function navigateToWikilink(target) {
  const file = state.files.find(f => f.name.toLowerCase() === target.toLowerCase())
  if (file) {
    openFileInTab(file)
  } else {
    // Create the file
    if (confirm(`"${target}" doesn't exist yet. Create it?`)) {
      window.splurk.createFile(target).then(result => {
        if (result.success) {
          state.files.push(result.file)
          renderFileTree(state.files)
          openFileInTab(result.file)
        }
      })
    }
  }
}

// ── Debounce / autosave ───────────────────────
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

const debouncedSave = debounce(async (absolutePath, content) => {
  const result = await window.splurk.writeFile(absolutePath, content)
  if (result.success) {
    showSaveIndicator()
    if (result.graph) {
      state.graphData = result.graph
      if (state.graphOpen && state.graph) updateGraph()
    }
  }
}, 1500)

// ── Vault selector ────────────────────────────
$btnPickVault.addEventListener('click', async () => {
  const vaultPath = await window.splurk.pickVault()
  if (vaultPath) openVault(vaultPath)
})

$btnNewVault.addEventListener('click', async () => {
  const nameWrap = document.createElement('div')
  nameWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;width:100%'
  nameWrap.innerHTML = `
    <input id="vni" type="text" placeholder="vault name e.g. my-notes"
      style="background:#1a1e28;border:1px solid #272d3f;border-radius:6px;padding:10px 16px;
             color:#eef0f6;font-family:'IBM Plex Mono',monospace;font-size:13px;width:220px;
             outline:none;text-align:center">
    <p style="font-size:11px;color:#454d63">Enter to pick location · Esc to cancel</p>`
  $btnNewVault.replaceWith(nameWrap)
  const inp = document.getElementById('vni')
  inp.focus()
  inp.addEventListener('keydown', async e => {
    if (e.key === 'Escape') { location.reload(); return }
    if (e.key !== 'Enter') return
    const name = inp.value.trim().replace(/[/\\?%*:|"<>]/g, '-')
    if (!name) return
    const parent = await window.splurk.pickParent()
    if (!parent) return
    const r = await window.splurk.createVault(parent, name)
    if (!r.success) { alert('Error: ' + r.error); return }
    await window.splurk.openVault(r.vaultPath)
    await window.splurk.createFile('Welcome to Splurk')
    openVault(r.vaultPath)
  })
})

// ── Open vault ────────────────────────────────
async function openVault(vaultPath) {
  const result = await window.splurk.openVault(vaultPath)
  state.vaultPath = vaultPath
  state.files     = result.files
  state.graphData = result.graph || { nodes: [], links: [] }

  $vaultSelector.style.display = 'none'
  $app.style.display = 'flex'

  const parts = vaultPath.split('/')
  $vaultName.textContent = parts[parts.length - 1]
  renderFileTree(state.files)
  refreshGitStatus()
  localStorage.setItem('splurk-last-vault', vaultPath)
}

// ── File tree ─────────────────────────────────
function renderFileTree(files) {
  $fileTree.innerHTML = ''
  if (!files.length) {
    $fileTree.innerHTML = `<div style="padding:12px;color:#454d63;font-size:12px">no notes yet — click + to create one</div>`
    return
  }
  for (const file of files) {
    const item = document.createElement('div')
    item.className = 'file-item'
    item.dataset.abs = file.absolutePath
    item.innerHTML = `<span class="file-item-icon">◆</span><span>${file.name}</span>`
    item.addEventListener('click', () => openFileInTab(file))
    $fileTree.appendChild(item)
  }
}

function updateSidebarActive() {
  const tab = state.tabs[state.activeTab]
  document.querySelectorAll('.file-item').forEach(el =>
    el.classList.toggle('active', !!(tab && el.dataset.abs === tab.file.absolutePath)))
}

// ── Tabs ──────────────────────────────────────
async function openFileInTab(file) {
  const existing = state.tabs.findIndex(t => t.file.absolutePath === file.absolutePath)
  if (existing !== -1) { switchTab(existing); return }

  const result = await window.splurk.readFile(file.absolutePath)
  if (!result.success) return

  state.tabs.push({ file, content: result.content, modified: false })
  switchTab(state.tabs.length - 1)
}

function switchTab(index) {
  state.activeTab = index
  renderTabs()
  loadTabContent()
  updateSidebarActive()
}

function renderTabs() {
  $tabList.innerHTML = ''
  state.tabs.forEach((tab, i) => {
    const el = document.createElement('div')
    el.className = 'tab' + (i === state.activeTab ? ' active' : '')
    el.innerHTML = `<span class="tab-title">${tab.file.name}${tab.modified ? ' ●' : ''}</span><span class="tab-close" data-i="${i}">✕</span>`
    el.addEventListener('click', e => e.target.classList.contains('tab-close') ? closeTab(i) : switchTab(i))
    $tabList.appendChild(el)
  })
}

function closeTab(index) {
  state.tabs.splice(index, 1)
  if (!state.tabs.length) { state.activeTab = null; showEmptyEditor(); renderTabs(); return }
  switchTab(Math.min(index, state.tabs.length - 1))
}

function loadTabContent() {
  const tab = state.tabs[state.activeTab]
  if (!tab) { showEmptyEditor(); return }
  $statusFile.textContent = tab.file.relativePath
  $editorEmpty.style.display = 'none'
  state.previewMode ? showPreview(tab.content) : showEditor(tab.content, tab.file)
}

function showEmptyEditor() {
  $editorEmpty.style.display = 'flex'
  $cmHost.style.display = 'none'
  $previewHost.style.display = 'none'
  if (state.editorView) { state.editorView.destroy(); state.editorView = null }
  $statusFile.textContent = '—'
}

function showEditor(content, file) {
  $cmHost.style.display = 'block'
  $previewHost.style.display = 'none'
  buildEditor(content, newContent => {
    const tab = state.tabs[state.activeTab]
    if (!tab) return
    tab.content = newContent
    tab.modified = true
    renderTabs()
    debouncedSave(tab.file.absolutePath, newContent)
  })
}

function showPreview(content) {
  $cmHost.style.display = 'none'
  $previewHost.style.display = 'block'

  // Process wikilinks before marked renders
  const withLinks = content.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
    `<span class="wikilink" data-target="${target}">${alias || target}</span>`)

  $previewHost.innerHTML = marked.parse(withLinks)

  $previewHost.querySelectorAll('.wikilink').forEach(el => {
    el.style.cssText = 'color:#6c8aff;cursor:pointer;border-bottom:1px solid rgba(108,138,255,0.4)'
    el.addEventListener('click', () => navigateToWikilink(el.dataset.target))
  })
}

// ── Mode toggle ───────────────────────────────
$btnToggleMode.addEventListener('click', () => {
  state.previewMode = !state.previewMode
  $btnToggleMode.classList.toggle('preview-mode', state.previewMode)
  $statusMode.textContent = state.previewMode ? 'preview' : 'edit'
  if (state.activeTab === null) return
  const tab = state.tabs[state.activeTab]
  if (state.previewMode) {
    if (state.editorView) tab.content = state.editorView.state.doc.toString()
    showPreview(tab.content)
  } else {
    showEditor(tab.content, tab.file)
  }
})

// ── Graph ─────────────────────────────────────
$btnGraphView.addEventListener('click', toggleGraph)
$btnCloseGraph.addEventListener('click', () => {
  state.graphOpen = false
  $graphOverlay.style.display = 'none'
  $btnGraphView.classList.remove('active')
})

function toggleGraph() {
  state.graphOpen = !state.graphOpen
  $graphOverlay.style.display = state.graphOpen ? 'flex' : 'none'
  $btnGraphView.classList.toggle('active', state.graphOpen)
  if (state.graphOpen) setTimeout(initGraph, 50)
}

function initGraph() {
  // Destroy old instance if exists
  if (state.graph) { state.graph._destructor && state.graph._destructor(); state.graph = null }
  $graphCanvas.innerHTML = ''

  const w = $graphCanvas.offsetWidth || window.innerWidth
  const h = $graphCanvas.offsetHeight || window.innerHeight - 80

  const gData = {
    nodes: (state.graphData.nodes || []).map(n => ({ id: n.id, ghost: n.ghost })),
    links: (state.graphData.links || []).map(l => ({ source: l.source, target: l.target }))
  }

  if (!gData.nodes.length) {
    $graphCanvas.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#454d63;font-size:13px;font-family:'IBM Plex Mono',monospace">no links yet — create [[wikilinks]] between notes</div>`
    return
  }

  const Graph = ForceGraph()
  Graph($graphCanvas)
    .width(w)
    .height(h)
    .graphData(gData)
    .backgroundColor('#0d0f14')
    .nodeLabel('id')
    .nodeColor(n => n.ghost ? '#2d3348' : '#6c8aff')
    .nodeRelSize(6)
    .nodeCanvasObject((node, ctx, scale) => {
      const r = node.ghost ? 4 : 7
      // Glow
      if (!node.ghost) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI)
        const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 8)
        grad.addColorStop(0, 'rgba(108,138,255,0.3)')
        grad.addColorStop(1, 'rgba(108,138,255,0)')
        ctx.fillStyle = grad
        ctx.fill()
      }
      // Node
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.fillStyle = node.ghost ? '#1a1e28' : '#6c8aff'
      ctx.fill()
      ctx.strokeStyle = node.ghost ? '#272d3f' : '#8aa3ff'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // Label
      if (scale > 0.5) {
        const fs = Math.max(9, 12 / scale)
        ctx.font = `${fs}px "IBM Plex Mono"`
        ctx.fillStyle = node.ghost ? '#454d63' : '#c8cdd8'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(node.id, node.x, node.y + r + 4)
      }
    })
    .linkColor(() => '#1e2230')
    .linkWidth(1.5)
    .linkDirectionalParticles(2)
    .linkDirectionalParticleWidth(1.5)
    .linkDirectionalParticleColor(() => '#6c8aff')
    .onNodeClick(node => {
      if (node.ghost) return
      const file = state.files.find(f => f.name === node.id)
      if (!file) return
      state.graphOpen = false
      $graphOverlay.style.display = 'none'
      $btnGraphView.classList.remove('active')
      openFileInTab(file)
    })
    .onNodeHover(node => {
      $graphCanvas.style.cursor = node && !node.ghost ? 'pointer' : 'default'
    })

  state.graph = Graph
}

function updateGraph() {
  if (!state.graph) return
  const gData = {
    nodes: (state.graphData.nodes || []).map(n => ({ id: n.id, ghost: n.ghost })),
    links: (state.graphData.links || []).map(l => ({ source: l.source, target: l.target }))
  }
  state.graph.graphData(gData)
}

// ── New file ──────────────────────────────────
$btnNewFile.addEventListener('click', () => {
  const wrap = document.createElement('div')
  wrap.className = 'new-file-input'
  const input = document.createElement('input')
  input.type = 'text'; input.placeholder = 'note name…'
  wrap.appendChild(input)
  $fileTree.prepend(wrap)
  input.focus()

  async function confirm() {
    const name = input.value.trim(); wrap.remove()
    if (!name) return
    const result = await window.splurk.createFile(name)
    if (!result.success) { console.error(result.error); return }
    state.files.unshift(result.file)
    renderFileTree(state.files)
    openFileInTab(result.file)
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') wrap.remove() })
  input.addEventListener('blur', () => setTimeout(() => wrap.isConnected && wrap.remove(), 150))
})

// ── Command palette (Ctrl+P) ──────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); toggleCommandPalette() }
  if (e.key === 'Escape' && state.commandPaletteOpen) closeCommandPalette()
})

function toggleCommandPalette() {
  if (state.commandPaletteOpen) { closeCommandPalette(); return }
  state.commandPaletteOpen = true

  const overlay = document.createElement('div')
  overlay.id = 'cmd-overlay'
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999;
    display:flex;align-items:flex-start;justify-content:center;padding-top:15vh`
  overlay.innerHTML = `
    <div style="background:#13161d;border:1px solid #272d3f;border-radius:8px;
                width:520px;max-height:400px;display:flex;flex-direction:column;overflow:hidden;
                box-shadow:0 24px 64px rgba(0,0,0,0.6)">
      <input id="cmd-input" placeholder="Search notes or commands…" style="
        background:transparent;border:none;border-bottom:1px solid #1e2230;
        padding:16px 20px;color:#eef0f6;font-family:'IBM Plex Mono',monospace;
        font-size:14px;outline:none;width:100%">
      <div id="cmd-results" style="overflow-y:auto;max-height:340px"></div>
    </div>`

  document.body.appendChild(overlay)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCommandPalette() })

  const cmdInput = document.getElementById('cmd-input')
  const cmdResults = document.getElementById('cmd-results')
  cmdInput.focus()

  function renderCmdResults(query) {
    const q = query.toLowerCase()
    const matches = state.files.filter(f => f.name.toLowerCase().includes(q)).slice(0, 10)
    cmdResults.innerHTML = matches.map((f, i) => `
      <div class="cmd-item" data-i="${i}" style="padding:10px 20px;cursor:pointer;
        color:#7a8299;font-family:'IBM Plex Mono',monospace;font-size:13px;
        border-bottom:1px solid #1e2230;transition:background 0.1s,color 0.1s"
        onmouseover="this.style.background='#1a1e28';this.style.color='#eef0f6'"
        onmouseout="this.style.background='';this.style.color='#7a8299'">
        <span style="color:#6c8aff;margin-right:8px">◆</span>${f.name}
      </div>`).join('')

    cmdResults.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        openFileInTab(matches[i])
        closeCommandPalette()
      })
    })
  }

  renderCmdResults('')
  cmdInput.addEventListener('input', e => renderCmdResults(e.target.value))
  cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCommandPalette()
    if (e.key === 'Enter') {
      const first = state.files.find(f => f.name.toLowerCase().includes(cmdInput.value.toLowerCase()))
      if (first) { openFileInTab(first); closeCommandPalette() }
    }
  })
}

function closeCommandPalette() {
  state.commandPaletteOpen = false
  document.getElementById('cmd-overlay')?.remove()
}

// ── Titlebar / controls ───────────────────────
$btnClose.addEventListener('click', () => window.close())

// ── Git ───────────────────────────────────────
async function refreshGitStatus() {
  const result = await window.splurk.gitStatus()
  $statusGit.textContent = !result.success ? 'git: not a repo'
    : result.clean ? 'git: clean' : `git: ${result.modified} modified`
}

// ── Save indicator ────────────────────────────
function showSaveIndicator() {
  $statusSave.textContent = '● saved'
  $statusSave.classList.add('visible')
  clearTimeout(window._saveTimer)
  window._saveTimer = setTimeout(() => $statusSave.classList.remove('visible'), 1500)
}

// ── Add wikilink CSS to editor ────────────────
const wikilinkStyle = document.createElement('style')
wikilinkStyle.textContent = `.cm-wikilink { color: #6c8aff; border-bottom: 1px solid rgba(108,138,255,0.5); cursor: pointer; }`
document.head.appendChild(wikilinkStyle)

// ── Restore last vault ────────────────────────
const lastVault = localStorage.getItem('splurk-last-vault')
if (lastVault) openVault(lastVault)

// ═══════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════
import { SplurkCanvas } from './canvas.js'

let splurkCanvas = null

const $canvasOverlay = document.getElementById('canvas-overlay')
const $btnCanvasView = document.getElementById('btn-canvas-view')
const $btnCloseCanvas = document.getElementById('btn-close-canvas')

$btnCanvasView.addEventListener('click', () => {
  const open = $canvasOverlay.style.display === 'none' || !$canvasOverlay.style.display
  $canvasOverlay.style.display = open ? 'flex' : 'none'
  $btnCanvasView.classList.toggle('active', open)
  if (open && !splurkCanvas) initCanvas()
})

$btnCloseCanvas.addEventListener('click', () => {
  $canvasOverlay.style.display = 'none'
  $btnCanvasView.classList.remove('active')
})

function initCanvas() {
  const area    = document.getElementById('canvas-area')
  const canvas  = document.getElementById('splurk-canvas')
  const nodesEl = document.getElementById('canvas-nodes')
  splurkCanvas  = new SplurkCanvas(area, canvas, nodesEl)

  // Tool buttons
  document.getElementById('tool-select').addEventListener('click', () => {
    splurkCanvas._activateTool('tool-select', 'select')
  })
  document.getElementById('tool-card').addEventListener('click', () => {
    splurkCanvas._activateTool('tool-card', 'card')
  })
  document.getElementById('tool-note').addEventListener('click', () => {
    // Show note picker
    showNotePickerForCanvas()
  })
  document.getElementById('tool-connect').addEventListener('click', () => {
    splurkCanvas._activateTool('tool-connect', 'connect')
  })
  document.getElementById('tool-fit').addEventListener('click', () => {
    splurkCanvas.fitToScreen()
  })
  document.getElementById('tool-clear').addEventListener('click', () => {
    if (confirm('Clear the entire canvas?')) splurkCanvas.clear()
  })

  // Drop notes from sidebar onto canvas
  document.querySelectorAll('.file-item').forEach(el => {
    el.setAttribute('draggable', 'true')
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', el.dataset.abs)
    })
  })

  area.addEventListener('dragover', e => e.preventDefault())
  area.addEventListener('drop', async e => {
    e.preventDefault()
    const abs = e.dataTransfer.getData('text/plain')
    const file = state.files.find(f => f.absolutePath === abs)
    if (!file) return
    const result = await window.splurk.readFile(abs)
    const preview = result.success ? result.content.slice(0, 120).replace(/[#*`]/g, '') : ''
    const rect = area.getBoundingClientRect()
    splurkCanvas.addNoteCard(e.clientX - rect.left, e.clientY - rect.top, { ...file, preview })
  })
}

function showNotePickerForCanvas() {
  const overlay = document.createElement('div')
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;
    display:flex;align-items:center;justify-content:center`
  overlay.innerHTML = `
    <div style="background:#13161d;border:1px solid #272d3f;border-radius:8px;
                width:400px;max-height:360px;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid #1e2230;font-family:'IBM Plex Mono',monospace;
                  font-size:11px;color:#454d63;text-transform:uppercase;letter-spacing:0.08em">
        pick a note to add to canvas
      </div>
      <div style="overflow-y:auto">
        ${state.files.map(f => `
          <div class="canvas-note-pick" data-abs="${f.absolutePath}"
            style="padding:10px 16px;cursor:pointer;color:#7a8299;font-family:'IBM Plex Mono',monospace;
                   font-size:13px;border-bottom:1px solid #1e2230;transition:background 0.1s"
            onmouseover="this.style.background='#1a1e28';this.style.color='#eef0f6'"
            onmouseout="this.style.background='';this.style.color='#7a8299'">
            <span style="color:#6c8aff;margin-right:8px">◆</span>${f.name}
          </div>`).join('')}
      </div>
    </div>`

  document.body.appendChild(overlay)
  overlay.addEventListener('click', async e => {
    const pick = e.target.closest('.canvas-note-pick')
    if (!pick && e.target === overlay) { overlay.remove(); return }
    if (!pick) return
    const file = state.files.find(f => f.absolutePath === pick.dataset.abs)
    if (!file) return
    const result = await window.splurk.readFile(file.absolutePath)
    const preview = result.success ? result.content.slice(0, 120).replace(/[#*`]/g, '') : ''
    const area = document.getElementById('canvas-area')
    const rect = area.getBoundingClientRect()
    splurkCanvas.addNoteCard(rect.width / 2 - 100, rect.height / 2 - 50, { ...file, preview })
    overlay.remove()
    splurkCanvas._activateTool('tool-select', 'select')
  })
}

// Make sidebar items draggable after vault opens (re-run after file tree renders)
const _origRenderFileTree = window._renderFileTree
