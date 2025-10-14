// public/debug-overlay.js
;(() => {
  const q = new URLSearchParams(location.search)
  if (q.get('debug') !== '1') return

  // ---- helpers ----
  const dm = () =>
    (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone) ? 'standalone' : 'browser'

  const fmt = (v) => {
    try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
    catch { return String(v) }
  }
  const now = () => new Date().toLocaleTimeString()

  // ---- styles ----
  const css = `
  #dbgWrap{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483647;font:12px ui-monospace,SFMono-Regular,Consolas,Monaco,monospace;color:#0b1220}
  #dbgFab{background:#0B3D60;color:#fff;border-radius:18px;padding:8px 10px;box-shadow:0 12px 24px rgba(0,0,0,.22);cursor:pointer;user-select:none}
  #dbgPanel{width:300px;max-height:50vh;background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.15);border-radius:14px;box-shadow:0 18px 36px rgba(0,0,0,.28);overflow:hidden}
  #dbgHead{display:flex;align-items:center;gap:8px;justify-content:space-between;background:#eef2f7;border-bottom:1px solid rgba(0,0,0,.08);padding:6px 8px}
  #dbgHead b{font-weight:800}
  #dbgBtns{display:flex;gap:6px}
  #dbgBtns button{font:12px ui-monospace,monospace;border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer}
  #dbgBody{padding:8px;max-height:calc(50vh - 34px);overflow:auto}
  #dbgKV{margin-bottom:8px;line-height:1.5}
  #dbgLogs{white-space:pre-wrap;line-height:1.45}
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  // ---- dom ----
  const wrap = document.createElement('div')
  wrap.id = 'dbgWrap'
  wrap.innerHTML = `
    <div id="dbgFab" aria-label="toggle debug overlay">🐞 Debug</div>
    <div id="dbgPanel" hidden>
      <div id="dbgHead">
        <b>Debug</b>
        <div id="dbgBtns">
          <button id="dbgCopy" title="Copy logs">copy</button>
          <button id="dbgClear" title="Clear logs">clear</button>
          <button id="dbgClose" title="Close">close</button>
        </div>
      </div>
      <div id="dbgBody">
        <div id="dbgKV"></div>
        <div id="dbgLogs"></div>
      </div>
    </div>`
  document.body.appendChild(wrap)

  const $ = (s) => wrap.querySelector(s)
  const fab = $('#dbgFab')
  const panel = $('#dbgPanel')
  const kv = $('#dbgKV')
  const logs = $('#dbgLogs')
  const btnCopy = $('#dbgCopy')
  const btnClear = $('#dbgClear')
  const btnClose = $('#dbgClose')

  const buf = []
  const push = (type, args) => {
    const line = `[${now()}] ${type}: ${[].map.call(args, fmt).join(' ')}`
    buf.push(line)
    // keep last 400 lines
    if (buf.length > 400) buf.shift()
    logs.textContent = buf.join('\n')
  }

  // mirror console.*
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log = function () { push('log', arguments); orig.log.apply(console, arguments) }
  console.warn = function () { push('warn', arguments); orig.warn.apply(console, arguments) }
  console.error = function () { push('error', arguments); orig.error.apply(console, arguments) }

  // basic page error hook
  window.addEventListener('error', (e) => push('onerror', [e.message || e.type]))
  window.addEventListener('unhandledrejection', (e) => push('promise', [e.reason || 'unhandledrejection']))

  // metrics
  const update = () => {
    const vv = window.visualViewport
    const kb = vv ? (vv.height < window.innerHeight * 0.9 ? 'open' : 'closed') : 'n/a'
    const line = [
      `mode=${dm()}`,
      `inner=${window.innerWidth}×${window.innerHeight}`,
      vv ? `vv=${Math.round(vv.width)}×${Math.round(vv.height)}` : 'vv=n/a',
      `dpr=${window.devicePixelRatio}`,
      `kb=${kb}`
    ].join('  |  ')
    kv.textContent = line
  }
  update()
  window.addEventListener('resize', update, { passive: true })
  window.visualViewport && window.visualViewport.addEventListener('resize', update, { passive: true })
  window.addEventListener('focusin', update, { passive: true })

  // ui actions
  const toggle = () => {
    const hid = panel.hasAttribute('hidden')
    if (hid) panel.removeAttribute('hidden'); else panel.setAttribute('hidden','')
  }
  fab.addEventListener('click', toggle)
  btnClose.addEventListener('click', toggle)
  btnClear.addEventListener('click', () => { buf.length = 0; logs.textContent = '' })
  btnCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(buf.join('\n')); console.log('copied logs') }
    catch (e) { console.warn('clipboard fail', e) }
  })

  // open by default on mobile (使いやすさ優先)
  if (/iPhone|Android/i.test(navigator.userAgent)) toggle()
})()
