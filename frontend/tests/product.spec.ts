import { expect, test } from '@playwright/test';

test('landing, registration, preferences, keys, logout and login work end to end', async ({
  page,
}) => {
  const email = `browser-${crypto.randomUUID()}@example.test`;
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('есть история');
  await page.getByRole('button', { name: 'ҚАЗ', exact: true }).click();
  await expect(page.locator('.hero-description-card')).toContainText('Бұқтырылған');
  await page.getByRole('link', { name: 'Создать первое описание' }).click();
  await page.getByLabel('Ваше имя').fill('Айдана');
  await page.getByLabel('Название ресторана').fill('Дәм');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-42');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Студия генерации');
  await page.getByRole('button', { name: 'Профиль ресторана', exact: true }).click();
  await page.getByLabel('Кухня', { exact: true }).fill('Казахская');
  await page.getByLabel('Язык по умолчанию').selectOption('kk');
  await page
    .locator('.tag-picker')
    .first()
    .getByRole('button', { name: 'Грибы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Сохранить предпочтения' }).click();
  await expect(page.getByRole('status')).toContainText('Профиль и предпочтения сохранены');
  await expect(page.locator('.recommendation-item').first()).toContainText('Ризотто');
  await page.reload();
  await expect(page.getByLabel('Кухня', { exact: true })).toHaveValue('Казахская');
  await expect(page.getByLabel('Язык по умолчанию')).toHaveValue('kk');
  await page.getByRole('link', { name: /MENUMIND L’ATELIER/ }).click();
  await page.getByRole('link', { name: 'Моя студия', exact: true }).click();
  await expect(page.getByLabel('Язык описания', { exact: true })).toHaveValue('kk');
  await page.getByRole('button', { name: 'Профиль ресторана', exact: true }).click();
  await page.getByLabel('Название API-ключа').fill('Тестовая интеграция');
  await page.getByRole('button', { name: 'Создать ключ', exact: true }).click();
  await expect(page.locator('.new-key code')).toContainText('mm_');
  await page.getByRole('button', { name: 'Я сохранил ключ' }).click();
  await expect(page.locator('.new-key')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отозвать ключ Тестовая интеграция' }).click();
  await expect(page.getByText('Ключ отозван', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('есть история');
  await page.getByRole('link', { name: 'Войти', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-42');
  await page.getByRole('button', { name: 'Войти в студию' }).click();
  await expect(page.getByLabel('Язык описания', { exact: true })).toHaveValue('kk');
});

test('name-only generation, regeneration, history and failed saves', async ({ page }) => {
  await page.request.post('/api/v1/auth/register', {
    data: {
      name: 'Chef',
      email: `${crypto.randomUUID()}@example.test`,
      password: 'Test-password-42',
      restaurantName: 'Studio',
    },
  });
  await page.goto('/#library');
  await page.getByRole('button', { name: 'Добавить блюдо' }).click();
  await page.getByLabel('Название блюда', { exact: true }).fill('Сорпа');
  await page.getByRole('button', { name: 'Сохранить карту' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: 'Сорпа', exact: true }) })
    .getByRole('button', { name: 'Открыть в студии' })
    .click();
  await page.getByLabel('Язык описания').selectOption('kk');
  const generate = page.getByRole('button', { name: 'Сгенерировать для всех каналов' });
  await generate.click();
  await expect(generate).toBeEnabled();
  const first = await page.locator('.marketplace .editorial-text').innerText();
  expect(first).toContain('Сорпа');
  await generate.click();
  await expect(generate).toBeEnabled();
  await expect(page.locator('.marketplace .editorial-text')).not.toHaveText(first);
  await page.getByRole('link', { name: 'История', exact: true }).click();
  await expect(page.locator('.history-grid article')).toHaveCount(2);
  await page.getByRole('button', { name: 'Открыть редакцию' }).first().click();
  await page.getByRole('button', { name: /Выбранное блюдо/ }).click();
  await page.route('**/api/v1/recipes/*', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: { message: 'Тестовая ошибка сохранения' } } })
      : route.continue(),
  );
  await page.getByLabel('Название блюда', { exact: true }).fill('Несохранённое название');
  await page.getByRole('button', { name: 'Сохранить карту' }).click();
  await expect(page.getByRole('alert')).toHaveText('Тестовая ошибка сохранения');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.selected-recipe')).toContainText('Сорпа');
});

test('public pages fit mobile and desktop without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['', '#register', '#login', '#docs']) {
      await page.goto(`/${route}`);
      await expect(page.locator('main')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${route} at ${width}`,
      ).toBeTruthy();
      if (!route) await page.screenshot({ path: `.cache/landing-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});
