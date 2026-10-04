import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/v1/auth/register', {
    data: {
      name: 'Test Chef',
      email: `chef-${crypto.randomUUID()}@example.test`,
      password: 'Test-password-42',
      restaurantName: 'Test Restaurant',
    },
  });
  expect(response.status()).toBe(201);
});

test('recipe editing, generation, export and persistence', async ({ page }) => {
  await page.goto('/#studio');
  await page.getByRole('button', { name: /Выбранное блюдо/ }).click();
  await page.getByLabel('Название блюда', { exact: true }).fill('Запечённая тыква');
  await page.getByLabel('Дополнение к названию').fill('с шалфеем');
  await page.getByRole('textbox', { name: /Ингредиенты/ }).fill('Тыква\nШалфей\nОливковое масло');
  await page.getByLabel('Метод приготовления').fill('Запекание при 180 °C в течение 35 минут.');
  await page.getByRole('button', { name: 'Сохранить карту' }).click();
  await page.getByRole('button', { name: 'Сгенерировать для всех каналов' }).click();
  await expect(page.getByRole('heading', { name: 'Запечённая тыква', exact: true })).toBeVisible();
  await expect(page.locator('.marketplace .editorial-text')).toContainText('Запекание при 180 °C');
  const texts = await page.locator('.results-panel .count').allTextContents();
  for (const text of texts) {
    const [length, limit] = text.match(/\d+/g)!.map(Number);
    expect(length).toBeLessThanOrEqual(limit);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Запечённая тыква', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать wolt', exact: true }).click();
  await page
    .getByLabel('Текст для Wolt Delivery')
    .fill('Тыква, запечённая с шалфеем и оливковым маслом.');
  await page.getByRole('button', { name: 'Сохранить редакцию' }).click();
  await expect(page.locator('.wolt-text')).toContainText('Тыква, запечённая с шалфеем');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^mise-.*\.json$/);
});

test('channel limits and brand settings apply to generation', async ({ page }) => {
  await page.goto('/#channels');
  await page.getByRole('button', { name: 'Настроить канал' }).first().click();
  await page.getByLabel('Максимальная длина описания').fill('75');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await page.getByRole('slider', { name: 'Уровень сдержанности' }).fill('25');
  await page.getByRole('button', { name: 'Сохранить профиль ресторана' }).click();
  await expect(page.getByRole('button', { name: 'Сохранить профиль ресторана' })).toBeEnabled();
  await expect(page.getByText('Профиль ресторана сохранён', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Уровень сдержанности' })).toHaveValue('25');
  await expect(page.locator('.channel-card').first()).toContainText('75 симв.');
  await page.getByRole('link', { name: 'Студия генерации', exact: true }).click();
  await page.getByRole('button', { name: 'Сгенерировать для всех каналов' }).click();
  await expect(page.getByRole('button', { name: 'Сгенерировать для всех каналов' })).toBeEnabled();
  const description = await page.locator('.marketplace .editorial-text').innerText();
  expect(description.length - 2).toBeLessThanOrEqual(75);
});

test('recipe library creates, searches and selects a recipe', async ({ page }) => {
  await page.goto('/#library');
  await page.getByRole('button', { name: 'Добавить блюдо' }).click();
  await page.getByLabel('Название блюда', { exact: true }).fill('Сезонный тестовый суп');
  await page.getByRole('textbox', { name: /Ингредиенты/ }).fill('Томаты\nБазилик');
  await page.getByLabel('Метод приготовления').fill('Томление овощей в бульоне.');
  await page.getByRole('combobox').selectOption('Суп');
  await page.getByRole('button', { name: 'Сохранить карту' }).click();
  await page.getByRole('textbox', { name: 'Поиск блюд' }).fill('тестовый');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Открыть в студии' }).click();
  await expect(page.locator('.selected-recipe')).toContainText('Сезонный тестовый суп');
  await page.getByRole('button', { name: 'Сгенерировать для всех каналов' }).click();
  await expect(page.locator('.dish-title')).toContainText('Сезонный тестовый суп');
  await expect(page.locator('.dish-placeholder')).toBeVisible();
});

test('API examples and publication dialog are honest and functional', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#docs');
  await page.getByRole('tab', { name: 'Python', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('import requests');
  await page.getByRole('button', { name: 'Копировать пример API' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('import requests');
  await page.getByRole('link', { name: 'Студия генерации', exact: true }).click();
  await page.getByRole('button', { name: 'Сгенерировать для всех каналов' }).click();
  await expect(page.getByRole('button', { name: 'Сгенерировать для всех каналов' })).toBeEnabled();
  await page.getByRole('button', { name: 'Подготовить к публикации' }).click();
  await expect(page.getByRole('dialog')).toContainText('ещё не подключены');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать пакет' }).click();
  expect((await downloaded).suggestedFilename()).toContain('publication');
  await expect(page.getByText('Редакция сохранена', { exact: true })).toBeVisible();
});

test('all pages render without overflow or browser errors on desktop and mobile', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['studio', 'channels', 'brand', 'docs', 'library', 'profile', 'history']) {
      await page.goto(`/#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${route} at ${width}px`,
      ).toBeTruthy();
      if (width !== 320)
        await page.screenshot({ path: `.cache/${route}-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('link', { name: 'Студия генерации', exact: true }).click();
  await expect(page.locator('.studio-heading')).toBeVisible();
});
