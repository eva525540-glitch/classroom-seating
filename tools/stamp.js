// index.html 의 스크립트 주소에 버전표(?v=...)를 새로 붙인다. 코드를 고친 뒤 푸시 전에 실행:  node tools/stamp.js
// (브라우저가 오래된 화면 파일과 새 코드를 섞어 쓰다 생기는 오류를 막는다)
const fs = require('fs'), path = require('path');
const p = path.join(__dirname, '..', 'index.html');
const v = Date.now().toString(36);
const t = fs.readFileSync(p, 'utf8').replace(/<script src="src\/(\w+)\.js(\?v=\w+)?"><\/script>/g, (m, n) => `<script src="src/${n}.js?v=${v}"></script>`);
fs.writeFileSync(p, t);
console.log('버전표', v);
