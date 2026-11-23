# 고사 좌석배치표

선택과목 명렬표(CSV·엑셀·붙여넣기)를 불러와 **공통 + 과목별 고사 좌석배치표**를 만들고 **한글(.hwpx)** 로 내보내는 정적 웹앱입니다.
서버가 없고 모든 처리는 브라우저 안에서만 이루어집니다. 학생 정보는 저장·전송하지 않습니다.

- 사용: `index.html`을 열거나 GitHub Pages로 배포 → 명렬표 PDF를 올리거나 「예시로 해 보기」.
- 명세: [`docs/prompt.md`](docs/prompt.md)
- 구성: `src/core.js`(배정 로직) · `src/hwpx.js`(hwpx 생성) · `src/app.js`(화면) · `src/data.js`(자동 생성: 레이아웃·양식·예시)
- `layouts.json`이나 `templates/`를 바꾸면 `node tools/build-data.js`로 `src/data.js`를 다시 만듭니다.
- 검증: `npm i jszip @xmldom/xmldom` 후 `node tests/verify.js` (완료 기준 자동 점검).
- 저장소에는 가상 데이터만 둡니다(`.gitignore` 참고).
