import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outputRoot = path.resolve(process.cwd(), 'qa-screenshots');
const requestedScreens = new Set(
  (process.env.QA_SCREENS ?? 'login,planTop,planMid,kanban,mobileCollapsed')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

test.describe('Visual QA', () => {
  test('captures login and planner shell states', async ({ page }, testInfo) => {
    const projectDir = path.join(outputRoot, testInfo.project.name);
    fs.mkdirSync(projectDir, { recursive: true });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    if (requestedScreens.has('login')) {
      await page.screenshot({
        path: path.join(projectDir, '01-login-or-app.png'),
        fullPage: true,
      });
    }

    const hasAuthForm = await page.getByRole('button', { name: /sign in|create account/i }).count();
    if (hasAuthForm > 0) {
      const email = process.env.QA_EMAIL;
      const password = process.env.QA_PASSWORD;
      if (!email || !password) {
        testInfo.annotations.push({
          type: 'warning',
          description: 'Set QA_EMAIL and QA_PASSWORD to capture authenticated planner screens.',
        });
        return;
      }

      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
    }

    if (requestedScreens.has('planTop')) {
      await page.screenshot({
        path: path.join(projectDir, '02-planner-top.png'),
        fullPage: true,
      });
    }

    const timeline = page.locator('.timeline-area');
    if (requestedScreens.has('planMid') && (await timeline.count()) > 0) {
      await timeline.first().evaluate((el) => {
        el.scrollTo({ top: 800, left: 0, behavior: 'instant' as ScrollBehavior });
      });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(projectDir, '03-planner-mid-scroll.png'),
        fullPage: true,
      });
    }

    if (requestedScreens.has('kanban')) {
      const kanbanToggle = page.getByRole('tab', { name: /kanban/i });
      if ((await kanbanToggle.count()) > 0) {
        await kanbanToggle.first().click();
        await page.waitForTimeout(700);
        await page.screenshot({
          path: path.join(projectDir, '04-kanban.png'),
          fullPage: true,
        });
      }
    }

    if (requestedScreens.has('mobileCollapsed')) {
      const isMobileProject = /iphone|pixel|ipad/i.test(testInfo.project.name);
      if (isMobileProject) {
        await page.evaluate(() => window.scrollTo({ top: 380, behavior: 'instant' }));
        await page.waitForTimeout(650);
        await page.screenshot({
          path: path.join(projectDir, '05-mobile-collapsed-header.png'),
          fullPage: true,
        });
      }
    }
  });
});
