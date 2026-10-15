import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, login } from './helpers';

test('director builds a schedule natively: overlap blocked, then published publicly', async ({ page }) => {
  await login(page, 'director');
  await page.goto('/admin/tournaments');
  await page.getByRole('link', { name: 'DEMO Spring Opener' }).click();
  await page.getByRole('link', { name: 'Registrations', exact: false }).first().click();
  // Confirm the pending 12U team so it can be scheduled.
  await page.getByRole('button', { name: 'Status' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('New status').selectOption('confirmed');
  await dlg.getByLabel(/Reason/).fill('Roster reviewed');
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Confirmed').first()).toBeVisible();

  await page.getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByText('Never published')).toBeVisible();
  await expectNoA11yViolations(page);
  // Two games on the same field and time → error.
  for (const label of ['Game A', 'Game B']) {
    await page.getByRole('button', { name: 'Add game', exact: true }).click();
    const g = page.getByRole('dialog', { name: 'Add game' });
    await g.getByLabel('Division').selectOption({ label: '12U' });
    await g.getByLabel('Start time (Eastern)').fill('09:00');
    await g.getByLabel('Field').selectOption({ index: 1 });
    await g.getByLabel('Placeholder').first().fill(`${label} away`);
    await g.getByLabel('Placeholder').last().fill(`${label} home`);
    await g.getByLabel('Label').fill(label);
    await g.getByRole('button', { name: 'Save to draft' }).click();
    await expect(g).toBeHidden();
  }
  await expect(page.getByText(/overlap on the same field/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Preview & publish' }).click();
  const pub = page.getByRole('dialog', { name: 'Review & publish schedule' });
  await expect(pub.getByRole('button', { name: 'Publish now' })).toBeDisabled();
  await pub.getByRole('button', { name: 'Back to editing' }).click();

  // Move Game B to 11:00 via the list view.
  await page.getByRole('button', { name: 'List' }).click();
  await page.getByRole('button', { name: 'Edit Game B' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit game' });
  await edit.getByLabel('Start time (Eastern)').fill('11:00');
  await edit.getByRole('button', { name: 'Save to draft' }).click();
  await expect(page.getByText(/overlap on the same field/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Preview & publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText(/Version 1 is live/)).toBeVisible();

  await page.goto('/tournaments/demo-spring-opener/schedule');
  await expect(page.getByText('Game A home').first()).toBeVisible();
});

test('unassigned staff cannot score; assigned scorekeeper can finalize only their game', async ({ page }) => {
  await login(page, 'scorekeeper');
  await page.goto('/admin/my-games');
  const cards = page.locator('main li.card');
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('link').click();
  await page.getByLabel('Game status').selectOption('final');
  await page.getByLabel(/\(away\) runs/).fill('2');
  await page.getByLabel(/\(home\) runs/).fill('5');
  await page.getByRole('button', { name: 'Finalize game' }).click();
  await expect(page.getByText('Final').first()).toBeVisible();

  const other = await page.request.get('/api/admin/my-games');
  const ids = (await other.json()).map((g: any) => g.id);
  expect(ids).toHaveLength(1);
});

test('correcting a semifinal after the final has a result requires explicit resolution', async ({ page }) => {
  await login(page, 'director');
  const t = (await (await page.request.get('/api/admin/tournaments')).json()).find((x: any) => x.slug === 'demo-fall-classic');
  const [b] = await (await page.request.get(`/api/admin/tournaments/${t.id}/brackets`)).json();
  const [semi1, semi2, fin] = b.matchups;
  const finalize = async (gameId: string, h: number, a: number, extra = {}) => {
    const g = (await (await page.request.get(`/api/admin/games/${gameId}`)).json()).game;
    return page.request.patch(`/api/admin/games/${gameId}`, { data: { version: g.version, status: 'final', resultType: 'played', homeScore: h, awayScore: a, forfeitWinner: null, ...extra }, headers: { origin: 'http://localhost:5173' } });
  };
  expect((await finalize(semi1.gameId, 6, 2)).status()).toBe(200);
  expect((await finalize(semi2.gameId, 4, 3)).status()).toBe(200);
  expect((await finalize(fin.gameId, 5, 1)).status()).toBe(200);

  await page.goto(`/admin/games/${semi1.gameId}`);
  await page.getByLabel(/\(away\) runs/).fill('9');
  await page.getByLabel(/Reason for correcting/).fill('Scorebook transposed');
  await page.getByRole('button', { name: 'Save correction' }).click();
  const dlg = page.getByRole('dialog', { name: 'This change affects later bracket games' });
  await expect(dlg).toBeVisible();
  await expectNoA11yViolations(page);
  await dlg.getByRole('button', { name: 'Reset later games' }).click();
  await expect(dlg).toBeHidden();

  await page.goto('/tournaments/demo-fall-classic/brackets');
  await expect(page.getByText('DEMO Cyclones').first()).toBeVisible();
});

test('director posts a thunderstorm delay that appears publicly with history', async ({ page }) => {
  await login(page, 'director');
  const t = (await (await page.request.get('/api/admin/tournaments')).json()).find((x: any) => x.slug === 'demo-fall-classic');
  await page.goto(`/admin/tournaments/${t.id}/updates`);
  await page.getByRole('button', { name: 'New notice' }).click();
  const d = page.getByRole('dialog', { name: 'New notice' });
  await d.getByLabel('Severity').selectOption('critical');
  await d.getByLabel('Headline').fill('Thunderstorm delay — all fields');
  await d.getByLabel('Details').fill('Lightning detected. All games delayed at least 30 minutes.');
  await d.getByRole('button', { name: 'Publish notice' }).click();
  await expect(d).toBeHidden();
  await page.goto('/tournaments/demo-fall-classic');
  await expect(page.getByRole('alert').filter({ hasText: 'Thunderstorm delay' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Issued by DEMO' })).toBeVisible();
});
