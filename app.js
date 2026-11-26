/* Kasir Readyku v1.0 - readyku.id */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const rp = n => 'Rp' + Math.round(n).toLocaleString('id-ID');
const num = s => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const hhmm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const tglID = s => { const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
const KEY = 'kasirReadyku';
const DEMO_MENU = [
  { k: 'AYG', c: 'Makanan', n: 'Ayam geprek', h: 18000, v: [{ l: 'Level pedas', o: [['0', 0], ['1', 0], ['2', 0], ['3', 0], ['5', 0]] }] },
  { k: 'NSG', c: 'Makanan', n: 'Nasi goreng', h: 17000, v: [{ l: 'Porsi', o: [['Biasa', 0], ['Spesial', 5000]] }] },
  { k: 'SOT', c: 'Makanan', n: 'Soto ayam', h: 16000, v: [] },
  { k: 'ETH', c: 'Minuman', n: 'Es teh', h: 5000, v: [{ l: 'Rasa', o: [['Manis', 0], ['Tawar', 0]] }] },
  { k: 'KSU', c: 'Minuman', n: 'Kopi susu', h: 12000, v: [{ l: 'Sajian', o: [['Panas', 0], ['Es', 2000]] }] },
  { k: 'KRP', c: 'Tambahan', n: 'Kerupuk', h: 2000, v: [] }];

let S = { conn: null, demo: false, dev: null, cfg: null, q: [], trx: [], shift: null, lastOk: 0, lastErr: '', lastCfg: 0 };
try { const x = JSON.parse(localStorage.getItem(KEY)); if (x && typeof x === 'object') S = Object.assign(S, x); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
let cart = [], cat = null, otype = 'Makan di sini', method = 'TUNAI', draft = null, view = 'kasir', installEv = null, busy = false;

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
const keyOf = () => (S.demo ? 'demo' : S.conn.k);
async function pinOk(pin, hash) { return !!pin && (await sha(keyOf() + ':' + String(pin).trim())) === hash; }
async function demoCfg() {
  return { toko: 'Warung Contoh', mode: 'sendiri', wa: '', po: await sha('demo:1234'), menu: DEMO_MENU,
    kasir: [{ n: 'Dina', p: await sha('demo:1111') }, { n: 'Rudi', p: await sha('demo:2222') }], ver: 'contoh' };
}

/* ---------------- sambungan ke Google Sheet ---------------- */
function parseLink(str) {
  const m = String(str).match(/#s=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4)))));
    const okHost = /^https:\/\/script\.google\.com\//.test(o.u) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(o.u);
    return okHost && o.k ? { u: o.u, k: String(o.k) } : null;
  } catch (e) { return null; }
}
async function call(opts) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try {
    const url = opts ? S.conn.u : S.conn.u + (S.conn.u.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(S.conn.k) + '&_=' + Date.now();
    const r = await fetch(url, Object.assign({ signal: ctl.signal, redirect: 'follow', cache: 'no-store' }, opts || {}));
    const j = await r.json();
    if (!j.ok) throw new Error(j.err || 'gagal');
    return j;
  } finally { clearTimeout(t); }
}
function applyCfg(c) {
  S.lastCfg = Date.now();
  if (!S.cfg || S.cfg.ver !== c.ver) { const modeChanged = S.cfg && S.cfg.mode !== c.mode; S.cfg = c; renderMenu(); renderTop(); if (modeChanged) { S.shift = null; route(); } }
}
async function sync(force) {
  if (!S.conn || S.demo || busy) return;
  busy = true; renderTop();
  let again = false;
  try {
    if (S.q.length) {
      const batch = S.q.slice(0, 40);
      const j = await call({ method: 'POST', body: JSON.stringify({ k: S.conn.k, ev: batch, wantCfg: force || Date.now() - S.lastCfg > 60000 }) });
      const done = new Set(j.acked || []);
      S.q = S.q.filter(ev => !done.has(ev.eid));
      S.trx.forEach(t => { if (done.has(t.id)) t.sync = true; });
      if (j.cfg) applyCfg(j.cfg);
      again = S.q.length > 0 && done.size > 0;
    } else if (force || Date.now() - S.lastCfg > 60000) {
      applyCfg((await call()).cfg);
    }
    S.lastOk = Date.now(); S.lastErr = '';
  } catch (e) {
    S.lastErr = e && e.message === 'kunci' ? 'Link kasir tidak berlaku. Minta link baru ke owner.' : (navigator.onLine === false ? 'Offline' : 'Belum tersambung');
  } finally {
    busy = false; save(); renderTop();
    if (view === 'riwayat') renderHist();
    if (view === 'perangkat') renderDev();
    if (again) setTimeout(sync, 300);
  }
}
function queue(ev) { if (!S.demo) S.q.push(ev); save(); setTimeout(sync, 50); }

/* ---------------- alur layar ---------------- */
function show(v) {
  view = v;
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
  if (v === 'riwayat') renderHist();
  if (v === 'tutup') renderSum();
  if (v === 'perangkat') renderDev();
}
function route() {
  const main = !!(S.dev && S.cfg && (S.conn || S.demo));
  $('tabs').hidden = !main || (S.cfg.mode === 'karyawan' && !S.shift);
  renderTop();
  if (!S.conn && !S.demo) return show('welcome');
  if (!S.dev) return show('name');
  if (!S.cfg) return show('name');
  if (S.cfg.mode === 'karyawan' && !S.shift) { renderLogin(); return show('login'); }
  $('tabTutup').textContent = S.cfg.mode === 'karyawan' ? 'Tutup shift' : 'Rekap hari ini';
  $('tutupH').textContent = $('tabTutup').textContent;
  $('demoBanner').hidden = !S.demo;
  renderMenu(); renderCart();
  show(['kasir', 'riwayat', 'tutup', 'perangkat'].includes(view) ? view : 'kasir');
}
function renderTop() {
  $('toko').textContent = S.cfg ? S.cfg.toko : 'Belum tersambung';
  const who = $('who'), sy = $('sync');
  who.hidden = !S.cfg; who.textContent = S.shift ? 'Kasir: ' + S.shift.kasir : (S.cfg && S.cfg.mode === 'karyawan' ? 'Belum masuk' : (S.dev ? S.dev.name : ''));
  sy.hidden = !S.cfg;
  if (S.demo) { sy.className = 'chip'; sy.textContent = 'Mode contoh'; return; }
  const n = S.q.length;
  sy.className = 'chip' + (S.lastErr && S.lastErr !== 'Offline' && S.lastErr !== 'Belum tersambung' ? ' err' : n ? ' wait' : '');
  sy.textContent = busy ? 'Mengirim…' : n ? n + ' menunggu kirim' + (S.lastErr ? ' · ' + S.lastErr.toLowerCase() : '') : (S.lastErr || 'Tersinkron');
}

/* ---------------- kasir ---------------- */
const menu = () => (S.cfg ? S.cfg.menu : []);
const item = k => menu().find(m => m.k === k);
function renderMenu() {
  const cs = [...new Set(menu().map(m => m.c))];
  if (!cs.includes(cat)) cat = cs[0];
  $('cats').innerHTML = cs.map(c => `<button data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('');
  $('grid').innerHTML = menu().filter(m => m.c === cat).map(m => `<button class="p" data-k="${esc(m.k)}"><b>${esc(m.n)}</b><small>${m.v.length ? esc(m.v.map(v => v.l).join(', ')) : '&nbsp;'}</small><span>${rp(m.h)}</span></button>`).join('') || '<p class="empty">Menu kosong. Owner mengisi menu di Google Sheet.</p>';
}
function addLine(line) {
  const same = cart.find(c => c.k === line.k && c.lbl.join() === line.lbl.join() && c.note === line.note);
  same ? (same.q += line.q) : cart.push(line);
  renderCart();
}
function tapItem(k) {
  const m = item(k); if (!m) return;
  if (!m.v.length) return addLine({ k: m.k, n: m.n, h: m.h, add: 0, lbl: [], note: '', q: 1 });
  draft = { k, sel: m.v.map(() => 0), q: 1 };
  $('optDlg').innerHTML = `<h2>${esc(m.n)}</h2>` + m.v.map((v, i) => `<p class="note">${esc(v.l)}</p><div class="opts">${v.o.map((o, j) => `<button data-vi="${i}" data-oj="${j}" aria-pressed="${j === 0}">${esc(o[0])}${o[1] ? ' +' + (o[1] / 1000) + 'rb' : ''}</button>`).join('')}</div>`).join('') +
    `<p class="note">Catatan</p><input id="optNote" placeholder="mis. tanpa es, sambal dipisah" style="margin:6px 0 12px"><div class="q" style="justify-content:center;margin-bottom:12px"><button data-oq="-1" aria-label="Kurangi">−</button><b id="optQ" style="min-width:30px;text-align:center">1</b><button data-oq="1" aria-label="Tambah">+</button></div><button class="primary" id="optAdd">Tambah ke pesanan</button><button class="wide" id="optX">Batal</button>`;
  $('optOv').classList.add('on');
}
function addDraft() {
  const m = item(draft.k), sel = m.v.map((v, i) => v.o[draft.sel[i]]);
  addLine({ k: m.k, n: m.n, h: m.h, add: sel.reduce((a, o) => a + o[1], 0), lbl: m.v.map((v, i) => (/pedas/i.test(v.l) ? 'Lv ' : '') + sel[i][0]), note: $('optNote').value.trim(), q: draft.q });
  $('optOv').classList.remove('on');
}
function editNote(i) {
  const c = cart[i];
  $('optDlg').innerHTML = `<h2>${esc(c.n)}</h2><p class="note">Catatan</p><input id="noteIn" value="${esc(c.note)}" style="margin:6px 0 12px"><button class="primary" id="noteOk" data-ni="${i}">Simpan catatan</button><button class="wide" id="optX">Batal</button>`;
  $('optOv').classList.add('on'); $('noteIn').focus();
}
const lineTot = c => (c.h + c.add) * c.q, total = () => cart.reduce((a, c) => a + lineTot(c), 0);
function renderCart() {
  $('cart').innerHTML = cart.length ? cart.map((c, i) => `<div class="row"><div class="n" data-note="${i}" role="button" tabindex="0">${esc(c.n)}<small>${esc([...c.lbl, c.note].filter(Boolean).join(' · ') || 'Ketuk untuk catatan')} · ${rp(c.h + c.add)}</small></div><div class="q"><button data-ci="${i}" data-cd="-1" aria-label="Kurangi">−</button><b>${c.q}</b><button data-ci="${i}" data-cd="1" aria-label="Tambah">+</button></div></div>`).join('') : '<p class="empty">Tap menu untuk menambah</p>';
  const t = total();
  $('tot').textContent = rp(t); $('barT').textContent = rp(t); $('barN').textContent = cart.reduce((a, c) => a + c.q, 0) + ' item';
  const qs = [t, ...[20000, 50000, 100000].filter(v => v > t)].slice(0, 4);
  $('quick').innerHTML = t ? qs.map((v, i) => `<button data-cash="${v}">${i ? rp(v) : 'Uang pas'}</button>`).join('') : '';
  updPay();
}
function updPay() {
  const t = total(), c = num($('cash').value), cm = method === 'TUNAI';
  $('cashBox').hidden = !cm; $('nonCash').hidden = cm;
  $('chg').textContent = rp(Math.max(0, c - t));
  $('payWarn').textContent = cm && t && c && c < t ? 'Uang kurang ' + rp(t - c) : '';
  $('save').disabled = !t || (cm && c < t);
}
function struk(t) {
  const W = 32, line = '-'.repeat(W), lr = (a, b) => a + ' '.repeat(Math.max(1, W - a.length - b.length)) + b, f = n => n.toLocaleString('id-ID');
  const L = [S.cfg.toko, tglID(t.tgl) + ' ' + t.jam + '  ' + t.id, t.kasir + ' · ' + t.ot + (t.cust ? ' · ' + t.cust : ''), line];
  t.items.forEach(c => { L.push(c.n + (c.lbl.length ? ' (' + c.lbl.join(', ') + ')' : '')); if (c.note) L.push('  * ' + c.note); L.push(lr('  ' + c.q + ' x ' + f(c.h + c.add), f(lineTot(c)))); });
  L.push(line, lr('TOTAL', f(t.total)), lr(t.m, f(t.bayar)));
  if (t.m === 'TUNAI') L.push(lr('Kembali', f(t.bayar - t.total)));
  L.push('', 'Terima kasih');
  return L.join('\n');
}
function saveOrder() {
  const tot = total(); if (!tot) return;
  if (method === 'TUNAI' && num($('cash').value) < tot) return;
  S.dev.seq++;
  const t = { id: S.dev.code + '-' + pad(S.dev.seq, 4), tgl: today(), jam: hhmm(), dev: S.dev.name, kasir: S.shift ? S.shift.kasir : 'Owner', ot: otype, cust: $('cust').value.trim(),
    m: method, total: tot, bayar: method === 'TUNAI' ? num($('cash').value) : tot, items: cart.map(c => ({ k: c.k, n: c.n, h: c.h, add: c.add, lbl: c.lbl, note: c.note, q: c.q })), st: 'OK' };
  S.trx.push(Object.assign({ sync: false, shiftId: S.shift ? S.shift.id : null }, t));
  const cut = Date.now() - 3 * 864e5; S.trx = S.trx.filter(x => !x.sync || new Date(x.tgl) >= cut);
  queue({ kind: 'trx', eid: t.id, t });
  cart = []; $('cash').value = ''; $('cust').value = ''; renderCart(); renderTop();
  const s = struk(t);
  $('rcpt').textContent = s;
  $('waStruk').href = 'https://wa.me/?text=' + encodeURIComponent(s);
  $('rcOv').classList.add('on'); $('newTrx').focus();
}

/* ---------------- riwayat ---------------- */
function renderHist() {
  const T = S.trx.filter(t => t.tgl === today()).slice().reverse();
  $('hist').innerHTML = T.length ? `<table><thead><tr><th>No</th><th>Jam</th><th>Bayar</th><th class="r">Total</th><th>Kirim</th><th>Status</th></tr></thead><tbody>${T.map(t => `<tr class="${t.st === 'BATAL' ? 'batal' : ''}"><td>${esc(t.id)}</td><td>${t.jam}</td><td>${t.m}</td><td class="r">${rp(t.total)}</td><td>${S.demo ? '<span class="tag o">Contoh</span>' : t.sync ? '<span class="tag g">Terkirim</span>' : '<span class="tag o">Menunggu</span>'}</td><td>${t.st === 'BATAL' ? '<span class="tag r">BATAL</span>' : `<button data-x="${esc(t.id)}">Batalkan</button><span data-pinw="${esc(t.id)}" hidden><input inputmode="numeric" type="password" placeholder="PIN owner" aria-label="PIN owner" style="width:120px;margin:4px 0"><button data-y="${esc(t.id)}">OK</button></span>`}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Belum ada pesanan hari ini.</p>';
}
async function voidTrx(id, pin, inp) {
  if (!(await pinOk(pin, S.cfg.po))) { inp.value = ''; inp.placeholder = 'PIN salah'; return; }
  const t = S.trx.find(x => x.id === id); if (!t || t.st === 'BATAL') return;
  t.st = 'BATAL'; queue({ kind: 'void', eid: 'void:' + id, id }); renderHist(); renderTop();
}

/* ---------------- tutup shift / rekap ---------------- */
function shiftTrx() {
  return S.trx.filter(t => t.st === 'OK' && (S.cfg.mode === 'karyawan' ? t.shiftId === (S.shift && S.shift.id) : t.tgl === today()));
}
function calc() {
  const ok = shiftTrx(), by = m => ok.filter(t => t.m === m).reduce((a, t) => a + t.total, 0);
  const modal = S.cfg.mode === 'karyawan' ? (S.shift ? S.shift.modal : 0) : num(($('modalIn') || {}).value);
  return { ok, tunai: by('TUNAI'), qris: by('QRIS'), tf: by('TRANSFER'), modal };
}
function renderSum() {
  const k = S.cfg.mode === 'karyawan';
  if (!k && !$('modalIn')) document.querySelector('label[for=laci]').insertAdjacentHTML('beforebegin', '<label for="modalIn" class="note" style="display:block">Modal awal laci hari ini</label><input id="modalIn" inputmode="numeric" value="0" style="margin-bottom:8px">');
  const c = calc();
  $('sum').innerHTML = [k ? ['Modal awal laci', c.modal] : null, ['Tunai', c.tunai], ['QRIS', c.qris], ['Transfer', c.tf], ['Seharusnya di laci', c.modal + c.tunai]].filter(Boolean)
    .map(([a, b]) => `<div class="kv"><span>${a}</span><b>${rp(b)}</b></div>`).join('') + `<p class="note">${c.ok.length} pesanan sah${k && S.shift ? ' · kasir ' + esc(S.shift.kasir) + ' sejak ' + S.shift.buka : ''}</p>`;
  $('close').disabled = k && !S.shift;
}
let lastRekap = null;
function closeShift() {
  const raw = $('laci').value.trim();
  if (!raw) { $('laciWarn').textContent = 'Hitung dan isi dulu uang di laci.'; return; }
  const c = calc(), laci = num(raw), sel = laci - (c.modal + c.tunai), k = S.cfg.mode === 'karyawan';
  const s = { id: S.dev.code + '-S' + Date.now().toString(36), dev: S.dev.name, kasir: k ? S.shift.kasir : 'Owner', buka: k ? S.shift.buka : tglID(today()),
    tutup: tglID(today()) + ' ' + hhmm(), modal: c.modal, tunai: c.tunai, qris: c.qris, tf: c.tf, laci, n: c.ok.length };
  queue({ kind: 'shift', eid: s.id, s });
  const txt = `${S.cfg.toko}\n${k ? 'Tutup shift ' + s.kasir : 'Rekap hari ini'} · ${s.tutup}\nPesanan: ${s.n}\nOmzet: ${rp(c.tunai + c.qris + c.tf)}\nTunai ${rp(c.tunai)} · QRIS ${rp(c.qris)} · Transfer ${rp(c.tf)}\nUang di laci: ${rp(laci)} (selisih ${sel > 0 ? '+' : sel < 0 ? '−' : ''}${rp(Math.abs(sel))})\nBelum terkirim ke Sheet: ${S.q.filter(ev => ev.kind === 'trx').length} pesanan`;
  lastRekap = { s, txt, rows: c.ok };
  const wa = S.cfg.wa ? `https://wa.me/${S.cfg.wa}?text=${encodeURIComponent(txt)}` : `https://wa.me/?text=${encodeURIComponent(txt)}`;
  $('rekapOut').innerHTML = `<div class="receipt" id="rkTxt"></div><a class="btn" target="_blank" rel="noopener" href="${wa}">Kirim ringkasan ke WA owner</a><button class="wide" id="shareX">Bagikan file rekap (.xlsx)</button><p class="warn" id="shareMsg"></p>`;
  $('rkTxt').textContent = txt; $('laciWarn').textContent = ''; $('laci').value = '';
  if (k) { S.shift = null; save(); $('tabs').hidden = true; renderTop(); $('rekapOut').insertAdjacentHTML('beforeend', '<button class="primary" id="toLogin">Selesai, ke layar masuk</button>'); }
  renderSum();
}
function loadXlsx() {
  return window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'vendor/xlsx.mini.min.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
}
async function shareXlsx() {
  if (!lastRekap) return;
  try {
    await loadXlsx();
    const { s, rows } = lastRekap, X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Rekap Kasir Readyku'], ['Toko', S.cfg.toko], ['Perangkat', s.dev], ['Kasir', s.kasir], ['Buka', s.buka], ['Tutup', s.tutup], ['Modal', s.modal], ['Tunai', s.tunai], ['QRIS', s.qris], ['Transfer', s.tf], ['Uang di laci', s.laci], ['Selisih', s.laci - s.modal - s.tunai], ['Jumlah pesanan', s.n]]), 'Ringkasan');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['ID', 'Tanggal', 'Jam', 'Kasir', 'Jenis', 'Pelanggan', 'Metode', 'Total']].concat(rows.map(t => [t.id, tglID(t.tgl), t.jam, t.kasir, t.ot, t.cust, t.m, t.total]))), 'Pesanan');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['ID', 'Menu', 'Pilihan', 'Catatan', 'Qty', 'Harga', 'Subtotal']].concat([].concat(...rows.map(t => t.items.map(c => [t.id, c.n, c.lbl.join(', '), c.note, c.q, c.h + c.add, lineTot(c)]))))), 'Item');
    const name = ('Rekap_' + S.cfg.toko + '_' + s.tutup.replace(/[/: ]/g, '-') + '.xlsx').replace(/[^\w.-]+/g, '_');
    const file = new File([X.write(wb, { type: 'array', bookType: 'xlsx' })], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: lastRekap.txt }); $('shareMsg').textContent = ''; }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); $('shareMsg').textContent = 'File tersimpan di unduhan. Kirim ke owner lewat WhatsApp.'; }
  } catch (e) { if (e && e.name !== 'AbortError') $('shareMsg').textContent = 'Gagal membuat file. Ringkasan WA tetap bisa dikirim.'; }
}

/* ---------------- login, perangkat ---------------- */
function renderLogin() { $('lgName').innerHTML = (S.cfg.kasir || []).map((k, i) => `<option value="${i}">${esc(k.n)}</option>`).join(''); }
async function login() {
  const k = (S.cfg.kasir || [])[+$('lgName').value];
  if (!k || !(await pinOk($('lgPin').value, k.p))) { $('lgWarn').textContent = 'PIN salah'; $('lgPin').value = ''; return; }
  S.shift = { id: Date.now().toString(36), kasir: k.n, modal: num($('lgModal').value), buka: tglID(today()) + ' ' + hhmm() };
  $('lgPin').value = ''; $('lgWarn').textContent = ''; save(); view = 'kasir'; $('rekapOut').innerHTML = '<p class="empty">Muncul setelah ditutup.</p>'; route();
}
function renderDev() {
  const rows = [['Toko', S.cfg.toko], ['Perangkat', S.dev.name + ' (' + S.dev.code + ')'], ['Mode', S.cfg.mode === 'karyawan' ? 'Karyawan' : 'Sendiri'],
    ['Menunggu dikirim', S.demo ? '-' : S.q.length], ['Terakhir tersambung', S.lastOk ? new Date(S.lastOk).toLocaleString('id-ID') : 'Belum pernah'], ['Menu', menu().length + ' item']];
  $('devInfo').innerHTML = rows.map(([a, b]) => `<div class="kv"><span>${a}</span><b>${esc(b)}</b></div>`).join('') + (S.lastErr ? `<p class="warn">${esc(S.lastErr)}</p>` : '');
  $('syncNow').hidden = S.demo;
  $('installBtn').hidden = !installEv;
}
let unlinkArmed = false;
async function ownerAct(act) {
  if (!(await pinOk($('ownPin').value, S.cfg.po))) { $('ownMsg').textContent = 'PIN owner salah'; return; }
  if (act === 'rename') {
    $('optDlg').innerHTML = `<h2>Nama perangkat</h2><input id="renIn" value="${esc(S.dev.name)}" style="margin:6px 0 12px"><button class="primary" id="renOk">Simpan</button><button class="wide" id="optX">Batal</button>`;
    $('optOv').classList.add('on'); return;
  }
  if (S.q.length && !unlinkArmed) { unlinkArmed = true; $('ownMsg').textContent = 'Masih ada ' + S.q.length + ' data belum terkirim dan akan hilang. Ketuk sekali lagi untuk tetap memutuskan.'; return; }
  try { localStorage.removeItem(KEY); } catch (e) {}
  location.replace(location.pathname);
}

/* ---------------- kejadian ---------------- */
document.addEventListener('click', e => {
  const n = e.target.closest('[data-note]'); if (n) return editNote(+n.dataset.note);
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.v) show(d.v);
  else if (d.cat !== undefined) { cat = d.cat; renderMenu(); }
  else if (d.k !== undefined) tapItem(d.k);
  else if (d.vi !== undefined) { draft.sel[+d.vi] = +d.oj; b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); }
  else if (d.oq) { draft.q = Math.max(1, draft.q + +d.oq); $('optQ').textContent = draft.q; }
  else if (b.id === 'optAdd') addDraft();
  else if (b.id === 'optX') $('optOv').classList.remove('on');
  else if (b.id === 'noteOk') { cart[+d.ni].note = $('noteIn').value.trim(); $('optOv').classList.remove('on'); renderCart(); }
  else if (b.id === 'renOk') { const v = $('renIn').value.trim(); if (v) { S.dev.name = v; save(); } $('optOv').classList.remove('on'); renderDev(); renderTop(); }
  else if (d.ci !== undefined) { const c = cart[+d.ci]; c.q += +d.cd; if (c.q < 1) cart.splice(+d.ci, 1); renderCart(); }
  else if (d.cash) { $('cash').value = (+d.cash).toLocaleString('id-ID'); updPay(); }
  else if (d.m) { method = d.m; document.querySelectorAll('#pay button').forEach(x => x.setAttribute('aria-pressed', x === b)); updPay(); }
  else if (d.o) { otype = d.o; document.querySelectorAll('#otype button').forEach(x => x.setAttribute('aria-pressed', x === b)); }
  else if (d.x) { b.hidden = true; const w = document.querySelector(`[data-pinw="${CSS.escape(d.x)}"]`); w.hidden = false; w.querySelector('input').focus(); }
  else if (d.y) { const w = document.querySelector(`[data-pinw="${CSS.escape(d.y)}"]`), inp = w.querySelector('input'); voidTrx(d.y, inp.value, inp); }
  else if (b.id === 'shareX') shareXlsx();
  else if (b.id === 'toLogin') { view = 'kasir'; route(); }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.note !== undefined) { e.preventDefault(); editNote(+e.target.dataset.note); } });
