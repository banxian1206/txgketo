/**
 * E2E 护栏基础库（Phase 1.0 护栏入库）
 * - 固定 channel:'chrome'（系统 Chrome）：不依赖会被系统清理的 playwright 缓存（§9.6 教训）
 * - 断言统一 PASS/FAIL/SKIP 收集，run.mjs 汇总出 exit code
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5207';
export const API = process.env.E2E_API || 'http://127.0.0.1:8208';
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const FILES = path.join(ROOT, 'files');
export const SHOTS = path.join(ROOT, 'shots');

// ── 断言收集 ──────────────────────────────────────────────
export const results = [];
export function check(id, ok, note = '', status = null) {
  // status: null=按 ok 判 PASS/FAIL；'SKIP' 强制跳过
  const st = status || (ok ? 'PASS' : 'FAIL');
  results.push({ id, st, note });
  const icon = st === 'PASS' ? '✅' : st === 'SKIP' ? '⏭️' : '❌';
  console.log(`  ${icon} ${id} ${note}`);
}
export function summary(title) {
  const p = results.filter(r => r.st === 'PASS').length;
  const f = results.filter(r => r.st === 'FAIL').length;
  const s = results.filter(r => r.st === 'SKIP').length;
  console.log(`\n══ ${title} ══ PASS ${p} · FAIL ${f} · SKIP ${s}`);
  for (const r of results.filter(r => r.st === 'FAIL')) console.log(`  ❌ ${r.id} ${r.note}`);
  return f;
}
export function exitWith(fails) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'last-results.json'), JSON.stringify(results, null, 2));
  process.exit(fails > 0 ? 1 : 0);
}

// ── 浏览器 ────────────────────────────────────────────────
export async function newCtx({ mobile = false } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errs.push(`http${r.status()}: ${r.url().replace(BASE, '')}`);
  });
  return { browser, ctx, page, errs, resetErrs: () => { errs.length = 0; } };
}

export async function login(page, username, password) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input#username, input[placeholder="admin"]', username);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL(u => !String(u).includes('/login'), { timeout: 15000 });
}

export const body = page => page.evaluate(() => document.body.innerText);
export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p }).catch(() => {});
  return p;
}

// ── API 小工具（回归里少量只读断言走 API，更快）─────────────
export async function apiLogin(username, password) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  return d.access_token;
}
export const apiGet = (url, token) => fetch(url.startsWith('http') ? url : `${API}/api/v1${url}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
