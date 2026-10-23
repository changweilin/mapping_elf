export async function openTool(page, sel) {
  const overlay = page.locator('#radial-menu-overlay');
  let isOpen = await overlay.evaluate((el) => el.classList.contains('open')).catch(() => false);
  if (!isOpen) {
    await page.locator('#btn-features-menu').click();
    isOpen = await overlay.evaluate((el) => el.classList.contains('open')).catch(() => false);
    if (!isOpen) {
      await page.locator('#btn-features-menu').click();
    }
  }
  await page.locator(sel).click();
}
