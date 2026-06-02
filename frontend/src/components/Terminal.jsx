import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import styles from './Terminal.module.css'

// ── xterm.js themes ──────────────────────────────────────────────────────────
const TERM_THEMES = {
  dark: {
    background:         '#000000',
    foreground:         '#e6e6e6',
    cursor:             '#4f8bff',
    cursorAccent:       '#000000',
    selectionBackground:'rgba(26,38,255,0.40)',
    black:   '#000000', brightBlack:   '#777777',
    red:     '#ff4d4d', brightRed:     '#ff8585',
    green:   '#33d17a', brightGreen:   '#5ce39a',
    yellow:  '#fcc419', brightYellow:  '#ffd84d',
    blue:    '#4f8bff', brightBlue:    '#84b0ff',
    magenta: '#7b3aed', brightMagenta: '#a679ff',
    cyan:    '#00d4ff', brightCyan:    '#5ce4ff',
    white:   '#e6e6e6', brightWhite:   '#ffffff',
  },
  light: {
    background:         '#f6f8fa',
    foreground:         '#1f2328',
    cursor:             '#0969da',
    cursorAccent:       '#f6f8fa',
    selectionBackground:'rgba(84,174,255,0.35)',
    black:   '#24292f', brightBlack:   '#57606a',
    red:     '#cf222e', brightRed:     '#a40e26',
    green:   '#116329', brightGreen:   '#1a7f37',
    yellow:  '#633c01', brightYellow:  '#7d4e00',
    blue:    '#0969da', brightBlue:    '#218bff',
    magenta: '#8250df', brightMagenta: '#a475f9',
    cyan:    '#1b7c83', brightCyan:    '#3192aa',
    white:   '#6e7781', brightWhite:   '#8c959f',
  },
}

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TerminalComponent({ collapsed, onToggleCollapse }) {
  const containerRef = useRef(null)
  const termRef      = useRef(null)
  const fitRef       = useRef(null)
  const wsRef        = useRef(null)

  const fit = useCallback(() => {
    const fitAddon = fitRef.current
    const term = termRef.current
    if (!fitAddon || !term) return
    if (!containerRef.current || containerRef.current.offsetHeight === 0) return
    try {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    } catch {}
  }, [])

  const connect = useCallback(() => {
    const term = termRef.current
    if (!term) return
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}/shell-ws`)
    wsRef.current = ws

    ws.onopen    = () => { term.clear(); fit() }
    ws.onmessage = (e) => { term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data)) }
    ws.onclose   = () => { term.write('\r\n\x1b[33m[Disconnected — click Reconnect]\x1b[0m\r\n') }
    ws.onerror   = () => { term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n') }
  }, [fit])

  // Re-fit one frame after expand so the CSS height transition has settled
  useEffect(() => {
    if (!collapsed) {
      const id = requestAnimationFrame(() => fit())
      return () => cancelAnimationFrame(id)
    }
  }, [collapsed, fit])

  // Mount terminal
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      theme: TERM_THEMES[getCurrentTheme()],
      scrollback: 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)

    requestAnimationFrame(() => fitAddon.fit())

    termRef.current = term
    fitRef.current  = fitAddon

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(data)
    })

    connect()

    window.addEventListener('resize', fit)
    const ro = new ResizeObserver(() => fit())
    if (containerRef.current) ro.observe(containerRef.current)

    // Watch <html data-theme> and update xterm theme live
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          term.options.theme = TERM_THEMES[getCurrentTheme()]
        }
      }
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      window.removeEventListener('resize', fit)
      ro.disconnect()
      mo.disconnect()
      wsRef.current?.close()
      term.dispose()
    }
  }, [connect, fit])

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <div className={styles.barLeft}>
          <div className={styles.dots}>
            <span className={styles.dot} style={{background:'#ff5f56'}} />
            <span className={styles.dot} style={{background:'#ffbd2e'}} />
            <span className={styles.dot} style={{background:'#27c93f'}} />
          </div>
          <span className={styles.barTitle}>
            <span className={styles.barIcon}>$_</span>
            bash — kubekosh
          </span>
        </div>
        <div className={styles.barRight}>
          <button className={styles.barBtn} onClick={connect} title="Reconnect terminal">
            ↺ Reconnect
          </button>
          <button className={styles.barBtn} onClick={onToggleCollapse} title={collapsed ? 'Expand terminal' : 'Collapse terminal'}>
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/*
        xtermOuter is position:relative so the absolutely-positioned xterm
        mount point (containerRef) fills it exactly — canonical xterm.js pattern.
        The div stays in the DOM even when collapsed so the PTY session lives.
      */}
      <div className={styles.xtermOuter} style={collapsed ? { height: 0 } : undefined}>
        <div ref={containerRef} className={styles.terminal} />
      </div>
    </div>
  )
}
