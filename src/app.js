/* 화면(UI) — 모든 처리는 브라우저 안에서만 한다. 명렬표는 저장하지 않는다. */
(function () {
  'use strict';
  var C = window.SeatCore, H = window.SeatHwpx, D = window.SEAT_DATA;
  var LAYOUTS = D.layouts.layouts, ONE_MAX = D.layouts.titleOneLineMaxChars;
  var SEATS = 21;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var S = {
    roster: null, classKey: null, cls: null, layout: 'A', seed: 1,
    keywords: C.DEFAULT_KEYWORDS.slice(), sortSubjects: 'appear',
    manual: {}, pages: [], cur: 0, sel: -1, exportSel: {}, thumbs: false,
    history: [], future: []
  };

  /* ---------- 공통 보조 ---------- */
  function ctx() {
    return { seatCount: SEATS, excluded: function (no) { return C.isExcluded(S.cls.students[no], S.keywords, S.manual); } };
  }
  function snapshot() { return JSON.stringify({ pages: S.pages, manual: S.manual, seed: S.seed, layout: S.layout }); }
  function push() { S.history.push(snapshot()); if (S.history.length > 100) S.history.shift(); S.future = []; }
  function restore(str) {
    var o = JSON.parse(str);
    S.pages = o.pages; S.manual = o.manual; S.seed = o.seed; S.layout = o.layout; S.sel = -1;
    if (S.cur >= S.pages.length) S.cur = S.pages.length - 1;
  }
  function cellsOf(pg) {
    return pg.seats.map(function (no) { return no == null ? null : { no: no, name: S.cls.students[no].name }; });
  }
  function pageTitle(pg) { return '고사좌석배치표(' + pg.subject + ')'; }

  /* ---------- 불러오기 ---------- */
  function showImportMsg(msg, bad) {
    var el = $('importMsg');
    el.textContent = msg || ''; el.classList.toggle('hidden', !msg);
  }
  function loadRoster(rows) {
    S.roster = rows;
    var keys = C.classKeys(rows);
    var sel = $('clsSel');
    sel.innerHTML = keys.map(function (k) { return '<option value="' + esc(k.key) + '">' + esc(k.grade + ' ' + k.cls) + '</option>'; }).join('');
    $('classPick').classList.toggle('hidden', keys.length <= 1);
    showImportMsg(rows.length + '개 행을 불러왔습니다. (' + keys.length + '개 학급)');
    startClass(keys[0].key);
  }
  function startClass(key) {
    S.classKey = key; S.manual = {}; S.history = []; S.future = []; S.sel = -1; S.cur = 0;
    S.cls = C.buildClass(S.roster, key, { sortSubjects: S.sortSubjects });
    S.pages = C.buildPages(S.cls, ctx(), S.seed);
    S.exportSel = {};
    S.pages.forEach(function (_, i) { S.exportSel[i] = true; });
    ['workCard', 'expCard'].forEach(function (id) { $(id).classList.remove('hidden'); });
    render();
  }
  function rebuildAll() { // 키워드/과목 순서 변경 등 — 전체 재생성
    if (!S.cls) return;
    push();
    S.cls = C.buildClass(S.roster, S.classKey, { sortSubjects: S.sortSubjects });
    S.pages = C.buildPages(S.cls, ctx(), S.seed);
    S.exportSel = {};
    S.pages.forEach(function (_, i) { S.exportSel[i] = true; });
    S.cur = 0; S.sel = -1;
    render();
  }
  function readFile(file) {
    var name = file.name.toLowerCase();
    file.arrayBuffer().then(function (buf) {
      var rows;
      if (/\.xlsx?$/.test(name)) {
        if (typeof XLSX === 'undefined') throw new Error('엑셀 읽기 라이브러리를 불러오지 못했습니다. CSV로 저장하거나 붙여넣기를 이용하세요.');
        var wb = XLSX.read(buf, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        rows = C.rowsToRoster(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
      } else {
        var text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
        rows = C.parseRosterText(text);
      }
      loadRoster(rows);
    }).catch(function (e) { showImportMsg('불러오지 못했습니다: ' + e.message); });
  }

  /* ---------- 좌석표 HTML ---------- */
  function slotMap(L) {
    var m = {};
    L.slotOrder.forEach(function (s, i) { m[s.row + ',' + s.col] = i; });
    return m;
  }
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
          else if (no != null) inner += '<span class="no">' + no + '</span><span class="nm">' + esc(S.cls.students[no].name) + '</span>' + (locked ? '<span class="tag">🔒</span>' : '');
          html += '<div class="' + cls + '" data-slot="' + i + '"' + (opt.interactive && !blocked ? ' draggable="true"' : '') + '>' + inner + '</div>';
        }
      });
    });
    return html + '</div>';
  }
  function titleHtml(pg) {
    var t = C.titleInfo(pg.subject, ONE_MAX);
    return '<div class="ttl">' + (t.twoLine ? '고사좌석배치표<small>' + esc(t.text) + '</small>' : '고사좌석배치표' + esc(t.text)) + '</div>';
  }
  function paperHtml(pg, opt) {
    return titleHtml(pg) + seatsHtml(pg, opt) + '<div class="board">칠판</div>';
  }

  /* ---------- 렌더 ---------- */
  function warningsFor(pg) {
    var w = [];
    if (pg.overflow.length) w.push('좌석(' + SEATS + '개)보다 학생이 많아 앉히지 못한 학생: ' + pg.overflow.map(function (n) { return n + ' ' + S.cls.students[n].name; }).join(', ') + ' — 자리를 비우거나 학생을 제외한 뒤 다시 확인하세요.');
    var t = C.titleInfo(pg.subject, ONE_MAX);
    if (t.tooLong) w.push('과목명이 12자를 넘어 두 줄 제목의 2행에 다 들어가지 않을 수 있습니다. 한글에서 열어 글자 크기를 직접 줄여 주세요.');
    return w;
  }
  function render() {
    if (!S.cls) return;
    $('seed').value = S.seed;
    $('kw').value = S.keywords.join(', ');
    Array.prototype.forEach.call($('layoutSeg').children, function (b) { b.classList.toggle('on', b.dataset.v === S.layout); });
    $('btnUndo').disabled = !S.history.length; $('btnRedo').disabled = !S.future.length;
    $('btnView').textContent = S.thumbs ? '한 쪽씩 보기' : '전체 쪽 보기';
    renderSummary(); renderTabs(); renderPage();
  }
  function renderSummary() {
    var rows = S.pages.map(function (pg) {
      var total = pg.nos.length, ex = pg.nos.filter(function (n) { return ctx().excluded(n); }).length;
      return '<tr><td>' + esc(pg.common ? '공통(학급 전원)' : pg.subject) + '</td><td>' + total + '</td><td>' + (total - ex) + '</td><td>' + ex + '</td></tr>';
    }).join('');
    $('sumWrap').innerHTML = '<table class="sum"><thead><tr><th>쪽</th><th>전체 선택자수</th><th>교실재적수</th><th>제외</th></tr></thead><tbody>' + rows + '</tbody></table><div class="hint">PDF 집계 줄(전체 선택자수·교실재적수)과 맞춰 보세요.</div>';
  }
  function renderTabs() {
    $('tabs').innerHTML = S.pages.map(function (pg, i) {
      var w = warningsFor(pg).length ? ' has-warn' : '';
      return '<div class="tab' + (i === S.cur ? ' cur' : '') + w + '" data-i="' + i + '" ><input type="checkbox" data-exp="' + i + '"' + (S.exportSel[i] ? ' checked' : '') + ' title="내보내기에 포함"><span data-go="' + i + '">' + esc(pg.common ? '공통' : pg.subject) + (w ? ' ⚠' : '') + '</span></div>';
    }).join('');
  }
  function renderPage() {
    var pg = S.pages[S.cur];
    $('thumbView').classList.toggle('hidden', !S.thumbs);
    $('pageView').classList.toggle('hidden', S.thumbs);
    $('pageWarn').innerHTML = S.pages.map(function (p, i) {
      var w = warningsFor(p);
      return w.length && (i === S.cur || S.thumbs) ? '<div class="warn"><b>' + esc(p.common ? '공통' : p.subject) + '</b>: ' + w.map(esc).join(' / ') + '</div>' : '';
    }).join('');
    if (S.thumbs) {
      $('thumbView').innerHTML = '<div class="thumbs">' + S.pages.map(function (p, i) {
        return '<div class="thumb' + (i === S.cur ? ' cur' : '') + '" data-go="' + i + '"><div class="paper mini">' + paperHtml(p, { sel: -1 }) + '</div></div>';
      }).join('') + '</div>';
      return;
    }
    $('paper').innerHTML = paperHtml(pg, { sel: S.sel, interactive: true });
    // 선택 막대
    var bar = '';
    if (S.sel >= 0) {
      var no = pg.seats[S.sel], blocked = pg.blocked.indexOf(S.sel) >= 0;
      bar += '<b>슬롯 ' + (S.sel + 1) + (no != null ? ' · ' + no + ' ' + esc(S.cls.students[no].name) : blocked ? ' · 비워 둔 좌석' : ' · 빈자리') + '</b>';
      if (no != null) {
        var lk = pg.locked.indexOf(no) >= 0;
        bar += '<button class="sub" data-act="lock">' + (lk ? '고정 해제' : '🔒 이 학생 고정') + '</button>';
      }
      bar += '<button class="sub" data-act="block">' + (blocked ? '좌석 비우기 해제' : '이 좌석 비워 두기') + '</button>';
      if (no != null) bar += '<button class="sub" data-act="excl">이 학생 제외</button>';
      bar += '<button class="sub" data-act="desel">선택 취소</button>';
    } else bar = '<span class="hint">좌석을 누르면 고정·비우기·제외 메뉴가 나옵니다.</span>';
    $('selbar').innerHTML = bar;
    $('pgSeed').value = pg.seed; $('pgSeed').disabled = pg.common; $('btnReshuffle').disabled = pg.common;
    $('pgHint').textContent = pg.common ? '공통 쪽은 번호순으로 채웁니다(섞지 않음).' : '선택자 ' + pg.nos.length + '명 중 제외 ' + pg.nos.filter(function (n) { return ctx().excluded(n); }).length + '명. 시드가 같으면 같은 배치가 나옵니다.';
    renderStudents(pg);
  }
  function renderStudents(pg) {
    $('stulist').innerHTML = S.cls.studentList.map(function (s) {
      var ex = ctx().excluded(s.no), on = pg.nos.indexOf(s.no) >= 0;
      return '<label><input type="checkbox" data-stu="' + s.no + '"' + (ex ? '' : ' checked') + '><span class="' + (ex ? 'ex' : '') + '">' + (on ? '● ' : '') + s.no + ' ' + esc(s.name) + '</span>' + (s.notes.length ? '<span class="nt">' + esc(s.notes.join(',')) + '</span>' : '') + '</label>';
    }).join('');
  }

  /* ---------- 조작 ---------- */
  function swap(a, b) {
    var pg = S.pages[S.cur];
    if (a === b) return;
    if (pg.blocked.indexOf(a) >= 0 || pg.blocked.indexOf(b) >= 0) return;
    push();
    var t = pg.seats[a]; pg.seats[a] = pg.seats[b]; pg.seats[b] = t;
    S.sel = -1; render();
  }
  function seatOf(e) { var el = e.target.closest('.seat'); return el ? +el.dataset.slot : -1; }

  function toggleLock() {
    var pg = S.pages[S.cur], no = pg.seats[S.sel]; if (no == null) return;
    push();
    var i = pg.locked.indexOf(no);
    if (i >= 0) pg.locked.splice(i, 1); else pg.locked.push(no);
    render();
  }
  function toggleBlock() {
    var pg = S.pages[S.cur], i = S.sel; if (i < 0) return;
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
    // 키워드 기본값과 같으면 수동 지정을 지운다
    var auto = S.cls.students[no].notes.some(function (n) { return C.noteExcluded(n, S.keywords); });
    if (auto === excluded) delete S.manual[no];
    S.pages.forEach(function (p) { C.applyExclusion(p, no, excluded, ctx()); });
    S.sel = -1; render();
  }

  function download(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* 첫 쪽 미리보기 이미지 (724×1024) — 항상 새로 그린다 */
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
    return new Promise(function (res) {
      cv.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/png');
    });
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function doExport() {
    var idx = S.pages.map(function (_, i) { return i; }).filter(function (i) { return S.exportSel[i]; });
    var msg = $('expMsg');
    if (!idx.length) { msg.textContent = '내보낼 쪽을 하나 이상 선택하세요.'; return; }
    var over = idx.filter(function (i) { return S.pages[i].overflow.length; });
    if (over.length && !confirm('앉히지 못한 학생이 있는 쪽이 있습니다(' + over.map(function (i) { return S.pages[i].subject; }).join(', ') + '). 그래도 내보낼까요?')) return;
    var sel = idx.map(function (i) { return S.pages[i]; });
    msg.textContent = '만드는 중…';
    drawPreview(sel[0]).then(function (png) {
      return H.buildHwpx({ JSZip: window.JSZip, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer },
        b64ToBytes(D.templates[S.layout]), LAYOUTS[S.layout],
        sel.map(function (p) { return { subject: p.subject, cells: cellsOf(p) }; }),
        { previewPng: png, titleOneLineMaxChars: ONE_MAX });
    }).then(function (bytes) {
      var g = (S.cls.grade.match(/\d+/) || [''])[0], c = (S.cls.cls.match(/\d+/) || [''])[0];
      var name = (g && c ? g + '-' + c + '_' : '') + '고사좌석배치표.hwpx';
      download(bytes, name);
      msg.textContent = name + ' (' + sel.length + '쪽)을 내려받았습니다. 한컴오피스 한글에서 열어 확인하세요.';
    }).catch(function (e) { msg.textContent = '내보내기 실패: ' + e.message; });
  }
  function doPrint() {
    var idx = S.pages.map(function (_, i) { return i; }).filter(function (i) { return S.exportSel[i]; });
    $('printArea').innerHTML = idx.map(function (i) { return '<div class="pp"><div class="paper">' + paperHtml(S.pages[i], { sel: -1 }) + '</div></div>'; }).join('');
    window.print();
  }

  /* ---------- 이벤트 ---------- */
  var dragFrom = -1;
  function bind() {
    $('file').onchange = function (e) { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
    $('btnPaste').onclick = function () {
      try { loadRoster(C.parseRosterText($('paste').value)); } catch (e) { showImportMsg('불러오지 못했습니다: ' + e.message); }
    };
    $('btnExample').onclick = function () { loadRoster(C.parseRosterText(D.example)); };
    $('clsSel').onchange = function (e) { startClass(e.target.value); };
    $('layoutSeg').onclick = function (e) {
      var v = e.target.dataset && e.target.dataset.v; if (!v || v === S.layout || !S.cls) return;
      push(); S.layout = v; render();
    };
    $('seed').onchange = function (e) {
      if (!S.cls) return;
      push(); S.seed = (parseInt(e.target.value, 10) || 0) >>> 0; applySeed();
    };
    function applySeed() {
      S.pages.forEach(function (p, i) { if (!p.common) C.reshuffle(p, C.pageSeed(S.seed, i), ctx()); });
      S.sel = -1; render();
    }
    $('btnReseedAll').onclick = function () {
      if (!S.cls) return;
      push(); S.seed = Math.floor(Math.random() * 1e9); applySeed();
    };
    $('kw').onchange = function (e) {
      S.keywords = e.target.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      rebuildAll();
    };
    $('sortSub').onchange = function (e) { S.sortSubjects = e.target.value; rebuildAll(); };

    $('tabs').onclick = function (e) {
      var exp = e.target.dataset && e.target.dataset.exp;
      if (exp != null && exp !== '') { S.exportSel[exp] = e.target.checked; return; }
      var go = e.target.closest('[data-i]');
      if (go && e.target.tagName !== 'INPUT') { S.cur = +go.dataset.i; S.sel = -1; render(); }
    };
    $('thumbView').onclick = function (e) {
      var t = e.target.closest('[data-go]'); if (!t) return;
      S.cur = +t.dataset.go; S.sel = -1; S.thumbs = false; render();
    };
    $('btnView').onclick = function () { S.thumbs = !S.thumbs; render(); };
    $('btnUndo').onclick = function () { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); render(); };
    $('btnRedo').onclick = function () { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); render(); };

    var paper = $('paper');
    paper.onclick = function (e) {
      var i = seatOf(e); if (i < 0) return;
      var pg = S.pages[S.cur];
      if (S.sel < 0 || pg.blocked.indexOf(S.sel) >= 0) { S.sel = i; render(); return; }
      if (S.sel === i) { S.sel = -1; render(); return; }
      if (pg.blocked.indexOf(i) >= 0) { S.sel = i; render(); return; }
      swap(S.sel, i);
    };
    paper.ondragstart = function (e) {
      var i = seatOf(e); if (i < 0) { e.preventDefault(); return; }
      dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i));
    };
    paper.ondragover = function (e) {
      var el = e.target.closest('.seat'); if (!el || dragFrom < 0) return;
      e.preventDefault();
      Array.prototype.forEach.call(paper.querySelectorAll('.over'), function (x) { x.classList.remove('over'); });
      el.classList.add('over');
    };
    paper.ondrop = function (e) {
      e.preventDefault(); var i = seatOf(e); var from = dragFrom; dragFrom = -1;
      if (i >= 0 && from >= 0) swap(from, i);
    };
    paper.ondragend = function () { dragFrom = -1; Array.prototype.forEach.call(paper.querySelectorAll('.over'), function (x) { x.classList.remove('over'); }); };

    $('selbar').onclick = function (e) {
      var a = e.target.dataset && e.target.dataset.act; if (!a) return;
      var pg = S.pages[S.cur];
      if (a === 'lock') toggleLock();
      else if (a === 'block') toggleBlock();
      else if (a === 'excl') { var no = pg.seats[S.sel]; if (no != null) setExcluded(no, true); }
      else if (a === 'desel') { S.sel = -1; render(); }
    };
    $('btnReshuffle').onclick = function () {
      var pg = S.pages[S.cur]; if (pg.common) return;
      push(); C.reshuffle(pg, Math.floor(Math.random() * 1e9), ctx()); S.sel = -1; render();
    };
    $('pgSeed').onchange = function (e) {
      var pg = S.pages[S.cur]; if (pg.common) return;
      push(); C.reshuffle(pg, parseInt(e.target.value, 10) || 0, ctx()); S.sel = -1; render();
    };
    $('stulist').onchange = function (e) {
      var no = e.target.dataset && e.target.dataset.stu; if (no == null) return;
      setExcluded(+no, !e.target.checked);
    };
    $('btnExport').onclick = doExport;
    $('btnPrint').onclick = doPrint;
    $('btnAll').onclick = function () { S.pages.forEach(function (_, i) { S.exportSel[i] = true; }); renderTabs(); };
    $('btnNone').onclick = function () { S.exportSel = {}; renderTabs(); };
    $('kw').value = S.keywords.join(', ');
  }
  bind();
})();
