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
    types: { A: C.defaultTypes(4), B: C.defaultTypes(5), M: C.defaultTypes(4, 6) }, mcols: 4, mrows: 6,
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
  function push() { /* 되돌리기 기능은 없다 */ }
  function isPicked(pg, no) { return !pg.common && !!pg.pick && pg.pick.indexOf(no) >= 0; }
  function cellsOf(pg) { return pg.seats.map(function (no) { return no == null ? null : { no: no, name: S.cls.students[no].name, picked: isPicked(pg, no) }; }); }
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
  function mergeName(m) { return m.name || m.ids.map(function (id) { var x = subById(id); return x ? x.name : ''; }).join('+'); }
  function mergeNos(m) {          // 과목 순서대로, 과목 안에서는 번호순 (겹치면 앞 과목에 둔다)
    var seen = {}, out = [];
    subs().forEach(function (x) {
      if (m.ids.indexOf(x.id) < 0) return;
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
    reseat(mergePages());
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
    reseat(mergePages());
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

  /* ---------- 반 시작 / 재생성 ---------- */
  function makeCls(key) {
    return C.buildClassFromMaster(S.master, key, subList(key), {});
  }
  function newPages() {
    var pages = C.buildPages(S.cls, ctx(), S.seed), N = seatCount();
    if (S.mode === 'manual') pages.forEach(function (p) { p.seats = new Array(N).fill(null); p.overflow = []; p.locked = []; });
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
          var inner = '<span class="slot">' + (i + 1) + '</span>' + hv(r, dc, [['x', 'X']], opt.interactive);
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
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true }) + (pg.common ? '' : '<div class="legend"><i></i>' + esc(pg.mid ? '선택 학생(과목 순서대로)' : pg.subject + ' 선택 학생') + '</div>');
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
    $('namePanel').classList.toggle('hidden', pg.common); $('btnUnmerge').classList.toggle('hidden', !pg.mid); $('pgName').value = pg.subject;
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
    push();
    S.manual[no] = excluded;
    var auto = S.cls.students[no].notes.some(function (n) { return C.noteExcluded(n, S.keywords); });
    if (auto === excluded) delete S.manual[no];
    S.pages.forEach(function (p) { C.applyExclusion(p, no, excluded, ctx()); });
    S.sel = -1; render();
  }
  function togglePick(no) {
    var pg = cur(); if (pg.common || pg.mid) return;
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
    var out = $('expMsg'), sel = S.pages.filter(function (p) { return !p.skipExp; });
    if (!sel.length) { out.textContent = '내보낼 과목을 하나 이상 선택하세요.'; return; }
    var bad = sel.filter(function (p) { return p.overflow.length || unseated(p).length; });
    if (bad.length && !confirm('앉지 못한 학생이 있는 과목이 있습니다 (' + bad.map(function (p) { return p.subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
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

    // 선택과목 추가·학생 선택
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
