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

  function stripUnit(s) { return String(s).replace(/\(\d+\)\s*$/, '').trim(); }

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
    textToRoster: textToRoster, rosterToTSV: rosterToTSV, applyExclusion: applyExclusion, relayout: relayout, reshuffle: reshuffle, titleInfo: titleInfo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
