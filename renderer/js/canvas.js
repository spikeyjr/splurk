// canvas.js — Splurk infinite canvas feature

export class SplurkCanvas {
  constructor(areaEl, canvasEl, nodesEl) {
    this.area     = areaEl
    this.canvas   = canvasEl
    this.nodesEl  = nodesEl
    this.ctx      = canvasEl.getContext('2d')

    this.nodes    = []   // { id, type, x, y, w, h, title, content, el }
    this.edges    = []   // { from, to }
    this.nextId   = 1

    // Viewport pan/zoom
    this.pan    = { x: 0, y: 0 }
    this.zoom   = 1
    this.tool   = 'select'   // select | card | note | connect

    // Interaction state
    this.dragging    = null   // { node, startX, startY, origX, origY }
    this.panning     = null   // { startX, startY, origPan }
    this.connecting  = null   // { fromNode, startX, startY, curX, curY }
    this.selected    = null   // node id

    this._resize()
    this._bindEvents()
    this._loop()
  }

  // ── Public API ──────────────────────────────

  setTool(tool) {
    this.tool = tool
    this.area.style.cursor = tool === 'select' ? 'default'
      : tool === 'connect' ? 'crosshair' : 'copy'
  }

  addCard(x, y, title = 'New card', content = '') {
    const sx = (x - this.pan.x) / this.zoom
    const sy = (y - this.pan.y) / this.zoom
    return this._createNode('card', sx, sy, title, content)
  }

  addNoteCard(x, y, file) {
    const sx = (x - this.pan.x) / this.zoom
    const sy = (y - this.pan.y) / this.zoom
    const node = this._createNode('note', sx, sy, file.name, file.preview || '')
    node.file = file
    return node
  }

  fitToScreen() {
    if (!this.nodes.length) return
    const xs = this.nodes.map(n => n.x)
    const ys = this.nodes.map(n => n.y)
    const x2 = this.nodes.map(n => n.x + n.w)
    const y2 = this.nodes.map(n => n.y + n.h)
    const minX = Math.min(...xs) - 40
    const minY = Math.min(...ys) - 40
    const maxX = Math.max(...x2) + 40
    const maxY = Math.max(...y2) + 40
    const scaleX = this.canvas.width  / (maxX - minX)
    const scaleY = this.canvas.height / (maxY - minY)
    this.zoom = Math.min(scaleX, scaleY, 1.5)
    this.pan.x = -minX * this.zoom + (this.canvas.width  - (maxX - minX) * this.zoom) / 2
    this.pan.y = -minY * this.zoom + (this.canvas.height - (maxY - minY) * this.zoom) / 2
    this._updateNodePositions()
  }

  clear() {
    this.nodes.forEach(n => n.el.remove())
    this.nodes = []
    this.edges = []
    this.selected = null
  }

  destroy() {
    this._raf && cancelAnimationFrame(this._raf)
    this._ro && this._ro.disconnect()
  }

  // ── Private ─────────────────────────────────

  _createNode(type, x, y, title, content) {
    const id = this.nextId++
    const el = document.createElement('div')
    el.className = 'canvas-node'
    el.dataset.id = id
    el.innerHTML = `
      <div class="canvas-node-header">
        <span class="node-icon">${type === 'note' ? '◆' : '▪'}</span>
        <span class="node-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
        <span class="canvas-node-close" data-close="${id}">✕</span>
      </div>
      <div class="canvas-node-body ${type === 'card' ? 'editable' : ''}"
           ${type === 'card' ? 'contenteditable="true"' : ''}
           data-body="${id}">${content}</div>
      <div class="canvas-connect-port top"    data-port="${id}" data-side="top"></div>
      <div class="canvas-connect-port bottom" data-port="${id}" data-side="bottom"></div>
      <div class="canvas-connect-port left"   data-port="${id}" data-side="left"></div>
      <div class="canvas-connect-port right"  data-port="${id}" data-side="right"></div>
      <div class="canvas-node-resize" data-resize="${id}">⊿</div>`

    this.nodesEl.appendChild(el)

    const node = { id, type, x, y, w: 200, h: type === 'card' ? 120 : 100, title, content, el, file: null }
    this.nodes.push(node)
    this._positionNode(node)
    this._bindNodeEvents(node)

    return node
  }

  _positionNode(node) {
    const sx = node.x * this.zoom + this.pan.x
    const sy = node.y * this.zoom + this.pan.y
    node.el.style.left     = sx + 'px'
    node.el.style.top      = sy + 'px'
    node.el.style.width    = (node.w * this.zoom) + 'px'
    node.el.style.minWidth = 'unset'
    node.el.style.maxWidth = 'unset'
  }

