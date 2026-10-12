/** 등록 확인 화면에서 사용자가 추천 역할("추천" 표시)을 눌러 확인하고 미리보기를 적용 — 추천만으로는 합계에 넣지 않으므로 */
module.exports = async function confirmRecommendedRole(page) {
  const opt = page.locator('[data-testid^="role-option-"]', { hasText: '추천' }).first();
  if ((await opt.count()) === 0) return false;
  await opt.click();
  const apply = page.locator('[data-testid="role-apply"]');
  await apply.waitFor({ timeout: 3000 }).catch(() => undefined);
  if (await apply.count()) await apply.click();
  await page.waitForTimeout(300);
  return true;
};
