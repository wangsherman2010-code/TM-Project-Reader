/* TM Project Viewer - bookshelf + phone-friendly reader for Toastmasters project PDFs.
 * Everything is stored on this device (IndexedDB). Nothing is uploaded. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- settings (text size, theme) ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('tmv.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tmv.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var SIZES = [16, 18, 20, 23, 26];
  var fsIdx = Math.min(SIZES.length - 1, Math.max(0, LS.get('fs', 1)));
  var theme = LS.get('theme', null);
  function isDark() { return theme ? theme === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  function applySettings() {
    var px = SIZES[fsIdx] + 'px';
    document.documentElement.style.setProperty('font-size', px, 'important');
    if (document.body) document.body.style.setProperty('font-size', px, 'important');
    if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', isDark() ? '#0b2a3d' : '#004165');
    LS.set('fs', fsIdx); LS.set('theme', theme);
    autosize();
  }

  /* ---------- IndexedDB ---------- */
  var DB = (function () {
    var p;
    function open() {
      return p || (p = new Promise(function (res, rej) {
        var r = indexedDB.open('tm-project-viewer', 1);
        r.onupgradeneeded = function () { var d = r.result; ['books', 'files', 'state'].forEach(function (n) { d.createObjectStore(n, { keyPath: 'id' }); }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      }));
    }
    function tx(store, mode, fn) {
      return open().then(function (d) {
        return new Promise(function (res, rej) {
          var t = d.transaction(store, mode), rq = fn(t.objectStore(store));
          t.oncomplete = function () { res(rq && rq.result); };
          t.onerror = t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (s, k) { return tx(s, 'readonly', function (o) { return o.get(k); }); },
      put: function (s, v) { return tx(s, 'readwrite', function (o) { return o.put(v); }); },
      del: function (s, k) { return tx(s, 'readwrite', function (o) { return o.delete(k); }); },
      all: function (s) { return tx(s, 'readonly', function (o) { return o.getAll(); }); }
    };
  })();

  /* ---------- state ---------- */
  var books = [], states = {}, cur = null, installEvt = null, canBack = false;
  var saveT = null;
  function saveState() { if (!cur) return; clearTimeout(saveT); saveT = setTimeout(saveNow, 300); }
  function saveNow() { clearTimeout(saveT); if (cur) DB.put('state', cur.state).catch(function () {}); }
  function loadShelf() {
    return Promise.all([DB.all('books'), DB.all('state')]).then(function (r) {
      books = r[0]; states = {}; r[1].forEach(function (s) { states[s.id] = s; });
    });
  }
  function sortedBooks() {
    return books.slice().sort(function (a, b) {
      var ta = (states[a.id] && states[a.id].openedAt) || a.addedAt, tb = (states[b.id] && states[b.id].openedAt) || b.addedAt;
      return tb - ta;
    });
  }
  function progressOf(b) {
    var s = states[b.id]; if (!s) return 0;
    return Math.round(Object.keys(s.seen || {}).length / b.sections.length * 100);
  }

  /* ---------- small UI helpers ---------- */
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="#004165" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5V19.5"/></svg>'
  };
  function toast(m) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
  function busy(msg) { var b = $('#busy'); if (msg == null) { b.hidden = true; return; } $('#busyTxt').textContent = msg; b.hidden = false; }
  function closeLayer() { $('#layer').innerHTML = ''; }
  function sheet(html, onMount) {
    var l = $('#layer'); l.innerHTML = '<div class="sheet" id="sh"><div class="box">' + html + '</div></div>';
    $('#sh').addEventListener('click', function (e) { if (e.target.id === 'sh') closeLayer(); });
    if (onMount) onMount($('#sh'));
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function autosize() { document.querySelectorAll('textarea[data-id],textarea[data-note]').forEach(grow); }
  function headerHtml(opts) {
    var left = opts.back ? '<button class="hbtn" data-act="shelf" aria-label="Back to bookshelf">' + ICON.back + '</button>' : '<div class="logo">' + ICON.book + '</div>';
    return '<div class="top-row">' + left + '<h1><small>' + esc(opts.kicker) + '</small><span>' + esc(opts.title) + '</span></h1>' +
      '<button class="hbtn" data-act="theme" aria-label="Switch light or dark mode">' + ICON.theme + '</button>' +
      '<button class="hbtn" data-act="fsdown" aria-label="Smaller text" style="font-size:13px">A−</button>' +
      '<button class="hbtn" data-act="fsup" aria-label="Larger text" style="font-size:19px">A+</button></div>';
  }
  function copyText(text) {
    var done = function () { toast('Copied — paste it into Notes, email or a doc'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { copySheet(text); }); else copySheet(text);
  }
  function copySheet(text) {
    sheet('<h3>Select all and copy</h3><textarea id="shTa" readonly></textarea><button class="btn block" id="shSel">Select all</button><button class="btn ghost block" data-act="closelayer">Close</button>', function () {
      var ta = $('#shTa'); ta.value = text;
      $('#shSel').onclick = function () { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); try { if (document.execCommand('copy')) toast('Copied'); } catch (e) {} };
    });
  }

  /* ---------- import ---------- */
  function sha1(buf) {
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-1', buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); });
    }
    var a = new Uint8Array(buf), h = 5381; for (var i = 0; i < a.length; i += 7) h = ((h << 5) + h + a[i]) | 0;
    return Promise.resolve('h' + (h >>> 0).toString(16) + '_' + a.length);
  }
  function prettyName(n) { return n.replace(/\.pdf$/i, '').replace(/^[0-9a-f]{6,10}-/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function makeCover(buf) {
    return pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise.then(function (doc) {
      return doc.getPage(1).then(function (page) {
        var vp0 = page.getViewport({ scale: 1 }), sc = 360 / vp0.width, vp = page.getViewport({ scale: sc });
        var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { var u = cv.toDataURL('image/jpeg', 0.72); try { doc.destroy(); } catch (e) {} return u; });
      });
    }).catch(function () { return ''; });
  }
  function importFiles(files) {
    var list = Array.prototype.slice.call(files), last = null;
    return list.reduce(function (p, f) { return p.then(function () { return importOne(f).then(function (id) { if (id) last = id; }); }); }, Promise.resolve()).then(function () {
      busy(null); return loadShelf();
    }).then(function () { if (list.length === 1 && last) openBook(last, 0, { push: true }); else showShelf({ replace: true }); });
  }
  function importOne(file) {
    busy('Opening ' + file.name + '…');
    return file.arrayBuffer().then(function (buf) {
      var head = new Uint8Array(buf.slice(0, 1024)), s = '';
      for (var i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
      if (s.indexOf('%PDF') < 0) { busy(null); toast('“' + file.name + '” is not a PDF file.'); return null; }
      return sha1(buf).then(function (id) {
        if (books.some(function (b) { return b.id === id; })) { busy(null); toast('Already on your bookshelf'); return id; }
        return TMParser.parsePdf(pdfjsLib, new Uint8Array(buf.slice(0)), function (n, t) { busy('Reading page ' + n + ' of ' + t + '…'); }).then(function (r) {
          busy('Making the cover…');
          return makeCover(buf).then(function (cover) {
            var book = { id: id, title: r.title || prettyName(file.name) || 'Untitled', subtitle: r.subtitle || '', name: file.name, size: file.size, addedAt: Date.now(),
              pages: r.pages, sections: r.sections, scanned: !!r.scanned, fieldCount: r.fieldCount, cover: cover };
            var st = { id: id, seen: {}, pos: 0, answers: {}, notes: {}, openedAt: Date.now() };
            return DB.put('files', { id: id, buf: buf }).then(function () { return DB.put('books', book); }).then(function () { return DB.put('state', st); }).then(function () {
              if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
              return id;
            });
          });
        });
      });
    }).catch(function (err) {
      busy(null);
      var msg = (err && err.name === 'PasswordException') ? 'That PDF is password-protected.' : 'Sorry, I could not read “' + file.name + '”.';
      toast(msg); console.error(err); return null;
    });
  }

  /* ---------- bookshelf ---------- */
  function showShelf(opts) {
    opts = opts || {};
    closeLayer(); saveNow(); cur = null; stopPages();
    if (!opts.fromPop) { try { (opts.replace ? history.replaceState : history.pushState).call(history, { v: 'shelf' }, '', location.pathname + location.search); } catch (e) {} }
    $('#top').innerHTML = headerHtml({ kicker: 'Toastmasters projects', title: 'TM Project Viewer' });
    var bs = sortedBooks(), h = '';
    h += '<div class="hero"><h2>My bookshelf</h2><p class="lead">' + (bs.length ? 'Tap a book to keep reading where you left off.' : 'Read Toastmasters project PDFs comfortably on your phone.') + '</p></div>';
    h += installBannerHtml();
    if (!bs.length) {
      h += '<div class="card empty"><div class="big">📚</div><h3 style="margin:.6rem 0 0;color:var(--head)">Your bookshelf is empty</h3>' +
        '<ol class="steps"><li><span>Download a project PDF (for example from Toastmasters Base Camp) to your phone.</span></li>' +
        '<li><span>Tap <b>Add PDF</b> below and choose it.</span></li>' +
        '<li><span>Read it section by section, fill in the boxes, and come back any time — it stays on this shelf.</span></li></ol></div>';
    } else {
      h += '<div class="shelf">' + bs.map(function (b) {
        var pr = progressOf(b), s = states[b.id] || {};
        return '<div class="book-wrap" style="position:relative"><button class="book" data-open="' + esc(b.id) + '" style="width:100%">' +
          (b.cover ? '<img class="cover" alt="" src="' + b.cover + '">' : '<div class="cover ph">📘</div>') +
          '<div class="info"><div class="t">' + esc(b.title) + '</div><div class="m">' + b.sections.length + ' sections · ' + pr + '% read</div><div class="progress"><i style="width:' + pr + '%"></i></div></div></button>' +
          '<button class="menu" data-menu="' + esc(b.id) + '" aria-label="Options for ' + esc(b.title) + '">⋯</button></div>';
      }).join('') + '</div>';
    }
    h += '<div class="foot">Your PDFs and everything you type are stored only on this device, in this browser. Nothing is uploaded. ' +
      'Unofficial tool, not affiliated with Toastmasters International. Project documents belong to their owners.</div>';
    $('#view').innerHTML = h;
    $('#bar').innerHTML = '<div class="bar"><div class="bar-in"><label class="btn block" style="cursor:pointer">＋ Add PDF<input type="file" id="pick" accept="application/pdf,.pdf" multiple hidden></label></div></div>';
    $('#pick').addEventListener('change', function (e) { var f = e.target.files; if (f && f.length) importFiles(f); e.target.value = ''; });
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }
  function installBannerHtml() {
    if (window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
    if (installEvt) return '<div class="banner"><div style="flex:1"><b>Install this app</b><div class="small">Add it to your home screen to open it like any other app, even offline.</div></div><button class="btn sm" data-act="install">Install</button></div>';
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (ios && !LS.get('iosTip', false)) return '<div class="banner"><div style="flex:1" class="small"><b>Install on iPhone/iPad:</b> tap the Share button, then <b>Add to Home Screen</b>.</div><button class="x" data-act="hideios" aria-label="Dismiss">×</button></div>';
    return '';
  }
  function bookMenu(id) {
    var b = books.filter(function (x) { return x.id === id; })[0]; if (!b) return;
    sheet('<h3>' + esc(b.title) + '</h3><button class="btn block" data-open="' + esc(id) + '">Open</button>' +
      '<button class="btn ghost block" data-rename="' + esc(id) + '">Rename</button>' +
      '<button class="btn ghost block" data-pdf="' + esc(id) + '">View original PDF pages</button>' +
      '<button class="btn danger block" data-remove="' + esc(id) + '">Remove from bookshelf</button>' +
      '<button class="btn ghost block" data-act="closelayer">Cancel</button>');
  }
  function renameSheet(id) {
    var b = books.filter(function (x) { return x.id === id; })[0]; if (!b) return;
    sheet('<h3>Rename</h3><input type="text" id="rn" value="' + esc(b.title) + '"><button class="btn block" id="rnOk">Save</button><button class="btn ghost block" data-act="closelayer">Cancel</button>', function () {
      $('#rnOk').onclick = function () { var v = $('#rn').value.trim(); if (!v) return; b.title = v; DB.put('books', b).then(function () { closeLayer(); showShelf({ replace: true, keepScroll: true }); }); };
    });
  }
  function removeSheet(id) {
    var b = books.filter(function (x) { return x.id === id; })[0]; if (!b) return;
    sheet('<h3>Remove “' + esc(b.title) + '”?</h3><p class="lead" style="margin:0">This deletes the PDF, your answers and your notes from this device. This cannot be undone.</p>' +
      '<button class="btn danger block" id="rmOk">Yes, remove it</button><button class="btn ghost block" data-act="closelayer">Keep it</button>', function () {
      $('#rmOk').onclick = function () {
        Promise.all([DB.del('books', id), DB.del('files', id), DB.del('state', id)]).then(loadShelf).then(function () { closeLayer(); showShelf({ replace: true, keepScroll: true }); toast('Removed'); });
      };
    });
  }

  /* ---------- reader ---------- */
  function openBook(id, idx, opts) {
    opts = opts || {};
    var b = books.filter(function (x) { return x.id === id; })[0];
    if (!b) { showShelf({ replace: true }); return Promise.resolve(); }
    return DB.get('state', id).then(function (st) {
      st = st || { id: id, seen: {}, pos: 0, answers: {}, notes: {} };
      if (idx == null) idx = st.pos || 0;
      idx = Math.max(0, Math.min(b.sections.length - 1, idx));
      st.pos = idx; st.seen[idx] = 1; st.openedAt = Date.now();
      cur = { book: b, state: st, idx: idx }; states[id] = st; if (opts.push) canBack = true;
      saveNow(); closeLayer();
      try { var s = { v: 'read', id: id, idx: idx }; if (opts.push) history.pushState(s, '', location.pathname + location.search); else if (!opts.fromPop) history.replaceState(s, '', location.pathname + location.search); } catch (e) {}
      renderReader();
    });
  }
  function gotoSection(i) {
    if (!cur) return; var n = cur.book.sections.length;
    if (i < 0 || i >= n) return;
    cur.idx = i; cur.state.pos = i; cur.state.seen[i] = 1; saveNow();
    try { history.replaceState({ v: 'read', id: cur.book.id, idx: i }, '', location.pathname + location.search); } catch (e) {}
    closeLayer(); renderReader();
  }
  function runsHtml(runs) { return (runs || []).map(function (r) { return r.b ? '<b>' + esc(r.t) + '</b>' : esc(r.t); }).join(''); }
  function blocksHtml(blocks) {
    var st = cur.state, out = '', i = 0;
    while (i < blocks.length) {
      var b = blocks[i];
      if (b.t === 'h1' || b.t === 'h2') { out += '<h3 class="bh2">' + esc(runsText(b)) + '</h3>'; i++; }
      else if (b.t === 'h3') { out += '<h4 class="bh3">' + esc(runsText(b)) + '</h4>'; i++; }
      else if (b.t === 'p') { out += '<p>' + runsHtml(b.runs) + '</p>'; i++; }
      else if (b.t === 'li') {
        var scored = !!b.m, items = '';
        while (i < blocks.length && blocks[i].t === 'li' && !!blocks[i].m === scored) { items += '<li' + (scored ? ' data-m="' + esc(blocks[i].m) + '"' : '') + '><span>' + runsHtml(blocks[i].runs) + '</span></li>'; i++; }
        out += '<ul class="' + (scored ? 'scores' : 'dots') + '">' + items + '</ul>';
      }
      else if (b.t === 'check') {
        var done = !!st.answers[b.id], hasTxt = b.runs && b.runs.length, nxt = blocks[i + 1];
        if (!hasTxt && nxt && nxt.t === 'field') {
          out += '<div class="chk ' + (done ? 'done' : '') + '"><input type="checkbox" data-chk="' + esc(b.id) + '" aria-label="Done" ' + (done ? 'checked' : '') + '><div class="txt" style="padding:0;flex:1">' +
            '<textarea class="one" data-id="' + esc(nxt.id) + '" placeholder="Type here…" aria-label="Your own task">' + esc(st.answers[nxt.id] != null ? st.answers[nxt.id] : (nxt.v || '')) + '</textarea></div></div>';
          i += 2;
        } else {
          out += '<label class="chk ' + (done ? 'done' : '') + '"><input type="checkbox" data-chk="' + esc(b.id) + '" ' + (done ? 'checked' : '') + '><span class="txt">' + (hasTxt ? runsHtml(b.runs) : 'Done') + '</span></label>'; i++;
        }
      }
      else if (b.t === 'field') {
        var val = st.answers[b.id] != null ? st.answers[b.id] : (b.v || '');
        out += '<div class="field"><textarea class="' + (b.ml ? '' : 'one') + '" data-id="' + esc(b.id) + '" placeholder="Type your answer here…" aria-label="' + esc(b.label || 'Your answer') + '">' + esc(val) + '</textarea></div>'; i++;
      }
      else i++;
    }
    return out;
  }
  function runsText(b) { return (b.runs || []).map(function (r) { return r.t; }).join(''); }
  var pageToken = null;
  function stopPages() { if (pageToken) pageToken.cancel = true; pageToken = null; }
  function renderReader() {
    stopPages();
    var b = cur.book, i = cur.idx, n = b.sections.length, s = b.sections[i];
    $('#top').innerHTML = headerHtml({ back: true, kicker: 'Section ' + (i + 1) + ' of ' + n, title: b.title });
    var pct = Math.round((i + 1) / n * 100), pgTxt = s.pageStart === s.pageEnd ? 'PDF page ' + s.pageStart : 'PDF pages ' + s.pageStart + '–' + s.pageEnd;
    var h = '<div class="crumb"><button class="btn ghost sm" data-act="toc">☰ Contents</button><span>' + (i + 1) + ' of ' + n + '</span></div>' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<h2 style="margin-top:14px">' + esc(s.title) + '</h2>' +
      '<div class="pgtag">' + pgTxt + ' · <button class="linkbtn" data-act="orig">View original page' + (s.pageStart === s.pageEnd ? '' : 's') + '</button></div>';
    if (b.scanned || !s.blocks.length) {
      h += '<p class="lead">This part has no selectable text, so here is the original page.</p><div class="pages" id="inlinePages"></div>';
    } else h += blocksHtml(s.blocks);
    h += '<div class="notes"><div class="field"><label for="nt">My notes for this section</label><textarea data-note="' + i + '" id="nt" placeholder="Jot down your thoughts…">' + esc(cur.state.notes[i] || '') + '</textarea></div></div>';
    $('#view').innerHTML = h;
    $('#bar').innerHTML = '<div class="bar"><div class="bar-in"><button class="btn ghost" data-act="prev" ' + (i === 0 ? 'disabled' : '') + '>← Back</button>' +
      '<button class="btn ghost mid" data-act="toc">' + (i + 1) + ' / ' + n + ' ☰</button>' +
      '<button class="btn" data-act="next" ' + (i === n - 1 ? 'disabled' : '') + '>Next →</button></div></div>';
    window.scrollTo(0, 0); autosize();
    var ip = $('#inlinePages'); if (ip) { pageToken = { cancel: false, zoom: 1 }; renderPages(ip, b.id, s.pageStart, s.pageEnd, pageToken).catch(function () {}); }
  }
  function tocSheet() {
    var b = cur.book, st = cur.state;
    var list = b.sections.map(function (s, k) {
      return '<button class="toc ' + (st.seen[k] ? 'seen ' : '') + (k === cur.idx ? 'now' : '') + '" data-goto="' + k + '"><span class="num">' + (st.seen[k] ? '✓' : (k + 1)) + '</span><span><div class="t">' + esc(s.title) + '</div><div class="s">' +
        (s.pageStart === s.pageEnd ? 'page ' + s.pageStart : 'pages ' + s.pageStart + '–' + s.pageEnd) + '</div></span></button>';
    }).join('');
    sheet('<h3>' + esc(b.title) + '</h3><div class="list">' + list + '</div>' +
      '<div style="display:flex;gap:8px"><button class="btn ghost sm" style="flex:1" data-act="export">Copy my answers</button><button class="btn ghost sm" style="flex:1" data-act="origall">Original PDF</button></div>' +
      '<button class="btn ghost block" data-act="shelf">Back to bookshelf</button>', function () {
      var now = $('.toc.now'); if (now) now.scrollIntoView({ block: 'center' });
    });
  }
  function exportText() {
    var b = cur.book, st = cur.state, t = b.title + '\nMy answers and notes\n\n';
    b.sections.forEach(function (s, k) {
      var lines = [], lastHead = '';
      s.blocks.forEach(function (bl) {
        if (bl.t === 'h2' || bl.t === 'h3') lastHead = runsText(bl);
        else if (bl.t === 'field') { var v = (st.answers[bl.id] != null ? st.answers[bl.id] : bl.v) || ''; if (String(v).trim()) lines.push((bl.label || lastHead || 'Answer') + ':\n' + v); }
        else if (bl.t === 'check' && st.answers[bl.id]) lines.push('[x] ' + (bl.runs && bl.runs.length ? runsText(bl) : 'Done'));
      });
      if (st.notes[k] && st.notes[k].trim()) lines.push('Notes:\n' + st.notes[k]);
      if (lines.length) t += '== ' + s.title + ' ==\n' + lines.join('\n\n') + '\n\n';
    });
    return t.trim() === (b.title + '\nMy answers and notes').trim() ? t + '(nothing written yet)' : t;
  }

  /* ---------- original PDF pages ---------- */
  var docCache = {};
  function getPdfDoc(id) {
    if (docCache.id === id && docCache.doc) return Promise.resolve(docCache.doc);
    if (docCache.doc) { try { docCache.doc.destroy(); } catch (e) {} docCache = {}; }
    return DB.get('files', id).then(function (f) {
      return pdfjsLib.getDocument({ data: new Uint8Array(f.buf.slice(0)) }).promise;
    }).then(function (doc) { docCache = { id: id, doc: doc }; return doc; });
  }
  function renderPages(el, id, from, to, token) {
    el.innerHTML = '';
    return getPdfDoc(id).then(function (doc) {
      var chain = Promise.resolve();
      for (var n = from; n <= to; n++) (function (n) {
        chain = chain.then(function () {
          if (token.cancel) return;
          var lab = document.createElement('div'); lab.className = 'pglab'; lab.textContent = 'PDF page ' + n;
          var wrap = document.createElement('div'); wrap.className = 'pgwrap'; var cv = document.createElement('canvas'); wrap.appendChild(cv);
          el.appendChild(lab); el.appendChild(wrap);
          return doc.getPage(n).then(function (page) {
            var vp0 = page.getViewport({ scale: 1 }), cssW = Math.max(200, el.clientWidth) * token.zoom;
            var sc = Math.min(3.2, (cssW / vp0.width) * (window.devicePixelRatio || 1)), vp = page.getViewport({ scale: sc });
            cv.width = vp.width; cv.height = vp.height; cv.style.width = cssW + 'px';
            var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise;
          });
        });
      })(n);
      return chain;
    });
  }
  function showOriginal(id, from, to) {
    var tok = { cancel: false, zoom: 1 };
    var l = $('#layer');
    l.innerHTML = '<div class="ov" id="ov"><div class="oh"><button class="hbtn" data-act="closeov" aria-label="Close">' + ICON.back + '</button><b>Original PDF · ' + (from === to ? 'page ' + from : 'pages ' + from + '–' + to) +
      '</b><button class="hbtn" data-act="zout" aria-label="Zoom out" style="font-size:20px">−</button><button class="hbtn" data-act="zin" aria-label="Zoom in" style="font-size:20px">+</button></div><div class="ob"><div id="ovp"></div></div></div>';
    var go = function () { tok.cancel = true; tok = { cancel: false, zoom: tok.zoom }; ovTok = tok; renderPages($('#ovp'), id, from, to, tok).catch(function () { $('#ovp').innerHTML = '<p class="lead">Could not load the PDF pages.</p>'; }); };
    var ovTok = tok; ovZoom = function (d) { tok.zoom = Math.max(1, Math.min(3, tok.zoom + d)); go(); }; ovClose = function () { tok.cancel = true; closeLayer(); };
    go();
  }
  var ovZoom = function () {}, ovClose = function () {};

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target, el;
    if ((el = t.closest('[data-open]'))) { e.preventDefault(); openBook(el.dataset.open, null, { push: !cur }); return; }
    if ((el = t.closest('[data-menu]'))) { bookMenu(el.dataset.menu); return; }
    if ((el = t.closest('[data-rename]'))) { renameSheet(el.dataset.rename); return; }
    if ((el = t.closest('[data-remove]'))) { removeSheet(el.dataset.remove); return; }
    if ((el = t.closest('[data-pdf]'))) { var bk = books.filter(function (x) { return x.id === el.dataset.pdf; })[0]; if (bk) showOriginal(bk.id, 1, bk.pages); return; }
    if ((el = t.closest('[data-goto]'))) { gotoSection(+el.dataset.goto); return; }
    if ((el = t.closest('[data-act]'))) {
      var a = el.dataset.act;
      if (a === 'theme') { theme = isDark() ? 'light' : 'dark'; applySettings(); }
      else if (a === 'fsup') { fsIdx = Math.min(SIZES.length - 1, fsIdx + 1); applySettings(); }
      else if (a === 'fsdown') { fsIdx = Math.max(0, fsIdx - 1); applySettings(); }
      else if (a === 'shelf') { closeLayer(); if (canBack) { canBack = false; history.back(); } else showShelf({ replace: true }); }
      else if (a === 'closelayer') closeLayer();
      else if (a === 'toc') tocSheet();
      else if (a === 'next') { gotoSection(cur.idx + 1); }
      else if (a === 'prev') { gotoSection(cur.idx - 1); }
      else if (a === 'orig') { var s = cur.book.sections[cur.idx]; showOriginal(cur.book.id, s.pageStart, s.pageEnd); }
      else if (a === 'origall') { showOriginal(cur.book.id, 1, cur.book.pages); }
      else if (a === 'closeov') ovClose();
      else if (a === 'zin') ovZoom(0.5);
      else if (a === 'zout') ovZoom(-0.5);
      else if (a === 'export') { closeLayer(); copyText(exportText()); }
      else if (a === 'install') { if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(function () { installEvt = null; showShelf({ replace: true, keepScroll: true }); }); } }
      else if (a === 'hideios') { LS.set('iosTip', true); showShelf({ replace: true, keepScroll: true }); }
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches && t.matches('textarea[data-id]') && cur) { cur.state.answers[t.dataset.id] = t.value; saveState(); grow(t); }
    else if (t.matches && t.matches('textarea[data-note]') && cur) { cur.state.notes[t.dataset.note] = t.value; saveState(); grow(t); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('input[data-chk]') && cur) {
      cur.state.answers[t.dataset.chk] = t.checked; saveState();
      var row = t.closest('.chk'); if (row) row.classList.toggle('done', t.checked);
    }
  });
  // swipe left / right to change section
  var sx = 0, sy = 0, st0 = 0;
  document.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) { sx = 0; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now(); }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!sx || !cur || $('#layer').innerHTML || (window.visualViewport && window.visualViewport.scale > 1.05)) return;
    var tg = e.target; if (tg.closest && tg.closest('textarea,input,canvas')) { sx = 0; return; }
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 45 && Date.now() - st0 < 600) gotoSection(cur.idx + (dx < 0 ? 1 : -1));
    sx = 0;
  }, { passive: true });
  window.addEventListener('popstate', function (e) {
    var s = e.state;
    if ($('#layer').innerHTML) { closeLayer(); }
    if (s && s.v === 'read') openBook(s.id, s.idx, { fromPop: true }); else { canBack = false; showShelf({ fromPop: true }); }
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (!cur && !$('#layer').innerHTML) showShelf({ replace: true, keepScroll: true }); });
  window.addEventListener('appinstalled', function () { installEvt = null; if (!cur) showShelf({ replace: true, keepScroll: true }); toast('Installed'); });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
  window.addEventListener('resize', autosize);

  /* ---------- start ---------- */
  if (typeof pdfjsLib === 'undefined') { $('#view').innerHTML = '<div class="card"><h3>The PDF engine did not load</h3><p>Check your internet connection and reload. If it keeps happening, update Chrome and Android System WebView.</p></div>'; return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  applySettings();
  loadShelf().then(function () {
    var s = history.state;
    if (s && s.v === 'read' && books.some(function (b) { return b.id === s.id; })) return openBook(s.id, s.idx, { fromPop: true });
    showShelf({ replace: true });
  }).catch(function (err) {
    console.error(err);
    $('#top').innerHTML = headerHtml({ kicker: 'Toastmasters projects', title: 'TM Project Viewer' });
    $('#view').innerHTML = '<div class="card"><h3>Storage is not available</h3><p>This browser is blocking local storage (private mode?). Open the app in a normal browser window so your bookshelf can be saved.</p></div>';
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
