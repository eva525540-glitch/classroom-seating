/* hwpx 내보내기 — 양식 hwpx의 쪽 블록을 복제하고 글자만 채운다.
 * 의존성(JSZip, DOMParser, XMLSerializer)은 deps로 주입 (브라우저/node 겸용). */
(function (root) {
  'use strict';
  var HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

  function kids(node, local) {
    var out = [];
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (!local || c.localName === local)) out.push(c);
    }
    return out;
  }
  function descendants(node, local, acc) {
    acc = acc || [];
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.localName === local) acc.push(c);
      descendants(c, local, acc);
    }
    return acc;
  }
  function setText(par, text) {
    // par: <hp:p>. 첫 run의 hp:t 텍스트를 교체 (없으면 만든다). 다른 속성은 건드리지 않는다.
    var run = kids(par, 'run')[0];
    if (!run) return;
    var t = kids(run, 't')[0];
    if (!t) {
      t = run.ownerDocument.createElementNS(HP, 'hp:t');
      run.appendChild(t);
    }
    while (t.firstChild) t.removeChild(t.firstChild);
    if (text !== '' && text != null) t.appendChild(run.ownerDocument.createTextNode(String(text)));
  }
  function setRunText(run, text) {
    var t = kids(run, 't')[0];
    if (!t) { t = run.ownerDocument.createElementNS(HP, 'hp:t'); run.appendChild(t); }
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(run.ownerDocument.createTextNode(text));
  }

  function splitBlocks(paras) {
    // paras[0]=머리, 이후 pageBreak="1"인 문단에서 블록이 갈라진다.
    var blocks = [], cur = [];
    for (var i = 1; i < paras.length; i++) {
      if (paras[i].getAttribute('pageBreak') === '1' && cur.length) { blocks.push(cur); cur = []; }
      cur.push(paras[i]);
    }
    if (cur.length) blocks.push(cur);
    if (blocks.length !== 3 || blocks[0].length !== 3 || blocks[1].length !== 4 || blocks[2].length !== 5)
      throw new Error('양식 파일의 구조가 예상과 다릅니다.');
    return { head: paras[0], firstOne: blocks[0], laterOne: blocks[1], laterTwo: blocks[2] };
  }

  function shiftVpos(par, delta) {
    if (!delta) return;
    kids(par, 'linesegarray').forEach(function (la) {
      kids(la, 'lineseg').forEach(function (ls) {
        var v = parseInt(ls.getAttribute('vertpos'), 10);
        if (!isNaN(v)) ls.setAttribute('vertpos', String(v + delta));
      });
    });
  }

  /* 좌석 채우기: cells = [{no,name}|null] (슬롯 순서) */
  function fillSeats(tblPara, layout, cells) {
    var tbl = descendants(tblPara, 'tbl')[0];
    var tcs = descendants(tbl, 'tc');
    var byAddr = {};
    tcs.forEach(function (tc) {
      var a = kids(tc, 'cellAddr')[0];
      byAddr[a.getAttribute('colAddr') + ',' + a.getAttribute('rowAddr')] = tc;
    });
    layout.slotOrder.forEach(function (s, i) {
      var tc = byAddr[s.col + ',' + s.row];
      if (!tc) throw new Error('좌석 셀을 찾지 못했습니다: ' + s.col + ',' + s.row);
      var ps = kids(kids(tc, 'subList')[0], 'p');
      if (ps.length !== 2) throw new Error('좌석 셀의 문단 구조가 예상과 다릅니다.');
      var c = cells[i];
      setText(ps[0], c ? String(c.no) : '');
      setText(ps[1], c ? c.name : '');
    });
    return tbl;
  }

  function previewText(pages, layout, twoLineMax) {
    var out = '\r\n';
    pages.forEach(function (pg) {
      var one = pg.subject.length <= twoLineMax;
      var t = '고사좌석배치표';
      if (one) out += t + '(' + pg.subject + ')\r\n';
      else out += t + '\r\n(' + pg.subject + ')\r\n';
      for (var r = 0; r < layout.rowCnt; r++) {
        var line = '';
        for (var c = 0; c < layout.colCnt; c++) {
          var content = '';
          var idx = -1;
          for (var k = 0; k < layout.slotOrder.length; k++) {
            if (layout.slotOrder[k].col === c && layout.slotOrder[k].row === r) { idx = k; break; }
          }
          if (idx >= 0 && pg.cells[idx]) content = pg.cells[idx].no + ' ' + pg.cells[idx].name;
          line += '<' + content + '>';
        }
        out += line + '\r\n';
      }
      out += '<칠판>\r\n\r\n';
    });
    return out.length > 1023 ? out.slice(0, 1023) : out;
  }

  /* pages: [{subject, cells:[{no,name}|null ×21]}] */
  async function buildHwpx(deps, templateBytes, layout, pages, opts) {
    opts = opts || {};
    var oneMax = opts.titleOneLineMaxChars == null ? 4 : opts.titleOneLineMaxChars;
    var zip = await deps.JSZip.loadAsync(templateBytes);
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
    var xml = await zip.file('Contents/section0.xml').async('string');
    var doc = new deps.DOMParser().parseFromString(xml, 'application/xml');
    var sec = doc.documentElement;
    var paras = kids(sec, 'p');
    var B = splitBlocks(paras);

    while (sec.firstChild) sec.removeChild(sec.firstChild);
    sec.appendChild(B.head);

    pages.forEach(function (pg, pi) {
      var twoLine = pg.subject.length > oneMax;
      var src, first = pi === 0;
      if (first && !twoLine) src = B.firstOne;
      else src = twoLine ? B.laterTwo : B.laterOne;
      var block = src.map(function (p) { return p.cloneNode(true); });
      var delta = 0;
      if (first && twoLine) { block.shift(); delta = layout.firstPageVposShift || 0; } // 맨 앞 쪽나눔 문단 제거
      var titleParas, seatPara;
      if (twoLine) {
        // [ (쪽나눔), 제목1, 제목2, 좌석표, 칠판 ]
        var off = first ? 0 : 1;
        titleParas = [block[off], block[off + 1]];
        setText(titleParas[1], '(' + pg.subject + ')');
        seatPara = block[off + 2];
      } else {
        var off1 = first ? 0 : 1;
        var runs = kids(block[off1], 'run');
        setRunText(runs[1], '(' + pg.subject + ')');
        seatPara = block[off1 + 1];
      }
      fillSeats(seatPara, layout, pg.cells);
      if (delta) block.forEach(function (p) { shiftVpos(p, delta); });
      block.forEach(function (p) { sec.appendChild(p); });
    });

    // 표 id / zOrder 재부여 (문서 전체에서 유일)
    var tbls = descendants(sec, 'tbl'), seen = {};
    tbls.forEach(function (t, i) {
      var id = 1500000000 + (i + 1) * 7919;
      t.setAttribute('id', String(id));
      t.setAttribute('zOrder', String(i + 1));
    });

    var out = new deps.XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
    out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + out;

    // 새 zip: mimetype 먼저 무압축
    var nz = new deps.JSZip();
    var mt = await zip.file('mimetype').async('string');
    nz.file('mimetype', mt, { compression: 'STORE', createFolders: false });
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (n === 'mimetype') continue;
      var opt = { compression: 'DEFLATE', createFolders: false };
      if (n === 'Contents/section0.xml') nz.file(n, out, opt);
      else if (n === 'Preview/PrvText.txt') nz.file(n, previewText(pages, layout, oneMax), opt);
      else if (n === 'Preview/PrvImage.png') nz.file(n, opts.previewPng, opt);
      else if (n === 'settings.xml') {
        var st = await zip.file(n).async('string');
        st = st.replace(/<ha:CaretPosition[^>]*\/>/, '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>');
        nz.file(n, st, opt);
      } else nz.file(n, await zip.file(n).async('uint8array'), opt);
    }
    return nz.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
  }

  var api = { buildHwpx: buildHwpx, previewText: previewText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SeatHwpx = api;
})(typeof window !== 'undefined' ? window : globalThis);
