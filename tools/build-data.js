// layouts.json 과 templates/*.hwpx 를 src/data.js 로 묶는다. (file:// 로 열어도 동작하도록)
// 사용: node tools/build-data.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const layouts = JSON.parse(fs.readFileSync(path.join(root, 'layouts.json'), 'utf8'));
const tpl = {};
['A', 'B'].forEach(v => {
  tpl[v] = fs.readFileSync(path.join(root, 'templates', `seat-template-${v}.hwpx`)).toString('base64');
});
const example = fs.readFileSync(path.join(root, 'examples', 'example-roster.csv'), 'utf8');
const out = '/* 자동 생성 파일 — tools/build-data.js 로 만든다. 직접 고치지 말 것. */\n' +
  'window.SEAT_DATA = ' + JSON.stringify({ layouts, templates: tpl, example }) + ';\n';
fs.writeFileSync(path.join(root, 'src', 'data.js'), out);
console.log('src/data.js', out.length, 'bytes');
