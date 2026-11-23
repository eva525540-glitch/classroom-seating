/* 화면(UI) — 모든 처리는 브라우저 안에서만 한다. 명렬표는 저장하지 않는다. */
(function () {
  'use strict';
  var C = window.SeatCore, H = window.SeatHwpx, D = window.SEAT_DATA;
  var LAYOUTS = D.layouts.layouts, ONE_MAX = D.layouts.titleOneLineMaxChars;
  /* 화면 파일(index.html)이 오래되어 요소가 없으면 오류로 멈추지 않고 알려 준다 */
  var missing = [];
  var $ = function (id) {
    var el = document.getElementById(id);
    if (!el) { missing.push(id); console.warn('화면 요소 없음: #' + id); return document.createElement('div'); }
    return el;
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function blankRows(n) { var a = []; for (var i = 0; i < n; i++) a.push({ grade: '', cls: '', no: '', name: '', kind: '' }); return a; }
  var S = {
    rows: blankRows(5),                                            // 학생 명렬표(입력 중인 표)
    master: null, dirty: true,                                      // 확정된 학생 명렬표
    subjectsBy: {}, mergesBy: {}, mergeOpen: false, mergeIds: [], openSub: -1,                                    // 학급별 선택과목(추가한 순서) 목록
    classKey: null, cls: null,
    mode: 'A',                                                      // 'A' 4열 | 'B' 5열 | 'manual' 직접 조정
    types: { A: C.defaultTypes(4), B: C.defaultTypes(5), M: C.defaultTypes(4, 6) }, mcols: 4, mrows: 6, undo: [],
    seed: 1, keywords: C.DEFAULT_KEYWORDS.slice(),
    manual: {}, pages: [], cur: 0, sel: -1, selPool: null, thumbs: false
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
  /* 되돌리기: 현재 쪽의 좌석 상태를 직전으로 (좌석을 바꾸는 조작 직전에 저장, 배치도 크기·X가 바뀌면 비운다) */
  function push() {
    var pg = S.pages[S.cur]; if (!pg) return;
    S.undo.push({ page: pg, seats: pg.seats.slice(), locked: pg.locked.slice(), overflow: pg.overflow.slice(), cleared: !!pg.cleared });
    if (S.undo.length > 50) S.undo.shift();
  }
  function isPicked(pg, no) { return !pg.common && !!pg.pick && pg.pick.indexOf(no) >= 0; }
  /* 색: 첫째 과목 옅은 주황, 둘째 옅은 초록, 셋째부터 비슷한 명도의 다른 색 (합본에서 과목 순서 = 쪽 오른쪽의 합친 순서) */
  var PAL = ['#FFE6D8', '#D5EBE2', '#D8E6FA', '#E8DEF4', '#F4ECD2', '#F8DEE8', '#DDEFD0', '#D6EEF2'];
  function colorOf(pg, no) {       // 이 학생이 칠해지는 색 (선택 학생이 아니면 null). 합본은 학생이 속한 첫 과목 순서의 색
    if (!isPicked(pg, no)) return null;
    if (pg.mid) {
      var m = (S.mergesBy[S.classKey] || []).filter(function (q) { return q.id === pg.mid; })[0], out = null;
      if (m) m.ids.forEach(function (id, k) {
        var x = subById(id); if (!out && x && x.nos.indexOf(no) >= 0) out = PAL[k % PAL.length];
      });
      return out || PAL[0];
    }
    return PAL[0];
  }
  function cellsOf(pg) { return pg.seats.map(function (no) { return no == null ? null : { no: no, name: S.cls.students[no].name, picked: isPicked(pg, no), color: colorOf(pg, no) }; }); }
  function unseated(pg) {
    var c = ctx();
    return pg.nos.filter(function (no) { return !c.excluded(no) && pg.seats.indexOf(no) < 0; });
  }
  function msg(id, text) { var el = $(id); el.textContent = text || ''; el.classList.toggle('hidden', !text); }
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
      var cnt = function (k) { return S.master.filter(function (m) { return m.kind === k; }).length; }, keys = C.masterClassKeys(S.master);
      btn.textContent = '✓ 확정됨'; btn.classList.add('done');
      ok.textContent = (keys.length > 1 ? keys.length + '개 학급 · ' : '') + '재적: ' + S.master.length + '명 · 자퇴생: ' + cnt('자퇴') + '명 · 통합지원반: ' + cnt('통합지원반') + '명 · 전출생: ' + cnt('전출') + '명 · 별도고사실: ' + cnt('별도고사실') + '명';
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
      if (/\.xlsx?$/.test(name) && typeof XLSX !== 'undefined') {
        var wb0 = XLSX.read(buf, { type: 'array' });
        if (isWorkBook(wb0)) { restoreWork(wb0); return; }       // 이 앱에서 저장한 파일이면 작업 전체를 복원
        var cr0 = combinedFromWorkbook(wb0);
        if (cr0) { applyCombined(cr0); return; }                   // 학생 + 선택과목이 같이 있는 명단이면 자동 분류
      }
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

  /* ---------- ② 선택과목 (추가한 순서대로) ---------- */
  var nid = 0;
  function subs() { var k = S.classKey; if (!S.subjectsBy[k]) S.subjectsBy[k] = []; return S.subjectsBy[k]; }
  function merges() { var k = S.classKey; if (!S.mergesBy[k]) S.mergesBy[k] = []; return S.mergesBy[k]; }
  function subById(id) { return subs().filter(function (x) { return x.id === id; })[0]; }
  function mergeName(m) { return m.name || m.ids.map(function (id) { var x = subById(id); return x ? x.name : ''; }).join('/'); }
  function mergeNos(m) {          // 합친 순서(쪽 오른쪽에서 조정)대로, 과목 안에서는 번호순 (겹치면 앞 과목에 둔다)
    var seen = {}, out = [];
    m.ids.forEach(function (id) {
      var x = subById(id); if (!x) return;
      x.nos.slice().sort(function (a, b) { return a - b; }).forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
    });
    return out;
  }
  function subList(key) {
    var save = S.classKey; S.classKey = key;
    var out = subs().map(function (x) { return { id: x.id, subject: x.name, nos: x.nos.slice(), expected: null }; })
      .concat(merges().map(function (m) { return { id: m.id, ordered: true, subject: mergeName(m), nos: mergeNos(m), expected: null }; }));
    S.classKey = save; return out;
  }
  function syncSubs() {            // 좌석 확인에서 바꾼 이름·선택 학생을 목록에 반영
    if (!S.cls) return;
    var n = subs().length;
    subs().forEach(function (x, i) { var pg = S.pages[i + 1]; if (pg) { x.name = pg.subject; x.nos = (pg.pick || []).slice(); } });
    merges().forEach(function (m, j) { var pg = S.pages[n + 1 + j]; if (pg) pg.subject = mergeName(m); });
  }
  function reseat(idx) {           // 지정한 쪽만 다시 배치 (선택 학생 먼저 → 번호순)
    S.cls.subjects = subList(S.classKey);
    var fresh = newPages();
    idx.forEach(function (i) { if (fresh[i]) S.pages[i] = fresh[i]; });
  }
  function mergePages() { var n = subs().length, r = []; merges().forEach(function (m, j) { r.push(n + 1 + j); }); return r; }
  function addSubject(name) {
    if (!S.cls) { msg('subMsg', '먼저 학생 명렬표를 적용하세요.'); return; }
    msg('subMsg', '');
    syncSubs();
    var list = subs(), n = list.length;
    name = String(name || '').trim() || '선택과목 ' + (n + 1);
    list.push({ id: 's' + (++nid), name: name, nos: [] });
    S.cls.subjects = subList(S.classKey);
    var fresh = newPages();
    S.pages.splice(n + 1, 0, fresh[n + 1]);
    S.openSub = n; S.cur = n + 1; S.sel = -1; S.selPool = null;
    render();
  }
  function removeSubject(i) {
    var x = subs()[i]; if (!x) return;
    if (!confirm('“' + x.name + '” 과목을 삭제할까요?')) return;
    syncSubs();
    var n = subs().length, ml = merges();
    for (var j = ml.length - 1; j >= 0; j--) {       // 합본에서도 빠진다 (과목이 1개 이하로 남으면 합본 삭제)
      ml[j].ids = ml[j].ids.filter(function (id) { return id !== x.id; });
      if (ml[j].ids.length < 2) { ml.splice(j, 1); S.pages.splice(n + 1 + j, 1); }
    }
    subs().splice(i, 1); S.pages.splice(i + 1, 1);
    reseat(mergePages());
    S.openSub = -1; S.cur = Math.min(S.cur, S.pages.length - 1); S.sel = -1; S.selPool = null;
    render();
  }
  function moveSubject(i, d) {
    var j = i + d, list = subs();
    if (j < 0 || j >= list.length) return;
    syncSubs();
    var t = list[i]; list[i] = list[j]; list[j] = t;
    t = S.pages[i + 1]; S.pages[i + 1] = S.pages[j + 1]; S.pages[j + 1] = t;
    if (S.openSub === i) S.openSub = j; else if (S.openSub === j) S.openSub = i;
    if (S.cur === i + 1) S.cur = j + 1; else if (S.cur === j + 1) S.cur = i + 1;
    render();
  }
  function setSubjectPick(i, nos) {
    syncSubs();
    var id = subs()[i].id;
    subs()[i].nos = nos;
    reseat([i + 1].concat(mergePages().filter(function (pi) { return merges()[pi - subs().length - 1].ids.indexOf(id) >= 0; })));
    S.sel = -1; S.selPool = null;
    render();
  }
  function addMerge(ids) {
    if (ids.length < 2) { msg('mergeMsg', '합칠 과목을 2개 이상 고르세요.'); return; }
    msg('mergeMsg', '');
    syncSubs();
    merges().push({ id: 'm' + (++nid), ids: ids, name: '' });
    S.cls.subjects = subList(S.classKey);
    var fresh = newPages();
    S.pages.push(fresh[fresh.length - 1]);
    S.cur = S.pages.length - 1; S.sel = -1; S.selPool = null; S.mergeOpen = false; S.mergeIds = [];
    render();
  }
  function curMerge() { var pg = cur(); return pg && pg.mid ? merges()[S.pages.indexOf(pg) - subs().length - 1] : null; }
  function moveMerged(k, d) {
    var m = curMerge(); if (!m) return;
    var j = k + d; if (j < 0 || j >= m.ids.length) return;
    var t = m.ids[k]; m.ids[k] = m.ids[j]; m.ids[j] = t;
    syncSubs(); reseat([S.cur]); S.sel = -1; S.selPool = null; render();
  }
  function renderMergeOrder() {
    var m = curMerge(), el = $('mergeOrder');
    el.classList.toggle('hidden', !m);
    if (!m) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="mo-t">합친 순서</div>' + m.ids.map(function (id, k) {
      var x = subById(id);
      return '<div class="mo"><i style="background:' + PAL[k % PAL.length] + '"></i><span>' + esc(x ? x.name : '') + '</span>' +
        '<button class="sub mini mv" data-mo="' + k + '" data-d="-1"' + (k === 0 ? ' disabled' : '') + ' aria-label="위로">▲</button>' +
        '<button class="sub mini mv" data-mo="' + k + '" data-d="1"' + (k === m.ids.length - 1 ? ' disabled' : '') + ' aria-label="아래로">▼</button></div>';
    }).join('');
  }
  function clearSeats() {          // 현재 쪽의 모든 학생을 배치 대기로
    var pg = cur(); push();
    pg.seats = new Array(pg.seats.length).fill(null); pg.locked = []; pg.overflow = []; pg.cleared = true;
    S.sel = -1; S.selPool = null; render();
  }
  function resetSeats() {          // 지금 칸 구성(X 포함)에서 기본 규칙(선택 과목 먼저 → 번호순)으로 다시 앉힌다
    var pg = cur(); push();
    S.cls.subjects = subList(S.classKey);
    var f = newPages()[S.cur];
    pg.seats = f.seats; pg.overflow = f.overflow; pg.locked = []; pg.blocked = []; pg.cleared = false;
    S.sel = -1; S.selPool = null; render();
  }
  function undoClear() {
    while (S.undo.length) {
      var u = S.undo.pop(), i = S.pages.indexOf(u.page);
      if (i < 0 || u.seats.length !== u.page.seats.length) continue;
      u.page.seats = u.seats; u.page.locked = u.locked; u.page.overflow = u.overflow; u.page.cleared = u.cleared;
      S.cur = i; S.sel = -1; S.selPool = null; render(); return;
    }
  }
  function blankSeat(slot) {       // 그 좌석을 빈자리로 (학생은 배치 대기로, 좌석은 그대로 남아 언제든 학생을 옮길 수 있다)
    var pg = cur(), no = pg.seats[slot]; if (no == null) return;
    push(); pg.seats[slot] = null;
    var l = pg.locked.indexOf(no); if (l >= 0) pg.locked.splice(l, 1);
    S.sel = -1; render();
  }
  function removeMerge(j) {
    syncSubs();
    var n = subs().length;
    merges().splice(j, 1); S.pages.splice(n + 1 + j, 1);
    S.cur = Math.min(S.cur, S.pages.length - 1); S.sel = -1;
    render();
  }
  function renderSubjects() {
    var box = $('subList');
    if (!S.cls) { box.innerHTML = ''; return; }
    var list = subs();
    box.innerHTML = list.map(function (x, i) {
      var open = S.openSub === i, set = {};
      x.nos.forEach(function (n) { set[n] = 1; });
      var body = open ? '<div class="subbody"><div class="subtools"><button class="sub mini" data-suball="' + i + '">전체 선택</button><button class="sub mini" data-subnone="' + i + '">전체 해제</button></div><div class="stuchips">' +
        S.cls.studentList.map(function (st) {
          return '<label class="sc' + (set[st.no] ? ' on' : '') + '"><input type="checkbox" data-subpick="' + i + '" data-no="' + st.no + '"' + (set[st.no] ? ' checked' : '') + '><i>' + st.no + '</i>' + esc(st.name) + '</label>';
        }).join('') + '</div></div>' : '';
      return '<div class="subcard' + (open ? ' open' : '') + '"><div class="subhead"><span class="idx">' + (i + 1) + '</span>' +
        '<input type="text" class="subname" data-subname="' + i + '" value="' + esc(x.name) + '" aria-label="과목명">' +
        '<span class="cnt">' + x.nos.length + '명</span>' +
        '<button class="sub mini mv" data-submv="' + i + '" data-d="-1" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="sub mini mv" data-submv="' + i + '" data-d="1" aria-label="아래로"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '<button class="sub mini" data-subopen="' + i + '">' + (open ? '접기' : '학생 선택') + '</button>' +
        '<button class="sub mini del" data-subdel="' + i + '" aria-label="과목 삭제">삭제</button></div>' + body + '</div>';
    }).join('');
  }
  function renderMerge() {
    var box = $('mergeBox'), has = S.cls && subs().length >= 2;
    $('btnMerge').classList.toggle('hidden', !has);
    box.classList.toggle('hidden', !has || !S.mergeOpen);
    if (!has) return;
    var ids = S.mergeIds || [];
    $('mergePick').innerHTML = subs().map(function (x) {
      var k = ids.indexOf(x.id);
      return '<label class="ep' + (k >= 0 ? ' on' : '') + '"><input type="checkbox" data-mg="' + x.id + '"' + (k >= 0 ? ' checked' : '') + '>' + esc(x.name) + '</label>';
    }).join('');
  }
  function renderExportPick() {
    var el = $('expPick'); if (!el) return;
    el.innerHTML = S.pages.map(function (pg, i) {
      return '<label class="ep' + (pg.skipExp ? '' : ' on') + '"><input type="checkbox" data-ep="' + i + '"' + (pg.skipExp ? '' : ' checked') + '>' + esc(pg.common ? '공통' : pg.subject) + '</label>';
    }).join('');
  }

  /* ---------- 작업 저장 / 불러오기 (엑셀) ----------
   * 시트 2개: 학생명렬표 · 선택과목(학생 × 과목 표, 선택한 칸에 ●). 합친 쪽·배치 방식은 저장하지 않는다. */
  function saveWork() {
    if (!S.master || !S.cls) { msg('subMsg', '먼저 학생 명렬표를 적용하세요.'); return; }
    if (typeof XLSX === 'undefined') { msg('subMsg', '엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'); return; }
    msg('subMsg', ''); syncSubs();
    var wb = XLSX.utils.book_new(), keys = C.masterClassKeys(S.master), save = S.classKey;
    var num = function (t, u) { return String(t).replace(u, ''); };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['학년', '반', '번호', '이름', '구분']].concat(S.master.map(function (m) { return [num(m.grade, '학년'), num(m.cls, '반'), m.no, m.name, m.kind || '']; }))), '학생명렬표');
    var names = [], sel = {};                       // 과목 열 순서 = 추가한 순서 (학급이 여럿이면 처음 나온 순서대로 이어 붙인다)
    keys.forEach(function (k) {
      S.classKey = k.key;
      subs().forEach(function (x) {
        if (names.indexOf(x.name) < 0) names.push(x.name);
        x.nos.forEach(function (n) { sel[k.key + '|' + n + '|' + x.name] = 1; });
      });
    });
    var rows = [['학년', '반', '번호', '이름', '구분'].concat(names)], cnt = names.map(function () { return 0; });
    S.master.forEach(function (m) {
      var r = [num(m.grade, '학년'), num(m.cls, '반'), m.no, m.name, m.kind || ''];
      names.forEach(function (nm, i) { var on = sel[m.grade + '|' + m.cls + '|' + m.no + '|' + nm]; r.push(on ? '●' : ''); if (on) cnt[i]++; });
      rows.push(r);
    });
    rows.push(['', '', '', '선택 인원', ''].concat(cnt.map(function (n) { return n + '명'; })));
    S.classKey = save;
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 12 }, { wch: 12 }].concat(names.map(function (n) { return { wch: Math.max(8, n.length * 2 + 2) }; }));
    XLSX.utils.book_append_sheet(wb, ws, '선택과목');
    var f = S.cls.grade.replace('학년', ''), c = S.cls.cls.replace('반', '');
    var name = '좌석배치_학생_선택과목' + (keys.length === 1 && f && c ? '_' + f + '-' + c : '') + '.xlsx';
    download(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), name);
    var ok = $('subOk'); ok.textContent = name + ' 으로 저장했어요'; ok.classList.remove('hidden');
  }
  /* ---------- 선택과목 명렬표 자동 분류 (학생 + 선택과목이 한 표에 있는 엑셀) ---------- */
  function combinedFromWorkbook(wb) {
    for (var i = 0; i < wb.SheetNames.length; i++) {
      var t = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]], { header: 1, raw: false, defval: '' }), r = C.parseCombinedRoster(t);
      if (r) return r;
    }
    return null;
  }
  function applyCombined(r) {
    S.rows = r.master.map(function (m) { return { grade: m.grade.replace('학년', ''), cls: m.cls.replace('반', ''), no: m.no, name: m.name, kind: m.kind }; });
    S.subjectsBy = {}; S.mergesBy = {}; S.mergeOpen = false; S.mergeIds = []; S.openSub = -1; S.undo = []; S.classKey = null;
    r.subjects.forEach(function (sj) {                    // 학급마다 그 학급 학생이 고른 과목만, 파일에 나온 순서대로
      var by = {};
      sj.picks.forEach(function (pk) { (by[pk.key] = by[pk.key] || []).push(pk.no); });
      Object.keys(by).forEach(function (k) {
        (S.subjectsBy[k] = S.subjectsBy[k] || []).push({ id: 's' + (++nid), name: sj.name, nos: by[k].filter(function (n, i, a) { return a.indexOf(n) === i; }) });
      });
    });
    renderMaster();
    if (!applyMaster()) return false;
    var keys = C.masterClassKeys(S.master).length;
    var ok = $('subOk');
    ok.textContent = '자동 분류했어요 · 학생 ' + S.master.length + '명 · 학급 ' + keys + '개 · 과목 ' + r.subjects.length + '개' +
      (r.special ? ' · 비고의 “특수” ' + r.special + '명은 통합지원반(좌석 제외)으로 분류했어요. 01에서 바꿀 수 있어요' : '');
    ok.classList.remove('hidden');
    return true;
  }
  function loadCombinedFile(file) {
    msg('subMsg', ''); $('subOk').classList.add('hidden');
    var name = file.name.toLowerCase();
    file.arrayBuffer().then(function (buf) {
      var r;
      if (/\.xlsx?$/.test(name)) {
        if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 라이브러리를 불러오지 못했습니다.');
        r = combinedFromWorkbook(XLSX.read(buf, { type: 'array' }));
      } else r = C.parseCombinedRoster(C.parseDelimited(decodeText(buf)));
      if (!r) throw new Error('학생과 선택과목을 나눌 수 없습니다. 머리글에 “학번”과 “이름”이 있고 과목 열이 있어야 해요.');
      applyCombined(r);
    }).catch(function (e) { msg('subMsg', '불러오지 못했습니다: ' + errText(e)); });
  }

  function isWorkBook(wb) { return !!(wb.Sheets['선택과목'] && (wb.Sheets['학생명렬표'] || S.master)); }
  function restoreWork(wb) {
    var T = function (n) { return wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) : []; };
    var keyOf = function (g, c) { return C.normGrade(g) + '|' + C.normCls(c); };
    var roster = wb.Sheets['학생명렬표'] ? tableToMaster(T('학생명렬표')) : null;
    if (roster && !roster.length) throw new Error('학생명렬표 시트에 학생이 없습니다.');
    var tab = T('선택과목'), head = (tab[0] || []).map(function (h) { return String(h).trim(); });
    var cn = head.indexOf('번호'), nn = head.indexOf('이름');
    var classes = roster ? C.masterClassKeys(roster).map(function (k) { return k.key; }) : C.masterClassKeys(S.master).map(function (k) { return k.key; });
    S.subjectsBy = {}; S.mergesBy = {}; S.mergeOpen = false; S.mergeIds = []; S.openSub = -1; S.undo = [];
    if (cn >= 0) {                                    // 학생 × 과목 표
      var cols = [];
      for (var c = Math.max(cn, nn) + 1; c < head.length; c++) if (head[c] && head[c] !== '구분') cols.push(c);
      classes.forEach(function (k) { S.subjectsBy[k] = cols.map(function (c) { return { id: 's' + (++nid), name: head[c], nos: [] }; }); });
      tab.slice(1).forEach(function (r) {
        var no = parseInt(String(r[cn]).trim(), 10); if (isNaN(no)) return;
        var k = head.indexOf('학년') >= 0 ? keyOf(r[head.indexOf('학년')], r[head.indexOf('반')]) : classes[0], list = S.subjectsBy[k];
        if (list) cols.forEach(function (c, i) { if (String(r[c]).trim()) list[i].nos.push(no); });
      });
    } else {                                          // 이전 형식(과목 한 줄에 번호 나열)도 읽는다
      tab.slice(1).filter(function (r) { return String(r[3]).trim(); }).sort(function (a, b) { return (+a[2] || 0) - (+b[2] || 0); }).forEach(function (r) {
        var k = keyOf(r[0], r[1]); (S.subjectsBy[k] = S.subjectsBy[k] || []).push({ id: 's' + (++nid), name: String(r[3]).trim(), nos: (String(r[4]).match(/\d+/g) || []).map(Number) });
      });
    }
    if (roster) {
      S.rows = roster.map(function (m) { return { grade: m.grade.replace('학년', ''), cls: m.cls.replace('반', ''), no: m.no, name: m.name, kind: m.kind }; });
      renderMaster();
      if (!applyMaster()) throw new Error('학생 명렬표에 고칠 곳이 있습니다. 01의 안내를 확인하세요.');
    } else startClass(S.classKey);
    var n = (S.subjectsBy[S.classKey] || []).length;
    var ok = $('subOk'); ok.textContent = '불러왔어요 · 과목 ' + n + '개'; ok.classList.remove('hidden');
  }
  function loadWorkFile(file) {
    msg('subMsg', ''); $('subOk').classList.add('hidden');
    file.arrayBuffer().then(function (buf) {
      if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 라이브러리를 불러오지 못했습니다.');
      var wb = XLSX.read(buf, { type: 'array' });
      if (!isWorkBook(wb)) {
        var cr = combinedFromWorkbook(wb);
        if (cr) { applyCombined(cr); return; }
        throw new Error('이 앱에서 저장한 엑셀 파일이 아닙니다. (선택과목 시트가 없어요)');
      }
      restoreWork(wb);
    }).catch(function (e) { msg('subMsg', '불러오지 못했습니다: ' + errText(e)); });
  }
  function errText(e) { var m = e && (e.message || (typeof e === 'string' ? e : e.name)); return m && m !== '[object Object]' ? String(m) : '알 수 없는 오류'; }

  /* ---------- 반 시작 / 재생성 ---------- */
  function makeCls(key) {
    return C.buildClassFromMaster(S.master, key, subList(key), {});
  }
  function newPages() {
    var pages = C.buildPages(S.cls, ctx(), S.seed), N = seatCount();
    return pages;
  }
  function startClass(key) {
    S.classKey = key; S.manual = {}; S.sel = -1; S.selPool = null; S.cur = 0;
    S.cls = makeCls(key);
    S.pages = newPages();
    $('sWork').classList.remove('hidden'); $('sExp').classList.remove('hidden');
    renderSubjects();
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
    return '<span class="hv">' + kinds.map(function (k) { return '<button data-cell="' + k[0] + '" data-r="' + r + '" data-c="' + c + '"' + (k[0] === 'seat' ? ' title="좌석으로 되돌리기" aria-label="좌석으로 되돌리기"' : k[0] === 'blank' ? ' class="bl" title="빈자리로 (좌석은 남김)" aria-label="빈자리로"' : ' title="이 칸 제외(X)" aria-label="이 칸 제외(X)"') + '>' + k[1] + '</button>'; }).join('') + '</span>';
  }
  function seatsHtml(pg, opt) {
    var L = curLayout(), sm = slotMap(L), ci = [];
    L.grid[0].forEach(function (t, c) { if (t !== 'gap') ci.push(c); });
    var html = '<div class="seats" style="grid-template-columns:repeat(' + ci.length + ',minmax(0,1fr))">';
    L.grid.forEach(function (row, r) {
      ci.forEach(function (c) {
        var t = row[c], dc = c / 2;
        if (t === 'void') html += '<div class="vcell">' + hv(r, dc, [['seat', '↺']], opt.interactive) + '</div>';
        else if (t === 'x') html += '<div class="xcell">' + hv(r, dc, [['seat', '↺']], opt.interactive) + '</div>';
        else {
          var i = sm[r + ',' + c], no = pg.seats[i], blocked = pg.blocked.indexOf(i) >= 0;
          var locked = no != null && pg.locked.indexOf(no) >= 0;
          var cls = 'seat' + (no == null && !blocked ? ' empty' : '') + (locked ? ' locked' : '') + (blocked ? ' blocked' : '') + (no != null && isPicked(pg, no) ? ' picked' : '') + (opt.sel === i ? ' sel' : '');
          var bg = no != null && isPicked(pg, no) ? ' style="background:' + colorOf(pg, no) + '"' : '';
          var inner = '<span class="slot">' + (i + 1) + '</span>' + hv(r, dc, no != null ? [['blank', '빈칸'], ['x', 'X']] : [['x', 'X']], opt.interactive);
          if (blocked) inner += '<span class="nm">비움</span>';
          else if (no != null) inner += '<span class="no">' + no + '</span><span class="nm">' + esc(S.cls.students[no].name) + '</span>' + (locked ? '<span class="tag">●</span>' : '');
          html += '<div class="' + cls + '" data-slot="' + i + '"' + (no != null ? ' title="' + no + ' ' + esc(S.cls.students[no].name) + '"' : '') + bg + (opt.interactive && !blocked && no != null ? ' draggable="true"' : '') + '>' + inner + '</div>';
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
    S.mode = m;
    if (S.cls) { syncSubs(); S.cls.subjects = subList(S.classKey); S.undo = []; S.pages = newPages(); S.cur = 0; S.sel = -1; S.selPool = null; }
    render();
  }

  /* ---------- 렌더 ---------- */
  function warningsFor(pg) {
    var w = [];
    if (pg.overflow.length) w.push('좌석(' + seatCount() + '개)이 모자라 앉히지 못한 학생: ' + pg.overflow.map(function (n) { return n + ' ' + S.cls.students[n].name; }).join(', '));
    return w;
  }
  function renderDims() {
    var box = $('dimBox'), man = S.mode === 'manual';
    box.classList.toggle('hidden', !man);
    if (!man) return;
    var c = $('dimCols'), r = $('dimRows');
    if (!c.options.length) {
      c.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
      r.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
    }
    c.value = String(S.mcols); r.value = String(S.mrows);
  }
  function render() {
    renderModes(); renderDims();
    if (!S.cls) return;
    $('btnView').textContent = S.thumbs ? '한 쪽씩' : '전체 보기';
    syncSubs();
    var ae = document.activeElement;
    if (!(ae && ae.classList && ae.classList.contains('subname'))) renderSubjects();
    renderMerge(); renderExportPick();
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
      return '<div class="tab' + (i === S.cur ? ' cur' : '') + (pg.mid ? ' mg' : '') + '" data-i="' + i + '">' + esc(pg.common ? '공통' : pg.subject) + '</div>';
    }).join('');
  }
  function legendHtml(pg) {
    var items = [];
    if (pg.mid) {
      var m = merges().filter(function (q) { return q.id === pg.mid; })[0];
      if (m) m.ids.forEach(function (id, k) { var x = subById(id); if (x) items.push([PAL[k % PAL.length], x.name + ' 선택 학생']); });
    } else items.push([PAL[0], pg.subject + ' 선택 학생']);
    return '<div class="legend">' + items.map(function (q) { return '<span><i style="background:' + q[0] + '"></i>' + esc(q[1]) + '</span>'; }).join('') + '</div>';
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
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true }) + (pg.common ? '' : legendHtml(pg));
    var bar = '';
    if (S.sel >= 0) {
      var no = pg.seats[S.sel];
      bar += '<b>슬롯 ' + (S.sel + 1) + (no != null ? ' · ' + no + ' ' + esc(S.cls.students[no].name) : ' · 빈자리') + '</b>';
      if (no != null) bar += '<button class="sub" data-act="lock">' + (pg.locked.indexOf(no) >= 0 ? '고정 해제' : '고정') + '</button><button class="sub" data-act="unseat">자리 빼기</button><button class="sub" data-act="rename">이름 수정</button>';
      bar += '<button class="sub" data-act="cellx">칸을 X로</button>';
      if (no != null) bar += '<button class="sub" data-act="excl">학생 제외</button>';
      bar += '<button class="sub" data-act="desel">취소</button>';
    }
    $('selbar').innerHTML = bar;
    $('namePanel').classList.toggle('hidden', pg.common); $('btnUnmerge').classList.toggle('hidden', !pg.mid); $('pgName').value = pg.subject; renderMergeOrder();
    $('btnUndoClear').disabled = !S.undo.length;
    var pool = unseated(pg);
    $('poolPanel').classList.toggle('hidden', !pool.length);
    $('pool').innerHTML = pool.map(function (n) { return '<span class="chip' + (S.selPool === n ? ' sel' : '') + (isPicked(pg, n) ? ' picked' : '') + '"' + (isPicked(pg, n) ? ' style="background:' + colorOf(pg, n) + '"' : '') + ' draggable="true" data-pool="' + n + '"><i>' + n + '</i>' + esc(S.cls.students[n].name) + '</span>'; }).join('');
    renderStudents(pg);
  }
  function renderStudents(pg) {
    var c = ctx();
    $('stulist').innerHTML = S.cls.studentList.map(function (s) {
      var ex = c.excluded(s.no);
      return '<div class="rw"><label><input type="checkbox" data-stu="' + s.no + '"' + (ex ? '' : ' checked') + '><span class="' + (ex ? 'ex' : '') + '">' + s.no + ' ' + esc(s.name) + '</span>' + (s.kind ? '<span class="nt">' + esc(s.kind) + '</span>' : '') + '</label>' +
        (pg.common || pg.mid ? '' : '<button class="pk' + (isPicked(pg, s.no) ? ' on' : '') + '" data-pick="' + s.no + '" title="이 과목 선택 학생" aria-label="이 과목 선택 학생"></button>') + '</div>';
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
    S.manual[no] = excluded;
    var auto = S.cls.students[no].notes.some(function (n) { return C.noteExcluded(n, S.keywords); });
    if (auto === excluded) delete S.manual[no];
    S.pages.forEach(function (p) { C.applyExclusion(p, no, excluded, ctx()); });
    S.sel = -1; render();
  }
  function togglePick(no) {
    var pg = cur(); if (pg.common || pg.mid) return;
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
      nl.slotOrder.forEach(function (s, i) { idx[(s.row + 8 - nd.R) + ',' + (s.col / 2 + 8 - nd.K)] = i; });   // 오른쪽 아래를 기준 좌표로
      S.cls.subjects = subList(S.classKey);
      var fresh = newPages();
      S.pages.forEach(function (pg, pi) {
        var last = -1, hole = false;
        pg.seats.forEach(function (x, i) { if (x != null) last = i; });
        pg.seats.forEach(function (x, i) { if (x == null && i < last) hole = true; });
        if (!pg.cleared && !hole && fresh[pi]) {      // 빈 자리 없이 앞부터 채워진 쪽: 앉은 순서를 지키며 앞(1번)부터 다시 채운다
          var seq = pg.seats.filter(function (x) { return x != null; });
          fresh[pi].seats.concat(fresh[pi].overflow).forEach(function (no) { if (no != null && seq.indexOf(no) < 0 && !ctx().excluded(no)) seq.push(no); });
          var st = new Array(N).fill(null), q = 0;
          for (var k = 0; k < N && q < seq.length; k++) st[k] = seq[q++];
          pg.seats = st; pg.blocked = []; pg.overflow = seq.slice(q);
          pg.locked = pg.locked.filter(function (no) { return st.indexOf(no) >= 0; });
          return;
        }
        var seats = new Array(N).fill(null);
        pg.seats.forEach(function (no, i) {
          var o = old.slotOrder[i], k = o ? (o.row + 8 - od.R) + ',' + (o.col / 2 + 8 - od.K) : null;
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
    S.sel = -1; S.selPool = null; S.undo = [];
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
    var out = $('expMsg'), sel = S.pages.filter(function (p) { return !p.skipExp; });
    if (!sel.length) { out.textContent = '내보낼 과목을 하나 이상 선택하세요.'; return; }
    var bad = sel.filter(function (p) { return p.overflow.length || unseated(p).length; });
    if (bad.length && !confirm('앉지 못한 학생이 있는 과목이 있습니다 (' + bad.map(function (p) { return p.subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
    out.textContent = '만드는 중…';
    drawPreview(sel[0]).then(function (png) {
      return H.buildHwpx({ JSZip: window.JSZip, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer },
        b64ToBytes(D.templates[layoutId()]), C.toTemplateLayout(curLayout(), tplCols()),
        sel.map(function (p) { return { subject: p.subject, cells: cellsOf(p) }; }), { previewPng: png, titleOneLineMaxChars: ONE_MAX, titleInfo: C.titleInfo });
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

    // 선택과목 추가·학생 선택
    $('btnAuto').onclick = function () { $('autoFile').click(); };
    $('autoFile').onchange = function (e) { if (e.target.files[0]) loadCombinedFile(e.target.files[0]); e.target.value = ''; };
    $('btnSave').onclick = saveWork;
    $('btnLoad').onclick = function () { $('workFile').click(); };
    $('workFile').onchange = function (e) { if (e.target.files[0]) loadWorkFile(e.target.files[0]); e.target.value = ''; };
    $('btnAddSub').onclick = function () { addSubject($('subName').value); $('subName').value = ''; $('subName').focus(); };
    $('subName').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('btnAddSub').click(); } };
    var sl = $('subList');
    sl.onclick = function (e) {
      var d = e.target.dataset || {};
      if (d.subopen != null && d.subopen !== '') { S.openSub = S.openSub === +d.subopen ? -1 : +d.subopen; renderSubjects(); }
      else if (d.submv != null && d.submv !== '') moveSubject(+d.submv, +d.d);
      else if (d.subdel != null && d.subdel !== '') removeSubject(+d.subdel);
      else if (d.suball != null && d.suball !== '') setSubjectPick(+d.suball, S.cls.studentList.map(function (st) { return st.no; }));
      else if (d.subnone != null && d.subnone !== '') setSubjectPick(+d.subnone, []);
    };
    sl.onchange = function (e) {
      var d = e.target.dataset || {};
      if (d.subpick != null && d.subpick !== '') {
        var i = +d.subpick, no = +d.no, cur0 = subs()[i].nos.slice(), k = cur0.indexOf(no);
        syncSubs(); cur0 = subs()[i].nos.slice(); k = cur0.indexOf(no);
        if (e.target.checked && k < 0) cur0.push(no); else if (!e.target.checked && k >= 0) cur0.splice(k, 1);
        setSubjectPick(i, cur0);
      } else if (d.subname != null && d.subname !== '') {
        var j = +d.subname, v = e.target.value.trim(), pg = S.pages[j + 1];
        if (!v) { e.target.value = subs()[j].name; return; }
        subs()[j].name = v; if (pg) pg.subject = v; render();
      }
    };
    $('expPick').onchange = function (e) { var i = e.target.dataset && e.target.dataset.ep; if (i == null) return; S.pages[+i].skipExp = !e.target.checked; renderExportPick(); };
    $('btnExpAll').onclick = function () { S.pages.forEach(function (p) { p.skipExp = false; }); renderExportPick(); };
    $('btnExpNone').onclick = function () { S.pages.forEach(function (p) { p.skipExp = true; }); renderExportPick(); };

    $('modes').onclick = function (e) { var b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); };
    $('dimCols').onchange = $('dimRows').onchange = function () { setDims(+$('dimCols').value, +$('dimRows').value); };
    $('clsSel').onchange = function (e) { startClass(e.target.value); };
    $('pgName').onchange = function (e) {
      var pg = cur(), v = e.target.value.trim(); if (pg.common || !v || v === pg.subject) { e.target.value = pg.subject; return; }
      if (pg.mid) { var mi = S.pages.indexOf(pg) - subs().length - 1; if (merges()[mi]) merges()[mi].name = v; }
      pg.subject = v; render();
    };
    $('mergeOrder').onclick = function (e) { var d = e.target.dataset || {}; if (d.mo != null && d.mo !== '') moveMerged(+d.mo, +d.d); };
    $('btnClear').onclick = function () { if (cur().seats.some(function (x) { return x != null; })) clearSeats(); };
    $('btnUndoClear').onclick = undoClear;
    $('btnReset').onclick = resetSeats;
    $('btnUnmerge').onclick = function () {
      var pg = cur(); if (!pg.mid) return;
      removeMerge(S.pages.indexOf(pg) - subs().length - 1);
    };
    $('btnMerge').onclick = function () { S.mergeOpen = !S.mergeOpen; S.mergeIds = []; msg('mergeMsg', ''); renderMerge(); };
    $('mergePick').onchange = function (e) {
      var id = e.target.dataset && e.target.dataset.mg; if (!id) return;
      var k = S.mergeIds.indexOf(id); if (e.target.checked && k < 0) S.mergeIds.push(id); else if (!e.target.checked && k >= 0) S.mergeIds.splice(k, 1);
      renderMerge();
    };
    $('btnDoMerge').onclick = function () {      // 과목 순서(02의 순서)대로 합친다
      var ids = subs().map(function (x) { return x.id; }).filter(function (id) { return S.mergeIds.indexOf(id) >= 0; });
      addMerge(ids);
    };

    $('tabs').onclick = function (e) {
      var go = e.target.closest('[data-i]');
      if (go) { S.cur = +go.dataset.i; S.sel = -1; S.selPool = null; render(); }
    };
    $('thumbView').onclick = function (e) { var t = e.target.closest('[data-go]'); if (!t) return; S.cur = +t.dataset.go; S.sel = -1; S.thumbs = false; render(); };
    $('btnView').onclick = function () { S.thumbs = !S.thumbs; render(); };

    var paper = $('paper');
    paper.onclick = function (e) {
      var hb = e.target.closest('[data-cell]');
      if (hb && hb.dataset.cell === 'blank') { var bs = slotMap(curLayout())[hb.dataset.r + ',' + hb.dataset.c * 2]; if (bs != null) blankSeat(bs); return; }
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
      else if (a === 'cellx' && slot) setCell(slot.row, slot.col / 2, 'x');
      else if (a === 'excl') { var no = cur().seats[S.sel]; if (no != null) setExcluded(no, true); }
      else if (a === 'desel') { S.sel = -1; render(); }
    };
    $('stulist').onchange = function (e) { var no = e.target.dataset && e.target.dataset.stu; if (no != null) setExcluded(+no, !e.target.checked); };
    $('stulist').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (b) togglePick(+b.dataset.pick); };
    $('btnExport').onclick = doExport;
  }
  bind();
  if (missing.length) {
    var warn = document.createElement('div');
    warn.className = 'warn'; warn.style.margin = '12px 20px';
    warn.textContent = '화면 파일이 새 버전과 맞지 않습니다. Ctrl+F5(강력 새로고침)를 눌러 주세요. (없는 항목: ' + missing.join(', ') + ')';
    document.body.insertBefore(warn, document.body.firstChild);
  }
  renderMaster();
  renderMasterState();
  renderModes();
})();
