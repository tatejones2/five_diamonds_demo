import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expectNoA11yViolations, expectNoHorizontalScroll, login } from './helpers';

test('coach signs up, verifies, builds a roster with import preview, and registers @phone', async ({ page, request }) => {
  const email = `e2e.coach.${Date.now()}@test.invalid`;
  await page.goto('/auth/sign-up');
  await page.getByLabel('Full name').fill('E2E Coach');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-test-password');
  await page.getByLabel(/18 or older/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const box = await (await request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`)).json();
  const link = /https?:\/\/\S+/.exec(box.find((m: any) => m.template === 'verify_email').text)![0];
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();

  await page.getByRole('link', { name: 'Add a team' }).click();
  await page.getByLabel('Team name').fill('E2E Hurricanes');
  await page.getByLabel('Age group').fill('10U');
  await page.getByRole('button', { name: /Create team/ }).click();
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Manual entry
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByLabel('Jersey number, row 1').fill('00');
  await page.getByLabel('Player name, row 1').fill('Alpha Tester');
  await page.getByRole('button', { name: 'Save roster' }).click();
  await expect(page.getByText('Roster saved (1 players).')).toBeVisible();

  // CSV import with a duplicate jersey and a malformed row: preview flags them; nothing saved yet.
  const file = path.join(os.tmpdir(), `roster-${Date.now()}.csv`);
  fs.writeFileSync(file, 'Player Name,Jersey Number\nBravo Tester,7\nCharlie Tester,7\nDelta Tester,abc\n');
  await page.locator('input[type=file]').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: 'Import preview' });
  await expect(dialog.getByText('3 need fixing')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to roster' }).click();
  await expect(page.getByRole('button', { name: 'Save roster' })).toBeDisabled();
  await expect(page.getByText(/Jersey #7 is used more than once/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Player name, row 1')).toHaveValue('Alpha Tester');
  await expect(page.getByLabel('Player name, row 2')).toHaveCount(0);
  await expectNoA11yViolations(page);

  // Register in the open DEMO event
  await page.goto('/tournaments/demo-spring-opener');
  await page.getByRole('link', { name: 'Register a Team' }).click();
  await page.getByRole('combobox', { name: /^Team/ }).selectOption({ label: 'E2E Hurricanes (10U)' });
  await page.getByRole('radio', { name: /^10U/ }).check();
  await page.getByLabel(/I have read the event/).check();
  await page.getByRole('button', { name: 'Submit registration' }).click();
  await expect(page.getByRole('heading', { name: 'Spot held for review' })).toBeVisible();
  await expect(page.getByText(/^5D-[A-Z0-9]{6}$/)).toBeVisible();
});

test('a manager cannot open another manager\'s team', async ({ page, request }) => {
  await login(page, 'coach1');
  const teams = await (await page.request.get('/api/me/teams')).json();
  const coach1Team = teams[0].id;
  await page.getByRole('button', { name: /Sign out|Account/ }).first().isVisible().catch(() => {});
  await page.context().clearCookies();
  await login(page, 'coach2');
  await page.goto(`/dashboard/teams/${coach1Team}`);
  await expect(page.getByText('Not found')).toBeVisible();
  const api = await page.request.get(`/api/me/teams/${coach1Team}/roster`);
  expect(api.status()).toBe(404);
  void request;
});