  _updateNodePositions() {
    this.nodes.forEach(n => this._positionNode(n))
  }

  _bindNodeEvents(node) {
    const header = node.el.querySelector('.canvas-node-header')
    const closeBtn = node.el.querySelector(`[data-close="${node.id}"]`)
    const body = node.el.querySelector(`[data-body="${node.id}"]`)

    // Drag
    header.addEventListener('mousedown', e => {
      if (e.target.dataset.close) return
      if (this.tool !== 'select') return
      e.preventDefault()
      this.dragging = { node, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
      node.el.classList.add('grabbing')
      this._selectNode(node.id)
    })

    // Close
    closeBtn.addEventListener('click', e => {
      e.stopPropagation()
      this.nodes = this.nodes.filter(n => n.id !== node.id)
      this.edges = this.edges.filter(e => e.from !== node.id && e.to !== node.id)
      node.el.remove()
    })

    // Select
    node.el.addEventListener('mousedown', e => {
      if (e.target.dataset.port || e.target.dataset.resize || e.target.dataset.close) return
      if (this.tool === 'select') this._selectNode(node.id)
    })

    // Connect ports
    node.el.querySelectorAll('.canvas-connect-port').forEach(port => {
      port.addEventListener('mousedown', e => {
        e.stopPropagation()
        const rect = port.getBoundingClientRect()
        this.connecting = {
          fromNode: node.id,
          curX: rect.left + rect.width / 2,
          curY: rect.top + rect.height / 2
        }
      })
    })

    // Resize
    const resizeHandle = node.el.querySelector(`[data-resize="${node.id}"]`)
    resizeHandle.addEventListener('mousedown', e => {
      e.stopPropagation()
      const startX = e.clientX, startY = e.clientY
      const origW = node.w, origH = node.h
      const onMove = e2 => {
        node.w = Math.max(120, origW + (e2.clientX - startX) / this.zoom)
        node.h = Math.max(60,  origH + (e2.clientY - startY) / this.zoom)
        this._positionNode(node)
        node.el.style.height = (node.h * this.zoom) + 'px'
      }
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  _selectNode(id) {
    this.selected = id
    this.nodes.forEach(n => n.el.classList.toggle('selected', n.id === id))
  }

  _bindEvents() {
    // Pan on background drag
    this.area.addEventListener('mousedown', e => {
      if (e.target !== this.area && e.target !== this.canvas && !e.target.classList.contains('canvas-node')) {
        if (e.target.closest('.canvas-node')) return
      }
      if (e.target === this.area || e.target === this.canvas) {
        if (this.tool === 'select') {
          this.panning = { startX: e.clientX, startY: e.clientY, origPan: { ...this.pan } }
          this.selected = null
          this.nodes.forEach(n => n.el.classList.remove('selected'))
        } else if (this.tool === 'card') {
          const rect = this.area.getBoundingClientRect()
          this.addCard(e.clientX - rect.left, e.clientY - rect.top)
          this.setTool('select')
          document.querySelectorAll('.canvas-tool-btn').forEach(b => b.classList.remove('active'))
          document.getElementById('tool-select').classList.add('active')
        }
      }
    })

    document.addEventListener('mousemove', e => {
      if (this.dragging) {
        const { node, startX, startY, origX, origY } = this.dragging
        node.x = origX + (e.clientX - startX) / this.zoom
        node.y = origY + (e.clientY - startY) / this.zoom
        this._positionNode(node)
      }
      if (this.panning) {
        this.pan.x = this.panning.origPan.x + (e.clientX - this.panning.startX)
        this.pan.y = this.panning.origPan.y + (e.clientY - this.panning.startY)
        this._updateNodePositions()
      }
      if (this.connecting) {
        this.connecting.curX = e.clientX
        this.connecting.curY = e.clientY
      }
    })

    document.addEventListener('mouseup', e => {
      if (this.dragging) { this.dragging.node.el.classList.remove('grabbing'); this.dragging = null }
      if (this.panning)  { this.panning = null }
      if (this.connecting) {
        // Check if released on a node
        const target = e.target.closest('.canvas-node')
        if (target) {
          const toId = parseInt(target.dataset.id)
          const fromId = this.connecting.fromNode
          if (toId !== fromId) {
            const exists = this.edges.find(e => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))
            if (!exists) this.edges.push({ from: fromId, to: toId })
          }
        }
        this.connecting = null
      }
    })

    // Scroll to zoom
    this.area.addEventListener('wheel', e => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 0.93
      const rect = this.area.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      this.pan.x = mx - (mx - this.pan.x) * factor
      this.pan.y = my - (my - this.pan.y) * factor
      this.zoom = Math.max(0.2, Math.min(3, this.zoom * factor))
      this._updateNodePositions()
    }, { passive: false })

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (!this.area.closest('#canvas-overlay') || this.area.closest('#canvas-overlay').style.display === 'none') return
      if (e.key === 'v' || e.key === 'V') this._activateTool('tool-select', 'select')
      if (e.key === 't' || e.key === 'T') this._activateTool('tool-card', 'card')
      if (e.key === 'c' || e.key === 'C') this._activateTool('tool-connect', 'connect')
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selected && document.activeElement.tagName !== 'INPUT' && !document.activeElement.isContentEditable) {
          const node = this.nodes.find(n => n.id === this.selected)
          if (node) {
            this.nodes = this.nodes.filter(n => n.id !== this.selected)
            this.edges = this.edges.filter(e => e.from !== this.selected && e.to !== this.selected)
            node.el.remove()
            this.selected = null
          }
        }
      }
    })
  }

  _activateTool(btnId, tool) {
    document.querySelectorAll('.canvas-tool-btn').forEach(b => b.classList.remove('active'))
    document.getElementById(btnId)?.classList.add('active')
    this.setTool(tool)
  }

  _resize() {
    this.canvas.width  = this.area.offsetWidth
    this.canvas.height = this.area.offsetHeight
    this.canvas.style.position = 'absolute'
    this.canvas.style.inset = '0'
    this.canvas.style.pointerEvents = 'none'
    this._ro = new ResizeObserver(() => {
      this.canvas.width  = this.area.offsetWidth
      this.canvas.height = this.area.offsetHeight
    })
    this._ro.observe(this.area)
  }

  _loop() {
    this._draw()
    this._raf = requestAnimationFrame(() => this._loop())
  }

  _draw() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Grid dots
    const spacing = 28 * this.zoom
    const offX = this.pan.x % spacing
    const offY = this.pan.y % spacing
    ctx.fillStyle = '#1e2230'
    for (let x = offX; x < this.canvas.width; x += spacing) {
      for (let y = offY; y < this.canvas.height; y += spacing) {
        ctx.beginPath()
        ctx.arc(x, y, 1, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Edges
    this.edges.forEach(edge => {
      const from = this.nodes.find(n => n.id === edge.from)
      const to   = this.nodes.find(n => n.id === edge.to)
      if (!from || !to) return
      const fx = from.x * this.zoom + this.pan.x + (from.w * this.zoom) / 2
      const fy = from.y * this.zoom + this.pan.y + (from.h * this.zoom) / 2
      const tx = to.x * this.zoom + this.pan.x + (to.w * this.zoom) / 2
      const ty = to.y * this.zoom + this.pan.y + (to.h * this.zoom) / 2
      const dx = tx - fx, dy = ty - fy

      ctx.beginPath()
      ctx.moveTo(fx, fy)
      ctx.bezierCurveTo(fx + dx * 0.4, fy, tx - dx * 0.4, ty, tx, ty)
      ctx.strokeStyle = '#272d3f'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Arrow
      const angle = Math.atan2(ty - fy, tx - fx)
      const as = 8
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(tx - as * Math.cos(angle - 0.4), ty - as * Math.sin(angle - 0.4))
      ctx.lineTo(tx - as * Math.cos(angle + 0.4), ty - as * Math.sin(angle + 0.4))
      ctx.closePath()
      ctx.fillStyle = '#353d55'
      ctx.fill()
    })

    // Live connecting line
    if (this.connecting) {
      const from = this.nodes.find(n => n.id === this.connecting.fromNode)
      if (from) {
        const rect = this.area.getBoundingClientRect()
        const fx = from.x * this.zoom + this.pan.x + (from.w * this.zoom) / 2
        const fy = from.y * this.zoom + this.pan.y + (from.h * this.zoom) / 2
        const tx = this.connecting.curX - rect.left
        const ty = this.connecting.curY - rect.top
        ctx.beginPath()
        ctx.setLineDash([5, 5])
        ctx.moveTo(fx, fy)
        ctx.lineTo(tx, ty)
        ctx.strokeStyle = '#6c8aff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }
}
