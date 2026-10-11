/**
 * E2E용 "민감정보 없는" 계약서 PDF (글자가 있는 실제 PDF → 보호 결과 no_sensitive_data).
 * 2026-10부터 민감정보 보호가 끝나지 않은 문서는 자동 분석을 하지 않으므로(fail-closed), 글자 없는 빈 PDF 대신 이것을 올린다.
 * 화면 시나리오는 그대로 파일 이름으로 고른다 (mock AI).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
module.exports = function cleanPdf() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pacto-e2e-clean-')), 'clean.pdf');
  execFileSync('node', ['--experimental-strip-types', '--no-warnings', path.join(ROOT, 'tests/protection/cli.ts'), 'make', 'clean', f], { cwd: ROOT });
  return fs.readFileSync(f);
};
