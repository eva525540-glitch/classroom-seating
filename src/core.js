/* 좌석배치 핵심 로직 (DOM 비의존) — 브라우저(window.SeatCore)와 node 모두 사용 */
(function (root) {
  'use strict';

  var DEFAULT_KEYWORDS = ['통합지원반', '전출', '자퇴', '별도고사실'];
  var REQUIRED = ['학년', '반', '편제명', '개설과목', '번호', '성명', '비고'];

  /* ---------- 시드 난수 (mulberry32) + Fisher–Yates ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffled(arr, seed) {
    var a = arr.slice(), rnd = mulberry32(seed);
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- CSV / 표 붙여넣기 파싱 ---------- */
  function parseDelimited(text) {
    text = String(text).replace(/^﻿/, '');
    var first = text.split(/\r?\n/, 1)[0] || '';
    var delim = first.indexOf('\t') >= 0 ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  /* 2차원 배열(헤더 포함) → 명렬표 행 객체 배열 */
  function rowsToRoster(table) {
    if (!table.length) throw new Error('내용이 비어 있습니다.');
    var head = table[0].map(function (h) { return String(h == null ? '' : h).replace(/^﻿/, '').trim(); });
    var idx = {};
    REQUIRED.forEach(function (k) { idx[k] = head.indexOf(k); });
    var missing = REQUIRED.filter(function (k) { return k !== '비고' && idx[k] < 0; });
    if (missing.length) throw new Error('필요한 열이 없습니다: ' + missing.join(', ') + ' (첫 줄에 열 이름이 있어야 합니다)');
    var out = [];
    for (var i = 1; i < table.length; i++) {
      var r = table[i], g = function (k) { return idx[k] < 0 ? '' : String(r[idx[k]] == null ? '' : r[idx[k]]).trim(); };
      var no = parseInt(g('번호'), 10);
      if (!g('성명') || isNaN(no)) continue;
      out.push({ grade: g('학년'), cls: g('반'), group: g('편제명'), subjectRaw: g('개설과목'), no: no, name: g('성명'), note: g('비고') });
    }
    if (!out.length) throw new Error('학생 행을 찾지 못했습니다.');
    return out;
  }
  function parseRosterText(text) { return rowsToRoster(parseDelimited(text)); }

  function stripUnit(s) { return String(s).replace(/\s*[(\uFF08\[\{]\s*\d+\s*[)\uFF09\]\}]\s*$/, '').trim(); }

  function classKeys(roster) {
    var seen = {}, out = [];
    roster.forEach(function (r) {
      var k = r.grade + '|' + r.cls;
      if (!seen[k]) { seen[k] = 1; out.push({ key: k, grade: r.grade, cls: r.cls }); }
    });
    return out;
  }

  /* ---------- 한 학급 프로젝트 만들기 ---------- */
  function noteExcluded(note, keywords) {
    if (!note) return false;
    return keywords.some(function (k) { return k && note.indexOf(k) >= 0; });
  }

  function buildClass(roster, classKey, opts) {
    opts = opts || {};
    var rows = roster.filter(function (r) { return r.grade + '|' + r.cls === classKey; });
    var students = {}, subjOrder = [], subjMap = {};
    rows.forEach(function (r) {
      var s = students[r.no];
      if (!s) s = students[r.no] = { no: r.no, name: r.name, notes: [] };
      if (r.note && s.notes.indexOf(r.note) < 0) s.notes.push(r.note);
      var name = stripUnit(r.subjectRaw);
      if (!name) return;
      if (!subjMap[name]) { subjMap[name] = { subject: name, raw: r.subjectRaw, group: r.group, nos: [] }; subjOrder.push(name); }
      if (subjMap[name].nos.indexOf(r.no) < 0) subjMap[name].nos.push(r.no);
    });
    var list = Object.keys(students).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return students[n]; });
    var subjects = subjOrder.map(function (n) { return subjMap[n]; });
    if (opts.sortSubjects === 'ga') subjects.sort(function (a, b) { return a.subject.localeCompare(b.subject, 'ko'); });
    var first = rows[0] || {};
    return { key: classKey, grade: first.grade, cls: first.cls, students: students, studentList: list, subjects: subjects };
  }

  function isExcluded(student, keywords, manual) {
    if (manual && manual[student.no] === true) return true;   // 수동 제외
    if (manual && manual[student.no] === false) return false; // 수동 포함
    return student.notes.some(function (n) { return noteExcluded(n, keywords); });
  }

  /* ---------- 쪽 생성 / 좌석 채우기 ----------
   * page: { subject, common, nos:[선택자 번호], seats:[no|null ×N], locked:[no], blocked:[slotIdx], seed, overflow:[no] }
   */
  function newPage(subject, common, nos, seed) {
    return { subject: subject, common: !!common, nos: nos.slice(), seats: [], locked: [], blocked: [], seed: seed >>> 0, overflow: [] };
  }

  function pageSeed(globalSeed, pageIndex) { return (hashStr(String(globalSeed) + ':' + pageIndex)) >>> 0; }

  /* 채우기: 고정 학생은 현재 자리 유지, 막힌 슬롯 건너뜀, 나머지를 순서대로. */
  function fillPage(page, cls, ctx) {
    var N = ctx.seatCount;
    var candidates = page.nos.filter(function (no) { return !ctx.excluded(no); });
    candidates.sort(function (a, b) { return a - b; });
    if (!page.common) { // 선택한 학생 먼저(섞어서), 바로 이어서 나머지 학생
      var pick = page.pick || [];
      var picks = candidates.filter(function (no) { return pick.indexOf(no) >= 0; });
      var others = candidates.filter(function (no) { return pick.indexOf(no) < 0; });
      candidates = shuffled(picks, page.seed).concat(shuffled(others, (page.seed ^ 0x9e3779b9) >>> 0));
    }

    var seats = new Array(N).fill(null);
    var blocked = page.blocked.filter(function (i) { return i < N; });
    var kept = {};
    (page.seats || []).forEach(function (no, i) {
      if (no != null && page.locked.indexOf(no) >= 0 && candidates.indexOf(no) >= 0 && blocked.indexOf(i) < 0 && i < N) {
        seats[i] = no; kept[no] = 1;
      }
    });
    var rest = candidates.filter(function (no) { return !kept[no]; });
    var overflow = [];
    var p = 0;
    for (var i = 0; i < N && p < rest.length; i++) {
      if (seats[i] != null || blocked.indexOf(i) >= 0) continue;
      seats[i] = rest[p++];
    }
    overflow = rest.slice(p);
    page.seats = seats; page.overflow = overflow;
    page.locked = page.locked.filter(function (no) { return seats.indexOf(no) >= 0; });
    return page;
  }

  /* 전체 쪽 만들기. includeCommon: 공통 쪽 포함 */
  function buildPages(cls, ctx, globalSeed) {
    var pages = [];
    var allNos = cls.studentList.map(function (s) { return s.no; });
    var commonPage = newPage('공통', true, allNos, 0);
    commonPage.pick = allNos.slice();
    fillPage(commonPage, cls, ctx);
    pages.push(commonPage);
    cls.subjects.forEach(function (sub, i) {
      var pg = newPage(sub.subject, false, allNos, pageSeed(globalSeed, i + 1));
      pg.pick = sub.nos.slice();
      pg.expected = sub.expected == null ? null : sub.expected;
      fillPage(pg, cls, ctx);
      pages.push(pg);
    });
    return pages;
  }

  /* 제외 토글 후 증분 갱신 */
  function applyExclusion(page, no, nowExcluded, ctx) {
    var i = page.seats.indexOf(no);
    if (page.nos.indexOf(no) < 0) return;
    if (ctx.manual) { // 직접 조정: 자동으로 채우지 않는다
      if (nowExcluded) { if (i >= 0) page.seats[i] = null; page.locked = page.locked.filter(function (x) { return x !== no; }); }
      return;
    }
    if (page.common) { fillPage(page, null, ctx); return; }
    if (nowExcluded) {
      if (i >= 0) page.seats[i] = null;
      page.locked = page.locked.filter(function (x) { return x !== no; });
      page.overflow = page.overflow.filter(function (x) { return x !== no; });
      // 넘친 학생이 있으면 빈 자리에 채운다
      refillOverflow(page, ctx);
    } else if (i < 0) {
      page.overflow.push(no);
      refillOverflow(page, ctx);
    }
  }
  function refillOverflow(page, ctx) {
    var N = ctx.seatCount;
    for (var i = 0; i < N && page.overflow.length; i++) {
      if (page.seats[i] == null && page.blocked.indexOf(i) < 0) page.seats[i] = page.overflow.shift();
    }
  }

  /* 다시 섞기 (과목 쪽) */
  function reshuffle(page, seed, ctx) { page.seed = seed >>> 0; return fillPage(page, null, ctx); }


  /* 좌석 비우기/해제 후: 현재 앉은 순서를 유지한 채 막힌 슬롯을 건너뛰며 다시 채운다 (고정 학생은 제자리) */
  function relayout(page, ctx) {
    var N = ctx.seatCount, seq = [];
    page.seats.forEach(function (no) {
      if (no != null && page.locked.indexOf(no) < 0) seq.push(no);
    });
    seq = seq.concat(page.overflow);
    var seats = new Array(N).fill(null);
    page.seats.forEach(function (no, i) {
      if (no != null && page.locked.indexOf(no) >= 0 && page.blocked.indexOf(i) < 0) seats[i] = no;
    });
    var p = 0;
    for (var i = 0; i < N && p < seq.length; i++) {
      if (seats[i] != null || page.blocked.indexOf(i) >= 0) continue;
      seats[i] = seq[p++];
    }
    page.seats = seats; page.overflow = seq.slice(p);
    page.locked = page.locked.filter(function (no) { return seats.indexOf(no) >= 0; });
    return page;
  }


  /* ---------- PDF 등에서 읽은 글자 → 명렬표 행 ----------
   * 한 줄: "2학년 3반 수학 도형탐구(3) 1 오하람 [비고]" (칸 구분선 | 은 공백으로 본다) */
  var ROW_RE = /(\d+)\s*학년\s*(\d+)\s*반\s+(\S+)\s+(.+?\(\s*\d+\s*\))\s*(\d+)\s+([가-힣]{2,5})(?:\s+(.*))?$/;
  function textToRoster(text) {
    var out = [];
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/[|｜ㅣ│¦]/g, ' ').replace(/\s+/g, ' ').trim();
      var m = ROW_RE.exec(line);
      if (!m) return;
      out.push({ grade: m[1] + '학년', cls: m[2] + '반', group: m[3], subjectRaw: m[4].replace(/\s*\(\s*(\d+)\s*\)$/, '($1)'), no: parseInt(m[5], 10), name: m[6], note: (m[7] || '').trim() });
    });
    return out;
  }
  function rosterToTSV(rows) {
    var head = ['학년', '반', '편제명', '개설과목', '번호', '성명', '비고'].join('\t');
    return head + '\n' + rows.map(function (r) {
      return [r.grade, r.cls, r.group, r.subjectRaw, r.no, r.name, r.note].join('\t');
    }).join('\n');
  }

  /* ---------- 느슨한 읽기 (스캔본 글자 인식처럼 틀린 글자가 섞인 경우) ----------
   * 쪽 제목("2학년 ○○(3) 3반 선택 현황")에서 학년·과목·반을 얻고, 줄마다 번호·성명·비고를 추정한다.
   * 못 읽은 번호는 빈칸으로 남겨 사람이 고치게 한다. */
  var TITLE_RE = /(?:^|[^0-9])(\d)\s*학년\s*([^()（）]+?)\s*[(（]\s*(\d+)\s*[)）]\s*(\d+)\s*반/;
  var NOTE_RE = /지원|전출|자퇴|별도|고사실|유예|휴학|퇴학|제적/;
  var NAME_AT = /^[^가-힣0-9]*([가-힣]{2,4})(?![가-힣])/;
  function lenientPage(text, ctx0) {
    var lines = String(text).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var ctx = ctx0 || { grade: '', cls: '', subject: '' };
    var rows = [];
    lines.forEach(function (line) {
      var tm = TITLE_RE.exec(line);
      if (tm && /선택|현황/.test(line)) { ctx = { grade: tm[1] + '학년', cls: tm[4] + '반', subject: tm[2].trim() + '(' + tm[3] + ')' }; return; }
      if (/성명|개설과목|편제명/.test(line)) return;
      var cells = line.replace(/[｜ㅣ│¦]/g, '|').split('|').map(function (c) { return c.trim(); });
      if (cells.length < 3) cells = line.split(/\s{2,}/).map(function (c) { return c.trim(); });
      if (cells.length < 3) return;
      var from = cells.length >= 6 ? 4 : 3;
      var no = '', name = '', note = '', i, m;
      // 한 칸에 "번호 성명"이 붙어 읽힌 경우
      for (i = cells.length - 1; i >= from && !name; i--) {
        if ((m = /^[^0-9가-힣]*(\d{1,2})\s+([가-힣]{2,4})(?![가-힣])/.exec(cells[i]))) { no = m[1]; name = m[2]; note = cells.slice(i + 1).filter(function (c) { return /[가-힣]{2,}/.test(c); }).join(' '); }
      }
      if (!name) {
        var h = [];
        cells.forEach(function (c, k) { if (k >= from && NAME_AT.test(c)) h.push(k); });
        if (!h.length) return;
        var last = h[h.length - 1];
        if (NOTE_RE.test(cells[last]) && h.length > 1) { note = cells[last].replace(/[|]/g, '').trim(); last = h[h.length - 2]; }
        name = NAME_AT.exec(cells[last])[1];
        for (i = last - 1; i >= 3; i--) {
          if ((m = /^[^0-9가-힣]*(\d{1,2})[^0-9가-힣]*$/.exec(cells[i])) || (m = /(?:^|\s)(\d{1,2})[^0-9가-힣]*$/.exec(cells[i]))) { no = m[1]; break; }
        }
        if (!note) note = cells.slice(last + 1).filter(function (c) { return /[가-힣]{2,}/.test(c); }).join(' ');
      }
      rows.push({ grade: ctx.grade, cls: ctx.cls, group: '-', subjectRaw: ctx.subject, no: no === '' ? '' : parseInt(no, 10), name: name, note: note });
    });
    return { rows: rows, ctx: ctx };
  }
  /* 쪽별 글자 → 명렬표 행. 정확히 읽히는 쪽은 엄격하게, 아니면 느슨하게. */
  function pagesToRoster(pageTexts) {
    var rows = [], ctx = null, lenient = false;
    pageTexts.forEach(function (tx) {
      var strict = textToRoster(tx), nonEmpty = String(tx).split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
      if (strict.length >= 3 && strict.length >= nonEmpty * 0.5) { rows = rows.concat(strict); return; }
      var r = lenientPage(tx, ctx); ctx = r.ctx; lenient = true; rows = rows.concat(r.rows);
    });
    return { rows: rows, lenient: lenient };
  }

  /* ---------- 학생 명렬표(기준) + 선택과목 명렬표 맞춰 보기 ----------
   * 학생 명렬표: [{grade, cls, no, name, kind}]  kind = '' | 통합지원반 | 별도고사실 | 전출 | 자퇴
   * 이름과 번호는 항상 학생 명렬표의 것을 쓴다. 선택과목 쪽(PDF 등)에서는 "누가 선택했는가"만 얻는다. */
  var KINDS = ['통합지원반', '별도고사실', '전출', '자퇴'];
  function normGrade(s) { var m = /(\d+)/.exec(String(s == null ? '' : s)); return m ? m[1] + '학년' : ''; }
  function normCls(s) { var m = /(\d+)/.exec(String(s == null ? '' : s)); return m ? m[1] + '반' : ''; }
  function normKind(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return '';
    for (var i = 0; i < KINDS.length; i++) if (s.indexOf(KINDS[i]) >= 0) return KINDS[i];
    if (/지원/.test(s)) return '통합지원반';
    if (/별도|고사실/.test(s)) return '별도고사실';
    return '';
  }
  /* 표(2차원 배열, 첫 줄 머리글) → 학생 명렬표. 머리글: 학년, 반, 번호, 이름(또는 성명), 구분(또는 비고) */
  function masterFromTable(table) {
    if (!table.length) throw new Error('내용이 비어 있습니다.');
    var head = table[0].map(function (h) { return String(h == null ? '' : h).replace(/^﻿/, '').trim(); });
    function find() { for (var a = 0; a < arguments.length; a++) { var i = head.indexOf(arguments[a]); if (i >= 0) return i; } return -1; }
    var gi = find('학년'), ci = find('반'), ni = find('번호'), mi = find('이름', '성명'), ki = find('구분', '비고');
    if (ni < 0 || mi < 0) throw new Error('머리글에 “번호”와 “이름”이 있어야 합니다. 엑셀 양식을 내려받아 사용하세요.');
    var out = [];
    table.slice(1).forEach(function (r) {
      var no = parseInt(String(r[ni] == null ? '' : r[ni]).trim(), 10), name = String(r[mi] == null ? '' : r[mi]).trim();
      if (isNaN(no) || !name) return;
      out.push({ grade: gi < 0 ? '' : normGrade(r[gi]), cls: ci < 0 ? '' : normCls(r[ci]), no: no, name: name, kind: ki < 0 ? '' : normKind(r[ki]) });
    });
    if (!out.length) throw new Error('학생 행을 찾지 못했습니다.');
    return out;
  }
  function masterClassKeys(master) {
    var seen = {}, out = [];
    master.forEach(function (r) {
      var k = r.grade + '|' + r.cls;
      if (!seen[k]) { seen[k] = 1; out.push({ key: k, grade: r.grade, cls: r.cls }); }
    });
    return out;
  }
  /* 한글 자모 단위 비슷한 정도 (0~1) — 글자 인식이 틀린 이름도 어느 정도 맞춘다 */
  function jamoSim(a, b) {
    a = String(a || '').normalize('NFD'); b = String(b || '').normalize('NFD');
    if (!a.length || !b.length) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }
  /* entries: [{grade, cls, subject, no, name}] (CSV·엑셀처럼 줄 단위로 온 경우) — 과목별로 묶어 matchPages 로 */
  function matchSelections(master, entries, classKey) {
    var order = [], map = {};
    entries.forEach(function (e) {
      var s = stripUnit(e.subject || '') || '(과목 미확인)';
      if (!map[s]) { map[s] = { index: order.length + 1, grade: e.grade, cls: e.cls, subject: s, jaeok: null, rows: [] }; order.push(s); }
      map[s].rows.push({ no: e.no, name: e.name });
    });
    return matchPages(master, order.map(function (s) { return map[s]; }), classKey);
  }
  function buildClassFromMaster(master, classKey, subjects, opts) {
    opts = opts || {};
    var rows = master.filter(function (r) { return r.grade + '|' + r.cls === classKey; });
    var students = {};
    rows.forEach(function (r) { students[r.no] = { no: r.no, name: r.name, kind: r.kind || '', notes: r.kind ? [r.kind] : [] }; });
    var list = Object.keys(students).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return students[n]; });
    var subs = (subjects || []).map(function (s) { return { subject: s.subject, raw: s.raw, group: s.group, expected: s.expected == null ? null : s.expected, nos: s.nos.filter(function (n) { return students[n]; }) }; });
    if (opts.sortSubjects === 'ga') subs.sort(function (a, b) { return a.subject.localeCompare(b.subject, 'ko'); });
    var first = rows[0] || {};
    return { key: classKey, grade: first.grade, cls: first.cls, students: students, studentList: list, subjects: subs };
  }

  /* ---------- PDF 쪽 읽기 (선택과목 명렬표는 과목×반마다 한 쪽) ----------
   * 쪽마다: 제목(학년·과목·반), 교실재적수, 학생 줄(번호·이름 추정)을 얻는다.
   * 과목은 쪽마다 반드시 하나 만든다(제목을 못 읽어도 "선택과목 N"). 이름은 틀려도 좋다 — 학생 명렬표와 맞춰 보며 바로잡는다. */
  var SKIP_LINE = /성명|개설과목|편제명|교실\s*[재제]\s*적|전체\s*선택|선택\s*현황|선택자수|재적수/;
  function parseTitle(line) {
    if (!/선택|현황/.test(line)) return null;
    var m = TITLE_RE.exec(line);
    if (m) return { grade: m[1] + '학년', cls: m[4] + '반', subject: stripUnit(m[2].trim() + '(' + m[3] + ')') };
    var body = line.replace(/\d{4}\s*학년도/, ' ').replace(/\d\s*차\s*정기\s*시험/, ' ');
    var g = /(\d)\s*학\s*년/.exec(body), cm = /(\d+)\s*반/.exec(body);
    if (!g) return null;
    var after = body.slice(g.index + g[0].length), end = after.search(/(\d+\s*반|선택\s*현황|선택|현황)/);
    var subj = stripUnit((end > 0 ? after.slice(0, end) : after).replace(/[|｜ㅣ│¦]/g, ' ').trim());
    return { grade: g[1] + '학년', cls: cm ? cm[1] + '반' : '', subject: subj };
  }
  /* "전체 선택자수 / 교실재적수 / 자퇴생 / 통합지원반 / 전출생 / 별도고사실" 줄에서 교실재적수를 찾는다 */
  function parseJaeok(lines) {
    var LAB = /교실\s*[재제]\s*적\s*수/;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (!LAB.test(l)) continue;
      var same = /교실\s*[재제]\s*적\s*수[^0-9가-힣]{0,4}(\d{1,3})/.exec(l);
      if (same) return parseInt(same[1], 10);
      var names = [['전체', /전체/], ['교실', /교실/], ['자퇴', /자퇴/], ['통합', /통합/], ['전출', /전출/], ['별도', /별도/]], pos = [];
      names.forEach(function (n) { var k = l.search(n[1]); if (k >= 0) pos.push({ n: n[0], k: k }); });
      pos.sort(function (a, b) { return a.k - b.k; });
      var idx = pos.map(function (p) { return p.n; }).indexOf('교실');
      var fix = function (s) { return s.replace(/[ㅁㅇOo]/g, '0').replace(/[|ㅣlI]/g, '1'); };   // 글자 인식이 0·1을 다른 글자로 읽는 경우
      var nums = l.match(/\d+/g) || [];
      for (var j = i + 1; j < Math.min(lines.length, i + 4) && nums.length < 2; j++) nums = fix(lines[j]).match(/\d+/g) || [];
      if (nums.length >= 6 && idx === 1) {              // 전체 = 교실재적수 + 자퇴 + 통합지원반 + 전출 + 별도고사실 이므로 서로 맞춰 본다
        var v = nums.slice(0, 6).map(function (x) { return parseInt(x, 10); }), derived = v[0] - v[2] - v[3] - v[4] - v[5];
        if (v[1] === derived) return v[1];
        if (derived >= 0 && derived <= v[0]) return derived;
      }
      if (nums.length >= 2 && idx >= 0 && idx < nums.length) return parseInt(nums[idx], 10);
    }
    return null;
  }
  /* 한 줄 → {no, name, note} (칸 구분선이 사라진 글자 인식 결과도 읽는다) */
  function lineToRow(line) {
    var s = String(line).replace(/[|｜ㅣ│¦]/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length < 3) return null;
    var strict = ROW_RE.exec(s);
    if (strict) return { no: parseInt(strict[5], 10), name: strict[6], note: (strict[7] || '').trim(), subj: strict[4] };
    var re = /(\d{1,2})\s?([가-힣]{2,4})(?![가-힣])/g, m, last = null;
    while ((m = re.exec(s))) { if (m[2] !== '학년' && m[2] !== '학반' && !(m.index === 0 && m[0].indexOf(' ') < 0) && parseInt(m[1], 10) <= 60) last = m; }
    if (last) {
      var note = s.slice(last.index + last[0].length).split(' ').filter(function (t) { return /[가-힣]{2,}/.test(t); }).join(' ');
      var pre = s.slice(0, last.index).trim().split(' ').filter(Boolean);
      return { no: parseInt(last[1], 10), name: last[2], note: note, subj: pre.length >= 4 ? pre.slice(3).join(' ') : '' };
    }
    var toks = s.split(' ').filter(function (t) { return /^[가-힣]{2,4}$/.test(t); });
    if (toks.length < 1 || s.split(' ').length < 3) return null;
    var name = toks[toks.length - 1], note = '';
    if (NOTE_RE.test(name) && toks.length > 1) { note = name; name = toks[toks.length - 2]; }
    return { no: '', name: name, note: note };
  }
  /* 과목명: 제목과 각 줄의 과목 칸을 모아 서로 가장 비슷한 것(대표값)을 고른다 — 글자 인식이 몇 글자 틀려도 다수가 맞으면 바로잡힌다 */
  function cleanSubj(s) { return stripUnit(String(s || '')).replace(/[^가-힣A-Za-z0-9 ]/g, ' ').replace(/([가-힣])\d$/, '$1').replace(/\s+/g, ' ').trim(); }
  function consensusSubject(titleSubj, rows) {
    var c = [];
    rows.forEach(function (r) { var s = cleanSubj(r.subj); if (s.length >= 2) c.push(s); });
    if (c.length < 3) { c = []; if (cleanSubj(titleSubj)) c.push(cleanSubj(titleSubj)); rows.forEach(function (r) { var s = cleanSubj(r.subj); if (s.length >= 2) c.push(s); }); }
    if (c.length < 3) return cleanSubj(titleSubj) || c[0] || '';
    var best = c[0], bs = -1;
    c.forEach(function (a) {
      var sc = 0; c.forEach(function (b) { sc += jamoSim(a, b); });
      if (sc > bs) { bs = sc; best = a; }
    });
    return best;
  }
  function parsePdfPages(texts) {
    return texts.map(function (tx, pi) {
      var lines = String(tx).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var title = null, rows = [];
      lines.forEach(function (l) { if (!title) title = parseTitle(l); });
      var jaeok = parseJaeok(lines);
      lines.forEach(function (l) {
        if (SKIP_LINE.test(l) || parseTitle(l)) return;
        var r = lineToRow(l); if (r) rows.push(r);
      });
      var subject = consensusSubject(title ? title.subject : '', rows);
      if (jaeok != null && rows.length && jaeok > rows.length + 1) jaeok = null;   // 글자 인식이 숫자를 잘못 읽은 경우
      return { index: pi + 1, grade: title ? title.grade : '', cls: title ? title.cls : '', subject: subject, jaeok: jaeok, rows: rows };
    });
  }
  /* 한 쪽의 줄들을 학생 명렬표(rows)의 학생에게 하나씩 짝지운다. 번호와 이름이 비슷할수록 점수가 높다. */
  function matchPage(students, entries, jaeok) {
    var pairs = [];
    entries.forEach(function (e, i) {
      students.forEach(function (r) {
        var noOk = e.no !== '' && e.no != null && Number(e.no) === r.no;
        var sc = (noOk ? 0.4 : 0) + 0.6 * jamoSim(e.name, r.name);
        if (sc >= 0.25) pairs.push({ sc: sc, i: i, r: r });
      });
    });
    pairs.sort(function (a, b) { return b.sc - a.sc; });
    var usedE = {}, usedS = {}, got = [];
    function take(p) { usedE[p.i] = 1; usedS[p.r.no] = 1; got.push(p); }
    pairs.forEach(function (p) { if (!usedE[p.i] && !usedS[p.r.no]) take(p); });
    if (jaeok != null) {                                   // PDF 의 교실재적수에 개수를 맞춘다
      var ne = got.filter(function (p) { return !p.r.kind; });
      if (ne.length > jaeok) {
        ne.sort(function (a, b) { return a.sc - b.sc; });
        ne.slice(0, ne.length - jaeok).forEach(function (p) { got.splice(got.indexOf(p), 1); delete usedS[p.r.no]; delete usedE[p.i]; });
      } else if (ne.length < jaeok) {
        var low = [];
        entries.forEach(function (e, i) {
          if (usedE[i]) return;
          students.forEach(function (r) {
            if (usedS[r.no] || r.kind) return;
            var noOk = e.no !== '' && e.no != null && Number(e.no) === r.no;
            low.push({ sc: (noOk ? 0.4 : 0) + 0.6 * jamoSim(e.name, r.name), i: i, r: r });
          });
        });
        low.sort(function (a, b) { return b.sc - a.sc; });
        var need = jaeok - ne.length;
        low.forEach(function (p) { if (need > 0 && p.sc >= 0.05 && !usedE[p.i] && !usedS[p.r.no]) { take(p); need--; } });
      }
    }
    return { nos: got.map(function (p) { return p.r.no; }), got: got.filter(function (p) { return !p.r.kind; }).length, unmatched: entries.length - got.length };
  }
  function matchPages(master, pages, classKey) {
    var students = master.filter(function (r) { return r.grade + '|' + r.cls === classKey; });
    var multi = masterClassKeys(master).length > 1;
    var order = [], map = {}, matched = 0, unmatched = 0, skipped = 0;
    pages.forEach(function (pg) {
      if (multi && pg.cls) {
        var key = (pg.grade || (students[0] && students[0].grade) || '') + '|' + pg.cls;
        if (key !== classKey) { skipped++; return; }
      }
      var name = stripUnit(pg.subject || '') || '선택과목 ' + pg.index;
      var res = matchPage(students, pg.rows, pg.jaeok);
      var s = map[name];
      if (!s) { s = map[name] = { subject: name, raw: name, group: '', nos: [], expected: null, got: 0 }; order.push(name); }
      res.nos.forEach(function (n) { if (s.nos.indexOf(n) < 0) s.nos.push(n); });
      if (pg.jaeok != null) s.expected = (s.expected || 0) + pg.jaeok;
      s.got += res.got; matched += res.nos.length; unmatched += res.unmatched;
    });
    return { subjects: order.map(function (n) { return map[n]; }), matched: matched, unmatched: unmatched, skipped: skipped };
  }

  /* ---------- 직접 만드는 좌석 배치도 ----------
   * types[행 0~5][열] = 'seat'(좌석) | 'blank'(빈칸) | 'x'(책상 없음, 대각선)
   * 기본은 모든 칸이 좌석(열마다 6석). 슬롯 순서는 양식과 같다:
   * 맨 오른쪽 열의 맨 아래(칠판 쪽)부터 위로, 열 끝에 닿으면 바로 왼쪽 열의 맨 아래로. 빈칸·X는 건너뛴다. */
  function defaultTypes(cols, rows) {
    rows = rows || 6;
    var t = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push('seat'); t.push(row); }
    return t;
  }
  /* 크기를 바꿀 때는 오른쪽 아래(앞줄·칠판 쪽)를 기준으로 기존 칸을 유지한다 */
  function resizeTypes(types, cols, rows) {
    rows = rows || types.length;
    var oR = types.length, oC = types[0] ? types[0].length : 0, t = defaultTypes(cols, rows);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var rr = r - (rows - oR), cc = c - (cols - oC);
      if (rr >= 0 && cc >= 0 && types[rr] && types[rr][cc]) t[r][c] = types[rr][cc];
    }
    return t;
  }
  function customLayout(cols, types, shift) {
    var rows = types.length, grid = [], so = [], r, c;
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < cols; c++) { if (c) row.push('gap'); var t = types[r][c]; row.push(t === 'seat' ? 'seat' : t === 'x' ? 'x' : 'void'); }
      grid.push(row);
    }
    for (c = cols - 1; c >= 0; c--) for (r = rows - 1; r >= 0; r--) if (types[r][c] === 'seat') so.push({ slot: so.length + 1, col: c * 2, row: r });
    return { id: 'C', rowCnt: rows, colCnt: cols * 2 - 1, cols: cols, seatCount: so.length, grid: grid, slotOrder: so, firstPageVposShift: shift || 0 };
  }
  /* 화면용 배치도(rows×cols)를 hwpx 양식 크기(6행 × tplCols열)의 배치도로 바꾼다.
   * 양식 표는 크기가 고정이라, 고른 크기는 오른쪽 아래(앞줄 쪽)에 놓고 나머지 칸은 비워 둔다. */
  function toTemplateLayout(L, tplCols) {
    var R = L.rowCnt, K = L.cols, ro = 6 - R, co = tplCols - K, grid = [], r, c;
    for (r = 0; r < 6; r++) { var row = []; for (c = 0; c < tplCols * 2 - 1; c++) row.push(c % 2 ? 'gap' : 'void'); grid.push(row); }
    for (r = 0; r < R; r++) for (c = 0; c < K * 2 - 1; c++) grid[r + ro][c + co * 2] = L.grid[r][c];
    return {
      id: L.id, rowCnt: 6, colCnt: tplCols * 2 - 1, cols: tplCols, seatCount: L.seatCount, grid: grid,
      slotOrder: L.slotOrder.map(function (s) { return { slot: s.slot, col: s.col + co * 2, row: s.row + ro }; }),
      firstPageVposShift: L.firstPageVposShift
    };
  }

  /* ---------- 제목 ---------- */
  function titleInfo(subject, oneLineMax) {
    var len = subject.length; // 과목명 글자 수
    return { twoLine: len > oneLineMax, tooLong: len > 12, text: '(' + subject + ')' };
  }

  var api = {
    DEFAULT_KEYWORDS: DEFAULT_KEYWORDS, mulberry32: mulberry32, hashStr: hashStr, shuffled: shuffled,
    parseDelimited: parseDelimited, rowsToRoster: rowsToRoster, parseRosterText: parseRosterText,
    stripUnit: stripUnit, classKeys: classKeys, buildClass: buildClass, isExcluded: isExcluded, noteExcluded: noteExcluded,
    newPage: newPage, pageSeed: pageSeed, fillPage: fillPage, buildPages: buildPages,
    textToRoster: textToRoster, pagesToRoster: pagesToRoster, rosterToTSV: rosterToTSV, applyExclusion: applyExclusion, parseTitle: parseTitle, parseJaeok: parseJaeok, lineToRow: lineToRow, parsePdfPages: parsePdfPages, matchPage: matchPage, matchPages: matchPages, defaultTypes: defaultTypes, resizeTypes: resizeTypes, customLayout: customLayout, toTemplateLayout: toTemplateLayout, KINDS: KINDS, normGrade: normGrade, normCls: normCls, normKind: normKind, masterFromTable: masterFromTable, masterClassKeys: masterClassKeys, jamoSim: jamoSim, matchSelections: matchSelections, buildClassFromMaster: buildClassFromMaster, relayout: relayout, reshuffle: reshuffle, titleInfo: titleInfo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
