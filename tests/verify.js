// 완료 기준 검증: NODE_PATH 에 jszip, @xmldom/xmldom 이 있어야 한다.
//   NODE_PATH=<node_modules 위치> node tests/verify.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const JSZip = require('jszip'), { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const core = require('../src/core.js'), hw = require('../src/hwpx.js');
const root = path.join(__dirname, '..');
const layouts = JSON.parse(fs.readFileSync(path.join(root, 'layouts.json'), 'utf8')).layouts;
const csv = fs.readFileSync(path.join(root, 'examples/example-roster.csv'), 'utf8');
const roster = core.parseRosterText(csv);
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
let n = 0; const ok = (m) => console.log('  ✓', m, ++n);

(async () => {
  const tr = core.textToRoster('2학년 | 3반 | 사회 | 미래사회와 기술 (3) | 17 | 소나윤 | 전출'+String.fromCharCode(10)+'제목 줄');
  assert.equal(tr.length, 1); assert.equal(tr[0].subjectRaw, '미래사회와 기술(3)'); assert.equal(tr[0].note, '전출'); ok('PDF 글자 한 줄 파싱');
  // 학생 명렬표(기준) + 선택과목 줄을 맞춰 보기
  const kindOf = {}; roster.forEach(r => { if (r.note) kindOf[r.no] = core.normKind(r.note); });
  const seenNo = {}, master = [];
  roster.forEach(r => { if (!seenNo[r.no]) { seenNo[r.no] = 1; master.push({ grade: r.grade, cls: r.cls, no: r.no, name: r.name, kind: kindOf[r.no] || '' }); } });
  const keys = core.masterClassKeys(master);
  assert.equal(keys.length, 1); assert.equal(keys[0].cls, '3반');
  const entries = roster.map(r => ({ grade: r.grade, cls: r.cls, subject: core.stripUnit(r.subjectRaw), no: r.no, name: r.name }));
  const mres = core.matchSelections(master, entries, keys[0].key);
  assert.equal(mres.matched, 96); assert.equal(mres.unmatched, 0); assert.equal(mres.subjects.length, 12); ok('선택과목 줄 96개를 학생 명렬표와 맞춤');
  // 틀린 이름·번호도 맞추기: 번호만 맞음 / 이름만 맞음(번호 없음) / 이름이 한 글자 틀림(번호 없음)
  const noisy = core.matchSelections(master, [
    { subject: '철학', no: 7, name: '신바나' }, { subject: '철학', no: '', name: '도민결' }, { subject: '철학', no: '', name: '육하군' }
  ], keys[0].key);
  assert.deepEqual(noisy.subjects[0].nos.slice().sort((a, b) => a - b), [7, 14, 16]); ok('틀린 글자 섞인 줄도 학생 명렬표로 바로잡음');
  // PDF 쪽 읽기: 제목·교실재적수·줄, 그리고 교실재적수에 맞춰 연결 (제목을 못 읽은 쪽도 과목은 만든다)
  const pdfTexts = [
    ['2026학년도 2차 정기시험 2학년 철학(3) 3반 선택 현황', '전체 선택자수 교실재적수 자퇴생 통합지원반 전출생 별도고사실', '4 3 0 0 0 1', '학년 반 편제명 개설과목(단위수) 번호 성명 비고',
      '2학년 3반 사회 철학(3) 7 신유나', '2화년 3반 사회 철학(3) 16 도민결', '2학년 3반 사회 철학(3) 21 표단우', '2학년 3반 사회 철학(3) 23 편라온 별도고사실'].join(String.fromCharCode(10)),
    ['선택 현황 이상한 제목', '교실재적수 : 2', '1 오하람', '2 구도 [깨짐]', '3 ㅁㄴㅇ'].join(String.fromCharCode(10))
  ];
  const pp = core.parsePdfPages(pdfTexts);
  assert.equal(pp[0].subject, '철학'); assert.equal(pp[0].cls, '3반'); assert.equal(pp[0].jaeok, 3); assert.equal(pp[0].rows.length, 4);
  const pm = core.matchPages(master, pp, keys[0].key);
  assert.equal(pm.subjects.length, 2); assert.equal(pm.subjects[0].subject, '철학'); assert.ok(/^선택과목/.test(pm.subjects[1].subject));
  assert.equal(pm.subjects[0].got, 3); assert.equal(pm.subjects[0].expected, 3); // 별도고사실 학생은 제외 인원이라 재적수에 안 셈
  assert.equal(pm.subjects[1].got, 2, '교실재적수 2명에 맞춤'); ok('PDF 쪽 읽기 + 교실재적수 맞추기');
  assert.equal(core.masterFromTable([['학년', '반', '번호', '이름', '구분'], ['2', '3', '1', '홍길동', '별도고사실'], ['', '', '', '', '']])[0].kind, '별도고사실'); ok('엑셀 양식 읽기');
  const cls = core.buildClassFromMaster(master, keys[0].key, mres.subjects);
  const ctx = { seatCount: 21, excluded: (no) => core.isExcluded(cls.students[no], core.DEFAULT_KEYWORDS, {}) };
  const pages = core.buildPages(cls, ctx, 12345);
  assert.equal(pages.length, 13); ok('13쪽 생성(공통+12과목)');
  const common = pages[0];
  assert.equal(common.seats.filter(x => x != null).length, 21);
  const seq = common.seats.filter(x => x != null);
  assert.deepEqual(seq, seq.slice().sort((a, b) => a - b)); ok('공통 쪽 21명 번호순');
  [4, 11, 17, 23].forEach(no => assert.ok(!common.seats.includes(no)));
  pages.slice(1).forEach(p => {
    const seated = p.seats.filter(x => x != null);
    assert.equal(seated.length, 21, p.subject + ': 공통 학생 21명 전원'); 
    assert.deepEqual(seated.slice().sort((x, y) => x - y), seq.slice().sort((x, y) => x - y));
    assert.equal(p.seats.findIndex(x => x == null), -1);
    const picks = p.pick.filter(no => !ctx.excluded(no));
    const head = p.seats.slice(0, picks.length);
    assert.deepEqual(head.slice().sort((x, y) => x - y), picks.slice().sort((x, y) => x - y), p.subject + ': 선택 학생이 앞 슬롯');
  });
  ok('모든 과목 쪽에 공통 21명 전원, 선택 학생이 먼저');
  const phil = pages.find(p => p.subject === '철학');
  assert.equal(phil.pick.filter(no => !ctx.excluded(no)).length, 3); ok('철학 선택자 3명(제외 뺀)');
  // 무작위 없음: 몇 번을 만들어도 같고, 순서는 1순위 선택과목 → 2순위 번호순
  const again = core.buildPages(cls, ctx, 999);
  assert.deepEqual(again.map(p => p.seats), pages.map(p => p.seats)); ok('언제 만들어도 같은 배치(무작위 없음)');
  pages.slice(1).forEach(p => {
    const picks = p.pick.filter(no => !ctx.excluded(no)).sort((a, b) => a - b);
    const rest = p.nos.filter(no => !ctx.excluded(no) && !p.pick.includes(no)).sort((a, b) => a - b);
    assert.deepEqual(p.seats.filter(x => x != null), picks.concat(rest), p.subject + ': 선택과목 먼저, 각각 번호순');
  });
  ok('정렬 순서: 1순위 선택과목, 2순위 번호순');
  // 영어 이름도 읽기·맞추기
  const enM = [{ grade: '1학년', cls: '1반', no: 1, name: 'Emily Park', kind: '' }, { grade: '1학년', cls: '1반', no: 2, name: '홍길동', kind: '' }, { grade: '1학년', cls: '1반', no: 3, name: 'Jun Seo', kind: '전출' }];
  const enT = ['2026학년도 1학년 철학(3) 1반 선택 현황', '1학년 1반 사회 철학(3) 1 Emily Park', '1학년 1반 사회 철학(3) 2 홍길동', '1학년 1반 사회 철학(3) 3 Jun Seo 전출'].join(String.fromCharCode(10));
  const enP = core.parsePdfPages([enT]);
  assert.equal(enP[0].rows[0].name, 'Emily Park'); assert.equal(enP[0].rows[2].note, '전출');
  const enMatch = core.matchPages(enM, enP, '1학년|1반');
  assert.deepEqual(enMatch.subjects[0].nos.slice().sort(), [1, 2, 3]); assert.equal(enMatch.subjects[0].pairs.length, 3);
  assert.ok(core.jamoSim('Emlly  Park', 'emily park') > 0.85); ok('영어 이름 읽기·맞추기');
  assert.equal(core.titleInfo('철학', 4).twoLine, false);
  assert.equal(core.titleInfo('코딩과 알고리즘', 4).twoLine, true);
  assert.equal(core.titleInfo('환경과 지속가능한 미래', 4).tooLong, false);
  assert.equal(core.titleInfo('환경과 지속가능한 미래입니다', 4).tooLong, true); ok('제목 규칙');

  const known = new Set(roster.map(r => r.name));
  for (const v of ['A', 'B']) {
    const L = layouts[v];
    const tpl = fs.readFileSync(path.join(root, 'templates', `seat-template-${v}.hwpx`));
    const outPages = pages.map(p => ({ subject: p.subject, cells: p.seats.map(no => no == null ? null : { no, name: cls.students[no].name, picked: !p.common && p.pick.includes(no) }) }));
    const out = await hw.buildHwpx({ JSZip, DOMParser, XMLSerializer }, tpl, L, outPages, { previewPng: PNG });
    const z = await JSZip.loadAsync(out);
    const names = Object.keys(z.files);
    assert.equal(names[0], 'mimetype'); assert.ok(names.every(x => !x.endsWith('/'))); ok(v + ': mimetype 첫 항목·폴더 항목 없음');
    const raw = Buffer.from(out);
    // mimetype 무압축: 로컬 헤더 압축방식 필드 = 0
    assert.equal(raw.readUInt16LE(8), 0); ok(v + ': mimetype 무압축');
    const sec = await z.file('Contents/section0.xml').async('string');
    assert.ok(sec.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'));
    assert.equal((sec.match(/<hp:tbl /g) || []).length, 26);
    const ids = [...sec.matchAll(/<hp:tbl id="(\d+)" zOrder="(\d+)"/g)];
    assert.equal(new Set(ids.map(m => m[1])).size, 26); assert.equal(new Set(ids.map(m => m[2])).size, 26);
    assert.equal((sec.match(/pageBreak="1"/g) || []).length, 12); ok(v + ': 표 26개·id 유일·쪽나눔 12');
    const hdrT = await JSZip.loadAsync(tpl).then(t => t.file('Contents/header.xml').async('string'));
    const hdrN = await z.file('Contents/header.xml').async('string');
    const BASE = +hdrT.match(/<hh:borderFills[^>]*itemCnt="(\d+)"/)[1];
    const addedIds = [...hdrN.matchAll(/<hh:borderFill id="(\d+)"/g)].map(m => +m[1]).filter(id => id > BASE);
    assert.ok(addedIds.length > 0 && new Set(addedIds).size === addedIds.length);
    assert.equal(+hdrN.match(/<hh:borderFills[^>]*itemCnt="(\d+)"/)[1], BASE + addedIds.length);
    assert.equal((hdrN.match(/faceColor="#D9ECFF"/g) || []).length, addedIds.length);
    // 기존 서식은 그대로: 추가분을 빼고 itemCnt 를 되돌리면 원본과 같다
    let back = hdrN.replace(/<hh:borderFill id="(\d+)"[^>]*>[\s\S]*?<\/hh:borderFill>/g, (m, id) => +id > BASE ? '' : m);
    back = back.replace('<hh:borderFills itemCnt="' + (BASE + addedIds.length) + '"', '<hh:borderFills itemCnt="' + BASE + '"');
    assert.equal(back, hdrT);
    const used = new Set([...sec.matchAll(/<hp:tc [^>]*borderFillIDRef="(\d+)"/g)].map(m => +m[1]));
    addedIds.forEach(id => assert.ok(used.has(id), '추가 서식 미사용: ' + id));
    [...used].forEach(id => assert.ok(id <= BASE + addedIds.length)); ok(v + ': header.xml 은 서식 추가만, 선택 학생 셀에 적용');
    // 이름 누출 검사: 텍스트 파일 전체에서 명렬표 이름만 허용, 양식 이름 없음
    const tplZip = await JSZip.loadAsync(tpl);
    const tplText = (await tplZip.file('Preview/PrvText.txt').async('string')) + (await tplZip.file('Contents/section0.xml').async('string'));
    const allOut = sec + (await z.file('Preview/PrvText.txt').async('string'));
    const prvImg = await z.file('Preview/PrvImage.png').async('uint8array');
    assert.deepEqual([...prvImg], [...PNG]); ok(v + ': PrvImage 교체');
    // 예시 hwpx 의 골격 비교 (표 수·행/열 수)
    const ex = await JSZip.loadAsync(fs.readFileSync(path.join(root, `examples/example-${v}.hwpx`)));
    const exSec = await ex.file('Contents/section0.xml').async('string');
    const sig = (s) => [...s.matchAll(/rowCnt="(\d+)" colCnt="(\d+)"/g)].map(m => m[1] + 'x' + m[2]).join(',');
    assert.equal(sig(sec), sig(exSec)); ok(v + ': 예시와 표 크기 골격 동일');
    // 좌석 셀 텍스트: 예시 12쪽 이후 이름들과는 무관, 우리 데이터의 일치 확인
    const common = outPages[0];
    L.slotOrder.forEach((s, i) => {
      const c = common.cells[i]; if (!c) return;
      const re = new RegExp('cellAddr colAddr="' + s.col + '" rowAddr="' + s.row + '"');
      assert.ok(re.test(sec));
    });
    const txt = await z.file('Preview/PrvText.txt').async('string');
    assert.ok(txt.startsWith('\r\n고사좌석배치표(공통)\r\n')); assert.ok(txt.length <= 1023); ok(v + ': PrvText 형식');
    const settings = await z.file('settings.xml').async('string');
    assert.ok(settings.includes('<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>'));
    // 이름 누출 검사: 출력 PrvText 의 '<번호 이름>' 과 section 의 좌석 셀 이름은 모두 명렬표에 있어야 한다.
    const pn = [...txt.matchAll(/<\d+ ([^>]+)>/g)].map(m => m[1]);
    pn.forEach(t => assert.ok(known.has(t), '명렬표에 없는 이름: ' + t));
    const sn = [...sec.matchAll(/<hp:t>([가-힣]{2,4})<\/hp:t>/g)].map(m => m[1]);
    const titles = new Set(pages.map(p => p.subject).concat(['고사좌석배치표', '칠판']));
    sn.forEach(t => assert.ok(known.has(t) || [...titles].some(x => x.includes(t) || t.includes(x)), '의심 문자열: ' + t));
    ok(v + ': 이름 누출 없음');
    // 두 줄 제목: 과목명 5자 이상 쪽은 제목 1행이 따로 있어야 한다
    assert.ok(/<hp:t>\(코딩과 알고리즘\)<\/hp:t>/.test(sec)); ok(v + ': 두 줄 제목 채움');
  }
  // 직접 만드는 배치도: X·빈칸·좌석을 마음대로, 모든 쪽이 같은 배치
  for (const cols of [4, 5]) {
    const L0 = layouts[cols === 4 ? 'A' : 'B'];
    const types = core.defaultTypes(cols); types[0][0] = 'x'; types[2][1] = 'blank'; types[5][cols - 1] = 'x';
    const CL = core.customLayout(cols, types, L0.firstPageVposShift);
    assert.equal(CL.seatCount, 6 * cols - 3);
    assert.deepEqual(CL.slotOrder[0], { slot: 1, col: (cols - 1) * 2, row: 4 }); // 맨 오른쪽 열 아래 칸이 X이므로 한 칸 위부터
    const tplC = fs.readFileSync(path.join(root, 'templates', 'seat-template-' + (cols === 4 ? 'A' : 'B') + '.hwpx'));
    const cellsC = Array.from({ length: CL.seatCount }, (_, i) => ({ no: i + 1, name: '이름' + (i + 1), picked: i % 3 === 0 }));
    const oc = await hw.buildHwpx({ JSZip, DOMParser, XMLSerializer }, tplC, CL, [{ subject: '철학', cells: cellsC }, { subject: '공통', cells: cellsC.map(c => ({ ...c, picked: false })) }], { previewPng: PNG });
    const zc = await JSZip.loadAsync(oc);
    const secC = await zc.file('Contents/section0.xml').async('string'), hdrC = await zc.file('Contents/header.xml').async('string');
    const errs = [];
    [secC, hdrC].forEach(x => new DOMParser({ onError: (l, m) => { if (l !== 'warning') errs.push(m); } }).parseFromString(x, 'text/xml'));
    assert.equal(errs.length, 0);
    const doc = new DOMParser().parseFromString(secC, 'text/xml');
    const tcs = []; (function walk(n) { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) { if (c.localName === 'tc') tcs.push(c); walk(c); } } })(doc.documentElement);
    const firstTbl = tcs.slice(0, (cols * 2 - 1) * 6);   // 첫 쪽 좌석표
    const at = (col, row) => firstTbl.find(tc => { const a = [...tc.childNodes].find(n => n.localName === 'cellAddr'); return +a.getAttribute('colAddr') === col && +a.getAttribute('rowAddr') === row; });
    const fillOf = (tc) => { const i = hdrC.indexOf('<hh:borderFill id="' + tc.getAttribute('borderFillIDRef') + '"'); return hdrC.slice(i, hdrC.indexOf('</hh:borderFill>', i)); };
    const txt = (tc) => [...tc.getElementsByTagName('hp:t')].map(n => n.textContent).filter(Boolean).join('|');
    assert.ok(/<hh:slash type="CENTER"/.test(fillOf(at(0, 0))), 'X 칸에 대각선'); assert.equal(txt(at(0, 0)), '');
    assert.ok(/<hh:slash type="CENTER"/.test(fillOf(at((cols - 1) * 2, 5))), '오른쪽 아래 X');
    assert.ok(!/<hh:slash type="CENTER"/.test(fillOf(at(2, 2))), '빈칸에는 대각선 없음'); assert.equal(txt(at(2, 2)), '');
    const s1 = at((cols - 1) * 2, 4); assert.equal(txt(s1), '1|이름1'); assert.ok(/#D9ECFF/.test(fillOf(s1)), '선택 학생 색');
    // 양식에서 원래 빈칸/X였던 곳도 좌석이 되면 번호·이름이 들어가고 대각선이 없다
    const nat = cols === 4 ? at(4, 0) : at(cols === 5 ? 8 : 0, 1);
    assert.ok(/\|이름\d+$/.test(txt(nat)) || /^\d+\|이름\d+$/.test(txt(nat)), '원래 빈 칸이던 곳에 좌석: ' + txt(nat));
    assert.ok(!/<hh:slash type="CENTER"/.test(fillOf(nat)));
    ok('직접 만든 배치도 ' + cols + '열: X·빈칸·좌석·색이 hwpx에 반영, 모든 쪽 동일');
  }
  // 직접 조정: 열·행 수를 먼저 고르기 (3열 × 4행) → 양식 크기(6행 × 4열)의 오른쪽 아래에 놓이고 나머지는 빈칸
  {
    const ty = core.defaultTypes(3, 4); ty[1][1] = 'x';
    const L = core.customLayout(3, ty, 360), T = core.toTemplateLayout(L, 4);
    assert.equal(L.rowCnt, 4); assert.equal(L.seatCount, 11); assert.equal(T.rowCnt, 6); assert.equal(T.colCnt, 7);
    assert.deepEqual(T.slotOrder[0], { slot: 1, col: 6, row: 5 });
    const cellsD = Array.from({ length: L.seatCount }, (_, i) => ({ no: i + 1, name: '이름' + (i + 1), picked: false }));
    const od = await hw.buildHwpx({ JSZip, DOMParser, XMLSerializer }, fs.readFileSync(path.join(root, 'templates/seat-template-A.hwpx')), T, [{ subject: '철학', cells: cellsD }], { previewPng: PNG });
    const sd = await (await JSZip.loadAsync(od)).file('Contents/section0.xml').async('string');
    const nums = [...sd.matchAll(/<hp:t>(\d+)<\/hp:t>/g)].map(m => +m[1]);
    assert.equal(nums.length, 11); assert.deepEqual(nums.slice().sort((a, b) => a - b), cellsD.map(c => c.no)); ok('열·행 수를 고른 배치도를 양식 크기로 변환(남는 칸은 비움)');
  }
  // 첫 쪽이 두 줄형일 때 (공통 제외)
  const L = layouts.A, tpl = fs.readFileSync(path.join(root, 'templates/seat-template-A.hwpx'));
  const p2 = [{ subject: '코딩과 알고리즘', cells: new Array(21).fill(null) }, { subject: '철학', cells: new Array(21).fill(null) }];
  const o2 = await hw.buildHwpx({ JSZip, DOMParser, XMLSerializer }, tpl, L, p2, { previewPng: PNG });
  const s2 = await (await JSZip.loadAsync(o2)).file('Contents/section0.xml').async('string');
  assert.equal((s2.match(/pageBreak="1"/g) || []).length, 1); ok('첫 쪽 두 줄형: 쪽나눔 1개(둘째 쪽만)');
  console.log('모두 통과');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
