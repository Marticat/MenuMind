import { expect, test } from '@playwright/test';
test('local provider is visible, neutral and honest about shared texts and one personalization arm', async ({
  page,
}) => {
  const reg = await page.request.post('/api/v1/auth/register', {
    data: {
      name: 'Chef',
      email: `${crypto.randomUUID()}@example.test`,
      password: 'Test-password-42',
      restaurantName: 'Local',
    },
  });
  const csrf = (await reg.json()).csrfToken;
  // Select a compact recipe by persisting a first result before loading the workspace.
  await page.request.post('/api/v1/generations', {
    headers: { 'X-CSRF-Token': csrf },
    data: { recipeId: 'DEMO-9101', tone: 'editorial', language: 'ru' },
  });
  await page.goto('/#studio');
  await expect(page.getByText('ЛОКАЛЬНАЯ LoRA', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByText('Один текст для четырёх каналов', { exact: true })).toBeVisible();
  await expect(page.locator('.variant-card')).toHaveCount(0);
  await expect(page.locator('.marketplace .editorial-text')).toContainText('Индейка с булгуром');
  await page.getByRole('button', { name: /Получить описание LoRA/ }).click();
  await expect(page.getByText(/LoRA даёт одинаковый ответ/)).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать wolt', exact: true }).click();
  await page.getByRole('dialog').locator('textarea').fill('Индейка с булгуром — ручная редакция.');
  await page.getByRole('button', { name: 'Сохранить редакцию' }).click();
  await expect(
    page.getByText('Ручная редакция · проверьте перед публикацией', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Один проверенный ответ модели/)).toHaveCount(0);
  await page.goto('/#personalization');
  await expect(page.getByText(/Локальная LoRA даёт один нейтральный вариант/)).toBeVisible();
  await page.getByLabel('Имя гостя').fill('Гость');
  await page.getByRole('button', { name: 'Сохранить гостя', exact: true }).click();
  await page.getByLabel('Блюдо для персонализации').selectOption('DEMO-9101');
  await page.getByRole('button', { name: 'Получить описание', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Персональное описание' })).toContainText(
    'Нейтральное описание · LoRA',
  );
  await expect(page.locator('summary').filter({ hasText: 'Все варианты (1)' })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: `.cache/local-lora-${width}.png`, fullPage: true });
  }
});
