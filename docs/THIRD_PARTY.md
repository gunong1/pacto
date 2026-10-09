# 서버에 묶어 넣은(vendor) 외부 라이브러리

Supabase Edge Function은 배포할 때 import한 파일만 올라가고, 이 프로젝트는 외부 네트워크 없이 같은 코드로 배포·로컬 실행하기 위해
일부 라이브러리를 버전을 고정해 `supabase/functions/_shared/vendor/`에 번들로 넣는다. 번들은 생성물이라 직접 고치지 않는다.

| 번들 | 라이브러리 · 버전 | 원본 저장소 | 라이선스 | 왜 vendor인가 | 다시 만들기 |
|---|---|---|---|---|---|
| `imagecodec.js` | jpeg-js 0.4.4 | https://github.com/jpeg-js/jpeg-js | BSD-3-Clause | 사진 보호본 JPEG 저장 (순수 JS). Edge에는 sharp·canvas 같은 네이티브 모듈이 없다 | `node scripts/vendor-image.mjs` |
| `imagecodec.js` | fast-png 6.2.0 (+ iobuffer, pako) | https://github.com/image-js/fast-png | MIT (pako: MIT·Zlib) | PNG 사진 해석 (순수 JS) · pako `inflate`는 스캔 PDF의 Flate 이미지 해석에도 사용 (추가 라이브러리 아님) | 〃 |
| `imagecodec.js` | @jsquash/jpeg 1.6.0 — mozjpeg 해석기 WASM | https://github.com/jamsinclair/jSquash (mozjpeg: https://github.com/mozilla/mozjpeg) | Apache-2.0 (mozjpeg: IJG · BSD-3-Clause · zlib) | JPEG 해석을 순수 JS(2400×3400 한 장 0.6~1.1초)보다 약 5배 빠르게 — Edge CPU 한도 안에 들기 위해. WASM은 모듈 안에 base64로 포함 | 〃 |
| `pdf-lib.js` | pdf-lib 1.17.1 (+ @pdf-lib/standard-fonts) | https://github.com/Hopding/pdf-lib | MIT | PDF 민감정보 제거·보호본 생성 | `node scripts/vendor-pdf.mjs` |
| `unpdf.js` | unpdf 1.8.1 (내부 pdf.js) | https://github.com/unjs/unpdf | MIT (pdf.js: Apache-2.0) | 보호본 검증용 독립 텍스트 추출 | 〃 |
| `korean-cmaps.js` | pdfjs-dist 6.1.200 cmaps (한글만) | https://github.com/mozilla/pdf.js | BSD-3-Clause (Adobe) | 한글 CMap 글꼴 해석 | 〃 |
| `pacto-domain.js` | 앱 자체 코드 (src/domain 등) | — | — | 앱·서버 알림 계산을 같은 코드로 | `node scripts/vendor-domain.mjs` |

- 버전은 `package.json` devDependencies에 고정(`--save-exact`)하고, 번들 첫 줄에 버전을 적는다.
- 각 번들 끝에는 라이브러리의 법적 고지(legal comments)가 함께 들어간다.
- 사용하지 않기로 한 것: MuPDF(AGPL), ImageScript(AGPL/MIT 이중 — npm 배포본이 Node 전용 구조라 Edge에 그대로 쓰기 어려움).

## 앱에 포함한 외부 라이브러리 — 계약서 뷰어 (개정 21)

| 위치 | 라이브러리 · 버전 | 원본 저장소 | 라이선스 | 용도 | 다시 만들기 |
|---|---|---|---|---|---|
| `package.json` dependencies | react-native-webview 13.16.1 (Expo SDK 57 지원 버전) | https://github.com/react-native-webview/react-native-webview | MIT | 앱 안 계약서 뷰어 화면 | `npm ci` |
| `src/features/viewer/viewerScript.generated.js` | pdfjs-dist 5.4.624 legacy 빌드 (화면 그리기 + worker) | https://github.com/mozilla/pdf.js | Apache-2.0 | PDF를 화면 폭에 맞춰 그림 (CDN 사용 안 함, 앱에 포함) | `node scripts/vendor-viewer.mjs` |
| 〃 | openjpeg wasm (pdfjs-dist 5.4.624에 포함) | https://github.com/uclouvain/openjpeg | BSD-2-Clause | JPEG2000 스캔 이미지 표시 | 〃 |
| 〃 | jbig2 wasm (PDFium, pdfjs-dist 5.4.624에 포함) | https://pdfium.googlesource.com/pdfium | BSD-3-Clause | 흑백 스캔(JBIG2) 이미지 표시 | 〃 |
| 〃 | 한글 CMap (서버와 같은 `korean-cmaps.js`) | https://github.com/mozilla/pdf.js | BSD-3-Clause (Adobe) | 한글 CMap 글꼴 표시 | 〃 |

- 라이선스 원문: `third_party/viewer/` (pdfjs-dist LICENSE, openjpeg·jbig2 LICENSE). 번들 끝에 법적 고지 주석 포함.
- pdfjs-dist는 npm에서 고정 버전을 내려받아 묶기만 한다(의존성에 넣지 않음). 앱 크기 약 2.1MB 증가.
