import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';

export const FIXTURE = resolve('tests/fixtures/fixture.png');
export const PROJECTS = resolve('.e2e-projects');

export async function freshEditor(page: Page, name: string) {
  await page.goto('/');
  await page.waitForSelector('[data-testid=stage]');
  const input = page.getByTestId('project-name');
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue(name);
  await page.waitForFunction((n) => (window as any).__editor.getProject().name === n, name);
}

export const getProject = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__editor.getProject())));

export async function setNum(page: Page, testId: string, value: number | string) {
  const f = page.getByTestId(testId);
  await f.fill(String(value));
  await f.press('Enter');
}
export const setTimeTo = (page: Page, t: number) => setNum(page, 'time-input', t);
