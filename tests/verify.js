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
  const keys = core.classKeys(roster);
  assert.equal(keys.length, 1); assert.equal(keys[0].cls, '3반');
  const cls = core.buildClass(roster, keys[0].key);
  const ctx = { seatCount: 21, excluded: (no) => core.isExcluded(cls.students[no], core.DEFAULT_KEYWORDS, {}) };
  const pages = core.buildPages(cls, ctx, 12345);
  assert.equal(pages.length, 13); ok('13쪽 생성(공통+12과목)');
  const common = pages[0];
  assert.equal(common.seats.filter(x => x != null).length, 21);
  const seq = common.seats.filter(x => x != null);
  assert.deepEqual(seq, seq.slice().sort((a, b) => a - b)); ok('공통 쪽 21명 번호순');
  [4, 11, 17, 23].forEach(no => assert.ok(!common.seats.includes(no)));
  pages.slice(1).forEach(p => {
    const filled = p.seats.findIndex(x => x == null);
    const cnt = p.seats.filter(x => x != null).length;
    assert.ok(filled === -1 || filled === cnt, p.subject + ' 빈자리 없이 이어서');
    p.seats.forEach(no => { if (no != null) assert.ok(!ctx.excluded(no)); });
  });
  const phil = pages.find(p => p.subject === '철학');
  assert.equal(phil.seats.filter(x => x != null).length, 3); ok('철학 3명, 제외 학생 없음');
  const again = core.buildPages(cls, ctx, 12345);
  assert.deepEqual(again.map(p => p.seats), pages.map(p => p.seats)); ok('같은 시드 → 같은 배치');
  const other = core.buildPages(cls, ctx, 999);
  assert.notDeepEqual(other.map(p => p.seats), pages.map(p => p.seats)); ok('다른 시드 → 다른 배치');
  assert.equal(core.titleInfo('철학', 4).twoLine, false);
  assert.equal(core.titleInfo('코딩과 알고리즘', 4).twoLine, true);
  assert.equal(core.titleInfo('환경과 지속가능한 미래', 4).tooLong, false);
  assert.equal(core.titleInfo('환경과 지속가능한 미래입니다', 4).tooLong, true); ok('제목 규칙');

  const known = new Set(roster.map(r => r.name));
  for (const v of ['A', 'B']) {
    const L = layouts[v];
    const tpl = fs.readFileSync(path.join(root, 'templates', `seat-template-${v}.hwpx`));
    const outPages = pages.map(p => ({ subject: p.subject, cells: p.seats.map(no => no == null ? null : { no, name: cls.students[no].name }) }));
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
    assert.equal(await z.file('Contents/header.xml').async('string'), hdrT); ok(v + ': header.xml 불변');
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
  // 첫 쪽이 두 줄형일 때 (공통 제외)
  const L = layouts.A, tpl = fs.readFileSync(path.join(root, 'templates/seat-template-A.hwpx'));
  const p2 = [{ subject: '코딩과 알고리즘', cells: new Array(21).fill(null) }, { subject: '철학', cells: new Array(21).fill(null) }];
  const o2 = await hw.buildHwpx({ JSZip, DOMParser, XMLSerializer }, tpl, L, p2, { previewPng: PNG });
  const s2 = await (await JSZip.loadAsync(o2)).file('Contents/section0.xml').async('string');
  assert.equal((s2.match(/pageBreak="1"/g) || []).length, 1); ok('첫 쪽 두 줄형: 쪽나눔 1개(둘째 쪽만)');
  console.log('모두 통과');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
