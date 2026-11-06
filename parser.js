/* TM Project Viewer - PDF -> readable sections.
 * Works in the browser (global TMParser) and in Node (module.exports) so it can be tested headlessly.
 * Everything runs on the device; PDFs are never uploaded anywhere. */
(function (root) {
  'use strict';

  var TERMINAL = /[.!?:;)"”'’\]]$/;
  var BULLET = /^[•●▪■◦○‣⁃·*]\s*/;
  var DASHBUL = /^[-–—]\s+/;
  var SCOREROW = /^([1-9])\s*[–—-]\s+/;
  var PAGENUM = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

  function weightOf(n) {
    n = (n || '').toLowerCase();
    if (/italic|oblique/.test(n) && !/bold/.test(n)) return 0;
    if (/black|heavy|extrabold|ultrabold/.test(n)) return 4;
    if (/semibold|demibold|demi/.test(n)) return 2.5;
    if (/bold/.test(n)) return 3;
    if (/medium/.test(n)) return 2;
    return 0;
  }
  function r05(x) { return Math.round(x * 2) / 2; }
  function clean(s) { return s.replace(/[   ]/g, ' ').replace(/[​­﻿]/g, ''); }

  /* ---------- column detection ---------- */
  function findSplit(its, W) {
    if (its.length < 12) return null;
    var rows = {}, lines = 0;
    its.forEach(function (o) { var k = Math.round(o.y / Math.max(o.size * 0.6, 1)); if (!rows[k]) { rows[k] = []; lines++; } rows[k].push(o); });
    var rowList = Object.keys(rows).map(function (k) { return rows[k]; });
    var n = its.length, cands = [], min = 1e9;
    for (var c = W * 0.3; c <= W * 0.7; c += 3) {
      var cross = 0, l = 0, r = 0, both = 0;
      rowList.forEach(function (row) {
        var hl = false, hr = false;
        row.forEach(function (o) {
          if (o.x < c - 1 && o.x + o.w > c + 1) cross++;
          else if (o.x + o.w <= c + 1) { l++; hl = true; }
          else { r++; hr = true; }
        });
        if (hl && hr) both++;
      });
      if (l >= n * 0.15 && r >= n * 0.15 && both >= 5) { cands.push({ c: c, cross: cross }); if (cross < min) min = cross; }
    }
    if (!cands.length || min > Math.max(2, lines * 0.25)) return null;
    var best = cands.filter(function (x) { return x.cross === min; });
    return best[Math.floor(best.length / 2)].c;
  }

  /* ---------- one page -> ordered atoms (text lines + form fields) ---------- */
  async function pageAtoms(page, pn) {
    var vp = page.getViewport({ scale: 1 }), W = vp.width, H = vp.height;
    try { await page.getOperatorList(); } catch (e) {}
    var tc = await page.getTextContent();
    var fcache = {};
    function fname(id) {
      if (id in fcache) return fcache[id];
      var n = '';
      try { var f = page.commonObjs.get(id); n = (f && f.name) || ''; } catch (e) {}
      if (!n) { try { n = (tc.styles && tc.styles[id] && tc.styles[id].fontFamily) || ''; } catch (e) {} }
      return (fcache[id] = n.replace(/^[A-Z]{6}\+/, ''));
    }
    var its = [];
    tc.items.forEach(function (it) {
      if (!it.str) return;
      var t = it.transform; if (!t) return;
      if (Math.abs(t[1]) > Math.abs(t[0]) * 0.5) return; // rotated
      var size = Math.hypot(t[0], t[1]) || Math.abs(t[3]) || it.height || 10;
      var s = clean(it.str);
      if (!s.trim()) return;
      its.push({ s: s, x: t[4], y: t[5], w: it.width || 0, size: size, wt: weightOf(fname(it.fontName)), fn: fname(it.fontName) });
    });

    var fields = [];
    try {
      var ann = await page.getAnnotations();
      ann.forEach(function (a, i) {
        if (a.subtype !== 'Widget' || !a.rect) return;
        var type = null;
        if (a.fieldType === 'Tx' || a.fieldType === 'Ch') type = 'field';
        else if (a.fieldType === 'Btn' && a.checkBox) type = 'check';
        if (!type) return;
        var r = a.rect, x1 = Math.min(r[0], r[2]), x2 = Math.max(r[0], r[2]), y1 = Math.min(r[1], r[3]), y2 = Math.max(r[1], r[3]);
        if (x2 - x1 < 4 || y2 - y1 < 4) return;
        var dv = a.fieldValue; if (Array.isArray(dv)) dv = dv.join(', ');
        fields.push({ kind: type, id: 'f' + pn + '_' + (a.id || i) , x1: x1, x2: x2, y1: y1, y2: y2, ml: !!a.multiLine || (y2 - y1) > 30, v: (typeof dv === 'string' && dv !== 'Off' && dv !== '') ? dv : '', fname: a.fieldName || '' });
      });
    } catch (e) {}

    // ordering
    var split = findSplit(its, W);
    var groups = {};
    function tolOf(o) { return 0.5 * (o.size || 10); }
    var fullRep = [];
    if (split) {
      its.forEach(function (o) { o.full = o.x < split - 1 && o.x + o.w > split + 1; o.col = o.full ? 2 : ((o.x + o.w / 2) < split ? 0 : 1); });
      fields.forEach(function (f) { f.full = (f.x2 - f.x1) > 0.6 * W || (f.x1 < split - 1 && f.x2 > split + 1); f.col = f.full ? 2 : (((f.x1 + f.x2) / 2) < split ? 0 : 1); });
      // two-column handling only applies inside the vertical zone where the right column exists
      var rights = its.filter(function (o) { return o.col === 1 && o.y > H * 0.10 && o.y < H * 0.95; });
      if (rights.length) {
        var zTop = Math.max.apply(null, rights.map(function (o) { return o.y; }));
        var zBot = Math.min.apply(null, rights.map(function (o) { return o.y; }));
        var lefts = its.filter(function (o) { return o.col === 0; }).sort(function (a, b) { return b.y - a.y; });
        var inside = lefts.filter(function (o) { return o.y <= zTop + 0.5 * o.size && o.y >= zBot - 0.5 * o.size; });
        var keep = {};
        inside.forEach(function (o) { keep[lefts.indexOf(o)] = 1; });
        var lowIn = inside.length ? inside[inside.length - 1] : null, topIn = inside.length ? inside[0] : null;
        var prev = lowIn || { y: zBot, size: 10 };
        lefts.forEach(function (o, i) { if (o.y < zBot - 0.5 * o.size && prev.y - o.y <= 2.6 * Math.min(o.size, prev.size)) { keep[i] = 1; prev = o; } });
        var prevU = topIn || { y: zTop, size: 10 };
        for (var li = lefts.length - 1; li >= 0; li--) { var lo = lefts[li]; if (lo.y > zTop + 0.5 * lo.size && lo.y - prevU.y <= 2.6 * Math.min(lo.size, prevU.size) && !keep[li]) { keep[li] = 1; prevU = lo; } }
        lefts.forEach(function (o, i) { if (!keep[i]) o.col = 2; });
        fields.forEach(function (f) { if (f.col !== 2 && (f.y2 > zTop + 14 || f.y2 < zBot - 8)) f.col = 2; });
      }
      var ys = its.filter(function (o) { return o.col === 2; }).map(function (o) { return o.y; }).concat(fields.filter(function (f) { return f.col === 2; }).map(function (f) { return f.y2; }));
      ys.sort(function (a, b) { return b - a; });
      ys.forEach(function (y) { if (!fullRep.length || Math.abs(fullRep[fullRep.length - 1] - y) > 6) fullRep.push(y); });
    } else {
      its.forEach(function (o) { o.col = 0; }); fields.forEach(function (f) { f.col = 0; });
    }
    function band(y, tol) { var n = 0; for (var i = 0; i < fullRep.length; i++) if (fullRep[i] > y + tol) n++; return n; }
    its.forEach(function (o) { var k = band(o.y, tolOf(o)) * 4 + o.col; (groups[k] = groups[k] || { its: [], fields: [] }).its.push(o); });
    fields.forEach(function (f) { var k = band(f.y2, 6) * 4 + f.col; (groups[k] = groups[k] || { its: [], fields: [] }).fields.push(f); });

    var atoms = [];
    Object.keys(groups).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
      var g = groups[k], seq = [];
      g.its.sort(function (a, b) { return b.y - a.y; });
      var cl = [];
      g.its.forEach(function (o) {
        var last = cl[cl.length - 1];
        if (last && Math.abs(last.y - o.y) <= 0.45 * Math.max(o.size, last.size)) { last.items.push(o); last.size = Math.max(last.size, o.size); }
        else cl.push({ y: o.y, size: o.size, items: [o] });
      });
      cl.forEach(function (c) { seq.push({ y: c.y, cl: c }); });
      g.fields.forEach(function (f) { seq.push({ y: f.y2, f: f }); });
      seq.sort(function (a, b) { return b.y - a.y; });
      seq.forEach(function (e) {
        if (e.f) { var f = e.f; f.page = pn; f.group = k; atoms.push(f); }
        else atoms.push(buildLine(e.cl, pn, k, H));
      });
    });
    return { atoms: atoms, W: W, H: H };
  }

  function buildLine(c, pn, group, H) {
    var items = c.items.sort(function (a, b) { return a.x - b.x; });
    var runs = [], prevEnd = null, text = '', chars = 0, boldChars = 0, maxSize = 0, fnChars = {};
    items.forEach(function (it) {
      var s = it.s;
      if (prevEnd != null) {
        var gap = it.x - prevEnd;
        if (gap > it.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(s)) { s = ' ' + s; }
      }
      var b = it.wt >= 2;
      var last = runs[runs.length - 1];
      if (last && last.b === b) last.t += s; else runs.push({ t: s, b: b });
      text += s; prevEnd = it.x + it.w;
      var n = it.s.trim().length; chars += n; if (b) boldChars += n;
      if (it.size > maxSize) maxSize = it.size;
      fnChars[it.fn] = (fnChars[it.fn] || 0) + n;
    });
    var x2 = items.length ? items[items.length - 1].x + items[items.length - 1].w : 0;
    return { kind: 'line', runs: runs, text: text.trim(), size: maxSize, x: items[0].x, x2: x2, y: c.y, page: pn, group: group,
      boldRatio: chars ? boldChars / chars : 0, chars: chars, margin: (c.y < H * 0.10 || c.y > H * 0.95) };
  }

  /* ---------- whole document ---------- */
  async function parsePdf(pdfjsLib, data, onProgress) {
    var doc = await pdfjsLib.getDocument({ data: data, disableFontFace: true, useSystemFonts: false }).promise;
    var meta = {}; try { meta = (await doc.getMetadata()).info || {}; } catch (e) {}
    var pages = [], total = doc.numPages;
    for (var pn = 1; pn <= total; pn++) {
      if (onProgress) onProgress(pn, total);
      var page = await doc.getPage(pn);
      pages.push(await pageAtoms(page, pn));
      page.cleanup && page.cleanup();
    }
    var result = structure(pages, total, meta);
    result.pages = total;
    try { doc.destroy(); } catch (e) {}
    return result;
  }

  function structure(pages, total, meta) {
    // 1. remove page numbers and repeating headers/footers
    var seen = {};
    pages.forEach(function (p) {
      var counted = {};
      p.atoms.forEach(function (a) {
        if (a.kind !== 'line' || !a.margin) return;
        var k = a.text.toLowerCase();
        if (!counted[k]) { counted[k] = 1; seen[k] = (seen[k] || 0) + 1; }
      });
    });
    var rep = Math.max(2, Math.ceil(total * 0.3));
    pages.forEach(function (p) {
      p.atoms = p.atoms.filter(function (a) {
        if (a.kind !== 'line' || !a.margin) return true;
        if (PAGENUM.test(a.text)) return false;
        var k = a.text.toLowerCase();
        return !(total > 2 && seen[k] >= rep && a.text.length > 3);
      });
    });

    // 2. title from the first page (largest text)
    var title = '', subtitle = '';
    var first = pages[0] ? pages[0].atoms.filter(function (a) { return a.kind === 'line' && !a.margin; }) : [];
    if (first.length) {
      var mx = Math.max.apply(null, first.map(function (l) { return l.size; }));
      title = first.filter(function (l) { return l.size >= mx * 0.9; }).map(function (l) { return l.text; }).join(' ');
      var rest = first.filter(function (l) { return l.size < mx * 0.9 && l.size >= 12; });
      if (rest.length && first.length <= 8) subtitle = rest[0].text;
    }
    if (!title && meta.Title) title = meta.Title;

    // 3. drop table-of-contents pages and near-empty pages
    var kept = [];
    pages.forEach(function (p, i) {
      var lines = p.atoms.filter(function (a) { return a.kind === 'line'; });
      var chars = lines.reduce(function (s, l) { return s + l.chars; }, 0);
      var isToc = lines.slice(0, 4).some(function (l) { return /^(table of )?contents$/i.test(l.text); });
      var hasFields = p.atoms.some(function (a) { return a.kind !== 'line'; });
      if (isToc) return;
      if (total > 1 && chars < 30 && !hasFields) return;
      kept.push(p);
    });
    // a cover page (very little text) only supplies the title; it must not skew heading sizes
    if (kept.length > 2 && kept[0] === pages[0]) {
      var c0 = kept[0].atoms.filter(function (a) { return a.kind === 'line'; }).reduce(function (s, l) { return s + l.chars; }, 0);
      if (c0 < 150 && !kept[0].atoms.some(function (a) { return a.kind !== 'line'; })) kept.shift();
    }
    var allLines = [];
    kept.forEach(function (p) { p.atoms.forEach(function (a) { if (a.kind === 'line') allLines.push(a); }); });
    var totalChars = allLines.reduce(function (s, l) { return s + l.chars; }, 0);
    var fieldCount = 0; pages.forEach(function (p) { p.atoms.forEach(function (a) { if (a.kind !== 'line') fieldCount++; }); });

    if (totalChars < 150) { // scanned / image-only PDF
      var secs = [];
      for (var i = 1; i <= total; i++) secs.push({ title: 'Page ' + i, pageStart: i, pageEnd: i, blocks: [] });
      return { title: title, subtitle: subtitle, sections: secs, scanned: true, fieldCount: 0, chars: totalChars };
    }

    // 4. body size / style statistics
    var sizeChars = {}, boldAll = 0, allChars = 0;
    allLines.forEach(function (l) { var k = r05(l.size); sizeChars[k] = (sizeChars[k] || 0) + l.chars; boldAll += l.boldRatio * l.chars; allChars += l.chars; });
    var bodySize = 10, bestN = -1;
    Object.keys(sizeChars).forEach(function (k) { if (sizeChars[k] > bestN) { bestN = sizeChars[k]; bodySize = +k; } });
    var noBold = allChars && boldAll / allChars > 0.6;

    // 5. headings
    function isBulletLine(l) { var t = l.text; return BULLET.test(t) || DASHBUL.test(t); }
    var sizeCands = {};
    allLines.forEach(function (l) {
      l.cand = null;
      if (isBulletLine(l) || l.chars < 2) return;
      if (l.size >= bodySize * 1.18 && l.text.length <= 140) { l.cand = 'size'; sizeCands[r05(l.size)] = 1; }
      else if (!noBold && l.boldRatio >= 0.85 && l.text.length <= 70 && !/[.;,]$/.test(l.text) && !/^\d+$/.test(l.text) && !SCOREROW.test(l.text)) l.cand = 'bold';
    });
    var sizeRank = Object.keys(sizeCands).map(Number).sort(function (a, b) { return b - a; });
    allLines.forEach(function (l) {
      if (l.cand === 'size') l.level = Math.min(3, sizeRank.indexOf(r05(l.size)) + 1);
      else if (l.cand === 'bold') l.level = 3;
    });

    // 6. blocks
    var blocks = [], cur = null, pendingCheck = null;
    function mergeRuns(runs) {
      var out = [];
      runs.forEach(function (r) { if (!r.t) return; var last = out[out.length - 1]; if (last && last.b === r.b) last.t += r.t; else out.push({ t: r.t, b: r.b }); });
      return out;
    }
    function textOf(runs) { return runs.map(function (r) { return r.t; }).join('').replace(/\s+/g, ' ').trim(); }
    function flush() {
      if (!cur) return;
      var runs = mergeRuns(cur.runs);
      if (runs.length) { runs[0].t = runs[0].t.replace(/^\s+/, ''); runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, ''); }
      var txt = textOf(runs);
      if (txt) {
        if (cur.check) { cur.check.runs = runs; }
        else { var b = { t: cur.t, runs: runs, pg: cur.page }; if (cur.m) b.m = cur.m; blocks.push(b); }
      }
      cur = null;
    }
    function stripLead(runs, re) {
      var out = runs.map(function (r) { return { t: r.t, b: r.b }; });
      if (out.length) out[0].t = out[0].t.replace(re, '');
      return out;
    }
    function appendRuns(c, runs) {
      var prev = textOf(c.runs.slice(-1)), nxt = runs.length ? runs[0].t : '';
      var join = ' ';
      if (/-$/.test(prev.trim()) && /^[a-z]/.test(nxt.trim())) join = '';
      if (c.runs.length) c.runs[c.runs.length - 1].t = c.runs[c.runs.length - 1].t.replace(/\s+$/, '') + join;
      runs.forEach(function (r, i) { c.runs.push({ t: i === 0 ? r.t.replace(/^\s+/, '') : r.t, b: r.b }); });
    }
    function continues(c, l) {
      if (!c || c.t === 'h') return false;
      if (c.page === l.page && c.group === l.group) {
        var gap = c.lastY - l.y;
        return gap > 0 && gap <= 1.55 * Math.max(l.size, bodySize);
      }
      var t = textOf(c.runs).trim();
      return !TERMINAL.test(t) && /^[a-z]/.test(l.text);
    }

    var atomsAll = [];
    kept.forEach(function (p) { p.atoms.forEach(function (a) { atomsAll.push(a); }); });
    var prevHead = null;
    atomsAll.forEach(function (a) {
      if (a.kind === 'field' || a.kind === 'check') {
        flush();
        var label = '';
        for (var i = blocks.length - 1, seenN = 0; i >= 0 && seenN < 3; i--) { if (!blocks[i].runs) continue; seenN++; if (!label) label = textOf(blocks[i].runs).slice(0, 140); if (/^h[123]$/.test(blocks[i].t)) { label = textOf(blocks[i].runs).slice(0, 140); break; } }
        if (a.kind === 'check') label = '';
        var fb = { t: a.kind === 'check' ? 'check' : 'field', id: a.id, label: label, pg: a.page, ml: a.ml, h: Math.round(a.y2 - a.y1), v: a.v };
        blocks.push(fb);
        pendingCheck = a.kind === 'check' ? { b: fb, a: a } : null;
        prevHead = null;
        return;
      }
      var l = a;
      if (l.level) {
        flush(); pendingCheck = null;
        var lvl = l.level;
        if (prevHead && prevHead.level === lvl && prevHead.page === l.page && prevHead.group === l.group && prevHead.y - l.y < 1.7 * l.size) {
          var pb = blocks[blocks.length - 1]; pb.runs[0].t += ' ' + l.text;
        } else {
          blocks.push({ t: 'h' + lvl, runs: [{ t: l.text, b: true }], pg: l.page });
        }
        prevHead = l;
        return;
      }
      prevHead = null;
      if (pendingCheck && l.x > pendingCheck.a.x2 - 2 && Math.abs(l.y - pendingCheck.a.y2) < 26) {
        flush(); cur = { t: 'check', check: pendingCheck.b, runs: [], page: l.page, group: l.group, lastY: l.y };
        pendingCheck = null; appendRuns(cur, l.runs); cur.lastY = l.y; return;
      }
      if (isBulletLine(l)) {
        flush(); cur = { t: 'li', runs: stripLead(stripLead(l.runs, BULLET), DASHBUL), page: l.page, group: l.group, lastY: l.y };
        return;
      }
      var sm = SCOREROW.exec(l.text);
      if (sm && (/\s[1-9]\s*[\u2013\u2014-]\s/.test(l.text.slice(sm[0].length)) || l.text.length - sm[0].length < 14)) sm = null;
      if (sm) {
        flush(); cur = { t: 'li', m: sm[1], runs: stripLead(l.runs, SCOREROW), page: l.page, group: l.group, lastY: l.y };
        return;
      }
      if (cur && continues(cur, l)) { appendRuns(cur, l.runs); cur.lastY = l.y; cur.page = l.page; cur.group = l.group; return; }
      flush();
      cur = { t: 'p', runs: l.runs.map(function (r) { return { t: r.t, b: r.b }; }), page: l.page, group: l.group, lastY: l.y };
    });
    flush();

    // 7. sections
    function hCount(lv) { return blocks.filter(function (b) { return b.t === 'h' + lv; }).length; }
    var bp = null;
    if (hCount(1) >= 3) bp = { h1: 1 };
    else if (hCount(1) + hCount(2) >= 3) bp = { h1: 1, h2: 1 };
    else if (hCount(1) + hCount(2) + hCount(3) >= 3 && blocks.length > 20) bp = { h1: 1, h2: 1, h3: 1 };
    var sections = [];
    if (bp) {
      var curS = { title: '', blocks: [] };
      blocks.forEach(function (b) {
        if (bp[b.t] && /^h[123]$/.test(b.t)) {
          sections.push(curS); curS = { title: textOf(b.runs), blocks: [], pg: b.pg };
        } else curS.blocks.push(b);
      });
      sections.push(curS);
    } else {
      // no headings: group by two pages
      var byPage = {};
      blocks.forEach(function (b) { var g = Math.floor((b.pg - 1) / 2); (byPage[g] = byPage[g] || []).push(b); });
      Object.keys(byPage).sort(function (a, b) { return a - b; }).forEach(function (g) {
        var bl = byPage[g]; sections.push({ title: 'Pages ' + bl[0].pg + (bl[bl.length - 1].pg !== bl[0].pg ? '–' + bl[bl.length - 1].pg : ''), blocks: bl });
      });
    }
    function hasContent(s) { return s.blocks.some(function (b) { return b.t === 'p' || b.t === 'li' || b.t === 'field' || b.t === 'check'; }); }
    // blocks before the first heading become "Introduction" only if they have content
    sections = sections.filter(function (s, i) { if (!hasContent(s)) return false; if (!s.title) s.title = 'Introduction'; return true; });
    sections.forEach(function (s) {
      var pgs = s.blocks.map(function (b) { return b.pg; }).filter(Boolean);
      if (s.pg) pgs.push(s.pg);
      s.pageStart = Math.min.apply(null, pgs); s.pageEnd = Math.max.apply(null, pgs);
      delete s.pg;
    });
    if (!sections.length) sections.push({ title: title || 'Document', blocks: blocks, pageStart: 1, pageEnd: total });
    return { title: title, subtitle: subtitle, sections: sections, scanned: false, fieldCount: fieldCount, chars: totalChars, bodySize: bodySize };
  }

  var api = { parsePdf: parsePdf, _pageAtoms: pageAtoms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TMParser = api;
})(typeof self !== 'undefined' ? self : this);