$('cash').addEventListener('input', updPay);
document.addEventListener('input', e => { if (e.target.id === 'modalIn') renderSum(); });
$('save').addEventListener('click', saveOrder);
$('toCart').addEventListener('click', () => $('cartCard').scrollIntoView({ behavior: 'smooth' }));
$('newTrx').addEventListener('click', () => $('rcOv').classList.remove('on'));
$('printBtn').addEventListener('click', () => window.print());
$('close').addEventListener('click', closeShift);
$('lgGo').addEventListener('click', login);
$('lgPin').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('sync').addEventListener('click', () => sync(true));
$('syncNow').addEventListener('click', async () => { $('syncMsg').textContent = ''; await sync(true); $('syncMsg').textContent = S.lastErr || 'Berhasil tersambung.'; });
$('renameBtn').addEventListener('click', () => ownerAct('rename'));
$('unlinkBtn').addEventListener('click', () => ownerAct('unlink'));
$('wGo').addEventListener('click', () => {
  const c = parseLink($('wLink').value);
  if (!c) { $('wWarn').textContent = 'Link tidak dikenali. Salin ulang dari menu Readyku > Siapkan Kasir di Google Sheet.'; return; }
  S.conn = c; S.demo = false; S.cfg = null; save(); route();
});
$('wDemo').addEventListener('click', async () => { S.demo = true; S.conn = null; S.cfg = await demoCfg(); S.dev = { name: 'Perangkat contoh', code: 'DEMO', seq: 0 }; save(); route(); });
$('nGo').addEventListener('click', async () => {
  const name = $('nName').value.trim() || 'Kasir 1';
  if (!S.dev) { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; S.dev = { name, code: Array.from(crypto.getRandomValues(new Uint8Array(3)), x => A[x % A.length]).join(''), seq: 0 }; }
  else S.dev.name = name;
  $('nGo').disabled = true; $('nWarn').textContent = 'Mengambil menu dari Google Sheet…';
  try { const j = await call(); S.cfg = j.cfg; S.lastCfg = S.lastOk = Date.now(); S.lastErr = ''; save(); $('nWarn').textContent = ''; route(); }
  catch (e) { $('nWarn').textContent = e && e.message === 'kunci' ? 'Link tidak berlaku. Minta link baru ke owner.' : 'Gagal tersambung. Pastikan ada internet, lalu coba lagi.'; }
  finally { $('nGo').disabled = false; }
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; if (view === 'perangkat') renderDev(); });
$('installBtn').addEventListener('click', async () => { if (!installEv) return; installEv.prompt(); await installEv.userChoice; installEv = null; renderDev(); });
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

/* ---------------- mulai ---------------- */
function handleHash() {
  const fromHash = parseLink(location.hash);
  if (!fromHash) return false;
  const same = S.conn && S.conn.u === fromHash.u && S.conn.k === fromHash.k;
  if (!same) {
    // Pindah ke toko lain: data toko lama tidak boleh ikut terkirim ke toko baru.
    if (S.q.length) alertLater();
    Object.assign(S, { conn: fromHash, demo: false, cfg: null, shift: null, q: [], trx: [], dev: null, lastErr: '', lastCfg: 0 });
  }
  history.replaceState(null, '', location.pathname); save();
  return true;
}
handleHash();
window.addEventListener('hashchange', () => { if (handleHash()) { view = 'kasir'; route(); } });
function alertLater() { setTimeout(() => { const w = $('nWarn'); if (w) w.textContent = 'Perangkat ini sebelumnya tersambung ke toko lain. Pesanan lama yang belum terkirim tidak dipindahkan.'; }, 0); }
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
route();
setInterval(() => sync(), 15000);
setTimeout(() => sync(), 500);
window.__kasir = { state: () => S, sync };
})();
