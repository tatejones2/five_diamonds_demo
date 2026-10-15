import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, expectNoHorizontalScroll } from './helpers';

test.describe('public visitor @phone', () => {
  test('finds this weekend and reads game cards, bracket and standings without login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'This Weekend' }).click();
    await expect(page).toHaveURL(/game-day/);
    await page.getByRole('link', { name: 'Schedule' }).first().click();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(cards.getByText('DEMO Riverside Park · Field 1').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);

    await page.getByRole('link', { name: 'Brackets' }).click();
    await expect(page.getByRole('heading', { name: '10U Championship Bracket' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);

    await page.getByRole('link', { name: 'Standings' }).click();
    await expect(page.getByText('Unofficial').first()).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole('link', { name: 'Updates' }).click();
    await expect(page.getByText('DEMO: Lightning watch this afternoon').first()).toBeVisible();
  });

  test('draft tournaments are not reachable by slug', async ({ page }) => {
    await page.goto('/tournaments/demo-winter-showcase');
    await expect(page.getByText('Not found')).toBeVisible();
  });

  test('tournament search filters by age group', async ({ page }) => {
    await page.goto('/tournaments');
    await expect(page.getByRole('link', { name: 'DEMO Spring Opener' })).toBeVisible();
    await page.getByLabel('Age group').selectOption('12U');
    await expect(page.getByRole('link', { name: 'DEMO Fall Classic' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'DEMO Spring Opener' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
