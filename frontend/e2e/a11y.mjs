/**
 * 无障碍（a11y）探针 —— axe-core 挂真实浏览器，逐路由跑 WCAG 2.1 A/AA
 *
 * 试跑定位（2026-10-06）：先出**报告**，不做硬门禁。
 *
 * ⚠️ 依赖：axe 是试跑时 `npm install --no-save axe-core @axe-core/playwright` 装的，
 *    **未进 package.json**（AGENTS §3：新增依赖要先走决策）。换机器跑前先装这两个。
 *    正式护栏**不依赖 axe** —— 那 5 条 A11Y/VIS 都在 `e2e/static.mjs` 里。
 *   node e2e/a11y.mjs                 全量（PC 25 路由 + 移动 9 路由）
 *   node e2e/a11y.mjs --role buyer1   只跑一个角色
 *   node e2e/a11y.mjs --gate          有 critical/serious 违规则 exit 1（接入 run.mjs 时再用）
 *   node e2e/a11y.mjs --top 15        报告里每档显示多少条
 *
 * 报告落 e2e/shots/a11y-report.json（按 rule 聚合：命中路由 / 节点数 / 示例）。
 * 路由→角色映射与 ui.mjs 的 PC_ROLE_ROUTES/M_ROLE_ROUTES 一致：不得用 admin（铁律 11）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { newCtx, login, SHOTS } from './lib.mjs';

const args = process.argv.slice(2);
const argVal = (k, d = null) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ONLY_ROLE = argVal('--role');
const GATE = args.includes('--gate');
const TOP = Number(argVal('--top', '12'));

// ── 路由 → 责任角色（照抄 ui.mjs，避免 403 误报；一个角色只走它有权看的页）──
const PC_ROLE_ROUTES = [
  ['pm1', ['/workbench', '/workbench/pm', '/projects', '/projects/new', '/my-tasks', '/reviews',
    '/changes', '/manufacturing', '/assembly', '/shipping', '/site', '/acceptance']],
  ['buyer1', ['/purchase', '/suppliers', '/library', '/warehouse']],
  ['sales1', ['/workbench/sales']],
  ['shop1', ['/workbench/shop']],
  ['eng_director', ['/workbench/eng', '/numbering', '/users']],
  ['service1', ['/service']],
];
const M_ROLE_ROUTES = [
  ['wh1', ['/m', '/m/warehouse', '/m/issues']],
  ['shop1', ['/m/production', '/m/assembly']],
  ['pm1', ['/m/shipping', '/m/site']],
  ['service1', ['/m/service']],
  ['sales1', ['/m/me']],
];

const RUN_OPTS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  resultTypes: ['violations'],
};

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const agg = new Map();   // ruleId -> { ...meta, routes:Set, nodes:[sample] }
const errors = [];
let pageCount = 0;
let totalViolations = 0;

/** 逐节点留档（不只是 rule 计数）—— 对比度要拆到「前景 on 背景」才可修 */
const allNodes = []; // {rule, impact, route, target, html, data, why}

function addViolations(route, violations) {
  pageCount++;
  totalViolations += violations.length;
  for (const v of violations) {
    if (!agg.has(v.id)) {
      agg.set(v.id, {
        id: v.id, impact: v.impact, help: v.help, description: v.description,
        tags: (v.tags || []).filter(t => t.startsWith('wcag')),
        routes: new Set(), nodeCount: 0, samples: [],
      });
    }
    const e = agg.get(v.id);
    e.routes.add(route);
    e.nodeCount += v.nodes.length;
    for (const n of v.nodes) {
      const rec = {
        rule: v.id, impact: v.impact, route,
        target: (n.target || []).join(' '),
        html: (n.html || '').slice(0, 260),
        why: (n.failureSummary || '').slice(0, 300),
        data: n.any?.[0]?.data || n.all?.[0]?.data || null,
      };
      allNodes.push(rec);
      if (e.samples.length < 6) e.samples.push(rec);
    }
  }
}

