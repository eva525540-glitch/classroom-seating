/* 화면(UI) — 모든 처리는 브라우저 안에서만 한다. 명렬표는 저장하지 않는다. */
(function () {
  'use strict';
  var C = window.SeatCore, H = window.SeatHwpx, D = window.SEAT_DATA;
  var LAYOUTS = D.layouts.layouts, ONE_MAX = D.layouts.titleOneLineMaxChars;
  var SEATS = 21;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var S = {
    roster: null, classKey: null, cls: null,
    mode: 'A',            // 'A' | 'B' | 'manual'
    layout: 'A',          // 화면에 그리는 양식 (manual 일 때는 A/B 중 선택)
    seed: 1, keywords: C.DEFAULT_KEYWORDS.slice(), sortSubjects: 'appear',
    manual: {}, pages: [], cur: 0, sel: -1, selPool: null, exportSel: {}, thumbs: false,
    history: [], future: []
  };

  /* ---------- 공통 ---------- */
  function ctx() {
    return { seatCount: SEATS, manual: S.mode === 'manual', excluded: function (no) { return C.isExcluded(S.cls.students[no], S.keywords, S.manual); } };
  }
  function snapshot() { return JSON.stringify({ pages: S.pages, manual: S.manual, seed: S.seed, layout: S.layout, mode: S.mode }); }
  function push() { S.history.push(snapshot()); if (S.history.length > 100) S.history.shift(); S.future = []; }
  function restore(str) {
    var o = JSON.parse(str);
    S.pages = o.pages; S.manual = o.manual; S.seed = o.seed; S.layout = o.layout; S.mode = o.mode; S.sel = -1; S.selPool = null;
    if (S.cur >= S.pages.length) S.cur = S.pages.length - 1;
  }
  function cellsOf(pg) { return pg.seats.map(function (no) { return no == null ? null : { no: no, name: S.cls.students[no].name }; }); }
  function unseated(pg) {
    var c = ctx();
    return pg.nos.filter(function (no) { return !c.excluded(no) && pg.seats.indexOf(no) < 0; });
  }

  /* ---------- 작은 안내 ---------- */
  function setStatus(msg, pct) {
    $('status').textContent = msg || ''; $('status').classList.toggle('hidden', !msg);
    $('bar').classList.toggle('hidden', pct == null); if (pct != null) $('barI').style.width = Math.round(pct * 100) + '%';
  }
  function showImportMsg(msg) { var el = $('importMsg'); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }

  /* ---------- 불러오기 ---------- */
  function loadRoster(rows) {
    S.roster = rows;
    var keys = C.classKeys(rows), sel = $('clsSel');
    sel.innerHTML = keys.map(function (k) { return '<option value="' + esc(k.key) + '">' + esc(k.grade + ' ' + k.cls) + '</option>'; }).join('');
    sel.parentNode.classList.toggle('hidden', keys.length <= 1);
    showImportMsg(''); setStatus(rows.length + '개 행을 불러왔습니다.', null);
    $('review').classList.add('hidden');
    startClass(keys[0].key);
  }
  function newPages() {
    var pages = C.buildPages(S.cls, ctx(), S.seed);
    if (S.mode === 'manual') pages.forEach(function (p) { p.seats = new Array(SEATS).fill(null); p.overflow = []; p.locked = []; });
    return pages;
  }
  function resetExportSel() { S.exportSel = {}; S.pages.forEach(function (_, i) { S.exportSel[i] = true; }); }
  function startClass(key) {
    S.classKey = key; S.manual = {}; S.history = []; S.future = []; S.sel = -1; S.selPool = null; S.cur = 0;
    S.cls = C.buildClass(S.roster, key, { sortSubjects: S.sortSubjects });
    S.pages = newPages(); resetExportSel();
    $('sWork').classList.remove('hidden'); $('sExp').classList.remove('hidden');
    render();
  }
  function rebuildAll() {
    if (!S.cls) return;
    push();
    S.cls = C.buildClass(S.roster, S.classKey, { sortSubjects: S.sortSubjects });
    S.pages = newPages(); resetExportSel(); S.cur = 0; S.sel = -1; S.selPool = null;
    render();
  }

  var libs = {};
  function loadScript(src) {
    if (!libs[src]) libs[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
      document.head.appendChild(s);
    });
    return libs[src];
  }
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function pageLines(tc) {
    var items = tc.items.filter(function (i) { return i.str && i.str.trim(); }).map(function (i) { return { s: i.str, x: i.transform[4], y: i.transform[5] }; });
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [], cur = null;
    items.forEach(function (it) {
      if (!cur || Math.abs(cur.y - it.y) > 3) { cur = { y: it.y, a: [] }; lines.push(cur); }
      cur.a.push(it);
    });
    return lines.map(function (l) { l.a.sort(function (p, q) { return p.x - q.x; }); return l.a.map(function (i) { return i.s; }).join(' '); }).join('\n');
  }
  async function readPdf(file) {
    setStatus('PDF를 읽는 중…', 0.05);
    await loadScript(PDFJS + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    var text = '', n = doc.numPages, p;
    for (p = 1; p <= n; p++) {
      var pg = await doc.getPage(p);
      text += pageLines(await pg.getTextContent()) + '\n';
      setStatus('글자 읽는 중… ' + p + ' / ' + n, p / n * 0.3);
    }
    var rows = C.textToRoster(text);
    if (rows.length) return { rows: rows, text: text };
    // 글자 층이 없는 스캔본 → 화면 속 글자를 인식한다(OCR)
    setStatus('스캔본으로 보여 글자 인식을 준비하는 중… (처음 한 번 데이터를 내려받습니다)', 0.3);
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    var worker = await window.Tesseract.createWorker('kor', 1, {});
    text = '';
    for (p = 1; p <= n; p++) {
      var page = await doc.getPage(p), vp = page.getViewport({ scale: 2.4 });
      var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      var r = await worker.recognize(cv);
      text += r.data.text + '\n';
      setStatus('글자 인식 중… ' + p + ' / ' + n, 0.3 + p / n * 0.7);
    }
    await worker.terminate();
    return { rows: C.textToRoster(text), text: text };
  }
  function showReview(res) {
    setStatus('', null);
    var box = $('review');
    $('reviewTxt').value = res.rows.length ? C.rosterToTSV(res.rows) : res.text;
    $('reviewCnt').textContent = res.rows.length ? '(' + res.rows.length + '행 인식)' : '(표로 인식하지 못했습니다. 한 줄에 “학년 반 편제명 개설과목 번호 성명 비고” 순서로 고쳐 주세요)';
    box.classList.remove('hidden');
  }
  function confirmReview() {
    var t = $('reviewTxt').value, rows;
    try {
      rows = /학년/.test(t.split(/\r?\n/, 1)[0]) && /성명/.test(t.split(/\r?\n/, 1)[0]) ? C.parseRosterText(t) : C.textToRoster(t);
      if (!rows.length) throw new Error('학생 행을 찾지 못했습니다.');
      loadRoster(rows);
    } catch (e) { showImportMsg('불러오지 못했습니다: ' + e.message); }
  }
  function readFile(file) {
    var name = file.name.toLowerCase();
    showImportMsg('');
    var job;
    if (/\.pdf$/.test(name)) job = readPdf(file).then(showReview);
    else job = file.arrayBuffer().then(function (buf) {
      var rows;
      if (/\.xlsx?$/.test(name)) {
        if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 라이브러리를 불러오지 못했습니다. CSV로 저장해 올려 주세요.');
        var wb = XLSX.read(buf, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]];
        rows = C.rowsToRoster(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
      } else {
        var text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
        rows = C.parseRosterText(text);
      }
      loadRoster(rows);
    });
    job.catch(function (e) { setStatus('', null); showImportMsg('불러오지 못했습니다: ' + e.message); });
  }

  /* ---------- 좌석표 HTML ---------- */
  function slotMap(L) { var m = {}; L.slotOrder.forEach(function (s, i) { m[s.row + ',' + s.col] = i; }); return m; }
  function seatsHtml(pg, opt) {
    var L = LAYOUTS[S.layout], sm = slotMap(L), ci = [];
    L.grid[0].forEach(function (t, c) { if (t !== 'gap') ci.push(c); });
    var html = '<div class="seats" style="grid-template-columns:repeat(' + ci.length + ',1fr)">';
    L.grid.forEach(function (row, r) {
      ci.forEach(function (c) {
        var t = row[c];
        if (t === 'void') html += '<div class="void"></div>';
        else if (t === 'x') html += '<div class="xcell"></div>';
        else {
          var i = sm[r + ',' + c], no = pg.seats[i], blocked = pg.blocked.indexOf(i) >= 0;
          var locked = no != null && pg.locked.indexOf(no) >= 0;
          var cls = 'seat' + (no == null && !blocked ? ' empty' : '') + (locked ? ' locked' : '') + (blocked ? ' blocked' : '') + (opt.sel === i ? ' sel' : '');
          var inner = '<span class="slot">' + (i + 1) + '</span>';
          if (blocked) inner += '<span class="nm">비움</span>';
          else if (no != null) inner += '<span class="no">' + no + '</span><span class="nm">' + esc(S.cls.students[no].name) + '</span>' + (locked ? '<span class="tag">●</span>' : '');
          html += '<div class="' + cls + '" data-slot="' + i + '"' + (opt.interactive && !blocked && no != null ? ' draggable="true"' : '') + '>' + inner + '</div>';
        }
      });
    });
    return html + '</div>';
  }
  function titleHtml(pg) {
    var t = C.titleInfo(pg.subject, ONE_MAX);
    return '<div class="ttl">' + (t.twoLine ? '고사좌석배치표<small>' + esc(t.text) + '</small>' : '고사좌석배치표' + esc(t.text)) + '</div>';
  }
  function paperHtml(pg, opt) { return titleHtml(pg) + seatsHtml(pg, opt) + '<div class="board">칠판</div>'; }

  /* ---------- 방식 카드 ---------- */
  function miniHtml(v, dash) {
    var L = LAYOUTS[v], ci = [];
    L.grid[0].forEach(function (t, c) { if (t !== 'gap') ci.push(c); });
    var h = '<div class="mini' + (dash ? ' dash' : '') + '" style="grid-template-columns:repeat(' + ci.length + ',11px)">';
    L.grid.forEach(function (row) { ci.forEach(function (c) { var t = row[c]; h += '<i class="' + (t === 'void' ? 'v' : t === 'x' ? 'x' : '') + '"></i>'; }); });
    return h + '</div>';
  }
  function renderModes() {
    var defs = [
      { m: 'A', t: 'A형', d: '4열 · 자동 배치', mini: miniHtml('A', false) },
      { m: 'B', t: 'B형', d: '5열 · 자동 배치', mini: miniHtml('B', false) },
      { m: 'manual', t: '직접 조정', d: '빈 좌석에 직접 배치', mini: miniHtml(S.layout, true) }
    ];
    $('modes').innerHTML = defs.map(function (x) {
      return '<button class="mode' + (S.mode === x.m ? ' on' : '') + '" data-m="' + x.m + '">' + x.mini + '<span><b>' + x.t + '</b><small>' + x.d + '</small></span></button>';
    }).join('');
  }
  function setMode(m) {
    if (m === S.mode) return;
    if (S.cls) push();
    var prev = S.mode;
    S.mode = m;
    if (m !== 'manual') S.layout = m;
    if (S.cls) {
      S.pages = newPages(); resetExportSel(); S.cur = 0; S.sel = -1; S.selPool = null;
    }
    render();
  }

  /* ---------- 렌더 ---------- */
  function warningsFor(pg) {
    var w = [];
    if (S.mode !== 'manual' && pg.overflow.length) w.push('좌석(' + SEATS + '개)이 모자라 앉히지 못한 학생: ' + pg.overflow.map(function (n) { return n + ' ' + S.cls.students[n].name; }).join(', '));
    if (C.titleInfo(pg.subject, ONE_MAX).tooLong) w.push('과목명이 12자를 넘어 제목 2행에 다 들어가지 않을 수 있습니다. 한글에서 글자 크기를 줄여 주세요.');
    return w;
  }
  function render() {
    renderModes();
    if (!S.cls) return;
    var man = S.mode === 'manual';
    $('seed').value = S.seed;
    $('layoutSeg').classList.toggle('hidden', !man);
    Array.prototype.forEach.call($('layoutSeg').children, function (b) { b.classList.toggle('on', b.dataset.v === S.layout); });
    $('shufflePanel').classList.toggle('hidden', man);
    $('btnUndo').disabled = !S.history.length; $('btnRedo').disabled = !S.future.length;
    $('btnView').textContent = S.thumbs ? '한 쪽씩' : '전체 보기';
    renderSummary(); renderTabs(); renderPage();
  }
  function renderSummary() {
    var c = ctx();
    $('sumWrap').innerHTML = '<table class="sum"><thead><tr><th>쪽</th><th>선택자</th><th>재적</th><th>제외</th></tr></thead><tbody>' + S.pages.map(function (pg) {
      var total = pg.nos.length, ex = pg.nos.filter(function (n) { return c.excluded(n); }).length;
      return '<tr><td>' + esc(pg.common ? '공통' : pg.subject) + '</td><td>' + total + '</td><td>' + (total - ex) + '</td><td>' + ex + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function renderTabs() {
    $('tabs').innerHTML = S.pages.map(function (pg, i) {
      var w = warningsFor(pg).length;
      return '<div class="tab' + (i === S.cur ? ' cur' : '') + (w ? ' warned' : '') + '" data-i="' + i + '"><input type="checkbox" data-exp="' + i + '"' + (S.exportSel[i] ? ' checked' : '') + ' aria-label="내보내기에 포함"><span>' + esc(pg.common ? '공통' : pg.subject) + (w ? ' !' : '') + '</span></div>';
    }).join('');
  }
  function renderPage() {
    var pg = S.pages[S.cur], man = S.mode === 'manual';
    $('thumbView').classList.toggle('hidden', !S.thumbs);
    $('pageView').classList.toggle('hidden', S.thumbs);
    $('pageWarn').innerHTML = S.pages.map(function (p, i) {
      var w = warningsFor(p);
      return w.length && (i === S.cur || S.thumbs) ? '<div class="warn"><b>' + esc(p.common ? '공통' : p.subject) + '</b> · ' + w.map(esc).join(' / ') + '</div>' : '';
    }).join('');
    if (S.thumbs) {
      $('thumbView').innerHTML = '<div class="thumbs">' + S.pages.map(function (p, i) {
        return '<div class="thumb' + (i === S.cur ? ' cur' : '') + '" data-go="' + i + '"><div class="paper">' + paperHtml(p, { sel: -1 }) + '</div></div>';
      }).join('') + '</div>';
      return;
    }
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true });
    var bar = '';
    if (S.sel >= 0) {
      var no = pg.seats[S.sel], blocked = pg.blocked.indexOf(S.sel) >= 0;
      bar += '<b>슬롯 ' + (S.sel + 1) + (no != null ? ' · ' + no + ' ' + esc(S.cls.students[no].name) : blocked ? ' · 비움' : ' · 빈자리') + '</b>';
      if (no != null) bar += '<button class="sub" data-act="lock">' + (pg.locked.indexOf(no) >= 0 ? '고정 해제' : '고정') + '</button><button class="sub" data-act="unseat">자리 빼기</button>';
      bar += '<button class="sub" data-act="block">' + (blocked ? '비움 해제' : '좌석 비우기') + '</button>';
      if (no != null) bar += '<button class="sub" data-act="excl">제외</button>';
      bar += '<button class="sub" data-act="desel">취소</button>';
    }
    $('selbar').innerHTML = bar;
    $('pgSeed').value = pg.seed; $('pgSeed').disabled = pg.common; $('btnReshuffle').disabled = pg.common;
    var pool = unseated(pg);
    $('poolPanel').classList.toggle('hidden', !(man || pool.length));
    $('pool').innerHTML = pool.map(function (n) { return '<span class="chip' + (S.selPool === n ? ' sel' : '') + '" draggable="true" data-pool="' + n + '"><i>' + n + '</i>' + esc(S.cls.students[n].name) + '</span>'; }).join('') || '<span style="color:var(--mute);font-size:.82rem">모두 배치됨</span>';
    renderStudents(pg);
  }
  function renderStudents(pg) {
    var c = ctx();
    $('stulist').innerHTML = S.cls.studentList.map(function (s) {
      var ex = c.excluded(s.no), on = pg.nos.indexOf(s.no) >= 0;
      return '<label><input type="checkbox" data-stu="' + s.no + '"' + (ex ? '' : ' checked') + '><span class="' + (ex ? 'ex' : '') + '">' + (on ? '● ' : '') + s.no + ' ' + esc(s.name) + '</span>' + (s.notes.length ? '<span class="nt">' + esc(s.notes.join(',')) + '</span>' : '') + '</label>';
    }).join('');
  }

  /* ---------- 조작 ---------- */
  function cur() { return S.pages[S.cur]; }
  function swap(a, b) {
    var pg = cur();
    if (a === b || pg.blocked.indexOf(a) >= 0 || pg.blocked.indexOf(b) >= 0) return;
    push();
    var t = pg.seats[a]; pg.seats[a] = pg.seats[b]; pg.seats[b] = t;
    S.sel = -1; render();
  }
  function place(no, slot) {
    var pg = cur();
    if (pg.blocked.indexOf(slot) >= 0) return;
    push();
    var old = pg.seats[slot];
    if (old != null) { var l = pg.locked.indexOf(old); if (l >= 0) pg.locked.splice(l, 1); }
    pg.seats[slot] = no; pg.overflow = pg.overflow.filter(function (x) { return x !== no; });
    S.selPool = null; S.sel = -1; render();
  }
  function unseat(slot) {
    var pg = cur(), no = pg.seats[slot]; if (no == null) return;
    push(); pg.seats[slot] = null;
    var l = pg.locked.indexOf(no); if (l >= 0) pg.locked.splice(l, 1);
    S.sel = -1; render();
  }
  function toggleLock() {
    var pg = cur(), no = pg.seats[S.sel]; if (no == null) return;
    push(); var i = pg.locked.indexOf(no);
    if (i >= 0) pg.locked.splice(i, 1); else pg.locked.push(no);
    render();
  }
  function toggleBlock() {
    var pg = cur(), i = S.sel; if (i < 0) return;
    push();
    var k = pg.blocked.indexOf(i);
    if (k >= 0) pg.blocked.splice(k, 1);
    else {
      var no = pg.seats[i];
      if (no != null) { var l = pg.locked.indexOf(no); if (l >= 0) pg.locked.splice(l, 1); }
      pg.blocked.push(i);
      if (S.mode === 'manual') pg.seats[i] = null;
    }
    if (S.mode !== 'manual') C.relayout(pg, ctx());
    S.sel = -1; render();
  }
  function setExcluded(no, excluded) {
    push();
    S.manual[no] = excluded;
    var auto = S.cls.students[no].notes.some(function (n) { return C.noteExcluded(n, S.keywords); });
    if (auto === excluded) delete S.manual[no];
    S.pages.forEach(function (p) { C.applyExclusion(p, no, excluded, ctx()); });
    S.sel = -1; render();
  }
  function applySeed() {
    S.pages.forEach(function (p, i) { if (!p.common) C.reshuffle(p, C.pageSeed(S.seed, i), ctx()); });
    S.sel = -1; render();
  }

  /* ---------- 내보내기 ---------- */
  function download(bytes, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function drawPreview(pg) {
    var cv = document.createElement('canvas'); cv.width = 724; cv.height = 1024;
    var g = cv.getContext('2d'), L = LAYOUTS[S.layout];
    g.fillStyle = '#fff'; g.fillRect(0, 0, 724, 1024);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 30px "Malgun Gothic",sans-serif';
    var t = C.titleInfo(pg.subject, ONE_MAX);
    if (t.twoLine) { g.fillText('고사좌석배치표', 362, 70); g.fillText(t.text, 362, 110); } else g.fillText('고사좌석배치표' + t.text, 362, 80);
    var top = 150, h = 120, w = 140, gap = 8, cols = L.grid[0].filter(function (x) { return x !== 'gap'; }).length;
    var x0 = (724 - (cols * w + (cols - 1) * gap)) / 2, sm = slotMap(L);
    L.grid.forEach(function (row, r) {
      var ci = 0;
      row.forEach(function (tp, c) {
        if (tp === 'gap') return;
        var x = x0 + ci * (w + gap), y = top + r * (h + gap); ci++;
        if (tp === 'void') return;
        g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
        if (tp === 'x') { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y); g.stroke(); return; }
        var no = pg.seats[sm[r + ',' + c]];
        if (no != null) {
          g.font = 'bold 28px "Malgun Gothic",sans-serif'; g.fillText(String(no), x + w / 2, y + 40);
          g.font = '20px "Malgun Gothic",sans-serif'; g.fillText(S.cls.students[no].name, x + w / 2, y + 82);
        }
      });
    });
    var by = top + 6 * (h + gap) + 10;
    g.strokeRect(x0, by, cols * w + (cols - 1) * gap, 70);
    g.font = 'bold 30px "Malgun Gothic",sans-serif'; g.fillText('칠판', 362, by + 35);
    return new Promise(function (res) { cv.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/png'); });
  }
  function b64ToBytes(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function selectedIdx() { return S.pages.map(function (_, i) { return i; }).filter(function (i) { return S.exportSel[i]; }); }
  function doExport() {
    var idx = selectedIdx(), msg = $('expMsg');
    if (!idx.length) { msg.textContent = '내보낼 쪽을 하나 이상 선택하세요.'; return; }
    var bad = idx.filter(function (i) { var p = S.pages[i]; return p.overflow.length || (S.mode === 'manual' && unseated(p).length); });
    if (bad.length && !confirm('앉지 못한 학생이 있는 쪽이 있습니다 (' + bad.map(function (i) { return S.pages[i].subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
    var sel = idx.map(function (i) { return S.pages[i]; });
    msg.textContent = '만드는 중…';
    drawPreview(sel[0]).then(function (png) {
      return H.buildHwpx({ JSZip: window.JSZip, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer },
        b64ToBytes(D.templates[S.layout]), LAYOUTS[S.layout],
        sel.map(function (p) { return { subject: p.subject, cells: cellsOf(p) }; }), { previewPng: png, titleOneLineMaxChars: ONE_MAX });
    }).then(function (bytes) {
      var g = (S.cls.grade.match(/\d+/) || [''])[0], c = (S.cls.cls.match(/\d+/) || [''])[0];
      var name = (g && c ? g + '-' + c + '_' : '') + '고사좌석배치표.hwpx';
      download(bytes, name);
      msg.textContent = name + ' · ' + sel.length + '쪽';
    }).catch(function (e) { msg.textContent = '내보내기 실패: ' + e.message; });
  }
  function doPrint() {
    $('printArea').innerHTML = selectedIdx().map(function (i) { return '<div class="pp"><div class="paper">' + paperHtml(S.pages[i], { sel: -1 }) + '</div></div>'; }).join('');
    window.print();
  }

  /* ---------- 이벤트 ---------- */
  var dragFrom = -1, dragPool = null;
  function seatOf(e) { var el = e.target.closest('.seat'); return el ? +el.dataset.slot : -1; }
  function clearOver() { Array.prototype.forEach.call(document.querySelectorAll('.over'), function (x) { x.classList.remove('over'); }); }
  function bind() {
    var drop = $('drop'), file = $('file');
    drop.onclick = function () { file.click(); };
    drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
    file.onchange = function (e) { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });
    $('lnkPaste').onclick = function () { $('pasteBox').classList.toggle('hidden'); };
    $('btnPaste').onclick = function () { try { loadRoster(C.parseRosterText($('paste').value)); } catch (e) { showImportMsg('불러오지 못했습니다: ' + e.message); } };
    $('lnkExample').onclick = function () { loadRoster(C.parseRosterText(D.example)); };
    $('btnReviewOk').onclick = confirmReview;
    $('btnReviewNo').onclick = function () { $('review').classList.add('hidden'); setStatus('', null); };

    $('modes').onclick = function (e) { var b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); };
    $('layoutSeg').onclick = function (e) {
      var v = e.target.dataset && e.target.dataset.v; if (!v || v === S.layout) return;
      push(); S.layout = v; render();
    };
    $('clsSel').onchange = function (e) { startClass(e.target.value); };
    $('sortSub').onchange = function (e) { S.sortSubjects = e.target.value; rebuildAll(); };
    $('seed').onchange = function (e) { push(); S.seed = (parseInt(e.target.value, 10) || 0) >>> 0; applySeed(); };
    $('btnReseedAll').onclick = function () { push(); S.seed = Math.floor(Math.random() * 1e9); applySeed(); };
    $('btnReshuffle').onclick = function () { var pg = cur(); if (pg.common) return; push(); C.reshuffle(pg, Math.floor(Math.random() * 1e9), ctx()); S.sel = -1; render(); };
    $('pgSeed').onchange = function (e) { var pg = cur(); if (pg.common) return; push(); C.reshuffle(pg, parseInt(e.target.value, 10) || 0, ctx()); S.sel = -1; render(); };

    $('tabs').onclick = function (e) {
      var exp = e.target.dataset && e.target.dataset.exp;
      if (exp != null && exp !== '') { S.exportSel[exp] = e.target.checked; return; }
      var go = e.target.closest('[data-i]');
      if (go && e.target.tagName !== 'INPUT') { S.cur = +go.dataset.i; S.sel = -1; S.selPool = null; render(); }
    };
    $('thumbView').onclick = function (e) { var t = e.target.closest('[data-go]'); if (!t) return; S.cur = +t.dataset.go; S.sel = -1; S.thumbs = false; render(); };
    $('btnView').onclick = function () { S.thumbs = !S.thumbs; render(); };
    $('btnUndo').onclick = function () { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); render(); };
    $('btnRedo').onclick = function () { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); render(); };

    var paper = $('paper');
    paper.onclick = function (e) {
      var i = seatOf(e); if (i < 0) return;
      var pg = cur();
      if (S.selPool != null) { place(S.selPool, i); return; }
      if (S.sel < 0 || pg.blocked.indexOf(S.sel) >= 0 || pg.blocked.indexOf(i) >= 0) { S.sel = i; render(); return; }
      if (S.sel === i) { S.sel = -1; render(); return; }
      swap(S.sel, i);
    };
    paper.ondragstart = function (e) {
      var i = seatOf(e); if (i < 0) { e.preventDefault(); return; }
      dragFrom = i; dragPool = null; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i));
    };
    paper.ondragover = function (e) {
      var el = e.target.closest('.seat'); if (!el || (dragFrom < 0 && dragPool == null)) return;
      e.preventDefault(); clearOver(); el.classList.add('over');
    };
    paper.ondrop = function (e) {
      e.preventDefault(); var i = seatOf(e), from = dragFrom, pn = dragPool; dragFrom = -1; dragPool = null; clearOver();
      if (i < 0) return;
      if (pn != null) place(pn, i); else if (from >= 0) swap(from, i);
    };
    paper.ondragend = function () { dragFrom = -1; clearOver(); };

    var pool = $('pool');
    pool.onclick = function (e) {
      var c = e.target.closest('[data-pool]'); if (!c) return;
      var n = +c.dataset.pool; S.selPool = S.selPool === n ? null : n; S.sel = -1; render();
    };
    pool.ondragstart = function (e) {
      var c = e.target.closest('[data-pool]'); if (!c) return;
      dragPool = +c.dataset.pool; dragFrom = -1; e.dataTransfer.setData('text/plain', 'p' + dragPool);
    };
    pool.ondragend = function () { dragPool = null; clearOver(); };
    $('poolPanel').ondragover = function (e) { if (dragFrom >= 0) e.preventDefault(); };
    $('poolPanel').ondrop = function (e) { if (dragFrom >= 0) { e.preventDefault(); var f = dragFrom; dragFrom = -1; unseat(f); } };

    $('selbar').onclick = function (e) {
      var a = e.target.dataset && e.target.dataset.act; if (!a) return;
      if (a === 'lock') toggleLock();
      else if (a === 'block') toggleBlock();
      else if (a === 'unseat') unseat(S.sel);
      else if (a === 'excl') { var no = cur().seats[S.sel]; if (no != null) setExcluded(no, true); }
      else if (a === 'desel') { S.sel = -1; render(); }
    };
    $('stulist').onchange = function (e) { var no = e.target.dataset && e.target.dataset.stu; if (no != null) setExcluded(+no, !e.target.checked); };
    $('btnExport').onclick = doExport;
    $('btnPrint').onclick = doPrint;
    $('btnAll').onclick = function () { resetExportSel(); renderTabs(); };
    $('btnNone').onclick = function () { S.exportSel = {}; renderTabs(); };
  }
  bind();
  renderModes();
})();
