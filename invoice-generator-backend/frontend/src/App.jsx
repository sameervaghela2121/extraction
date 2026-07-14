import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

// ponytail: one page, useState only — no router/state lib for a single screen.

// Fewer pixels ⇒ mobile. A phone isn't a squeezed desktop, so some things are
// *rendered* differently, not merely restyled.
const MOBILE_MAX = 768

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= MOBILE_MAX)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
    const onChange = (e) => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

// A camera capture arrives as IMG_2026….jpg or a 32-digit number — useless to read,
// and long enough to blow the layout apart. Show something human until the backend
// renames it from the invoice itself.
function displayName(name, isImg, photoNo) {
  if (isImg && (/^\d{12,}\./.test(name) || /^(IMG|PXL|DSC)[-_]/i.test(name))) {
    return `Camera photo${photoNo ? ` ${photoNo}` : ''}`
  }
  return name
}

const STATUS_META = {
  queued: { label: 'Queued', icon: '○' },
  processing: { label: 'Extracting', icon: '◐' },
  retrying: { label: 'Retrying', icon: '↻' },
  done: { label: 'Done', icon: '✓' },
  failed: { label: 'Failed', icon: '✕' },
}

function FileStatusRow({ name, size, status, thumb, isImg, onRemove, onMove, removable, isMobile }) {
  const meta = STATUS_META[status] || STATUS_META.queued
  return (
    <li className={`filerow status-${status}`}>
      <span className={`statusdot status-${status}`}>{meta.icon}</span>
      {/* a photo whose thumbnail is no longer around still isn't a PDF */}
      {thumb ? <img className="thumb" src={thumb} alt="" />
        : <span className={'thumb ' + (isImg ? 'thumb-img' : 'thumb-pdf')}>
          {isImg ? 'IMG' : 'PDF'}
        </span>}
      {/* name over meta — one line each, so a long filename can never widen the row */}
      <span className="rowtext">
        <span className="fname" title={name}>{name}</span>
        <span className="rowmeta">
          {size != null && <span className="fsize">{(size / 1024).toFixed(0)} KB</span>}
          <span className={`statuspill status-${status}`}>{meta.label}</span>
        </span>
      </span>
      {removable && (
        <>
          {/* reordering is a desktop affordance; on a phone those two extra 40px
              buttons steal the width the filename needs */}
          {!isMobile && (
            <>
              <button className="x" onClick={() => onMove(-1)} aria-label="Move up">↑</button>
              <button className="x" onClick={() => onMove(1)} aria-label="Move down">↓</button>
            </>
          )}
          <button className="x" onClick={onRemove} aria-label="Remove">✕</button>
        </>
      )}
    </li>
  )
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail
        throw new Error(detail || 'login failed')
      }
      const { token } = await res.json()
      onLogin(token)
    } catch (e2) {
      setErr(String(e2.message || e2))
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app login-screen">
      <div className="bg-glow bg-glow-a" />
      <div className="bg-glow bg-glow-b" />
      <form className={'card login-card' + (shake ? ' shake' : '')} onSubmit={submit}>
        <span className="logo login-logo">📄</span>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to extract invoices to Excel</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            autoFocus
            required
            placeholder="you@company.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="pwwrap">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="pwtoggle" onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
        </label>

        {err && <div className="status err login-err">{err}</div>}

        <button className="primary login-btn" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// Every invoice-level field the workbook writes, so what you see is what you export.
const INVOICE_FIELDS = [
  ['invoice_no', 'Invoice No'], ['invoice_date', 'Invoice Date'],
  ['seller_name', 'Seller'], ['seller_gstin', 'Seller GSTIN'],
  ['buyer_name', 'Buyer'], ['buyer_gstin', 'Buyer GSTIN'],
  ['taxable_value', 'Taxable Value'],
  ['cgst_rate', 'CGST Rate'], ['cgst_amount', 'CGST Amount'],
  ['sgst_rate', 'SGST Rate'], ['sgst_amount', 'SGST Amount'],
  ['igst_rate', 'IGST Rate'], ['igst_amount', 'IGST Amount'],
  ['round_off', 'Round Off'], ['grand_total', 'Grand Total'],
  ['grand_total_words', 'Grand Total (Words)'],
]
const ITEM_FIELDS = [
  ['description', 'Description'], ['hsn', 'HSN/SAC'], ['qty', 'Qty'],
  ['unit', 'Unit'], ['rate', 'Rate'], ['amount', 'Amount'],
]

// drawn, not typed: Android renders the 🗑 glyph as a tofu box
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

const PAGE_SIZE = 10

function Library({ token, onSignOut, onOpen }) {
  const [files, setFiles] = useState(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [armed, setArmed] = useState(null)   // row whose delete is one tap from firing
  const armTimer = useRef(null)
  const [renaming, setRenaming] = useState(null)
  const [q, setQ] = useState('')             // what's in the box
  const [query, setQuery] = useState('')     // what's been sent — debounced
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  // the list polls every 5s anyway; firing a fetch per keystroke on top of that is noise
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [q])

  async function rename(f, title) {
    setRenaming(null)
    const next = title.trim()
    if (!next || next === (f.title || f.filename)) return
    const r = await fetch(`/files/${f._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: next }),
    })
    if (r.status === 401) { onSignOut(); return }
    load()
  }

  async function load() {
    try {
      const url = `/files?limit=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`
        + `&q=${encodeURIComponent(query)}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (r.status === 401) { onSignOut(); return }
      if (!r.ok) throw new Error(`server returned ${r.status}`)
      const body = await r.json()
      setFiles(body.files)
      setTotal(body.total)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  useEffect(() => {
    load()
    // extraction keeps running server-side after you close the tab, so poll while
    // anything is still working and let the rows flip to done on their own
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, query])

  function toggle(id) {
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Two-step delete: the first tap arms the row, the second confirms. A stray tap on
  // a small screen can't destroy a document, and it disarms itself after 4s.
  async function remove(f) {
    if (armed !== f._id) {
      setArmed(f._id)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(null), 4000)
      return
    }
    clearTimeout(armTimer.current)
    setArmed(null)
    const r = await fetch(`/files/${f._id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status === 401) { onSignOut(); return }
    setPicked((p) => { const n = new Set(p); n.delete(f._id); return n })
    load()
  }

  async function exportPicked() {
    const r = await fetch('/files/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ file_ids: [...picked] }),
    })
    if (r.status === 401) { onSignOut(); return }
    if (!r.ok) {
      const why = await r.json().catch(() => null)
      alert(`Export failed: ${why?.detail || `server returned ${r.status}`}`)
      return
    }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = 'invoices_export.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="card"><div className="status err">Error: {error}</div></div>
  if (!files) return <div className="card"><p className="muted pad">Loading…</p></div>
  // an empty library and an empty search are different things and must not say the same thing
  if (!files.length && !query) {
    return (
      <div className="card empty">
        <span className="drop-icon">🗂</span>
        <p><strong>No documents yet</strong></p>
        <p className="muted">Files you extract will show up here — they stay available after you leave.</p>
      </div>
    )
  }

  const done = files.filter((f) => f.status === 'done')
  const allPicked = done.length > 0 && done.every((f) => picked.has(f._id))
  const working = files.filter((f) => !['done', 'failed'].includes(f.status)).length
  const from = total ? page * PAGE_SIZE + 1 : 0
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  const searchbox = (
    <div className="searchbox">
      <input
        type="search"
        value={q}
        placeholder="Search invoice no, seller, buyer, GSTIN or file name"
        aria-label="Search documents"
        onChange={(e) => setQ(e.target.value)}
      />
      {q && <button className="x x-clear" onClick={() => setQ('')} aria-label="Clear search">✕</button>}
    </div>
  )

  return (
    <div className="card">
      <div className="preview-head">
        <h2>Documents</h2>
        <span className="badge">{total} file{total === 1 ? '' : 's'}</span>
        {working > 0 && <span className="chip-working">◐ {working} still processing</span>}
        <div className="headactions">
          {picked.size > 0 && (
            <button className="primary small" onClick={exportPicked}>
              ⬇ Export selected ({picked.size})
            </button>
          )}
        </div>
      </div>

      {searchbox}

      {!files.length ? (
        <p className="muted pad">No documents match “{query}”.</p>
      ) : (
        <label className="selectall">
          <input
            type="checkbox"
            checked={allPicked}
            disabled={!done.length}
            onChange={() => setPicked(allPicked ? new Set() : new Set(done.map((f) => f._id)))}
          />
          {/* only this page's rows — ticks made on other pages are kept either way */}
          <span>Select all extracted on this page</span>
        </label>
      )}

      <ul className="filelist">
        {files.map((f) => (
          <li key={f._id} className="filerow libraryrow">
            <input
              type="checkbox"
              className="pick"
              checked={picked.has(f._id)}
              disabled={f.status !== 'done'}
              title={f.status === 'done' ? 'Include in export' : 'Not extracted yet'}
              onChange={() => toggle(f._id)}
            />
            <span className="rowmain" onClick={() => onOpen(f._id)}>
              <span className={'thumb thumb-pdf' + (f.mime?.startsWith('image/') ? ' thumb-img' : '')}>
                {f.mime?.startsWith('image/') ? '🖼' : 'PDF'}
              </span>
              {/* name and meta are separate lines so the name can never be
                  squeezed out of existence on a narrow screen */}
              <span className="rowtext">
                {renaming === f._id ? (
                  <input
                    className="renameinput"
                    defaultValue={f.title || f.filename}
                    autoFocus
                    // auto-titles run long; without this the caret lands at the end and a
                    // narrow field shows only the tail ("+18 more"). select() alone doesn't
                    // undo the scroll autofocus already did.
                    onFocus={(e) => { e.target.select(); e.target.scrollLeft = 0 }}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => rename(f, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(f, e.target.value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="fname" title={f.filename}>{f.title || f.filename}</span>
                )}
                <span className="rowmeta">
                  {/* the phone's own filename, kept for the Excel's Source File column */}
                  {f.title && f.title !== f.filename &&
                    <span className="fsize origname" title={f.filename}>{f.filename}</span>}
                  <span className="fsize">{new Date(f.created_at).toLocaleDateString()}</span>
                  <span className="fsize">{(f.size / 1024).toFixed(0)} KB</span>
                  {f.needs_review && <span className="chip-review">⚠ Needs review</span>}
                  <span className={`statuspill status-${f.status}`}>
                    {f.status === 'failed' ? 'Failed'
                      : f.status !== 'done' ? 'Processing…'
                        : `${f.invoice_count} invoice${f.invoice_count === 1 ? '' : 's'}`}
                  </span>
                </span>
              </span>
            </span>
            <button className="x x-rename" onClick={() => setRenaming(f._id)}
                    title="Rename" aria-label={`Rename ${f.title || f.filename}`}>✎</button>
            <button className={'x x-del' + (armed === f._id ? ' armed' : '')}
                    onClick={() => remove(f)}
                    title={armed === f._id ? 'Tap again to delete permanently' : `Delete ${f.filename}`}
                    aria-label={armed === f._id ? `Confirm delete ${f.filename}` : `Delete ${f.filename}`}>
              {armed === f._id ? 'Delete?' : <TrashIcon />}
            </button>

            {/* why this document matched — tap an invoice to open the document on its page */}
            {f.matches?.length > 0 && (
              <div className="matchlist">
                <span className="matchhead">
                  {f.match_count} matching invoice{f.match_count === 1 ? '' : 's'}
                </span>
                {f.matches.map((m, k) => (
                  <button key={k} className="matchrow" onClick={() => onOpen(f._id, m.page)}>
                    <span className="matchname">
                      {[m.invoice_no, m.seller_name].filter(Boolean).join(' — ') || 'Invoice'}
                      {/* say what matched when it isn't already on the line — searching a
                          buyer or a GSTIN otherwise looks like it returned the wrong invoice */}
                      {m.matched_on && !['invoice no', 'seller'].includes(m.matched_on) && (
                        <span className="matchwhy">{m.matched_on}: {m.matched_value}</span>
                      )}
                    </span>
                    {m.page && <span className="pagechip">Page {m.page}</span>}
                  </button>
                ))}
                {f.match_count > f.matches.length && (
                  <span className="matchhead">+{f.match_count - f.matches.length} more</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {total > PAGE_SIZE && (
        <div className="previewbar pager">
          <button className="ghost small" disabled={page === 0}
                  onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="previewtitle">Showing {from}–{to} of {total}</span>
          <button className="ghost small" disabled={page >= lastPage}
                  onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  )
}

// Read-only: what's shown is exactly what was read off the document, and exactly what
// goes into the Excel. Nothing here is hand-typed.
function InvoiceCard({ invoice, onSelect }) {
  if (invoice.error) {
    return <div className="status err">Extraction failed: {invoice.error}</div>
  }
  const other = Object.entries(invoice.other_fields || {}).filter(([, v]) => v !== '' && v != null)

  return (
    <div className="invcard">
      {/* documents extracted before pages were recorded have no page — no chip */}
      {invoice.page && (
        <button className="pagechip" onClick={onSelect}
                title="Show this invoice in the document">
          Page {invoice.page}
        </button>
      )}
      <dl className="fieldgrid">
        {INVOICE_FIELDS.map(([key, label]) => (
          <div className="readfield" key={key}>
            <dt>{label}</dt>
            <dd>{invoice[key] === '' || invoice[key] == null ? <span className="blank">—</span> : String(invoice[key])}</dd>
          </div>
        ))}
      </dl>

      {other.length > 0 && (
        <>
          {/* whatever else was printed on the document — labels vary per invoice */}
          <h3 className="subhead">Other fields on this document</h3>
          <dl className="fieldgrid">
            {other.map(([label, value]) => (
              <div className="readfield" key={label}>
                <dt>{label}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {(invoice.items?.length > 0) && (
        <>
          <h3 className="subhead">Line items</h3>
          {/* wider than a phone — scroll it inside its own box rather than pushing
              the page sideways */}
          <div className="tablescroll">
            <table className="itemtable">
              <thead>
                <tr>{ITEM_FIELDS.map(([, label]) => <th key={label}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {invoice.items.map((it, i) => (
                  <tr key={i}>
                    {ITEM_FIELDS.map(([key]) => <td key={key}>{it[key] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// Android Chrome refuses to render a PDF inside an <iframe> — it shows a download stub
// instead — so the pages are drawn to canvas here. pdf.js is imported lazily so its
// weight only lands on someone who actually opens a PDF.
function PdfPreview({ bytes, pages, header, onLoad }) {
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let pdf = null
    ;(async () => {
      try {
        // the legacy build, not the default one: pdf.js 6 calls Map.prototype
        // .getOrInsertComputed, which desktop Chrome has and Chrome for Android does not —
        // every page failed on the phone with "getOrInsertComputed is not a function".
        // The legacy bundle ships the polyfill, in the worker as well as here.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc =
          new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
        // slice: pdf.js takes ownership of the buffer it's handed
        pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
        if (cancelled) { pdf.destroy(); return }
        setDoc(pdf)
        onLoad(pdf.numPages)
      } catch (e) {
        if (!cancelled) setErr(String(e.message || e))
      }
    })()
    return () => { cancelled = true; if (pdf) pdf.destroy() }
  }, [bytes, onLoad])

  // a new selection starts at the top of that invoice, not wherever the last one was scrolled
  // to. Keyed on the page numbers themselves — the array is rebuilt on every render, so
  // depending on its identity would reset the scroll position on any unrelated re-render.
  const pageKey = pages ? pages.join(',') : 'all'
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = 0 }, [pageKey])

  if (err) return <div className="status err">Could not render this PDF: {err}</div>
  if (!doc) return <p className="muted pad">Loading preview…</p>

  // pages = the invoice's own page numbers, or null for the whole document
  const showing = pages || Array.from({ length: doc.numPages }, (_, i) => i + 1)
  return (
    <>
      {header}
      <div className="docframe" ref={boxRef}>
        {showing.map((num) => (
          // label the page only when the whole file is on show — inside one invoice the
          // header already says which pages these are
          <PdfPage key={num} doc={doc} num={num} label={!pages} />
        ))}
      </div>
    </>
  )
}

// A phone's canvas budget is far smaller than a desktop's, and an oversized bitmap fails
// silently — a blank page rather than an exception.
const MAX_CANVAS_PX = 4e6

// One page, rendered when it scrolls into view — a 23-page invoice shouldn't rasterise
// all of itself up front on a phone.
function PdfPage({ doc, num, label }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    let cancelled = false
    let task = null
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return
      io.disconnect()
      try {
        const page = await doc.getPage(num)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const css = el.clientWidth / base.width
        // sharpen for the device's pixel ratio, but never past what the device can hold
        const cap = Math.sqrt(MAX_CANVAS_PX / (base.width * base.height * css * css))
        const scale = css * Math.min(window.devicePixelRatio || 1, Math.max(1, cap))
        const viewport = page.getViewport({ scale })

        // the canvas goes into the page *before* it's drawn: a detached canvas that's
        // rendered and then inserted can come out blank on a real Android GPU surface
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        el.replaceChildren(canvas)

        task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
        await task.promise
      } catch (e) {
        // a swallowed rejection here is what left the phone staring at white boxes
        if (!cancelled && e?.name !== 'RenderingCancelledException') {
          el.textContent = `Page ${num} didn't render: ${e?.message || e}`
        }
      }
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => { cancelled = true; io.disconnect(); task?.cancel() }
  }, [doc, num])

  return (
    <div className="pdfpagewrap">
      {/* sibling, not a child: the render replaces the box's children with the canvas */}
      {label && <div className="pagelabel">Page {num}</div>}
      <div className="pdfpage" data-page={num} ref={ref} />
    </div>
  )
}

// Where each invoice sits in the file: it runs from its own start page to the page before
// the next one starts — which is exactly how the PDF was cut on invoice boundaries. Returns
// [] when the pages can't be trusted (documents extracted before pages were recorded), and
// the caller then falls back to showing the whole document.
function invoicePageRanges(invoices, numPages) {
  if (!numPages || !invoices?.length) return []
  const starts = invoices.map((i) => i.page)
  const usable = starts.every((p, k) => Number.isInteger(p) && p >= 1 && p <= numPages
    && (k === 0 || p >= starts[k - 1]))
  if (!usable) return []
  return starts.map((from, k) => ({
    from,
    to: k + 1 < starts.length ? Math.max(from, starts[k + 1] - 1) : numPages,
  }))
}

function FileDetail({ fid, initialPage, token, onSignOut, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [src, setSrc] = useState(null)      // object URL — photos only
  const [bytes, setBytes] = useState(null)  // raw PDF, handed to pdf.js
  // on a phone the two panes can't sit side by side, so show one at a time
  const [pane, setPane] = useState('doc')
  const [numPages, setNumPages] = useState(0)
  const [sel, setSel] = useState(0)         // invoice being checked; null = whole document

  const onPdfLoad = useCallback((n) => setNumPages(n), [])
  const jumped = useRef(false)   // the search target is honoured once, then the user drives

  useEffect(() => {
    const auth = { Authorization: `Bearer ${token}` }
    let url = null
    ;(async () => {
      try {
        const res = await fetch(`/files/${fid}`, { headers: auth })
        if (res.status === 401) { onSignOut(); return }
        if (!res.ok) throw new Error(`server returned ${res.status}`)
        const meta = await res.json()
        setData(meta)
        // <img> can't send an Authorization header, so fetch the bytes ourselves
        const raw = await fetch(`/files/${fid}/raw`, { headers: auth })
        if (!raw.ok) throw new Error('could not load the original file')
        if (meta.file.mime?.startsWith('image/')) {
          url = URL.createObjectURL(await raw.blob())
          setSrc(url)
        } else {
          setBytes(await raw.arrayBuffer())
        }
      } catch (e) {
        setError(String(e.message || e))
      }
    })()
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [fid, token, onSignOut])

  async function downloadXlsx() {
    const res = await fetch(`/files/${fid}/xlsx`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 401) { onSignOut(); return }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `${data?.file?.filename?.replace(/\.[^.]+$/, '') || 'invoices'}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="card"><div className="status err">Error: {error}</div></div>
  if (!data) return <div className="card"><p className="muted pad">Loading…</p></div>

  const isImage = data.file.mime?.startsWith('image/')
  const invoices = data.invoices
  const ranges = invoicePageRanges(invoices, numPages)

  // arrived from a search hit: land on the invoice that actually matched. "contains", not
  // "starts at" — a match on page 17 of the 16–19 invoice still belongs to that invoice.
  if (initialPage && !jumped.current && ranges.length) {
    jumped.current = true
    const k = ranges.findIndex((r) => initialPage >= r.from && initialPage <= r.to)
    if (k >= 0 && k !== sel) setSel(k)
  }
  // no trustworthy pages (old document, photo, nothing extracted) -> whole document, all cards
  const picked = ranges.length ? sel : null
  const range = picked == null ? null : ranges[picked]
  const shownPages = range
    ? Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i)
    : null
  const shownCards = picked == null ? invoices : [invoices[picked]]

  // selecting an invoice is the whole point of this screen: the pane shows its pages and
  // nothing else, so what's on screen always belongs to the data beside it. On a phone the
  // panes are stacked, so a pick from the data side has to flip you to the document.
  function pick(i) {
    setSel(i)
    setPane('doc')
  }

  const previewHeader = ranges.length > 0 && (
    <div className="previewbar">
      {picked == null ? (
        <>
          <span className="previewtitle">All {numPages} pages</span>
          <button className="ghost small" onClick={() => setSel(0)}>Back to invoice 1</button>
        </>
      ) : (
        <>
          <button className="ghost small" disabled={picked === 0}
                  onClick={() => setSel(picked - 1)}>‹ Prev</button>
          <span className="previewtitle">
            Invoice {picked + 1} of {invoices.length} ·{' '}
            {range.from === range.to ? `page ${range.from}` : `pages ${range.from}–${range.to}`}
          </span>
          <button className="ghost small" disabled={picked === invoices.length - 1}
                  onClick={() => setSel(picked + 1)}>Next ›</button>
          <button className="ghost small" onClick={() => setSel(null)}>All pages</button>
        </>
      )}
    </div>
  )

  return (
    <>
      <div className="detailbar">
        <button className="ghost" onClick={onBack}>← <span className="hide-xs">Documents</span></button>
        <span className="fname" title={data.file.filename}>{data.file.title || data.file.filename}</span>
        <button className="ghost" onClick={downloadXlsx}>⬇ <span className="hide-xs">Download </span>Excel</button>
      </div>

      {/* phone only: the panes stack, so let the user flip between them */}
      <div className="panetoggle">
        <button className={pane === 'doc' ? 'on' : ''} onClick={() => setPane('doc')}>Document</button>
        <button className={pane === 'data' ? 'on' : ''} onClick={() => setPane('data')}>
          Extracted data
        </button>
      </div>

      <div className={`sidebyside show-${pane}`}>
        <section className="card pane pane-doc">
          {isImage
            ? (src ? <img className="docimg" src={src} alt={data.file.filename} />
              : <p className="muted pad">Loading preview…</p>)
            : (bytes ? <PdfPreview bytes={bytes} pages={shownPages}
                                   header={previewHeader} onLoad={onPdfLoad} />
              : <p className="muted pad">Loading preview…</p>)}
        </section>
        <section className="card pane pane-data">
          <div className="preview-head">
            <h2>Extracted data</h2>
            <span className="badge">
              {picked == null
                ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`
                : `Invoice ${picked + 1} of ${invoices.length}`}
            </span>
          </div>
          <div className="panescroll">
            {invoices.length === 0 && <p className="muted pad">Nothing was extracted from this file.</p>}
            {shownCards.map((inv, i) => (
              <InvoiceCard key={inv._id} invoice={inv}
                           onSelect={() => pick(picked == null ? i : picked)} />
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

export default function Root() {
  const [token, setToken] = useState(() => localStorage.getItem('token'))

  function login(t) {
    localStorage.setItem('token', t)
    setToken(t)
  }
  function signOut() {
    localStorage.removeItem('token')
    setToken(null)
  }

  if (!token) return <Login onLogin={login} />
  return <App token={token} onSignOut={signOut} />
}

function App({ token, onSignOut }) {
  const [tab, setTab] = useState('upload')      // 'upload' | 'library'
  const isMobile = useIsMobile()
  // docked open on a wide screen; an overlay you pull in with ☰ on a narrow one
  const [navOpen, setNavOpen] = useState(() => window.innerWidth >= 1024)
  // file open in the side-by-side view: { fid, page } — page is set when the user came from
  // a search hit, so the document opens on the invoice they were actually looking for
  const [openFid, setOpenFid] = useState(null)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null) // {done_files, total_files, files} while polling
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const cameraRef = useRef(null)
  // lazily-created object URLs for image thumbnails, revoked on removal
  const thumbs = useRef(new Map())

  // on desktop the drawer is docked, so navigating shouldn't close it
  const closeNavOnMobile = () => { if (window.innerWidth < 1024) setNavOpen(false) }

  // the name is all we have once the picked File is cleared (after a job finishes, the row
  // is rebuilt from the server's progress list) — so the type must be readable from it alone
  const isImageName = (n) => /\.(jpe?g|png|webp|heic|heif)$/i.test(n || '')
  const isImage = (f) => f.type.startsWith('image/') || isImageName(f.name)

  function thumbFor(f) {
    if (!isImage(f)) return null
    if (!thumbs.current.has(f)) thumbs.current.set(f, URL.createObjectURL(f))
    return thumbs.current.get(f)
  }

  function dropThumb(f) {
    const url = thumbs.current.get(f)
    if (url) { URL.revokeObjectURL(url); thumbs.current.delete(f) }
  }

  function addFiles(fileList) {
    const accepted = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') || isImage(f)
    )
    // de-dupe by name+size so re-picking the same batch doesn't double up
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...accepted.filter((f) => !seen.has(f.name + f.size))]
    })
  }

  function removeFile(i) {
    setFiles((prev) => {
      dropThumb(prev[i])
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function clearFiles() {
    setFiles((prev) => {
      prev.forEach(dropThumb)
      return []
    })
  }

  function moveFile(i, dir) {
    setFiles((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function extract() {
    setBusy(true)
    setError('')
    setProgress({ done_files: 0, total_files: files.length, files: [] })
    try {
      const auth = { Authorization: `Bearer ${token}` }
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      // 1) hand the files off — returns immediately with a job id (no long request).
      const res = await fetch('/extract', { method: 'POST', body: fd, headers: auth })
      if (res.status === 401) { onSignOut(); return }
      if (!res.ok) throw new Error((await res.text()) || `Server returned ${res.status}`)
      const { job_id } = await res.json()

      // 2) poll until the background extraction finishes.
      // ponytail: cap the wait so a stuck job doesn't spin forever.
      for (let i = 0; ; i++) {
        await sleep(2000)
        const sr = await fetch(`/status/${job_id}`, { headers: auth })
        if (sr.status === 401) { onSignOut(); return }
        const s = await sr.json()
        setProgress(s)
        if (s.status === 'done') break
        if (s.status === 'error') throw new Error(s.error || 'extraction failed')
        if (i > 900) throw new Error('timed out waiting for extraction (30 min)')
      }
      // 3) done — send them to Documents, where the extracted data sits beside the
      // original document. Beats a cramped inline sheet, and it's where the file lives.
      clearFiles()
      setTab('library')
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const done = progress?.done_files ?? 0
  const total = progress?.total_files || files.length
  const pct = total ? Math.round((done / total) * 100) : 0
  // merge live per-file status (once polling starts) over the locally-picked file list
  let photoNo = 0
  // `f` is the picked File, which may be gone; `fallbackName` is what the server calls it
  const describe = (f, fallbackName) => {
    const name = f?.name || fallbackName || ''
    const img = f ? isImage(f) : isImageName(name)
    if (img) photoNo += 1
    return { name: displayName(name, img, photoNo) || name, isImg: img }
  }
  const displayFiles = progress?.files?.length
    ? progress.files.map((f, i) => ({
      ...describe(files[i], f.name), size: files[i]?.size, status: f.status,
      thumb: files[i] ? thumbFor(files[i]) : null,
    }))
    : files.map((f) => ({ ...describe(f), size: f.size, status: 'queued', thumb: thumbFor(f) }))

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <div className="bg-glow bg-glow-a" />
      <div className="bg-glow bg-glow-b" />

      <header className="topbar">
        <div className="brand">
          <button className="burger" aria-label="Menu" aria-expanded={navOpen}
                  onClick={() => setNavOpen((v) => !v)}>☰</button>
          <span className="logo">📄</span>
          <div>
            <h1>Invoice&nbsp;→&nbsp;Excel</h1>
            <p>Bulk-extract invoice PDFs into a structured workbook</p>
          </div>
          {/* icon-only on a phone so it fits, but always visible. An inline SVG, not a
              Unicode glyph — ⏻ (U+23FB) is missing from most phone fonts and rendered
              as a tofu box. */}
          <button className="ghost signout" onClick={onSignOut}
                  title="Sign out" aria-label="Sign out">
            {isMobile ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            ) : 'Sign out'}
          </button>
        </div>
      </header>

      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <nav className={'sidenav' + (navOpen ? ' open' : '')}>
        <button className={'navitem' + (tab === 'upload' ? ' on' : '')}
                onClick={() => { setTab('upload'); closeNavOnMobile() }}>
          <span className="navicon">⬆</span> Upload
        </button>
        <button className={'navitem' + (tab === 'library' ? ' on' : '')}
                onClick={() => { setTab('library'); setOpenFid(null); closeNavOnMobile() }}>
          <span className="navicon">🗂</span> Documents
        </button>
      </nav>

      {tab === 'library' ? (
        <main className="container">
          {openFid
            ? <FileDetail fid={openFid.fid} initialPage={openFid.page} token={token}
                          onSignOut={onSignOut} onBack={() => setOpenFid(null)} />
            : <Library token={token} onSignOut={onSignOut}
                       onOpen={(fid, page) => setOpenFid({ fid, page })} />}
        </main>
      ) : (
      // upload sits in the middle of the page rather than hugging the top
      <main className="container centered">
        <section className="card upload-card">
          <div className="uploadhead">
            <h2>Upload invoices</h2>
            <p className="muted">Drop your invoices in and we'll pull the data out into a spreadsheet.</p>
          </div>
          <div
            className={'drop' + (dragging ? ' over' : '')}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
          >
            <span className="drop-icon">⬆</span>
            <p><strong>Click to choose PDFs or photos</strong> or drag &amp; drop here</p>
            <p className="muted">Multiple files supported · single-invoice or multi-invoice PDFs · invoice photos</p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
            />
          </div>

          {/* rear camera on phones; a plain image picker on desktop — no custom camera UI needed */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
          <button className="ghost scanbtn" onClick={() => cameraRef.current?.click()} disabled={busy}>
            📷 Scan with camera
          </button>

          {displayFiles.length > 0 && (
            <ul className="filelist">
              {displayFiles.map((f, i) => (
                <FileStatusRow
                  key={f.name + i}
                  name={f.name}
                  size={f.size}
                  status={f.status}
                  thumb={f.thumb}
                  isImg={f.isImg}
                  isMobile={isMobile}
                  removable={!busy}
                  onRemove={() => removeFile(i)}
                  onMove={(dir) => moveFile(i, dir)}
                />
              ))}
            </ul>
          )}

          <div className="actions">
            <button className="primary" onClick={extract} disabled={busy || files.length === 0}>
              {busy ? 'Extracting…' : 'Extract data'}
            </button>
            {files.length > 0 && (
              <button className="ghost" onClick={clearFiles} disabled={busy}>Clear</button>
            )}
          </div>

          {busy && (
            <div className="status progresswrap">
              <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
              <span>Processing… {done}/{total} files ({pct}%)</span>
            </div>
          )}
          {error && <div className="status err">Error: {error}</div>}
        </section>
      </main>
      )}
    </div>
  )
}
