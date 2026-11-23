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

  /* 칸 서식(borderFill) 은행: header.xml 의 기존 서식은 그대로 두고, 필요한 변형(X 표시·배경색)만 뒤에 추가한다. */
  var SHADE_COLOR = '#FFE6D8';
  function FillBank(headerXml) {
    this.xml = headerXml;
    this.base = parseInt((headerXml.match(/<hh:borderFills[^>]*itemCnt="(\d+)"/) || [0, 0])[1], 10);
    this.maxId = 0; var self = this;
    headerXml.replace(/<hh:borderFill id="(\d+)"/g, function (m, id) { self.maxId = Math.max(self.maxId, +id); return m; });
    this.added = []; this.cache = {};
    this.charBase = parseInt((headerXml.match(/<hh:charProperties[^>]*itemCnt="(\d+)"/) || [0, 0])[1], 10);
    this.charMax = 0; headerXml.replace(/<hh:charPr id="(\d+)"/g, function (m, id) { self.charMax = Math.max(self.charMax, +id); return m; });
    this.chars = []; this.charCache = {};
  }
  /* 글자 서식 ref 에서 자간만 바꾼 서식의 id (같으면 ref 그대로). 기존 서식은 두고 새 서식만 뒤에 추가한다. */
  FillBank.prototype.spacing = function (ref, sp) {
    var m = this.xml.match(new RegExp('<hh:charPr id="' + ref + '"[\\s\\S]*?</hh:charPr>'));
    if (!m) return ref;
    var cur = +(m[0].match(/<hh:spacing hangul="(-?\d+)"/) || [0, 0])[1];
    if (cur === sp) return ref;
    var key = ref + '|' + sp;
    if (this.charCache[key]) return this.charCache[key];
    var id = ++this.charMax;
    var c = m[0].replace('id="' + ref + '"', 'id="' + id + '"').replace(/<hh:spacing [^>]*\/>/, '<hh:spacing hangul="' + sp + '" latin="' + sp + '" hanja="' + sp + '" japanese="' + sp + '" other="' + sp + '" symbol="' + sp + '" user="' + sp + '"/>');
    this.chars.push(c); this.charCache[key] = String(id);
    return String(id);
  };
  /* 글자 서식 ref 에서 크기만 비율로 줄인 서식 (칸이 많은 큰 배치도용) */
  FillBank.prototype.sized = function (ref, scale) {
    if (scale >= 0.999) return ref;
    var m = this.xml.match(new RegExp('<hh:charPr id="' + ref + '"[\\s\\S]*?</hh:charPr>'));
    if (!m) return ref;
    var h = +m[0].match(/<hh:charPr [^>]*height="(\d+)"/)[1], nh = Math.max(600, Math.round(h * scale)), key = ref + '#' + nh;
    if (this.charCache[key]) return this.charCache[key];
    var id = ++this.charMax;
    var c = m[0].replace('id="' + ref + '"', 'id="' + id + '"').replace(/(<hh:charPr [^>]*height=")\d+(")/, '$1' + nh + '$2');
    this.chars.push(c); this.charCache[key] = String(id);
    return String(id);
  };
  FillBank.prototype.dirty = function () { return this.added.length > 0 || this.chars.length > 0; };
  FillBank.prototype.find = function (ref) {
    var m = this.xml.match(new RegExp('<hh:borderFill id="' + ref + '"[^>]*>[\\s\\S]*?</hh:borderFill>'));
    return m ? m[0] : null;
  };
  /* ref 서식에서 슬래시(X 표시)와 배경색만 바꾼 서식의 id. 바뀐 게 없으면 ref 그대로. */
  FillBank.prototype.get = function (ref, opt) {
    var src = this.find(ref);
    if (!src) return ref;
    var want = opt.slash === 'CENTER' ? 'CENTER' : 'NONE';
    var cur = (src.match(/<hh:slash type="(\w+)"/) || [0, 'NONE'])[1];
    if (cur === want && !opt.shade) return ref;
    var shadeC = opt.shade ? (typeof opt.shade === 'string' ? opt.shade : SHADE_COLOR) : '';
    var key = ref + '|' + want + '|' + shadeC;
    if (this.cache[key]) return this.cache[key];
    var id = ++this.maxId, s = src.replace('id="' + ref + '"', 'id="' + id + '"');
    s = s.replace(/<hh:slash type="\w+"/, '<hh:slash type="' + want + '"').replace(/<hh:backSlash type="\w+"/, '<hh:backSlash type="' + want + '"');
    if (opt.shade) {
      var brush = '<hc:fillBrush><hc:winBrush faceColor="' + shadeC + '" hatchColor="#999999" alpha="0"/></hc:fillBrush>';
      if (/<hc:fillBrush>[\s\S]*?<\/hc:fillBrush>/.test(s)) s = s.replace(/<hc:fillBrush>[\s\S]*?<\/hc:fillBrush>/, brush);
      else s = s.replace('</hh:borderFill>', brush + '</hh:borderFill>');
    }
    this.added.push(s); this.cache[key] = String(id);
    return String(id);
  };
  FillBank.prototype.finish = function () {
    var out = this.xml;
    if (this.added.length) {
      var last = out.lastIndexOf('</hh:borderFill>') + '</hh:borderFill>'.length;
      out = out.slice(0, last) + this.added.join('') + out.slice(last);
      out = out.replace(/(<hh:borderFills[^>]*itemCnt=")\d+(")/, '$1' + (this.base + this.added.length) + '$2');
    }
    if (this.chars.length) {
      var lc = out.lastIndexOf('</hh:charPr>') + '</hh:charPr>'.length;
      out = out.slice(0, lc) + this.chars.join('') + out.slice(lc);
      out = out.replace(/(<hh:charProperties[^>]*itemCnt=")\d+(")/, '$1' + (this.charBase + this.chars.length) + '$2');
    }
    return out;
  };

  /* 좌석표 채우기·꾸미기.
   * layout.grid 의 칸 종류(seat / void / x)에 맞게 X 표시를 넣고, 좌석 칸에는 번호·이름을 쓴다.
   * cells = [{no,name,picked}|null] (슬롯 순서) */
  /* 양식보다 큰 배치도(행 7~8, 열 6~8): 표를 새로 만든다. 좌석·칸막이 칸은 양식의 칸을 복제하고, 글자는 칸 크기에 맞춰 줄인다. */
  function expandTable(tblPara, layout) {
    var tbl = descendants(tblPara, 'tbl')[0], tcs = descendants(tbl, 'tc');
    function at(c, r) { return tcs.filter(function (tc) { var a = kids(tc, 'cellAddr')[0]; return +a.getAttribute('colAddr') === c && +a.getAttribute('rowAddr') === r; })[0]; }
    var seatP = at(2, 1), gapP = at(1, 1);
    if (!seatP || !gapP) throw new Error('양식에서 좌석 칸을 찾지 못했습니다.');
    var sz = kids(tbl, 'sz')[0], W = +sz.getAttribute('width'), H = +sz.getAttribute('height');
    var R = layout.rowCnt, K = layout.cols, gapW = 700;
    var seatW = Math.floor((W - (K - 1) * gapW) / K), rowH = Math.floor(H / R);
    var trs = kids(tbl, 'tr'), shell = trs[0].cloneNode(false);
    trs.forEach(function (t) { tbl.removeChild(t); });
    for (var r = 0; r < R; r++) {
      var tr = shell.cloneNode(false);
      for (var c = 0; c < layout.colCnt; c++) {
        var tc = (c % 2 ? gapP : seatP).cloneNode(true), w = c % 2 ? gapW : seatW;
        var a = kids(tc, 'cellAddr')[0]; a.setAttribute('colAddr', String(c)); a.setAttribute('rowAddr', String(r));
        var cs = kids(tc, 'cellSz')[0]; cs.setAttribute('width', String(w)); cs.setAttribute('height', String(rowH));
        descendants(tc, 'lineseg').forEach(function (ls) { ls.setAttribute('horzsize', String(Math.max(100, w - 282))); });
        tr.appendChild(tc);
      }
      tbl.appendChild(tr);
    }
    tbl.setAttribute('rowCnt', String(R)); tbl.setAttribute('colCnt', String(layout.colCnt));
    sz.setAttribute('width', String(seatW * K + gapW * (K - 1))); sz.setAttribute('height', String(rowH * R));
    return Math.min(1, seatW / 9800, rowH / 8016);
  }
  function fillSeats(tblPara, layout, cells, bank) {
    var scale = layout.expand ? expandTable(tblPara, layout) : 1;
    var tbl = descendants(tblPara, 'tbl')[0];
    var tcs = descendants(tbl, 'tc');
    var slotAt = {}, proto = null;
    layout.slotOrder.forEach(function (s, i) { slotAt[s.col + ',' + s.row] = i; });
    tcs.forEach(function (tc) {
      var ps = kids(kids(tc, 'subList')[0], 'p');
      if (!proto && ps.length === 2) proto = kids(tc, 'subList')[0];   // 좌석 칸의 문단 구조(번호·이름)
    });
    if (!proto) throw new Error('양식에서 좌석 칸을 찾지 못했습니다.');
    tcs.forEach(function (tc) {
      var a = kids(tc, 'cellAddr')[0], col = +a.getAttribute('colAddr'), row = +a.getAttribute('rowAddr');
      if (col % 2 !== 0) return;                       // 칸막이 열은 그대로
      var type = (layout.grid[row] || [])[col];
      if (!type || type === 'gap') return;
      var key = col + ',' + row, i = slotAt[key], c = i == null ? null : cells[i];
      if (type === 'seat') {
        var sub = kids(tc, 'subList')[0], ps = kids(sub, 'p');
        if (ps.length !== 2) { var nsub = proto.cloneNode(true); tc.replaceChild(nsub, sub); sub = nsub; ps = kids(sub, 'p'); }
        setText(ps[0], c ? String(c.no) : '');
        setText(ps[1], c ? c.name : '');
        if (scale < 1) ps.forEach(function (pp) { kids(pp, 'run').forEach(function (rn) { rn.setAttribute('charPrIDRef', bank.sized(rn.getAttribute('charPrIDRef'), scale)); }); });
      }
      var ref = tc.getAttribute('borderFillIDRef');
      var nref = bank.get(ref, { slash: type === 'x' ? 'CENTER' : 'NONE', shade: type === 'seat' && c && c.picked ? (c.color || true) : false });
      if (nref !== ref) tc.setAttribute('borderFillIDRef', nref);
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
    var tInfo = opts.titleInfo || function (subj) { return { twoLine: subj.length > oneMax, spacing: -25 }; };
    var zip = await deps.JSZip.loadAsync(templateBytes);
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
    var xml = await zip.file('Contents/section0.xml').async('string');
    var doc = new deps.DOMParser().parseFromString(xml, 'application/xml');
    var sec = doc.documentElement;
    var paras = kids(sec, 'p');
    var B = splitBlocks(paras);
    var bank = new FillBank(await zip.file('Contents/header.xml').async('string'));

    while (sec.firstChild) sec.removeChild(sec.firstChild);
    sec.appendChild(B.head);

    function applySpacing(para, sp, runIdx) {     // 과목명 글자(run)의 자간을 정한 값으로
      var r = kids(para, 'run')[runIdx || 0];
      if (r && sp != null) r.setAttribute('charPrIDRef', bank.spacing(r.getAttribute('charPrIDRef'), sp));
    }
    pages.forEach(function (pg, pi) {
      var ti = tInfo(pg.subject, oneMax), twoLine = ti.twoLine;
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
        applySpacing(titleParas[1], ti.spacing);
        seatPara = block[off + 2];
      } else {
        var off1 = first ? 0 : 1;
        var runs = kids(block[off1], 'run');
        setRunText(runs[1], '(' + pg.subject + ')');
        applySpacing(block[off1], ti.spacing, 1);
        seatPara = block[off1 + 1];
      }
      fillSeats(seatPara, layout, pg.cells, bank);
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
      else if (n === 'Contents/header.xml' && bank.dirty()) nz.file(n, bank.finish(), opt);
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
