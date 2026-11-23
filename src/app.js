/* 화면(UI) — 모든 처리는 브라우저 안에서만 한다. 명렬표는 저장하지 않는다. */
(function () {
  'use strict';
  var C = window.SeatCore, H = window.SeatHwpx, D = window.SEAT_DATA;
  var LAYOUTS = D.layouts.layouts, ONE_MAX = D.layouts.titleOneLineMaxChars;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var S = {
    rows: [{ grade: '', cls: '', no: '', name: '', kind: '' }],   // 학생 명렬표(입력 중인 표)
    master: null, dirty: true,                                      // 적용된 학생 명렬표
    selEntries: null, matchInfo: null,                              // 선택과목 명렬표에서 읽은 줄
    classKey: null, cls: null,
    mode: 'A',                                                      // 'A' | 'B' | 'manual'(직접 만드는 배치도)
    custom: { cols: 4, types: C.defaultTypes(4) }, edit: false, tool: 'blank',
    seed: 1, keywords: C.DEFAULT_KEYWORDS.slice(), sortSubjects: 'appear',
    manual: {}, pages: [], cur: 0, sel: -1, selPool: null, exportSel: {}, thumbs: false,
    history: [], future: []
  };

  /* ---------- 공통 ---------- */
  function layoutId() { return S.mode === 'manual' ? (S.custom.cols === 4 ? 'A' : 'B') : S.mode; }   // 쓰는 hwpx 양식
  function curLayout() {
    return S.mode === 'manual' ? C.customLayout(S.custom.cols, S.custom.types, LAYOUTS[layoutId()].firstPageVposShift) : LAYOUTS[S.mode];
  }
  function seatCount() { return curLayout().slotOrder.length; }
  function ctx() {
    return { seatCount: seatCount(), manual: false, excluded: function (no) { return C.isExcluded(S.cls.students[no], S.keywords, S.manual); } };
  }
  function snapshot() { return JSON.stringify({ pages: S.pages, manual: S.manual, seed: S.seed, custom: S.custom, mode: S.mode }); }
  function push() { S.history.push(snapshot()); if (S.history.length > 100) S.history.shift(); S.future = []; }
  function restore(str) {
    var o = JSON.parse(str);
    S.pages = o.pages; S.manual = o.manual; S.seed = o.seed; S.custom = o.custom; S.mode = o.mode; S.sel = -1; S.selPool = null;
    if (S.cur >= S.pages.length) S.cur = S.pages.length - 1;
  }
  function isPicked(pg, no) { return !pg.common && !!pg.pick && pg.pick.indexOf(no) >= 0; }
  function cellsOf(pg) { return pg.seats.map(function (no) { return no == null ? null : { no: no, name: S.cls.students[no].name, picked: isPicked(pg, no) }; }); }
  function unseated(pg) {
    var c = ctx();
    return pg.nos.filter(function (no) { return !c.excluded(no) && pg.seats.indexOf(no) < 0; });
  }
  function msg(id, text) { var el = $(id); el.textContent = text || ''; el.classList.toggle('hidden', !text); }
  function setStatus(text, pct) {
    $('status').textContent = text || ''; $('status').classList.toggle('hidden', !text);
    $('bar').classList.toggle('hidden', pct == null); if (pct != null) $('barI').style.width = Math.round(pct * 100) + '%';
  }
  function download(bytes, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- ① 학생 명렬표 입력 ---------- */
  function renderMaster() {
    var h = '<div class="mrow h"><span>학년</span><span>반</span><span>번호</span><span>이름</span><span>구분</span><span></span></div>';
    S.rows.forEach(function (r, i) {
      h += '<div class="mrow" data-i="' + i + '">' +
        '<input data-f="grade" value="' + esc(r.grade) + '" placeholder="2" aria-label="학년">' +
        '<input data-f="cls" value="' + esc(r.cls) + '" placeholder="3" aria-label="반">' +
        '<input data-f="no" type="number" min="1" value="' + esc(r.no) + '" aria-label="번호">' +
        '<input data-f="name" value="' + esc(r.name) + '" aria-label="이름">' +
        '<select data-f="kind" aria-label="구분"><option value="">해당 없음</option>' + C.KINDS.map(function (k) { return '<option' + (r.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
        '<button data-del="' + i + '" title="줄 지우기" aria-label="줄 지우기">×</button></div>';
    });
    $('mtbl').innerHTML = h;
  }
  function addRow(focus) {
    var last = S.rows[S.rows.length - 1] || {};
    var n = parseInt(last.no, 10);
    S.rows.push({ grade: last.grade || '', cls: last.cls || '', no: isNaN(n) ? '' : n + 1, name: '', kind: '' });
    S.dirty = true;
    renderMaster();
    if (focus) { var el = $('mtbl').querySelector('[data-i="' + (S.rows.length - 1) + '"] [data-f="name"]'); if (el) el.focus(); }
    $('mtbl').scrollTop = $('mtbl').scrollHeight;
  }
  function rowFilled(r) { return String(r.name || '').trim() || String(r.no == null ? '' : r.no).trim(); }
  function addRowsFromMaster(list) {
    var keep = S.rows.filter(rowFilled);
    S.rows = keep.concat(list.map(function (m) { return { grade: m.grade.replace('학년', ''), cls: m.cls.replace('반', ''), no: m.no, name: m.name, kind: m.kind }; }));
    if (!S.rows.length) S.rows = [{ grade: '', cls: '', no: '', name: '', kind: '' }];
    S.dirty = true; renderMaster(); msg('masterMsg', '');
  }
  function tableToMaster(table) {
    var first = (table[0] || []).map(function (h) { return String(h).trim(); });
    if (first.indexOf('번호') >= 0 && (first.indexOf('이름') >= 0 || first.indexOf('성명') >= 0)) return C.masterFromTable(table);
    // 머리글이 없으면 학년, 반, 번호, 이름, 구분 순서로 본다
    return C.masterFromTable([['학년', '반', '번호', '이름', '구분']].concat(table));
  }
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }
  function sheetToTable(buf) {
    if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 라이브러리를 불러오지 못했습니다. CSV로 저장해 올려 주세요.');
    var wb = XLSX.read(buf, { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  function readMasterFile(file) {
    var name = file.name.toLowerCase();
    file.arrayBuffer().then(function (buf) {
      var table = /\.xlsx?$/.test(name) ? sheetToTable(buf) : C.parseDelimited(decodeText(buf));
      addRowsFromMaster(tableToMaster(table));
    }).catch(function (e) { msg('masterMsg', '불러오지 못했습니다: ' + e.message); });
  }
  function downloadTemplate() {
    var NOTE = [['구분은 해당하는 학생만 고르세요 (통합지원반, 별도고사실, 전출, 자퇴).'], ['구분을 고른 학생은 좌석에서 제외됩니다.'], ['학년·반은 숫자만 써도 됩니다.']];
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js').then(function () {
      var wb = new window.ExcelJS.Workbook(), ws = wb.addWorksheet('학생명렬표');
      ws.columns = [{ header: '학년', width: 8 }, { header: '반', width: 8 }, { header: '번호', width: 8 }, { header: '이름', width: 16 }, { header: '구분', width: 16 }];
      ws.getRow(1).font = { bold: true };
      for (var r = 2; r <= 101; r++) ws.getCell('E' + r).dataValidation = { type: 'list', allowBlank: true, formulae: ['"' + C.KINDS.join(',') + '"'] };
      var w2 = wb.addWorksheet('안내'); NOTE.forEach(function (l) { w2.addRow(l); }); w2.getColumn(1).width = 70;
      return wb.xlsx.writeBuffer();
    }).catch(function () {
      // 인터넷이 없으면 선택 목록 없는 기본 양식
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['학년', '반', '번호', '이름', '구분']]), '학생명렬표');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(NOTE), '안내');
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    }).then(function (buf) { download(buf, '학생명렬표_양식.xlsx'); });
  }

  /* 입력 표 → 적용 */
  function collectMaster() {
    var errs = [], valid = [], seen = {};
    S.rows.forEach(function (r, i) {
      if (!rowFilled(r)) return;
      var name = String(r.name || '').trim(), no = parseInt(String(r.no == null ? '' : r.no).trim(), 10);
      if (isNaN(no) || !name) { errs.push((i + 1) + '번째 줄은 번호와 이름을 모두 입력해야 합니다'); return; }
      var g = C.normGrade(r.grade), c = C.normCls(r.cls), key = g + '|' + c + '|' + no;
      if (seen[key]) { errs.push((i + 1) + '번째 줄의 번호가 겹칩니다'); return; }
      seen[key] = 1; valid.push({ grade: g, cls: c, no: no, name: name, kind: r.kind || '' });
    });
    return { valid: valid, errs: errs };
  }
  function applyMaster() {
    var res = collectMaster();
    if (res.errs.length) { msg('masterMsg', res.errs.slice(0, 4).join(' · ') + (res.errs.length > 4 ? ' 외 ' + (res.errs.length - 4) + '곳' : '')); return false; }
    if (!res.valid.length) { msg('masterMsg', '학생을 한 명 이상 입력하세요.'); return false; }
    msg('masterMsg', '');
    S.master = res.valid; S.dirty = false;
    var keys = C.masterClassKeys(S.master), sel = $('clsSel');
    sel.innerHTML = keys.map(function (k) { return '<option value="' + esc(k.key) + '">' + esc((k.grade + ' ' + k.cls).trim() || '학급') + '</option>'; }).join('');
    sel.parentNode.classList.toggle('hidden', keys.length <= 1);
    var key = keys.some(function (k) { return k.key === S.classKey; }) ? S.classKey : keys[0].key;
    sel.value = key;
    startClass(key);
    return true;
  }

  /* ---------- ② 선택과목 명렬표 ---------- */
  var libs = {};
  function loadScript(src) {
    if (!libs[src]) libs[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { delete libs[src]; rej(new Error('라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
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
  /* PDF → 표의 줄들 ({grade, cls, subjectRaw, no, name}) */
  async function readPdf(file) {
    setStatus('PDF를 읽는 중…', 0.05);
    await loadScript(PDFJS + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    var doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    var pages = [], n = doc.numPages, p;
    for (p = 1; p <= n; p++) {
      var pg = await doc.getPage(p);
      pages.push(pageLines(await pg.getTextContent()));
      setStatus('표를 읽는 중… ' + p + ' / ' + n, p / n * 0.3);
    }
    var res = C.pagesToRoster(pages);
    if (res.rows.length) return res.rows;
    // 글자 층이 없는 스캔본 → 화면 속 글자를 인식한다(OCR)
    setStatus('스캔본으로 보여 글자 인식을 준비하는 중… (처음 한 번 데이터를 내려받습니다)', 0.3);
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    var worker = await window.Tesseract.createWorker('kor', 1, {});
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    pages = [];
    for (p = 1; p <= n; p++) {
      var page = await doc.getPage(p), vp = page.getViewport({ scale: 3 });
      var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      pages.push((await worker.recognize(cv)).data.text);
      setStatus('표를 읽는 중… ' + p + ' / ' + n, 0.3 + p / n * 0.7);
    }
    await worker.terminate();
    return C.pagesToRoster(pages).rows;
  }
  function toEntries(rows) {
    return rows.map(function (r) { return { grade: r.grade, cls: r.cls, subject: C.stripUnit(r.subjectRaw), no: r.no, name: r.name }; });
  }
  function loadSelections(entries) {
    if (!entries.length) { msg('importMsg', '표에서 학생 줄을 찾지 못했습니다. 엑셀(CSV)로 올려 보세요.'); return; }
    S.selEntries = entries;
    msg('importMsg', '');
    if (!S.master || S.dirty) { if (!applyMaster()) return; } else startClass(S.classKey);
  }
  function readFile(file) {
    if (!collectMaster().valid.length) { msg('importMsg', '먼저 위의 학생 명렬표를 입력하세요.'); return; }
    var name = file.name.toLowerCase(), job;
    msg('importMsg', '');
    if (/\.pdf$/.test(name)) job = readPdf(file).then(function (rows) { setStatus('', null); loadSelections(toEntries(rows)); });
    else job = file.arrayBuffer().then(function (buf) {
      var rows = /\.xlsx?$/.test(name) ? C.rowsToRoster(sheetToTable(buf)) : C.parseRosterText(decodeText(buf));
      loadSelections(toEntries(rows));
    });
    job.catch(function (e) { setStatus('', null); msg('importMsg', '불러오지 못했습니다: ' + e.message); });
  }

  /* ---------- 반 시작 / 재생성 ---------- */
  function makeCls(key) {
    var subs = S.matchInfo ? S.matchInfo.subjects : [];
    return C.buildClassFromMaster(S.master, key, subs, { sortSubjects: S.sortSubjects });
  }
  function newPages() {
    return C.buildPages(S.cls, ctx(), S.seed);
  }
  function resetExportSel() { S.exportSel = {}; S.pages.forEach(function (_, i) { S.exportSel[i] = true; }); }
  function startClass(key) {
    S.classKey = key; S.manual = {}; S.history = []; S.future = []; S.sel = -1; S.selPool = null; S.cur = 0;
    S.matchInfo = S.selEntries ? C.matchSelections(S.master, S.selEntries, key) : null;
    S.cls = makeCls(key);
    S.pages = newPages(); resetExportSel();
    $('sWork').classList.remove('hidden'); $('sExp').classList.remove('hidden');
    if (S.matchInfo) {
      var m = S.matchInfo;
      setStatus('선택과목 ' + m.subjects.length + '개 · 학생 ' + m.matched + '명 연결' + (m.unmatched ? ' · 연결하지 못한 줄 ' + m.unmatched + '개' : '') + (m.skipped ? ' · 다른 반 ' + m.skipped + '줄 제외' : ''), null);
    } else setStatus('', null);
    render();
  }
  function rebuildAll() {
    if (!S.cls) return;
    push();
    S.cls = makeCls(S.classKey);
    S.pages = newPages(); resetExportSel(); S.cur = 0; S.sel = -1; S.selPool = null;
    render();
  }

  /* ---------- 좌석표 HTML ---------- */
  function slotMap(L) { var m = {}; L.slotOrder.forEach(function (s, i) { m[s.row + ',' + s.col] = i; }); return m; }
  function seatsHtml(pg, opt) {
    var L = curLayout(), sm = slotMap(L), ci = [];
    L.grid[0].forEach(function (t, c) { if (t !== 'gap') ci.push(c); });
    var html = '<div class="seats" style="grid-template-columns:repeat(' + ci.length + ',1fr)">';
    L.grid.forEach(function (row, r) {
      ci.forEach(function (c) {
        var t = row[c];
        var pos = ' data-r="' + r + '" data-c="' + (c / 2) + '"';
        if (t === 'void') html += '<div class="' + (opt.edit ? 'vcell' : 'void') + '"' + pos + '>' + (opt.edit ? '빈칸' : '') + '</div>';
        else if (t === 'x') html += '<div class="xcell' + (opt.edit ? ' ed' : '') + '"' + pos + '></div>';
        else {
          var i = sm[r + ',' + c], no = pg.seats[i], blocked = pg.blocked.indexOf(i) >= 0;
          var locked = no != null && pg.locked.indexOf(no) >= 0;
          var cls = 'seat' + (no == null && !blocked ? ' empty' : '') + (locked ? ' locked' : '') + (blocked ? ' blocked' : '') + (no != null && isPicked(pg, no) ? ' picked' : '') + (opt.sel === i ? ' sel' : '');
          var inner = '<span class="slot">' + (i + 1) + '</span>';
          if (blocked) inner += '<span class="nm">비움</span>';
          else if (no != null) inner += '<span class="no">' + no + '</span><span class="nm">' + esc(S.cls.students[no].name) + '</span>' + (locked ? '<span class="tag">●</span>' : '');
          html += '<div class="' + cls + '" data-slot="' + i + '"' + pos + (opt.interactive && !blocked && no != null ? ' draggable="true"' : '') + '>' + inner + '</div>';
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
  function miniHtml(cols, dash) {
    var h = '<div class="mini' + (dash ? ' dash' : '') + '" style="grid-template-columns:repeat(' + cols + ',11px)">';
    for (var i = 0; i < cols * 6; i++) h += '<i></i>';
    return h + '</div>';
  }
  function renderModes() {
    var defs = [
      { m: 'A', t: 'A형 (4열)', d: '4 × 6', mini: miniHtml(4, false) },
      { m: 'B', t: 'B형 (5열)', d: '5 × 6', mini: miniHtml(5, false) },
      { m: 'manual', t: '직접 조정', d: '', mini: miniHtml(4, true) }
    ];
    $('modes').innerHTML = defs.map(function (x) {
      return '<button class="mode' + (S.mode === x.m ? ' on' : '') + '" data-m="' + x.m + '">' + x.mini + '<span><b>' + x.t + '</b>' + (x.d ? '<small>' + x.d + '</small>' : '') + '</span></button>';
    }).join('');
  }
  function setMode(m) {
    if (m === S.mode) return;
    if (S.cls) push();
    S.mode = m; S.edit = false;
    if (S.cls) { S.pages = newPages(); resetExportSel(); S.cur = 0; S.sel = -1; S.selPool = null; }
    render();
  }

  /* ---------- 렌더 ---------- */
  function warningsFor(pg) {
    var w = [];
    if (pg.overflow.length) w.push('좌석(' + seatCount() + '개)이 모자라 앉히지 못한 학생: ' + pg.overflow.map(function (n) { return n + ' ' + S.cls.students[n].name; }).join(', '));
    if (C.titleInfo(pg.subject, ONE_MAX).tooLong) w.push('과목명이 12자를 넘어 제목 2행에 다 들어가지 않을 수 있습니다. 한글에서 글자 크기를 줄여 주세요.');
    return w;
  }
  function render() {
    renderModes();
    if (!S.cls) return;
    var man = S.mode === 'manual';
    $('seed').value = S.seed;
    $('layoutSeg').classList.toggle('hidden', !man); $('btnEdit').classList.toggle('hidden', !man);
    Array.prototype.forEach.call($('layoutSeg').children, function (b) { b.classList.toggle('on', +b.dataset.v === S.custom.cols); });
    $('btnEdit').textContent = S.edit ? '편집 끝' : '배치도 편집'; $('btnEdit').classList.toggle('on', S.edit);
    $('btnUndo').disabled = !S.history.length; $('btnRedo').disabled = !S.future.length;
    $('btnView').textContent = S.thumbs ? '한 쪽씩' : '전체 보기';
    renderSummary(); renderTabs(); renderPage();
  }
  function renderSummary() {
    var c = ctx();
    $('sumWrap').innerHTML = '<table class="sum"><thead><tr><th>쪽</th><th>선택자</th><th>재적</th><th>제외</th></tr></thead><tbody>' + S.pages.map(function (pg) {
      var src = pg.pick || pg.nos, total = src.length, ex = src.filter(function (n) { return c.excluded(n); }).length;
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
    var pg = S.pages[S.cur];
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
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true, edit: S.edit }) + (pg.common ? '' : '<div class="legend"><i></i>' + esc(pg.subject) + ' 선택 학생</div>');
    var bar = '';
    if (S.edit) {
      bar = ['seat:좌석', 'blank:빈칸', 'x:X'].map(function (s) { var k = s.split(':'); return '<button class="sub' + (S.tool === k[0] ? ' on' : '') + '" data-tool="' + k[0] + '">' + k[1] + '</button>'; }).join('');
    } else if (S.sel >= 0) {
      var no = pg.seats[S.sel], blocked = pg.blocked.indexOf(S.sel) >= 0;
      bar += '<b>슬롯 ' + (S.sel + 1) + (no != null ? ' · ' + no + ' ' + esc(S.cls.students[no].name) : blocked ? ' · 비움' : ' · 빈자리') + '</b>';
      if (no != null) bar += '<button class="sub" data-act="lock">' + (pg.locked.indexOf(no) >= 0 ? '고정 해제' : '고정') + '</button><button class="sub" data-act="unseat">자리 빼기</button><button class="sub" data-act="rename">이름 수정</button>';
      if (S.mode !== 'manual') bar += '<button class="sub" data-act="block">' + (blocked ? '비움 해제' : '좌석 비우기') + '</button>';
      if (no != null) bar += '<button class="sub" data-act="excl">제외</button>';
      bar += '<button class="sub" data-act="desel">취소</button>';
    }
    $('selbar').innerHTML = bar;
    $('pgSeed').value = pg.seed; $('pgSeed').disabled = pg.common; $('btnReshuffle').disabled = pg.common;
    $('namePanel').classList.toggle('hidden', pg.common); $('pgName').value = pg.subject;
    var pool = unseated(pg);
    $('poolPanel').classList.toggle('hidden', !pool.length);
    $('pool').innerHTML = pool.map(function (n) { return '<span class="chip' + (S.selPool === n ? ' sel' : '') + (isPicked(pg, n) ? ' picked' : '') + '" draggable="true" data-pool="' + n + '"><i>' + n + '</i>' + esc(S.cls.students[n].name) + '</span>'; }).join('') || '<span style="color:var(--mute);font-size:.82rem">모두 배치됨</span>';
    renderStudents(pg);
  }
  function renderStudents(pg) {
    var c = ctx();
    $('stulist').innerHTML = S.cls.studentList.map(function (s) {
      var ex = c.excluded(s.no);
      return '<div class="rw"><label><input type="checkbox" data-stu="' + s.no + '"' + (ex ? '' : ' checked') + '><span class="' + (ex ? 'ex' : '') + '">' + s.no + ' ' + esc(s.name) + '</span>' + (s.kind ? '<span class="nt">' + esc(s.kind) + '</span>' : '') + '</label>' +
        (pg.common ? '' : '<button class="pk' + (isPicked(pg, s.no) ? ' on' : '') + '" data-pick="' + s.no + '" title="이 과목 선택 학생" aria-label="이 과목 선택 학생"></button>') + '</div>';
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
    }
    C.relayout(pg, ctx());
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
  function togglePick(no) {
    var pg = cur(); if (pg.common) return;
    push();
    var i = pg.pick.indexOf(no);
    if (i >= 0) pg.pick.splice(i, 1); else pg.pick.push(no);
    render();
  }
  function renameStudent(no) {
    var s = S.cls.students[no], v = window.prompt('이름 수정 (' + no + '번)', s.name);
    if (v == null) return;
    v = v.trim(); if (!v || v === s.name) return;
    s.name = v;
    S.master.forEach(function (m) { if (m.grade + '|' + m.cls === S.classKey && m.no === no) m.name = v; });
    S.rows.forEach(function (r) { if (C.normGrade(r.grade) + '|' + C.normCls(r.cls) === S.classKey && parseInt(r.no, 10) === no) r.name = v; });
    renderMaster(); render();
  }
  /* 배치도가 바뀌면 모든 쪽을 같은 모양으로 다시 놓는다: 앉은 순서(앞자리부터)를 지키며 빈칸·X를 건너뛴다 */
  function relayoutPages() {
    var N = seatCount();
    S.pages.forEach(function (pg) {
      var seq = pg.seats.filter(function (x) { return x != null; }).concat(pg.overflow);
      var seats = new Array(N).fill(null), p = 0;
      for (var i = 0; i < N && p < seq.length; i++) seats[i] = seq[p++];
      pg.seats = seats; pg.overflow = seq.slice(p); pg.blocked = [];
      pg.locked = pg.locked.filter(function (no) { return seats.indexOf(no) >= 0; });
    });
    S.sel = -1; S.selPool = null;
  }
  function paintCell(r, c) {
    if (S.custom.types[r][c] === S.tool) return;
    push();
    S.custom.types[r][c] = S.tool;
    relayoutPages(); render();
  }
  function applySeed() {
    S.pages.forEach(function (p, i) { if (!p.common) C.reshuffle(p, C.pageSeed(S.seed, i), ctx()); });
    S.sel = -1; render();
  }

  /* ---------- 내보내기 ---------- */
  function drawPreview(pg) {
    var cv = document.createElement('canvas'); cv.width = 724; cv.height = 1024;
    var g = cv.getContext('2d'), L = curLayout();
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
        if (tp === 'x') { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke(); return; }
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
    var idx = selectedIdx(), out = $('expMsg');
    if (!idx.length) { out.textContent = '내보낼 쪽을 하나 이상 선택하세요.'; return; }
    var bad = idx.filter(function (i) { var p = S.pages[i]; return p.overflow.length || unseated(p).length; });
    if (bad.length && !confirm('앉지 못한 학생이 있는 쪽이 있습니다 (' + bad.map(function (i) { return S.pages[i].subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
    var sel = idx.map(function (i) { return S.pages[i]; });
    out.textContent = '만드는 중…';
    drawPreview(sel[0]).then(function (png) {
      return H.buildHwpx({ JSZip: window.JSZip, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer },
        b64ToBytes(D.templates[layoutId()]), curLayout(),
        sel.map(function (p) { return { subject: p.subject, cells: cellsOf(p) }; }), { previewPng: png, titleOneLineMaxChars: ONE_MAX });
    }).then(function (bytes) {
      var g = (S.cls.grade.match(/\d+/) || [''])[0], c = (S.cls.cls.match(/\d+/) || [''])[0];
      var name = (g && c ? g + '-' + c + '_' : '') + '고사좌석배치표.hwpx';
      download(bytes, name);
      out.textContent = name + ' · ' + sel.length + '쪽';
    }).catch(function (e) { out.textContent = '내보내기 실패: ' + e.message; });
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
    // 학생 명렬표 입력
    var mt = $('mtbl');
    function onEdit(e) {
      var row = e.target.closest('[data-i]'), f = e.target.dataset && e.target.dataset.f; if (!row || !f) return;
      S.rows[+row.dataset.i][f] = e.target.value; S.dirty = true;
    }
    mt.addEventListener('input', onEdit); mt.addEventListener('change', onEdit);
    mt.addEventListener('click', function (e) {
      var d = e.target.dataset && e.target.dataset.del; if (d == null || d === '') return;
      S.rows.splice(+d, 1); if (!S.rows.length) S.rows.push({ grade: '', cls: '', no: '', name: '', kind: '' });
      S.dirty = true; renderMaster();
    });
    mt.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.dataset || e.target.dataset.f !== 'name') return;
      var row = e.target.closest('[data-i]'); if (!row) return;
      e.preventDefault();
      if (+row.dataset.i === S.rows.length - 1) addRow(true);
      else { var nx = mt.querySelector('[data-i="' + (+row.dataset.i + 1) + '"] [data-f="name"]'); if (nx) nx.focus(); }
    });
    $('btnAddRow').onclick = function () { addRow(true); };
    $('btnApply').onclick = applyMaster;
    $('btnTpl').onclick = downloadTemplate;
    $('btnMasterFile').onclick = function () { $('masterFile').click(); };
    $('masterFile').onchange = function (e) { if (e.target.files[0]) readMasterFile(e.target.files[0]); e.target.value = ''; };
    $('lnkPaste').onclick = function () { $('pasteBox').classList.toggle('hidden'); };
    $('btnPaste').onclick = function () {
      try { addRowsFromMaster(tableToMaster(C.parseDelimited($('paste').value))); $('paste').value = ''; $('pasteBox').classList.add('hidden'); }
      catch (e) { msg('masterMsg', '불러오지 못했습니다: ' + e.message); }
    };

    // 선택과목 명렬표 올리기
    var drop = $('drop'), file = $('file');
    drop.onclick = function () { file.click(); };
    drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
    file.onchange = function (e) { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('on'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });

    $('modes').onclick = function (e) { var b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); };
    $('layoutSeg').onclick = function (e) {
      var v = +(e.target.dataset && e.target.dataset.v); if (!v || v === S.custom.cols) return;
      push(); S.custom.types = C.resizeTypes(S.custom.types, v); S.custom.cols = v; relayoutPages(); render();
    };
    $('btnEdit').onclick = function () { S.edit = !S.edit; S.sel = -1; S.selPool = null; render(); };
    $('clsSel').onchange = function (e) { startClass(e.target.value); };
    $('sortSub').onchange = function (e) { S.sortSubjects = e.target.value; rebuildAll(); };
    $('seed').onchange = function (e) { push(); S.seed = (parseInt(e.target.value, 10) || 0) >>> 0; applySeed(); };
    $('btnReseedAll').onclick = function () { push(); S.seed = Math.floor(Math.random() * 1e9); applySeed(); };
    $('btnReshuffle').onclick = function () { var pg = cur(); if (pg.common) return; push(); C.reshuffle(pg, Math.floor(Math.random() * 1e9), ctx()); S.sel = -1; render(); };
    $('pgSeed').onchange = function (e) { var pg = cur(); if (pg.common) return; push(); C.reshuffle(pg, parseInt(e.target.value, 10) || 0, ctx()); S.sel = -1; render(); };
    $('pgName').onchange = function (e) {
      var pg = cur(), v = e.target.value.trim(); if (pg.common || !v || v === pg.subject) { e.target.value = pg.subject; return; }
      push(); pg.subject = v; render();
    };

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
      if (S.edit) { var cell = e.target.closest('[data-r]'); if (cell) paintCell(+cell.dataset.r, +cell.dataset.c); return; }
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
      var tl = e.target.dataset && e.target.dataset.tool; if (tl) { S.tool = tl; renderPage(); return; }
      var a = e.target.dataset && e.target.dataset.act; if (!a) return;
      if (a === 'lock') toggleLock();
      else if (a === 'block') toggleBlock();
      else if (a === 'unseat') unseat(S.sel);
      else if (a === 'rename') { var rn = cur().seats[S.sel]; if (rn != null) renameStudent(rn); }
      else if (a === 'excl') { var no = cur().seats[S.sel]; if (no != null) setExcluded(no, true); }
      else if (a === 'desel') { S.sel = -1; render(); }
    };
    $('stulist').onchange = function (e) { var no = e.target.dataset && e.target.dataset.stu; if (no != null) setExcluded(+no, !e.target.checked); };
    $('stulist').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (b) togglePick(+b.dataset.pick); };
    $('btnExport').onclick = doExport;
    $('btnPrint').onclick = doPrint;
    $('btnAll').onclick = function () { resetExportSel(); renderTabs(); };
    $('btnNone').onclick = function () { S.exportSel = {}; renderTabs(); };
  }
  bind();
  renderMaster();
  renderModes();
})();
