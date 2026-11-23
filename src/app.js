/* 화면(UI) — 모든 처리는 브라우저 안에서만 한다. 명렬표는 저장하지 않는다. */
(function () {
  'use strict';
  var C = window.SeatCore, H = window.SeatHwpx, D = window.SEAT_DATA;
  var LAYOUTS = D.layouts.layouts, ONE_MAX = D.layouts.titleOneLineMaxChars;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function blankRows(n) { var a = []; for (var i = 0; i < n; i++) a.push({ grade: '', cls: '', no: '', name: '', kind: '' }); return a; }
  var S = {
    rows: blankRows(5),                                            // 학생 명렬표(입력 중인 표)
    master: null, dirty: true,                                      // 확정된 학생 명렬표
    selSource: null, matchInfo: null, fileInfo: null,               // 선택과목 명렬표(PDF·CSV)에서 읽은 것
    classKey: null, cls: null,
    mode: 'A',                                                      // 'A' 4열 | 'B' 5열 | 'manual' 직접 조정
    types: { A: C.defaultTypes(4), B: C.defaultTypes(5), M: C.defaultTypes(4, 6) }, mcols: 4, mrows: 6, pendingFile: null,
    seed: Math.floor(Math.random() * 1e9), keywords: C.DEFAULT_KEYWORDS.slice(), sortSubjects: 'appear',
    manual: {}, pages: [], cur: 0, sel: -1, selPool: null, thumbs: false,
    history: [], future: []
  };

  /* ---------- 배치도 ---------- */
  function curCols() { return S.mode === 'A' ? 4 : S.mode === 'B' ? 5 : S.mcols; }
  function curRows() { return S.mode === 'manual' ? S.mrows : 6; }
  function curTypes() { return S.types[S.mode === 'manual' ? 'M' : S.mode]; }
  function tplCols() { return curCols() <= 4 ? 4 : 5; }                 // 쓰는 hwpx 양식의 열 수 (양식은 4열형·5열형 두 가지)
  function layoutId() { return tplCols() === 4 ? 'A' : 'B'; }
  function curLayout() { return C.customLayout(curCols(), curTypes(), LAYOUTS[layoutId()].firstPageVposShift); }
  function seatCount() { return curLayout().slotOrder.length; }

  /* ---------- 공통 ---------- */
  function ctx() {
    return { seatCount: seatCount(), manual: S.mode === 'manual', excluded: function (no) { return C.isExcluded(S.cls.students[no], S.keywords, S.manual); } };
  }
  function snapshot() { return JSON.stringify({ pages: S.pages, manual: S.manual, seed: S.seed, mode: S.mode, types: S.types, mcols: S.mcols, mrows: S.mrows }); }
  function push() { S.history.push(snapshot()); if (S.history.length > 100) S.history.shift(); S.future = []; }
  function restore(str) {
    var o = JSON.parse(str);
    S.pages = o.pages; S.manual = o.manual; S.seed = o.seed; S.mode = o.mode; S.types = o.types; S.mcols = o.mcols; S.mrows = o.mrows; S.sel = -1; S.selPool = null;
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
      var g = String(r.grade || '').replace(/[^0-9]/g, '').slice(0, 1);
      h += '<div class="mrow" data-i="' + i + '">' +
        '<select data-f="grade" required aria-label="학년"><option value="" disabled hidden' + (g ? '' : ' selected') + '>1학년</option>' + [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (String(n) === g ? ' selected' : '') + '>' + n + '학년</option>'; }).join('') + '</select>' +
        '<input data-f="cls" inputmode="numeric" value="' + esc(r.cls) + '" placeholder="1반" aria-label="반">' +
        '<input data-f="no" inputmode="numeric" value="' + esc(r.no) + '" placeholder="번호" aria-label="번호">' +
        '<input data-f="name" value="' + esc(r.name) + '" placeholder="이름" aria-label="이름">' +
        '<select data-f="kind" aria-label="구분"><option value="">해당 없음</option>' + C.KINDS.map(function (k) { return '<option' + (r.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
        '<button data-del="' + i + '" title="줄 지우기" aria-label="줄 지우기">×</button></div>';
    });
    $('mtbl').innerHTML = h;
  }
  /* 확정 여부를 눈에 보이게: 버튼이 초록색 "확정됨"이 되고 요약이 뜬다. 고치면 다시 "명렬표 적용". */
  function renderMasterState() {
    var btn = $('btnApply'), ok = $('masterOk');
    if (S.master && !S.dirty) {
      var ex = S.master.filter(function (m) { return m.kind; }).length, keys = C.masterClassKeys(S.master);
      btn.textContent = '✓ 확정됨'; btn.classList.add('done');
      ok.textContent = '이 명렬표로 확정 · ' + (keys.length === 1 ? ((keys[0].grade + ' ' + keys[0].cls).trim() + ' ') : keys.length + '개 학급 ') + S.master.length + '명' + (ex ? ' (좌석 제외 ' + ex + '명)' : '');
      ok.classList.remove('hidden', 'dirty');
    } else {
      btn.textContent = '명렬표 적용'; btn.classList.remove('done');
      if (S.master) { ok.textContent = '고친 내용이 있습니다. 다시 적용하세요'; ok.classList.remove('hidden'); ok.classList.add('dirty'); }
      else ok.classList.add('hidden');
    }
  }
  function markDirty() { S.dirty = true; renderMasterState(); }
  function addRow(focus) {
    var last = S.rows[S.rows.length - 1] || {};
    var n = parseInt(last.no, 10);
    S.rows.push({ grade: last.grade || '', cls: last.cls || '', no: isNaN(n) ? '' : n + 1, name: '', kind: '' });
    markDirty(); renderMaster();
    if (focus) { var el = $('mtbl').querySelector('[data-i="' + (S.rows.length - 1) + '"] [data-f="name"]'); if (el) el.focus(); }
    $('mtbl').scrollTop = $('mtbl').scrollHeight;
  }
  function rowFilled(r) { return String(r.name || '').trim() || String(r.no == null ? '' : r.no).trim(); }
  function addRowsFromMaster(list) {
    var keep = S.rows.filter(rowFilled);
    S.rows = keep.concat(list.map(function (m) { return { grade: m.grade.replace('학년', ''), cls: m.cls.replace('반', ''), no: m.no, name: m.name, kind: m.kind }; }));
    if (S.rows.length < 5) S.rows = S.rows.concat(blankRows(5 - S.rows.length));
    markDirty(); renderMaster(); msg('masterMsg', '');
  }
  function tableToMaster(table) {
    var first = (table[0] || []).map(function (h) { return String(h).trim(); });
    if (first.indexOf('번호') >= 0 && (first.indexOf('이름') >= 0 || first.indexOf('성명') >= 0)) return C.masterFromTable(table);
    return C.masterFromTable([['학년', '반', '번호', '이름', '구분']].concat(table));   // 머리글이 없으면 이 순서로 본다
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
      var wb = XLSX.utils.book_new();   // 인터넷이 없으면 선택 목록 없는 기본 양식
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['학년', '반', '번호', '이름', '구분']]), '학생명렬표');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(NOTE), '안내');
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    }).then(function (buf) { download(buf, '학생명렬표_양식.xlsx'); });
  }

  /* 입력 표 → 확정 */
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
    renderMasterState();
    $('mdet').open = false;                                           // 확정되면 입력표는 접어 둔다
    startClass(key);
    if (S.pendingFile) { var pf = S.pendingFile; S.pendingFile = null; readFile(pf); }
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
  /* 글자 인식 전처리: 흑백으로 바꾸고 표의 긴 선을 지운다(선이 글자를 망치지 않게) */
  function cleanForOcr(cv, scale) {
    var g = cv.getContext('2d'), w = cv.width, h = cv.height, im = g.getImageData(0, 0, w, h), d = im.data;
    var gray = new Uint8Array(w * h), hist = new Array(256).fill(0), i, j, x, y;
    for (i = 0, j = 0; i < d.length; i += 4, j++) { var v = ((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0; gray[j] = v; hist[v]++; }
    var total = w * h, sum = 0, t;
    for (t = 0; t < 256; t++) sum += t * hist[t];
    var wB = 0, sumB = 0, best = 0, th = 128;
    for (t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF, bw = wB * wF * (mB - mF) * (mB - mF);
      if (bw > best) { best = bw; th = t; }
    }
    var bin = new Uint8Array(w * h);                       // 1 = 검은 점
    for (j = 0; j < bin.length; j++) bin[j] = gray[j] < th ? 1 : 0;
    var minH = Math.round(w * 0.05), minV = Math.round(scale * 13.5), run;   // 세로선: 글자 획(약 8pt)보다 길고 표 칸 높이(약 15pt 이상)보다 짧게
    for (y = 0; y < h; y++) {                              // 가로선 지우기
      run = 0;
      for (x = 0; x <= w; x++) {
        if (x < w && bin[y * w + x]) run++;
        else { if (run >= minH) for (var k = x - run; k < x; k++) bin[y * w + k] = 0; run = 0; }
      }
    }
    for (x = 0; x < w; x++) {                              // 세로선 지우기
      run = 0;
      for (y = 0; y <= h; y++) {
        if (y < h && bin[y * w + x]) run++;
        else { if (run >= minV) for (var m = y - run; m < y; m++) bin[m * w + x] = 0; run = 0; }
      }
    }
    for (i = 0, j = 0; i < d.length; i += 4, j++) { var c = bin[j] ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    return cv;
  }
  /* PDF → 쪽별로 읽은 것 [{subject, cls, jaeok, rows}] */
  async function readPdf(file) {
    setStatus('PDF를 읽는 중…', 0.05);
    await loadScript(PDFJS + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    var doc;
    try { doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
    catch (e) { throw new Error('PDF를 열지 못했습니다 (' + errText(e) + '). 암호가 걸렸거나 손상된 파일일 수 있어요.'); }
    var texts = [], n = doc.numPages, p;
    for (p = 1; p <= n; p++) {
      var pg = await doc.getPage(p);
      texts.push(pageLines(await pg.getTextContent()));
      setStatus('표를 읽는 중… ' + p + ' / ' + n, p / n * 0.3);
    }
    var pages = C.parsePdfPages(texts);
    if (pages.some(function (q) { return q.rows.length >= 2; })) return pages;
    // 글자 층이 없는 스캔본 → 글자 인식(OCR)
    setStatus('스캔본으로 보여 글자 인식을 준비하는 중… (처음 한 번 데이터를 내려받습니다)', 0.3);
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    var worker;
    try {
      worker = await Promise.race([window.Tesseract.createWorker('kor', 1, {}), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('시간이 너무 오래 걸립니다')); }, 180000); })]);
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    } catch (e) { throw new Error('스캔본 글자 인식을 준비하지 못했습니다 (' + errText(e) + '). 인터넷 연결(또는 학교 네트워크의 차단)을 확인해 주세요.'); }
    texts = [];
    for (p = 1; p <= n; p++) {
      var page = await doc.getPage(p), vp = page.getViewport({ scale: 3 });
      var cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      texts.push((await worker.recognize(cleanForOcr(cv, 3))).data.text);
      setStatus('표를 읽는 중… ' + p + ' / ' + n, 0.3 + p / n * 0.7);
    }
    await worker.terminate();
    return C.parsePdfPages(texts);
  }
  function renderFileInfo() {
    var f = S.fileInfo, el = $('fileInfo');
    el.classList.toggle('hidden', !f);
    if (!f) return;
    el.innerHTML = '<b>' + esc(f.name) + '</b><span>' + esc(f.kind) + (f.loading ? ' · 읽는 중…' : ' · ' + f.detail) + '</span><button class="sub" id="btnFileAgain">다른 파일</button>';
  }
  function loadSelections(source) {
    S.selSource = source;
    msg('importMsg', '');
    if (!S.master || S.dirty) { if (!applyMaster()) return false; } else startClass(S.classKey);
    return true;
  }
  function errText(e) {
    var m = e && (e.message || (typeof e === 'string' ? e : e.name));
    return m && m !== '[object Object]' ? String(m) : '알 수 없는 오류';
  }
  function readFile(file) {
    var name = file.name.toLowerCase(), job, isPdf = /\.pdf$/.test(name);
    msg('importMsg', '');
    if (!collectMaster().valid.length) {            // 학생 명렬표가 아직 없으면, 입력·확정 뒤에 이어서 읽는다
      S.pendingFile = file;
      S.fileInfo = { name: file.name, kind: isPdf ? 'PDF' : /\.xlsx?$/.test(name) ? '엑셀' : 'CSV', loading: false, detail: '대기 중' }; renderFileInfo();
      $('mdet').open = true;
      msg('importMsg', '먼저 위에서 학생 명렬표를 입력하고 “명렬표 적용”을 눌러 주세요. 그러면 이 파일을 이어서 읽어요.');
      return;
    }
    S.fileInfo = { name: file.name, kind: isPdf ? 'PDF' : /\.xlsx?$/.test(name) ? '엑셀' : 'CSV', loading: true }; renderFileInfo();
    if (isPdf) job = readPdf(file).then(function (pages) {
      setStatus('', null);
      if (!pages.some(function (q) { return q.rows.length; })) throw new Error('표에서 학생 줄을 찾지 못했습니다. 엑셀(CSV)로 올려 보세요.');
      S.fileInfo.pageCount = pages.length;
      loadSelections({ kind: 'pages', pages: pages });
    });
    else job = file.arrayBuffer().then(function (buf) {
      var rows = /\.xlsx?$/.test(name) ? C.rowsToRoster(sheetToTable(buf)) : C.parseRosterText(decodeText(buf));
      loadSelections({ kind: 'entries', entries: rows.map(function (r) { return { grade: r.grade, cls: r.cls, subject: C.stripUnit(r.subjectRaw), no: r.no, name: r.name }; }) });
    });
    job.catch(function (e) { console.error(e); setStatus('', null); S.fileInfo = null; renderFileInfo(); msg('importMsg', '불러오지 못했습니다: ' + errText(e)); });
  }

  /* ---------- 반 시작 / 재생성 ---------- */
  function runMatch(key) {
    var s = S.selSource;
    if (!s) return null;
    return s.kind === 'pages' ? C.matchPages(S.master, s.pages, key) : C.matchSelections(S.master, s.entries, key);
  }
  function makeCls(key) {
    return C.buildClassFromMaster(S.master, key, S.matchInfo ? S.matchInfo.subjects : [], { sortSubjects: S.sortSubjects });
  }
  function newPages() {
    var pages = C.buildPages(S.cls, ctx(), S.seed), N = seatCount();
    if (S.mode === 'manual') pages.forEach(function (p) { p.seats = new Array(N).fill(null); p.overflow = []; p.locked = []; });
    return pages;
  }
  function startClass(key) {
    S.classKey = key; S.manual = {}; S.history = []; S.future = []; S.sel = -1; S.selPool = null; S.cur = 0;
    S.matchInfo = runMatch(key);
    S.cls = makeCls(key);
    S.pages = newPages();
    $('sWork').classList.remove('hidden'); $('sExp').classList.remove('hidden');
    if (S.fileInfo) {
      var m = S.matchInfo;
      S.fileInfo.loading = false;
      S.fileInfo.detail = (S.fileInfo.pageCount ? S.fileInfo.pageCount + '쪽 · ' : '') + '과목 ' + (m ? m.subjects.length : 0) + '개';
      renderFileInfo();
    }
    setStatus('', null);
    render();
  }
  function rebuildAll() {
    if (!S.cls) return;
    push();
    S.cls = makeCls(S.classKey);
    S.pages = newPages(); S.cur = 0; S.sel = -1; S.selPool = null;
    render();
  }

  /* ---------- 좌석표 HTML ---------- */
  function slotMap(L) { var m = {}; L.slotOrder.forEach(function (s, i) { m[s.row + ',' + s.col] = i; }); return m; }
  function hv(r, c, kinds, on) {
    if (!on) return '';
    return '<span class="hv">' + kinds.map(function (k) { return '<button data-cell="' + k[0] + '" data-r="' + r + '" data-c="' + c + '">' + k[1] + '</button>'; }).join('') + '</span>';
  }
  function seatsHtml(pg, opt) {
    var L = curLayout(), sm = slotMap(L), ci = [];
    L.grid[0].forEach(function (t, c) { if (t !== 'gap') ci.push(c); });
    var html = '<div class="seats" style="grid-template-columns:repeat(' + ci.length + ',1fr)">';
    L.grid.forEach(function (row, r) {
      ci.forEach(function (c) {
        var t = row[c], dc = c / 2;
        if (t === 'void') html += '<div class="vcell">' + hv(r, dc, [['seat', '좌석으로']], opt.interactive) + '</div>';
        else if (t === 'x') html += '<div class="xcell">' + hv(r, dc, [['seat', '좌석으로']], opt.interactive) + '</div>';
        else {
          var i = sm[r + ',' + c], no = pg.seats[i], blocked = pg.blocked.indexOf(i) >= 0;
          var locked = no != null && pg.locked.indexOf(no) >= 0;
          var cls = 'seat' + (no == null && !blocked ? ' empty' : '') + (locked ? ' locked' : '') + (blocked ? ' blocked' : '') + (no != null && isPicked(pg, no) ? ' picked' : '') + (opt.sel === i ? ' sel' : '');
          var inner = '<span class="slot">' + (i + 1) + '</span>' + hv(r, dc, [['blank', '빈칸'], ['x', 'X']], opt.interactive);
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
    S.mode = m;
    if (S.cls) { S.pages = newPages(); S.cur = 0; S.sel = -1; S.selPool = null; }
    render();
  }

  /* ---------- 렌더 ---------- */
  function warningsFor(pg) {
    var w = [];
    if (pg.overflow.length) w.push('좌석(' + seatCount() + '개)이 모자라 앉히지 못한 학생: ' + pg.overflow.map(function (n) { return n + ' ' + S.cls.students[n].name; }).join(', '));
    if (C.titleInfo(pg.subject, ONE_MAX).tooLong) w.push('과목명이 12자를 넘어 제목 2행에 다 들어가지 않을 수 있습니다. 한글에서 글자 크기를 줄여 주세요.');
    return w;
  }
  function renderDims() {
    var box = $('dimBox'), man = S.mode === 'manual';
    box.classList.toggle('hidden', !man);
    if (!man) return;
    var c = $('dimCols'), r = $('dimRows');
    if (!c.options.length) {
      c.innerHTML = [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
      r.innerHTML = [1, 2, 3, 4, 5, 6].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
    }
    c.value = String(S.mcols); r.value = String(S.mrows);
  }
  function render() {
    renderModes(); renderDims();
    if (!S.cls) return;
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
      return '<div class="tab' + (i === S.cur ? ' cur' : '') + '" data-i="' + i + '">' + esc(pg.common ? '공통' : pg.subject) + '</div>';
    }).join('');
  }
  function renderPage() {
    var pg = S.pages[S.cur];
    $('thumbView').classList.toggle('hidden', !S.thumbs);
    $('pageView').classList.toggle('hidden', S.thumbs);
    var w = S.thumbs ? [] : warningsFor(pg);
    $('pageWarn').innerHTML = w.length ? '<div class="warn">' + w.map(esc).join(' / ') + '</div>' : '';
    if (S.thumbs) {
      $('thumbView').innerHTML = '<div class="thumbs">' + S.pages.map(function (p, i) {
        return '<div class="thumb' + (i === S.cur ? ' cur' : '') + '" data-go="' + i + '"><div class="paper">' + paperHtml(p, { sel: -1 }) + '</div></div>';
      }).join('') + '</div>';
      return;
    }
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true }) + (pg.common ? '' : '<div class="legend"><i></i>' + esc(pg.subject) + ' 선택 학생</div>');
    var bar = '';
    if (S.sel >= 0) {
      var no = pg.seats[S.sel];
      bar += '<b>슬롯 ' + (S.sel + 1) + (no != null ? ' · ' + no + ' ' + esc(S.cls.students[no].name) : ' · 빈자리') + '</b>';
      if (no != null) bar += '<button class="sub" data-act="lock">' + (pg.locked.indexOf(no) >= 0 ? '고정 해제' : '고정') + '</button><button class="sub" data-act="unseat">자리 빼기</button><button class="sub" data-act="rename">이름 수정</button>';
      bar += '<button class="sub" data-act="cellblank">칸을 빈칸으로</button><button class="sub" data-act="cellx">칸을 X로</button>';
      if (no != null) bar += '<button class="sub" data-act="excl">학생 제외</button>';
      bar += '<button class="sub" data-act="desel">취소</button>';
    }
    $('selbar').innerHTML = bar;
    $('btnReshuffle').disabled = pg.common;
    $('namePanel').classList.toggle('hidden', pg.common); $('pgName').value = pg.subject;
    var ei = $('expInfo');
    if (!pg.common && pg.expected != null) {
      var n = (pg.pick || []).filter(function (x) { return !ctx().excluded(x); }).length;
      ei.textContent = 'PDF 교실재적수 ' + pg.expected + '명 · 색칠 ' + n + '명' + (n === pg.expected ? '' : ' (파란 점으로 맞춰 주세요)');
      ei.classList.toggle('bad', n !== pg.expected); ei.classList.remove('hidden');
    } else ei.classList.add('hidden');
    var pool = unseated(pg);
    $('poolPanel').classList.toggle('hidden', !pool.length);
    $('pool').innerHTML = pool.map(function (n) { return '<span class="chip' + (S.selPool === n ? ' sel' : '') + (isPicked(pg, n) ? ' picked' : '') + '" draggable="true" data-pool="' + n + '"><i>' + n + '</i>' + esc(S.cls.students[n].name) + '</span>'; }).join('');
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
  /* 칸을 빈칸/X로 바꾸거나 좌석으로 되돌린다 — 모든 쪽에 똑같이 적용된다 */
  function setCell(r, c, type) {
    var old = curLayout(), od = { R: curRows(), K: curCols() };
    push();
    curTypes()[r][c] = type;
    relayoutPages(old, od);
    render();
  }
  /* 직접 조정에서 열·행 수를 바꾼다 (오른쪽 아래 기준으로 기존 칸·학생 위치를 유지) */
  function setDims(K, R) {
    if (K === S.mcols && R === S.mrows) return;
    var old = curLayout(), od = { R: curRows(), K: curCols() };
    push();
    S.types.M = C.resizeTypes(S.types.M, K, R); S.mcols = K; S.mrows = R;
    relayoutPages(old, od);
    render();
  }
  function relayoutPages(old, od) {
    var nl = curLayout(), N = nl.slotOrder.length;
    if (S.mode === 'manual') {            // 직접 조정: 학생은 자기 칸에 그대로, 없어진 칸의 학생만 대기로
      var nd = { R: curRows(), K: curCols() }, idx = {};
      nl.slotOrder.forEach(function (s, i) { idx[(s.row + 6 - nd.R) + ',' + (s.col / 2 + 5 - nd.K)] = i; });   // 오른쪽 아래를 기준 좌표로
      S.pages.forEach(function (pg) {
        var seats = new Array(N).fill(null);
        pg.seats.forEach(function (no, i) {
          var o = old.slotOrder[i], k = o ? (o.row + 6 - od.R) + ',' + (o.col / 2 + 5 - od.K) : null;
          if (no != null && k != null && idx[k] != null) seats[idx[k]] = no;
        });
        pg.seats = seats; pg.blocked = []; pg.overflow = [];
        pg.locked = pg.locked.filter(function (no) { return seats.indexOf(no) >= 0; });
      });
    } else {                              // 자동: 앉은 순서(앞자리부터)를 지키며 빈칸·X를 건너뛰고 다시 놓는다
      S.pages.forEach(function (pg) {
        var seq = pg.seats.filter(function (x) { return x != null; }).concat(pg.overflow);
        var seats = new Array(N).fill(null), p = 0;
        for (var i = 0; i < N && p < seq.length; i++) seats[i] = seq[p++];
        pg.seats = seats; pg.overflow = seq.slice(p); pg.blocked = [];
        pg.locked = pg.locked.filter(function (no) { return seats.indexOf(no) >= 0; });
      });
    }
    S.sel = -1; S.selPool = null;
  }

  /* ---------- 내보내기 ---------- */
  function drawPreview(pg) {
    var cv = document.createElement('canvas'); cv.width = 724; cv.height = 1024;
    var g = cv.getContext('2d'), L = C.toTemplateLayout(curLayout(), tplCols());
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
        g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
        if (tp === 'x') { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke(); return; }
        if (tp === 'void') return;
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
  function doExport() {
    var out = $('expMsg'), sel = S.pages.slice();
    var bad = sel.filter(function (p) { return p.overflow.length || unseated(p).length; });
    if (bad.length && !confirm('앉지 못한 학생이 있는 쪽이 있습니다 (' + bad.map(function (p) { return p.subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
    out.textContent = '만드는 중…';
    drawPreview(sel[0]).then(function (png) {
      return H.buildHwpx({ JSZip: window.JSZip, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer },
        b64ToBytes(D.templates[layoutId()]), C.toTemplateLayout(curLayout(), tplCols()),
        sel.map(function (p) { return { subject: p.subject, cells: cellsOf(p) }; }), { previewPng: png, titleOneLineMaxChars: ONE_MAX });
    }).then(function (bytes) {
      var g = (S.cls.grade.match(/\d+/) || [''])[0], c = (S.cls.cls.match(/\d+/) || [''])[0];
      var name = (g && c ? g + '-' + c + '_' : '') + '고사좌석배치표.hwpx';
      download(bytes, name);
      out.textContent = name + ' · ' + sel.length + '쪽';
    }).catch(function (e) { out.textContent = '내보내기 실패: ' + e.message; });
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
      S.rows[+row.dataset.i][f] = e.target.value; markDirty();
    }
    mt.addEventListener('input', onEdit); mt.addEventListener('change', onEdit);
    mt.addEventListener('click', function (e) {
      var d = e.target.dataset && e.target.dataset.del; if (d == null || d === '') return;
      S.rows.splice(+d, 1); if (!S.rows.length) S.rows = blankRows(1);
      markDirty(); renderMaster();
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
    $('fileInfo').onclick = function (e) { if (e.target.id === 'btnFileAgain') file.click(); };

    $('modes').onclick = function (e) { var b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); };
    $('dimCols').onchange = $('dimRows').onchange = function () { setDims(+$('dimCols').value, +$('dimRows').value); };
    $('clsSel').onchange = function (e) { startClass(e.target.value); };
    $('sortSub').onchange = function (e) { S.sortSubjects = e.target.value; rebuildAll(); };
    $('btnReshuffle').onclick = function () { var pg = cur(); if (pg.common) return; push(); C.reshuffle(pg, Math.floor(Math.random() * 1e9), ctx()); S.sel = -1; render(); };
    $('pgName').onchange = function (e) {
      var pg = cur(), v = e.target.value.trim(); if (pg.common || !v || v === pg.subject) { e.target.value = pg.subject; return; }
      push(); pg.subject = v; render();
    };

    $('tabs').onclick = function (e) {
      var go = e.target.closest('[data-i]');
      if (go) { S.cur = +go.dataset.i; S.sel = -1; S.selPool = null; render(); }
    };
    $('thumbView').onclick = function (e) { var t = e.target.closest('[data-go]'); if (!t) return; S.cur = +t.dataset.go; S.sel = -1; S.thumbs = false; render(); };
    $('btnView').onclick = function () { S.thumbs = !S.thumbs; render(); };
    $('btnUndo').onclick = function () { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); render(); };
    $('btnRedo').onclick = function () { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); render(); };

    var paper = $('paper');
    paper.onclick = function (e) {
      var hb = e.target.closest('[data-cell]');
      if (hb) { setCell(+hb.dataset.r, +hb.dataset.c, hb.dataset.cell); return; }
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
      var slot = curLayout().slotOrder[S.sel];
      if (a === 'lock') toggleLock();
      else if (a === 'unseat') unseat(S.sel);
      else if (a === 'rename') { var rn = cur().seats[S.sel]; if (rn != null) renameStudent(rn); }
      else if (a === 'cellblank' && slot) setCell(slot.row, slot.col / 2, 'blank');
      else if (a === 'cellx' && slot) setCell(slot.row, slot.col / 2, 'x');
      else if (a === 'excl') { var no = cur().seats[S.sel]; if (no != null) setExcluded(no, true); }
      else if (a === 'desel') { S.sel = -1; render(); }
    };
    $('stulist').onchange = function (e) { var no = e.target.dataset && e.target.dataset.stu; if (no != null) setExcluded(+no, !e.target.checked); };
    $('stulist').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (b) togglePick(+b.dataset.pick); };
    $('btnExport').onclick = doExport;
  }
  bind();
  renderMaster();
  renderMasterState();
  renderModes();
})();