async function runGroup(label, groups, { mobile = false } = {}) {
  const c = await newCtx({ mobile });
  const { page } = c;
  const rows = ONLY_ROLE ? groups.filter(([who]) => who === ONLY_ROLE) : groups;
  if (!rows.length) { errors.push(`${label}: 没有匹配的角色 ${ONLY_ROLE}`); }
  for (const [who, routes] of rows) {
    try {
      await login(page, who, 'txgk@123');
    } catch (e) {
      errors.push(`${label}/${who}: 登录失败 ${e}`);
      continue;
    }
    for (const r of routes) {
      try {
        await page.goto('http://127.0.0.1:5207' + r, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(700);
        const res = await new AxeBuilder({ page }).options(RUN_OPTS).analyze();
        const viol = res.violations || [];
        addViolations(r, viol);
        const kinds = viol.length;
        console.log(`  ${kinds === 0 ? '✅' : '⚠️ '} ${label} ${who} ${r}  rules=${kinds} nodes=${viol.reduce((a, v) => a + v.nodes.length, 0)}`);
      } catch (e) {
        errors.push(`${label}/${who} ${r}: ${String(e).slice(0, 200)}`);
      }
    }
  }
  await c.browser.close();
}

console.log('════════ A11Y 探针（axe-core · WCAG 2.1 A/AA）════════');
await runGroup('PC', PC_ROLE_ROUTES);
await runGroup('MOBILE', M_ROLE_ROUTES, { mobile: true });

// ── 报告 ────────────────────────────────────────────────
const list = [...agg.values()].sort((a, b) =>
  (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || b.nodeCount - a.nodeCount);

console.log('\n════════ 按规则聚合（impact → 命中路由数 / 节点数）════════');
for (const e of list) {
  console.log(`\n[${e.impact || 'n/a'}] ${e.id}  —  ${e.routes.size} 路由 / ${e.nodeCount} 节点`);
  console.log(`   ${e.help}`);
  for (const s of e.samples.slice(0, 2)) {
    console.log(`   · ${s.route}  ${s.target}`);
    console.log(`     ${s.html.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

// ── 对比度：拆到「前景 on 背景」颜色对（这才是可修改的粒度）──
const contrast = allNodes.filter(n => n.rule === 'color-contrast' && n.data);
if (contrast.length) {
  const pairs = new Map();
  for (const n of contrast) {
    const d = n.data;
    const key = `${d.fgColor} on ${d.bgColor}  (${d.contrastRatio}:1, need ${d.expectedContrastRatio})`;
    if (!pairs.has(key)) pairs.set(key, { count: 0, routes: new Set(), selectors: new Map() });
    const p = pairs.get(key);
    p.count++; p.routes.add(n.route);
    // 用选择器的「末段 class」归并，避免 nth-child 千变万化
    const sel = n.target.replace(/\s*>\s*/g, ' > ').replace(/:nth-child\(\d+\)/g, '').replace(/#rc_[\w-]+/g, '#rc_*');
    const key2 = sel.slice(-90);
    if (!p.selectors.has(key2)) p.selectors.set(key2, { n: 0, example: n.html.replace(/\s+/g, ' ').slice(0, 120) });
    p.selectors.get(key2).n++;
  }
  const sorted = [...pairs.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`\n════════ color-contrast 拆解（${sorted.length} 种颜色对）════════`);
  for (const [key, p] of sorted) {
    console.log(`\n${String(p.count).padStart(4)} 节点 / ${p.routes.size} 路由   ${key}`);
    for (const [sel, v] of [...p.selectors.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3)) {
      console.log(`      ×${String(v.n).padStart(3)}  ${sel}`);
      console.log(`            ${v.example}`);
    }
  }
}

// ── label：列全（数量少，逐条给上下文）──
const labels = allNodes.filter(n => n.rule === 'label');
if (labels.length) {
  console.log(`\n════════ label 缺名（${labels.length} 个）════════`);
  for (const n of labels) {
    console.log(`  · ${n.route}  ${n.target}`);
    console.log(`    ${n.html.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}

// ── meta-viewport：源头只有一处 ──
const vps = allNodes.filter(n => n.rule === 'meta-viewport');
if (vps.length) {
  console.log(`\n════════ meta-viewport（${vps.length} 个，实为同一处源头）════════`);
  console.log(`  ${vps[0].html.replace(/\s+/g, ' ').slice(0, 160)}`);
}

const byImpact = list.reduce((a, e) => { a[e.impact || 'n/a'] = (a[e.impact || 'n/a'] || 0) + 1; return a; }, {});
console.log('\n════════ 合计 ════════');
console.log(`页面 ${pageCount} · 违规规则 ${list.length} 条 · 违规节点合计 ${list.reduce((a, e) => a + e.nodeCount, 0)}`);
console.log(`按影响：${Object.entries(byImpact).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}`);
if (errors.length) console.log(`\n⚠️ 探针自身异常 ${errors.length} 条：\n  ` + errors.join('\n  '));

fs.mkdirSync(SHOTS, { recursive: true });
const out = {
  generatedAt: new Date().toISOString(),
  pages: pageCount,
  rules: list.map(e => ({ ...e, routes: [...e.routes] })),
  nodes: allNodes,
  errors,
};
fs.writeFileSync(path.join(SHOTS, 'a11y-report.json'), JSON.stringify(out, null, 2));
console.log(`\n报告：e2e/shots/a11y-report.json`);

if (GATE) {
  const bad = list.filter(e => e.impact === 'critical' || e.impact === 'serious');
  if (bad.length) { console.log(`\n❌ --gate：critical/serious 规则 ${bad.length} 条 → exit 1`); process.exit(1); }
}
process.exit(0);
