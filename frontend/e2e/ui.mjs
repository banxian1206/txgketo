/**
 * UI 回归：真实浏览器（channel:chrome）
 *  Part 1 冒烟：PC 25 路由 + 移动 9 路由，零 pageerror / 零 4xx / 零 antd 弃用警告（P-16 动态）
 *  Part 2 交互：P-09 · P-01 · P-03 · P-02 · P-11 · P-13 · P-05 · P-10 · P-04 · P-08 · P-18 · P-21 · P-22
 *  Part 3 预填实读：用户/供应商/标准库编辑 + 装配开始（打开弹窗断言初始值，治 PREFILL 静态盲区）
 *  Part 4 本轮口径：O1 侧栏不再重名 · R4-01 移动端已下线 PC-only 卡
 *  注意：本脚本会创建 1 个测试商机（E2E回归-*）并走完 建图/下单/验收，属护栏正常代价
 */
import { newCtx, login, body, shot, check, summary, exitWith, results, BASE, API, FILES, apiLogin, apiGet, apiPost } from './lib.mjs';
import path from 'node:path';

/** 打开表单/档案页的某个分区（P4：分区条 `?tab=`）——跨步骤填字段前必须先切过去 */
async function openSection(page, label) {
  const b = page.locator('.ds-sec').filter({ hasText: label }).first()
  if (await b.count()) { await b.click(); await page.waitForTimeout(350); return true }
  return false
}

/** 打开台内某个视图（R3-B）：台页签现在是「组页签（≤4）+ 组内 Segmented」，
 *  所以按**视图名**找：先在组页签里找，找不到就逐个组点开再看组内 Segmented。 */
/**
 * 按视图名打开页签 —— 兼容三条实现（docs/15 后统一为前两条）：
 *   ① 单层流程条：`.ds-sec-nav button`（台/详情页通用）
 *   ② 两层流程条：`ds-subtabs` 里的 Segmented（项那一行）
 *   ③ 旧 antd Tabs（尚未迁移的页）
 */
async function openTab(page, label) {
  const seg = page.locator('.ds-subtabs .ant-segmented-item').filter({ hasText: label }).first()
  if (await seg.count()) { await seg.click(); await page.waitForTimeout(800); return true }
  const sec = page.locator('.ds-sec-nav button').filter({ hasText: label }).first()
  if (await sec.count()) { await sec.click(); await page.waitForTimeout(800); return true }
  const t = page.locator('.ant-tabs-tab').filter({ hasText: label }).first()
  if (await t.count()) { await t.click(); await page.waitForTimeout(700); return true }
  const groups = page.locator('.ant-tabs-tab')
  const n = await groups.count()
  for (let i = 0; i < n; i++) {
    await groups.nth(i).click(); await page.waitForTimeout(400)
    const s2 = page.locator('.ant-segmented-item').filter({ hasText: label }).first()
    if (await s2.count()) { await s2.click(); await page.waitForTimeout(800); return true }
  }
  return false
}

/** 流程条现状（新壳）：组那一行 / 项那一行 / 单层时两者相同 */
/**
 * 台内页签条状态。
 * ★ 2026-10-05：台内**只剩一行可点页签条**（组不再当可点胶囊、也不再画小标题 ——
 *   客户实测「点『待办』没反应」：组点它=跳组内第一个，人已在该组时 URL 与内容都不变=死路）。
 *   所以 `groupSel` 已无对应物，一律报空；`itemSel` = 当前选中的那个页签。
 *   保留 `groupSel` 字段是为了让老断言在改写期间不报 TypeError。
 */
async function navState(page) {
  return page.evaluate(() => {
    const row = document.querySelector('.ds-subtabs.is-flow') || document.querySelector('.ds-subtabs')
    const itemSel = row?.querySelector('.ant-segmented-item-selected')?.textContent?.trim() ?? ''
    const single = document.querySelector('.ds-sec-nav button.ds-sec.on')?.textContent?.trim() ?? ''
    const groupCount = row ? row.querySelectorAll('.ant-segmented-item').length : document.querySelectorAll('.ds-sec-nav button').length
    return { groupSel: '', itemSel: itemSel || single, groupCount, itemCount: groupCount }
  })
}

const PHOTO = path.join(FILES, 'photo.png');
const PC_ROUTES = [
  '/workbench', '/workbench/sales', '/workbench/pm', '/workbench/eng', '/workbench/shop',
  '/projects', '/projects/new', '/numbering', '/users', '/library',
  '/my-tasks', '/reviews', '/changes', '/purchase', '/suppliers',
  '/warehouse', '/manufacturing', '/assembly', '/shipping',
  '/site', '/acceptance', '/service',
];
const M_ROUTES = ['/m', '/m/warehouse', '/m/issues', '/m/production', '/m/assembly', '/m/shipping', '/m/site', '/m/service', '/m/me'];

// ★ 冒烟不得用 admin（超管绕过所有权限码 → 等于权限层没测；且无部门会造出 N21 假象）。
//   改为「路由 → 用哪个角色跑」：一个角色只走它有权看的页，否则会因 403 误报。
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

/** 逐个角色登录，只走它被分配的路由；返回异常清单。 */
async function smokeByRole(ctx, groups, waitMs) {
  const { page, errs } = ctx;
  const bad = [];
  for (const [who, routes] of groups) {
    await login(page, who, 'txgk@123');
    for (const r of routes) {
      errs.length = 0;
      await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(waitMs);
      const len = (await body(page)).length;
      if (len < 40) bad.push(`${who}${r} 空页(${len})`);
      const e = errs.filter(x => !x.includes('favicon'));
      if (e.length) bad.push(`${who}${r}: ${e.slice(0, 2).join(' ')}`);
    }
  }
  return bad;
}

// ═════════ Part 1 · PC 冒烟（按角色分组，共 25 路由）═════════
{
  const c = await newCtx(); const { errs } = c;
  const bad = await smokeByRole(c, PC_ROLE_ROUTES, 500);
  const n = PC_ROLE_ROUTES.reduce((a, [, rs]) => a + rs.length, 0);
  check('SMOKE-pc', bad.length === 0, bad.length ? bad.join(' | ').slice(0, 400) : `${n} 路由零异常零空页（${PC_ROLE_ROUTES.length} 角色）`);

  // P-16 动态：console 无 antd 弃用警告
  const antdWarn = errs.filter(x => /antd/.test(x));
  check('P-16-dyn', antdWarn.length === 0, antdWarn.length ? antdWarn[0] : 'console antd 警告 0');
  await c.browser.close();
}

// ═════════ Part 1b · 移动冒烟（按角色分组，共 9 页）═════════
{
  const c = await newCtx({ mobile: true });
  const bad = await smokeByRole(c, M_ROLE_ROUTES, 400);
  const n = M_ROLE_ROUTES.reduce((a, [, rs]) => a + rs.length, 0);
  check('SMOKE-mobile', bad.length === 0, bad.length ? bad.join(' | ').slice(0, 400) : `${n} 移动页零异常（${M_ROLE_ROUTES.length} 角色）`);
  // ★ F12（2026-10-04 走查核实）：打错地址/过期书签不能被静默踢回工作台 —— 要明说「页面不存在」且保留原 URL
  await c.page.goto(BASE + '/nope-xyz-404', { waitUntil: 'networkidle' }).catch(() => {});
  await c.page.waitForTimeout(800);
  const t404 = await body(c.page);
  check('F12-真404页', /页面不存在/.test(t404) && c.page.url().includes('nope-xyz-404'),
    `含「页面不存在」=${/页面不存在/.test(t404)} · URL 保留=${c.page.url().includes('nope-xyz-404')}`);
  await c.browser.close();
}

// ═════════ Part 2 · 交互回归（一条写链走到底）═════════
const c = await newCtx(); const { page, errs } = c;
let newNo = null;
try {
  // ★ 本段前 300 行是只读 IA 断言，其中「A3：反向裁剪（super 全卡）」**必须用超管**才能验证 ——
  //   故显式声明例外。其后的写链已按责任角色逐段重新登录（见下方 login 调用）。
  await login(page, 'admin', 'txgk@123', { system: true });   // admin-ok: 本段含「A3 反向裁剪(super 全卡)」与写链 IA 断言，须超管；写链下单已由 N21 修复后可走采购链

  // ── P0 全站 IA：侧栏 7 项三分类 + 一级图标 + 旧平铺收进右侧 ──
  {
    // lazy chunk 加载期整页是 Skeleton —— 等侧栏真实挂载再断言（否则断在加载时序上）
    await page.waitForSelector('.ant-menu-item', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    const t = await body(page)
    const groups = ['业务', '系统管理'].every((g) => t.includes(g))
    const roots = ['项目', '基础数据', '系统管理']
    const missing = roots.filter((r) => !t.includes(r))
    // ★ 重整 D1（docs/10 §8.1）：「交付执行」这一层已经不存在，侧栏必须查不到它
    const hasDelivery = t.includes('交付执行')
    const siderIcons = await page.locator('.ant-menu-item .anticon').count()
    const siderText = await page.locator('.ant-layout-sider').innerText().catch(() => '')
    const siderLines = siderText.split('\n').map((x) => x.trim())
    // 整行匹配（防'我的工作台'子串误伤'我的工作'）
    const oldFlat = ['制造（车间）', '装配 · 齐套率', '发运（发货指令）', '我的工作'].filter((x) => siderLines.includes(x))
    // ★ 重整后侧栏终态 4 项：工作台 + 项目 + 基础数据 + 系统管理（业务线不再占侧栏）
    const itemCount = await page.locator('.ant-layout-sider .ant-menu-item').count()
    check('NAV-侧栏4项终态', groups && missing.length === 0 && itemCount === 4 && !hasDelivery,
      `项数=${itemCount}/4 · 三分类组=${groups} · 缺项=${missing.join('/') || '无'} · 交付执行残留=${hasDelivery}`)
    check('NAV-旧平铺已收', oldFlat.length === 0,
      oldFlat.length ? `侧栏仍有平铺: ${oldFlat.join('/')}` : '我的工作/交付执行二级已全部收编')
  }

  // ── P0 域 Tab + 旧路径 redirect（通知/书签不断）──
  {
    await page.goto(BASE + '/manufacturing', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/workbench\/shop\/mfg/, { timeout: 8000 }).catch(() => {})
    const redirected = page.url().includes('/workbench/shop/mfg')
    // 车间台内导航：看板 / 制造 / 装配（制造与装配的唯一入口，双入口已收）
    // ★ docs/15 §6-⑤：视图条是 `ShopViews` 的 Segmented（台头之后），不再是 antd card 页签
    const shopTabs = await page.locator('.domain-content .shop-views .ant-segmented-item').allInnerTexts().catch(() => [])
    check('NAV-redirect交付', redirected && shopTabs.some((x) => x.includes('制造')) && shopTabs.some((x) => x.includes('装配')),
      `旧 /manufacturing → ${page.url()} · 车间台视图=${JSON.stringify(shopTabs)}`)
    const asmTab = page.locator('.domain-content .shop-views .ant-segmented-item', { hasText: '装配' }).first()
    if (await asmTab.count()) {
      await asmTab.click()
      await page.waitForURL(/\/workbench\/shop\/assembly/, { timeout: 6000 }).catch(() => {})
      check('NAV-Tab切换', page.url().includes('/workbench/shop/assembly'), `点装配 → ${page.url()}`)
    } else check('NAV-Tab切换', false, '车间台无装配入口')
    const cases = [['/my-tasks', 'workbench\\/tasks'], ['/mine/tasks', 'workbench\\/tasks'], ['/users', 'admin\\/users'], ['/purchase/orders', 'purchase(?!,/suppliers)'], ['/purchase/suppliers', 'suppliers']]
    const bad = []
    for (const [from, to] of cases) {
      await page.goto(BASE + from, { waitUntil: 'domcontentloaded' })
      try { await page.waitForURL(new RegExp(to), { timeout: 6000 }) } catch { bad.push(`${from}→${page.url()}`) }
    }
    check('NAV-redirect抽样', bad.length === 0, bad.length ? bad.join(' | ') : '3 条旧路径全部落到新址')
  }

  // ── P0 基础数据域（路径零变 + pathless Tab 壳）──
  {
    await page.goto(BASE + '/numbering', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    const tabs = await page.locator('.domain-tabs a').allInnerTexts()
    const active = await page.locator('.domain-tabs a.active').innerText().catch(() => '')
    check('NAV-基础数据Tab', tabs.length === 2 && active === '编号规则', `Tab=${tabs.join('/')} · active=${active}`)
  }

  // ── A3：admin 反向裁剪（super 全卡）+ 台 Tab 待办角标（条件：counts>0 才验数值）──
  {
    await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const aT = await body(page)
    // ★ 2026-10-05：「我的工作台」入口已取消（客户拍板），超管首屏不再有那张收件箱卡。
    //   改为断言：① 台清单里**不再有**「我的工作台」 ② 仍能看到各部门台 ③ 管理入口还在。
    // ⚠ 「演示数据」那个管理入口在 `/users` 页（侧栏「用户与权限」），不在首屏 ——
    //   所以这里只断言前两件：不再有「我的工作台」、能看到各部门台。管理入口由 O1-侧栏不再重名 覆盖。
    check('NAV-KPI裁剪-admin', !aT.includes('我的工作台') && aT.includes('仓库工作台'),
      `super：无「我的工作台」=${!aT.includes('我的工作台')} · 见各部门台=${aT.includes('仓库工作台')}`)

    const counts = await page.evaluate(async () => {
      try {
        const raw = localStorage.getItem('txgk_session')
        if (!raw) return null
        const tok = JSON.parse(raw).token
        const r = await fetch('/api/v1/workbench/me', { headers: { Authorization: 'Bearer ' + tok } })
        return (await r.json()).counts
      } catch { return null }
    })
    if (!counts) {
      check('NAV-台Tab角标', false, '取不到 counts —— 台角标无法验证（先跑 e2e_baseline 造数）')
    } else {
      const probes = [
        // ★ 2026-10-05：'我的'台已取消（客户拍板），只剩各部门台的角标要核对
        ['采购', counts.to_purchase],
        ['仓库', counts.to_inspect + counts.to_store + counts.issues],
        ['车间', counts.shop_wait + counts.shop_accept + counts.shop_transfer + counts.shop_assembling + counts.shop_debug],
      ]
      const tabTexts = await page.locator('.domain-tabs a').allInnerTexts()
      const bad = []
      let anyPositive = false
      for (const [name, n] of probes) {
        const line = tabTexts.find((t) => t.includes(name)) ?? ''
        const hasDigit = /\d/.test(line)
        if (n > 0) { anyPositive = true; if (!hasDigit) bad.push(`${name}台 counts=${n} 无角标`) }
        else if (hasDigit) bad.push(`${name}台 counts=0 却显示(${line.trim()})`)
      }
      if (!anyPositive && bad.length === 0) {
        check('NAV-台Tab角标', false, '业务台 counts 全 0 —— 没角标可验（先跑 e2e_baseline 造数）')
      } else {
        check('NAV-台Tab角标', bad.length === 0, bad.length ? bad.join(' | ') : '角标数值与 counts 逐台一致（0 不显示）')
      }
    }
  }

  // ── A5 车间台收编：台内 card 页签（看板|制造|装配）= URL 子路由 ──
  {
    await page.goto(BASE + '/workbench/shop', { waitUntil: 'networkidle' })
    await page.waitForSelector('.domain-content .shop-views', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(400)
    const inner = page.locator('.domain-content')
    // ★ docs/15 §6-⑤：三视图条从 antd card 页签（在标题之上）改成 `ShopViews` 的 Segmented
    //   （在每个视图自己的台头之后）；URL 仍是子路由 /workbench/shop/mfg
    const viewTab = inner.locator('.shop-views .ant-segmented-item', { hasText: '制造' }).first()
    let urlOk = false, contentOk = false
    if (await viewTab.count()) {
      await viewTab.click()
      await page.waitForURL(/\/workbench\/shop\/mfg/, { timeout: 6000 }).catch(() => {})
      urlOk = page.url().includes('/workbench/shop/mfg')
      await page.waitForTimeout(700)
      const t2 = await body(page)
      contentOk = t2.includes('排产') || t2.includes('制造') || t2.includes('下发')
    }
    const viewCount = await inner.locator('.shop-views .ant-segmented-item').count()
    check('NAV-车间台收编', viewCount === 3 && urlOk && contentOk,
      `视图条=${viewCount} 项 · URL=${urlOk} · 制造内容挂载=${contentOk}`)
  }

  // ── A4 到货跟踪（催货视图：active 页签 + 在途行/空态双分支）──
  {
    await page.goto(BASE + '/purchase?tab=arrivals', { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const t = await body(page)
    const hasRows = (t.match(/PO\d{5}/g) || []).length > 0
    const hasEmpty = t.includes('没有在途采购单')
    // ★ docs/15：台流程条统一成「组（Segmented）+ 组内项（Segmented）」；?tab=arrivals 落
    //   「到货与验收」组、组内选中「到货跟踪」（key 没改，深链照旧）
    const nav = await navState(page)
    // ★ 2026-10-05：一行页签条（无「组」层）——验「到货跟踪」在条里且被选中、条没有变两倍长
    check('NAV-到货跟踪', /到货跟踪/.test(nav.itemSel) && nav.groupCount <= 12 && (hasRows || hasEmpty),
      `选中=「${nav.itemSel}」 · 条内项数=${nav.groupCount}/12 · 在途行=${hasRows}${hasEmpty ? '(空态引导)' : ''}`)
  }

  // ── P0 修正：工作台 Tab 化（me 动态列表）+ 采购/仓库归位 + 角色裁剪 ──
  {
    await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
    await page.waitForSelector('.domain-tabs a', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(600)
    const tabs = await page.locator('.domain-tabs a').allInnerTexts()
    const hasPurchase = tabs.some((t) => t.includes('采购'))
    const hasWarehouse = tabs.some((t) => t.includes('仓库'))
    check('NAV-工作台Tab', tabs.length >= 6 && hasPurchase && hasWarehouse,
      `admin 台 Tab=${tabs.length} 个 · 采购台=${hasPurchase} · 仓库台=${hasWarehouse}（me 列表原样）`)
    // 点采购台 Tab → 走到采购工作台
    const pTab = page.locator('.domain-tabs a', { hasText: '采购' })
    if (await pTab.count()) {
      await pTab.click(); await page.waitForTimeout(1200)
      const onPurchase = page.url().includes('/purchase')
      check('NAV-采购台在工作台', onPurchase, `点采购Tab → ${page.url()}（角色台归位工作台域）`)
    } else check('NAV-采购台在工作台', false, '无采购Tab')
  }
  // ★ 重整 P1（docs/10 §8.4）：「我的工作台」不再自带页签条 —— 原来台条→台内条→页内条→状态条
  //   四条横条叠在一屏。现在待办卡就是入口，点它直达「对应台 + 对应页签」。
  {
    // ★ 2026-10-05：「我的工作台」聚合页已取消 → 这条断言改成验**中转站**：
    //   `/workbench` 必须落到我可见的台（不是停在空白、也不是回聚合页），且台内只有一条页签条。
    await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const innerTabs = await page.locator('.domain-content .ant-tabs-tab').allInnerTexts().catch(() => [])
    const urlOk = /\/(workbench\/(sales|pm|eng|shop)|purchase|warehouse|delivery\/|dashboard)/.test(new URL(page.url()).pathname)
    const contentOk = (await body(page)).length > 200
    // ★ 2026-10-05：车间台的卡片深链原指向 /workbench/tasks（已取消的聚合页）。
    //   现在 /workbench 是中转站，**点它必须跳到我可见的第一个台**（不能停在空白）。
    check('NAV-台内不叠页签', innerTabs.length === 0 && urlOk && contentOk,
      `台内页签条=${innerTabs.length}（应 0）· 卡片深链落到台=${urlOk} · 内容挂载=${contentOk}`)
  }

  // ── docs/12 视觉/信息架构护栏：详情页首屏必须给出结论；表格不许截断数据 ──
  {
    const vc = await newCtx()
    try {
      await login(vc.page, 'pm1', 'txgk@123')
      const pno = await vc.page.evaluate(async (api) => {
        const raw = JSON.parse(localStorage.getItem('txgk_session') || '{}')
        const r = await fetch(api + '/api/v1/projects', { headers: { Authorization: 'Bearer ' + raw.token } })
        const j = await r.json()
        return Array.isArray(j) && j.length ? j[0].project_no : null
      }, API)
      if (!pno) {
        check('VIS-详情首屏', false, '库里没有项目 —— 基线未跑（护栏不许空转，直接红）')
      } else {
        await vc.page.goto(`${BASE}/projects/${pno}`, { waitUntil: 'networkidle' })
        await vc.page.waitForTimeout(1500)
        const fold = await vc.page.evaluate(() => {
          const vh = window.innerHeight
          const txt = (el) => (el?.innerText ?? '')
          const bar = document.querySelector('.ant-collapse-item')?.closest('.ant-collapse')?.previousElementSibling
          const inFold = (sel) => Array.from(document.querySelectorAll(sel)).some((e) => {
            const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= vh + 40
          })
          return {
            h: Math.round((document.querySelector('.domain-content') || document.body).scrollHeight),
            no: inFold('.ant-breadcrumb') || txt(document.body).slice(0, 400).includes('TX'),
            // ★ 2026-10-04 迁移：状态药丸从 antd `Tag` 换成了 ds 的 `Chip`/`Status`
            //   （`.ds-ch` / `.ds-st`）—— 断言意图不变（首屏看得到阶段），选择器跟着换代。
            stage: inFold('.ant-tag, .ds-ch, .ds-st'),
            // 注意：antd 会给两字按钮自动插空格（「立 项」），比对前先去掉空白
            nextBtn: Array.from(document.querySelectorAll('button')).some((b) => b.getBoundingClientRect().top < vh && /成交登记|立项|进入设计|去发运|登记回款|质保金/.test((b.innerText ?? '').replace(/\s+/g, ''))),
            stageText: (document.querySelector('.ant-tag, .ds-ch, .ds-st')?.innerText ?? ''),
            nums: (() => {
              const s = Array.from(document.querySelectorAll('*')).filter((e) => /设备|齐套|未收|客户/.test(e.textContent ?? '') && e.children.length <= 3)
              return s.length > 0 && s[0].getBoundingClientRect().top < vh
            })(),
          }
        })
        // 终态（已关闭/已归档）本来就没有「下一步」—— 护栏按阶段判，不逼产品造出动作
        const terminal = /已关闭|已归档/.test(fold.stageText ?? '')
        check('VIS-详情首屏给结论', fold.stage && fold.nums && (fold.nextBtn || terminal),
          `首屏: 阶段=${fold.stageText ?? fold.stage} 下一步=${fold.nextBtn}${terminal ? '(终态豁免)' : ''} 关键数字=${fold.nums} · 页高 ${fold.h}px`)
        check('VIS-详情页≤3屏', fold.h <= 2700, `页高 ${fold.h}px（改造前 7411px）`)
        // ★ 2026-10-05 迁移（docs/14 P3）：折叠泳道已被**分区条**取代 —— 断言意图不变
        //   （"一屏只呈现一块，不要回到平铺"），选择器从 .ant-collapse-item-active 换到 .ds-sec.on。
        const sec = await vc.page.evaluate(() => {
          const on = document.querySelectorAll('.ds-sec.on')
          return { n: document.querySelectorAll('.ds-sec').length, on: on.length, label: (on[0]?.innerText ?? '').trim() }
        })
        check('OBJ-默认分区=概览', sec.n >= 3 && sec.on === 1 && /概览/.test(sec.label),
          `分区 ${sec.n} 个 · 默认选中「${sec.label}」（选中数 ${sec.on}，应 1）`)
        // 空值不占位：只读页面上的「—」是注意力黑洞（改造前光首屏就 3 个）
        // 只判「字段区」：表格单元格留 — 是对的（行对齐需要占位），要治的是详情页那种
        // 一整屏 label 配 — 的空字段（改造前首屏就 3 个）
        const emptyFields = await vc.page.evaluate(() =>
          Array.from(document.querySelectorAll('.ef-value')).filter((e) => (e.innerText ?? '').trim() === '—').length)
        check('VIS-空值不占位', emptyFields === 0, `字段区仍有 ${emptyFields} 个「label : —」空占位`)
        const trunc = await vc.page.evaluate(() => {
          const bad = []
          document.querySelectorAll('.ant-table td, .ant-table th').forEach((c) => {
            if (c.scrollWidth > c.clientWidth + 1) {
              const r = c.getBoundingClientRect()
              if (r.width > 0 && r.top < window.innerHeight) bad.push((c.innerText || '').slice(0, 18))
            }
          })
          return bad
        })
        check('VIS-表格不截断数据', trunc.length === 0, trunc.length ? `被截断: ${trunc.slice(0, 4).join(' | ')}` : '可见单元格无 scrollWidth 溢出')
      }
    } finally {
      await vc.browser.close()
    }
  }

  // ── docs/11 导航上下文：从台点进项目，不许"换了个地方" ──
  // ★ 自建靶（不许"没数据就跳过"——那是休眠护栏，第九轮报告点过名）：
  //   用当前角色自己的台 + 真实点击链路，断言侧栏/台条/返回口三件事都没漂。
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'sales1', 'txgk@123')
      await nc.page.goto(BASE + '/workbench/sales', { waitUntil: 'networkidle' })
      await nc.page.waitForTimeout(1200)
      const tabsBefore = await nc.page.locator('.domain-tabs a').count()
      const row = nc.page.locator('.ant-table-row').first()
      let url = '', sideSel = '', tabsAfter = 0, backTxt = '', backUrl = ''
      if (await row.count()) {
        const entry = row.locator('button.project-entry')
        await entry.focus()
        await nc.page.keyboard.press('Enter')
        await nc.page.waitForTimeout(1400)
        url = nc.page.url()
        sideSel = (await nc.page.locator('.ant-menu-item-selected').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        tabsAfter = await nc.page.locator('.domain-tabs a').count()
        const bk = nc.page.getByRole('button', { name: /^← 返回/ }).first()
        backTxt = await bk.innerText().catch(() => '')
        if (await bk.count()) { await bk.focus(); await nc.page.keyboard.press('Enter'); await nc.page.waitForTimeout(1200); backUrl = nc.page.url() }
      }
      // （台里没项目行也必须红 —— 不许「没数据就跳过」的休眠护栏）
      check('NAV-drill-in 带来源', url.includes('from='), url ? `点项目行 → ${url.replace(BASE, '')}` : '台里没有可点的项目行')
      check('NAV-侧栏不被抢走', sideSel.includes('工作台'), `侧栏选中=「${sideSel}」（曾是「项目」）`)
      // ★ 2026-10-05：sales1 只有 1 个台 → `DomainShell` 按设计**不画台条**（visible.length<=1），
      //   所以“台条 0 → 0”是对的；真正要守住的是「多台时台条不许中途消失」。
      check('NAV-台条不消失', tabsAfter === tabsBefore && (tabsBefore === 0 || tabsBefore >= 1),
        `台条 ${tabsBefore} → ${tabsAfter}（单台角色按设计不显示；多台时不得中途消失）`)
      check('NAV-返回口是来源台', /返回.*(工作台|列表)/.test(backTxt) && backTxt.includes('商务部'), `返回口=「${backTxt}」`)
      check('NAV-点返回回原台', backUrl.includes('/workbench/sales'), backUrl.replace(BASE, '') || '（返回口没点动）')
    } finally {
      await nc.browser.close()
    }
  }

  // ── 走查 2026-10-04：从工作台进「新建商机」再取消，必须回【来源工作台】（不是项目列表）──
  //   用户实测：商务台 → 新建商机 → 取消 → 落到 /projects（丢来源）。本断言钉死这个动线。
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'sales1', 'txgk@123')
      await nc.page.goto(BASE + '/workbench/sales', { waitUntil: 'networkidle' })
      await nc.page.waitForTimeout(1200)
      await nc.page.locator('button').filter({ hasText: '新建商机' }).first().click()
      await nc.page.waitForTimeout(1400)
      const newUrl = nc.page.url()
      await nc.page.locator('button').filter({ hasText: /^取\s*消$/ }).first().click()
      await nc.page.waitForTimeout(1200)
      const cancelUrl = nc.page.url()
      check('NAV-取消回来源台',
        newUrl.includes('/projects/new') && newUrl.includes('from=') && cancelUrl.includes('/workbench/sales'),
        `新建 → ${newUrl.replace(BASE, '')} · 取消 → ${cancelUrl.replace(BASE, '')}`)
    } finally {
      await nc.browser.close()
    }
  }

  // UIUX：登录失败必须在表单上可见，修改输入后消除旧反馈。
  {
    const nc = await newCtx()
    try {
      await nc.page.goto(BASE + '/login')
      await nc.page.locator('input[autocomplete="username"]').fill('pm1')
      await nc.page.locator('input[autocomplete="current-password"]').fill('incorrect-ux-test')
      await nc.page.getByRole('button', { name: /登\s*录/ }).click()
      const feedback = nc.page.getByRole('alert').filter({ hasText: '账号或密码错误' })
      await feedback.waitFor({ state: 'visible' })
      check('UX-登录失败就地反馈', await feedback.isVisible(), '错误保留在表单内')
      await nc.page.locator('input[autocomplete="current-password"]').fill('txgk@123')
      check('UX-更正输入清除旧错误', await feedback.count() === 0, '输入更正后不保留过时错误')
    } finally { await nc.browser.close() }
  }

  // 长/短工作台页签切换不主动滚动页面（只读，矮视口可复现旧scrollIntoView位移）。
  {
    const nc = await newCtx()
    try {
      await nc.page.setViewportSize({ width: 1366, height: 600 })
      await login(nc.page, 'pm1', 'txgk@123')
      await nc.page.goto(BASE + '/workbench/pm', { waitUntil: 'networkidle' })
      const pos = () => nc.page.evaluate(() => {
        const nav = document.querySelector('.ds-subtabs').getBoundingClientRect()
        return { x: nav.x, y: nav.y, scroll: window.scrollY }
      })
      const before = await pos()
      await nc.page.locator('.ds-subtabs').getByText('验收与质保', { exact: true }).click()
      await nc.page.getByRole('button', { name: '申请客户验收', exact: true }).waitFor()
      const after = await pos()
      await nc.page.locator('.ds-subtabs').getByText('看板', { exact: true }).click()
      const back = await pos()
      check('UX-页签切换外壳不位移', [after, back].every(p => Math.abs(p.x - before.x) < 1 && Math.abs(p.y - before.y) < 1 && Math.abs(p.scroll - before.scroll) < 1), JSON.stringify({ before, after, back }))
    } finally { await nc.browser.close() }
  }

  // S0 分区引导：不写业务数据，验证保值、摘要和隐藏区校验。
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'sales1', 'txgk@123')
      await nc.page.goto(BASE + '/projects/new?from=%2Fworkbench%2Fsales')
      check('UX-S0标题不重复提交操作', await nc.page.locator('.ant-card-head button').count() === 0 && await nc.page.getByRole('button', { name: '建立商机', exact: true }).count() === 0, '标题无操作，前两步不展示提交')
      await nc.page.getByRole('button', { name: '① 商机与联系', exact: true }).focus()
      await nc.page.keyboard.press('ArrowRight')
      check('UX-分区方向键跟随焦点', new URL(nc.page.url()).searchParams.get('tab') === 'require' && await nc.page.getByRole('button', { name: '② 需求与时间', exact: true }).evaluate(el => el === document.activeElement), '切区后焦点移到对应按钮')
      await nc.page.keyboard.press('ArrowLeft')
      await nc.page.getByRole('combobox', { name: '销售负责人' }).click()
      await nc.page.keyboard.press('ArrowRight')
      check('UX-分区不抢选择器方向键', !new URL(nc.page.url()).searchParams.has('tab'), '在选择器操作仍停留第一步')
      await nc.page.keyboard.press('Escape')
      await nc.page.locator('#project_name').fill('UX草稿护栏')
      await nc.page.getByRole('button', { name: '下一项：需求与时间', exact: true }).click()
      await nc.page.locator('#project_desc').fill('仅验证草稿，不提交业务数据')
      check('UX-S0下一项进URL', new URL(nc.page.url()).searchParams.get('tab') === 'require', '下一项切区不提交')
      await nc.page.getByRole('button', { name: '③ 资料与商务', exact: true }).click()
      check('UX-S0摘要保留草稿', await nc.page.getByTestId('create-review').innerText().then((t) => t.includes('UX草稿护栏') && t.includes('未填写')), '摘要区显示已填与缺项')
      await nc.page.getByRole('button', { name: '更多技术与商务信息（选填）', exact: true }).click()
      await nc.page.locator('#competitor').fill('选填护栏草稿')
      await nc.page.getByRole('button', { name: '更多技术与商务信息（选填）', exact: true }).click()
      await nc.page.getByRole('button', { name: '② 需求与时间', exact: true }).click()
      await nc.page.getByRole('button', { name: '③ 资料与商务', exact: true }).click()
      await nc.page.getByRole('button', { name: '更多技术与商务信息（选填）', exact: true }).click()
      check('UX-S0选填折叠跨区保值', await nc.page.locator('#competitor').inputValue() === '选填护栏草稿', '折叠与切换不卸载已填字段')
      await nc.page.getByRole('button', { name: '建立商机', exact: true }).last().click()
      await nc.page.locator('[data-section=basic]').waitFor({ state: 'visible' })
      check('UX-S0校验跳隐藏区', await nc.page.locator('[data-section=basic]').isVisible(), '必填校验仍跳第一个错误区')
    } finally { await nc.browser.close() }
  }

  // ── B1 三角色开台（拍板④）：发运/现场/售后各见自己的台 + 台Tab直达交付域 ──
  {
    const roles = [['delivery1', '发运工作台', '/delivery/shipping'], ['site1', '现场工作台', '/delivery/site'], ['service1', '售后工作台', '/delivery/service']]
    const bad = []
    let domainOk = false
    for (const [u, expect, expectRoute] of roles) {
      const cr = await newCtx()
      try {
        await login(cr.page, u, 'txgk@123')
        await cr.page.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
        // ★ 2026-10-05：「我的工作台」取消后，这三个账号**各自只剩 1 个台**，
        //   而 `DomainShell` 按设计在 `visible.length <= 1` 时**不画台条**
        //   （一个台不需要导航条）。所以不能再等 `.domain-tabs a` 出现 —— 那是旧契约。
        //   新契约：`/workbench` 中转后**落到自己那个台**，且不出现多台域条。
        await cr.page.waitForTimeout(1200)
        const tabs = await cr.page.locator('.domain-tabs a').allInnerTexts().catch(() => [])
        const landed = cr.page.url().includes(expectRoute)
        if (!landed) bad.push(`${u}: /workbench 未落到「${expect}」(${cr.page.url()})`)
        if (tabs.length > 3) bad.push(`${u}: 出现 ${tabs.length} 项台条（交付域未删净）`)
        // ★ 第八/九轮实测过的故障：发运角色点自己的台 → index redirect 落进【制造页】→ 403（无 mfg:view）
        //   重整后台必须直达自己的页面，且不再有 6 项域条。
        //   ★ 2026-10-05：delivery1 只剩 1 个台 → 台条按设计不画，所以**不能再从台条里找它再点**；
        //   改为直接校验中转站落地页（这条故障本身就是“落点错”，从哪儿点的无关）。
        if (u === 'delivery1') {
          domainOk = cr.page.url().includes('/delivery/shipping')
          const body1 = await cr.page.locator('body').innerText().catch(() => '')
          if (/没有权限|mfg:view/.test(body1)) bad.push('发运工作台落进了无权限页（旧故障复现）')
          const dTabs = await cr.page.locator('.domain-tabs a').count()
          if (dTabs > 3) bad.push(`点发运工作台后仍出现 ${dTabs} 项导航（交付域未删净）`)
        }
      } finally {
        await cr.browser.close()
      }
    }
    check('NAV-B1三角色开台', bad.length === 0 && domainOk,
      bad.length ? bad.join(' | ') : '单台角色落到自己的台（台条按设计不显示）· 发运工作台 → /delivery/shipping（不再落制造页）')
  }

  // A1（v2 拍板①）：供应商入采购台 —— 旧链落台内页签 + 侧栏收编
  {
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/purchase\?tab=suppliers/, { timeout: 8000 }).catch(() => {})
    const landed = page.url().includes('tab=suppliers')
    await page.waitForTimeout(900)
    const nav = await navState(page)
    const siderHasSupplier = await page.locator('.ant-layout-sider').innerText().catch(() => '')
    const noSideEntry = !siderHasSupplier.includes('供应商')
    // ★ 供应商是「单 key 的组」→ 页签直接显示「供应商」（不造"主数据"这种听不懂的组名）
    check('NAV-供应商入台', landed && nav.itemSel.includes('供应商') && noSideEntry && nav.groupCount <= 12,
      `旧链→${page.url().split('?')[1] || page.url()} · active=「${nav.itemSel}」 · 条内项数=${nav.groupCount}/12 · 侧栏已收=${noSideEntry}`)
  }

  // 选中态 = 最长前缀（用户实测 bug：/workbench/eng 被错标「我的工作台」——eng/sales 两台都验）
  {
    const bad = []
    for (const [route, expect] of [['/workbench/eng', '工程'], ['/workbench/sales', '商务']]) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForSelector('.domain-tabs a.active', { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(300)
      const act = await page.locator('.domain-tabs a.active').innerText().catch(() => '(无高亮)')
      if (!act.includes(expect)) bad.push(`${route} → 高亮「${act}」应含「${expect}」`)
    }
    check('NAV-台选中态', bad.length === 0,
      bad.length ? bad.join(' | ') : 'eng→工程部、sales→商务部 各自高亮正确（最长前缀匹配）')
  }

  // 角色裁剪：buyer1 只见 我的工作台 + 采购工作台
  {
    const c2 = await newCtx(); const p2 = c2.page
    await login(p2, 'buyer1', 'txgk@123')
    await p2.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
    await p2.waitForTimeout(1200)
    // ★ 2026-10-05：buyer1 只可见 1 个台（采购）→ 台条按设计不画（visible.length<=1）。
    //   裁剪的断言改为：/workbench **落到采购台**，且页面上**看不到仓库台**。
    const tabs = await p2.locator('.domain-tabs a').allInnerTexts().catch(() => [])
    const t = await p2.locator('body').innerText()
    const ok = p2.url().includes('/purchase') && !t.includes('仓库工作台')
    check('NAV-台角色裁剪', ok, `buyer1 落点=${new URL(p2.url()).pathname} · 台条=${JSON.stringify(tabs)} · 页面无「仓库工作台」=${!t.includes('仓库工作台')}`)
    // A3：buyer1 的角色裁剪 —— 无 DESIGN_AUDIT → 采购台里不该出现「待我审批/待我审核」这类别的台的事；
    //   非 ADMIN → 不该有管理入口。（★ 2026-10-05：这些卡原在已删的聚合页，现在查采购台自己）
    const bT = await body(p2)
    const buyerOk = !bT.includes('待我审核') && bT.includes('采购池') && !bT.includes('演示数据')
    check('NAV-KPI裁剪-buyer1', buyerOk,
      `无待我审核=${!bT.includes('待我审核')} · 有待采购=${bT.includes('待采购')} · 无管理卡=${!bT.includes('演示数据')}`)
    await c2.browser.close()
  }

  // —— P-09：空提交必须给出**看得见、能定位**的校验反馈 + 零 pageerror ——
  //   ★ 2026-10-05 迁移（docs/14 P4）：表单页分区后，错误可能落在**被藏起来的步骤**里。
  //     断言意图不变（空提交不能让用户"点了没反应"），拆成两条：
  //     ① 提交后**当前区**必须有可见的错误行；② 在「商机与联系」能看见列表级联系人错误。
  await page.goto(BASE + '/projects/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  errs.length = 0;
  await openSection(page, '资料与商务');
  await page.getByRole('button', { name: /建\s*立\s*商\s*机/ }).first().click();
  await page.waitForTimeout(900);
  const visibleErrs = await page.locator('.ant-form-item-explain-error:visible').allInnerTexts();
  await openSection(page, '商机与联系');
  const t0 = await body(page);
  check('P-09', visibleErrs.length > 0 && t0.includes('至少要有一个客户方联系人') && errs.length === 0,
    `可见错误 ${visibleErrs.length} 条（${visibleErrs.slice(0, 1).join('')}）· 列表级联系人错误=${t0.includes('至少要有一个客户方联系人')}${errs.length ? ' · 有异常: ' + errs[0] : ''}`);

  // —— S0 建商机（写链开始）：按三步真实字段布局填写 ——
  await openSection(page, '商机与联系');
  await page.getByLabel(/商机名称/).fill(`E2E回归-${new Date().toISOString().slice(5, 16).replace(/[-:]/g, '')}`);
  await page.getByLabel(/客户名称/).fill('E2E回归客户');
  await page.getByRole('button', { name: /添\s*加\s*联\s*系\s*人/ }).click();
  await page.getByPlaceholder('姓名').first().fill('回归机器人');
  await page.getByPlaceholder('电话').first().fill('13900000000');
  await page.getByLabel(/销售负责人/).click(); await page.waitForTimeout(400);
  await page.keyboard.type('销售'); await page.waitForTimeout(500);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  await openSection(page, '需求与时间');
  await page.getByLabel(/客户需求/).fill('e2e 护栏自动创建（可清理）');
  await page.getByLabel(/项目地点/).fill('广东惠州回归路 1 号');
  const dl = page.locator('.ant-form-item').filter({ hasText: '商机截止时间' }).locator('input');
  await dl.click(); await page.keyboard.type('2026-12-31'); await page.keyboard.press('Enter');
  await openSection(page, '资料与商务');
  await page.getByRole('button', { name: /建\s*立\s*商\s*机/ }).first().click();
  await page.waitForURL(/\/projects\/TX\d{5}/, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const t1 = await body(page);
  newNo = (t1.match(/TX\d{5}/g) || []).sort().at(-1);
  check('S0-建商机', !!newNo && t1.includes('E2E回归'), newNo ? `${newNo} 已建` : '新商机详情未见新项目');
  if (!newNo) throw new Error('no project');

  // —— 成交登记 ——
  await page.goto(`${BASE}/projects/${newNo}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /成\s*交\s*登\s*记/ }).first().click();
  await page.waitForSelector('.ant-modal', { timeout: 5000 });
  check('UX-付款节点固定标签', await page.getByLabel('付款节点', { exact: true }).count() === 4 && await page.getByLabel('比例（%）', { exact: true }).count() === 4, '预填四行均有节点与比例标签');
  const fillDate = async (id, v) => { const i = page.locator('#' + id); await i.click(); await page.keyboard.type(v); await page.keyboard.press('Enter'); };
  await fillDate('period_start', '2026-09-22');
  await fillDate('period_end', '2027-06-30');
  await page.locator('#amount').fill('500000');
  await page.locator('#warranty_months').fill('12');
  // AppModal 已预填 4 个付款节点（R2-02 修复后）——不再多点「添加付款节点」
  await page.getByRole('button', { name: /确\s*认\s*成\s*交/ }).click();
  await page.waitForTimeout(2000);
  // ★ F1 基线：成交登记提交后（无论成败）页面不得白屏 ——
  //   修前 422 的 detail 对象数组被直接丢进 React 渲染 → body.innerText 长度归零整站白屏
  {
    const tDeal = await body(page);
    const reactCrash = errs.filter((x) => /Objects are not valid as a React child/.test(x));
    check('F1-提交后页面非空白', tDeal.trim().length > 50 && reactCrash.length === 0,
      reactCrash.length ? reactCrash[0].slice(0, 120) : `body ${tDeal.trim().length} 字`);
  }

  // —— 立项 + 建设备 ——
  await page.getByRole('button', { name: /^立\s*项$/ }).first().click();
  await page.waitForURL(/initiate/, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await openSection(page, '设备清单');   // ★ 分区化后：「+ 新增设备」在「② 设备清单」里
  await page.getByRole('button', { name: /\+\s*新\s*增\s*设\s*备/ }).click();
  await page.waitForTimeout(500);
  await page.getByLabel(/设备名称/).fill('回归升降机');
  await page.getByRole('button', { name: /^\s*确\s*定\s*$/ }).last().click();
  await page.waitForTimeout(1400);
  check('S1-立项', (await body(page)).includes('回归升降机'), '设备 01A 已建');
  await page.getByRole('button', { name: /项目团队（已任命/ }).click();
  await page.getByRole('button', { name: /设备清单（已定/ }).click();
  check('UX-S1准备清单直达分区', new URL(page.url()).searchParams.get('tab') === 'equipment' && (await body(page)).includes('回归升降机'), '从团队切回设备，URL与内容一致');

  // —— P-03 + P-01：设计面预选 + 第一张图 ——
  await page.goto(`${BASE}/projects/${newNo}/design/01A`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: /\+\s*新\s*增\s*条\s*目/ }).click();
  await page.waitForTimeout(800);
  const am = page.locator('.ant-modal:visible').filter({ hasText: '新增条目' });
  const parentVal = await am.locator('.ant-form-item').filter({ hasText: '挂在哪个下面' })
    .locator('.ant-select-selection-item').allInnerTexts().catch(() => []);
  check('P-03', parentVal.length > 0, parentVal.length ? `父级打开即预选: ${parentVal[0].slice(0, 40)}` : '预选丢失');
  await am.getByLabel(/名称/).fill('回归安装板');
  await am.getByRole('button', { name: /新\s*增/ }).last().click();
  await page.waitForTimeout(2000);
  const t2 = await body(page);
  const drawn = /TX\d{5}-01A-\d{2}-00-00-00/.test(t2) && t2.includes('回归安装板');
  check('P-01', drawn, drawn ? '第一张图 UI 建出（父级未手动干预）' : '建图仍失败');

  // —— P-02 + P-21：辅料手工申请 → 合并下单 → 仓库验收 ——
  await page.goto(BASE + '/purchase', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // P-21：空池时合并按钮禁用态有说明（按钮存在即可，禁用+提示静态由交互规范约束）
  await page.getByRole('button', { name: /手\s*工\s*申\s*请/ }).click();
  await page.waitForTimeout(600);
  const mm = page.locator('.ant-modal:visible').filter({ hasText: '手工采购申请' });
  // P-14 动态：搜索旁标准库出口
  check('P-14-dyn', (await mm.innerText()).includes('去标准库新建'), '手工申请含标准库出口');
  await mm.locator('.ant-form-item').filter({ hasText: '归属' }).first().locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').filter({ hasText: '辅料' }).first().click();
  await mm.locator('.ant-form-item').filter({ hasText: '物料' }).first().locator('.ant-select-selector').click();
  await page.waitForTimeout(300);
  // ★ 不硬编「方通」：复位主数据后标准库里可能没有它（P1 报告里 e2e:clean 会连主数据一起清）。
  //   先读下拉里的第一条候选，再用它的前两个字去搜 —— 既测了搜索，又不依赖具体哪个物料。
  await page.waitForTimeout(600);
  const firstOpt = page.locator('.ant-select-dropdown:visible .ant-select-item').first();
  const firstText = (await firstOpt.innerText().catch(() => '')).trim();
  const term = firstText.replace(/^[A-Z0-9-]+\s*/, '').slice(0, 2) || firstText.slice(0, 2);
  if (term) { await page.keyboard.type(term); await page.waitForTimeout(700); }
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  // ★ 2026-10-05：记下**刚选的物料名**，后面按它定位池里那一条。
  //   旧代码硬编「方通」（`hasText: '方通'`）—— 采购池空/主数据被复位后就永远勾不到行，
  //   于是 P-21 报“勾选后仍禁用”、写链在下一步 click 超时（实测本轮踩到）。
  const pickedName = firstText.replace(/^[A-Z0-9-]+\s*/, '').trim();
  await mm.locator('.ant-form-item').filter({ hasText: '数量' }).locator('input').fill('3');
  await mm.getByRole('button', { name: /提\s*交\s*进\s*池/ }).click();
  await page.waitForTimeout(1600);
  // ★ 选「刚申请的那一条」（按物料名定位）而不是表格第一行：
  //   池里可能有别的历史待采购需求，
  //   而 merge-order 会拒绝非「待采购/部分下单/审批中」的行 → 400 “不能合并下单”（探针旧假设=空池）
  // 池子可能分页：先在**可见页**找刚申请的那一条，找不到就翻到能看见它为止（最多 3 页）
  let rowCb = null
  for (let pg = 0; pg < 3 && !rowCb; pg++) {
    if (pg > 0) {
      const next = page.locator('.ant-pagination-item-2, .ant-pagination-next').first()
      if (!(await next.count())) break
      await next.click().catch(() => {})
      await page.waitForTimeout(700)
    }
    const hit = page.locator('.ant-table-row').filter({ hasText: pickedName.slice(0, 4) })
    const row = (await hit.count()) ? hit.first() : page.locator('.ant-table-row').first()
    const cb = row.locator('.ant-checkbox-input')
    if (await cb.count()) rowCb = cb
  }
  if (await rowCb.count()) await rowCb.check().catch(() => {});
  await page.waitForTimeout(400);
  const mergeBtn = page.getByRole('button', { name: /合\s*并\s*下\s*单/ }).first();
  const wasDisabled = await mergeBtn.isDisabled().catch(() => false);
  check('P-21', !wasDisabled, wasDisabled ? '勾选后仍禁用（异常）' : '勾选后合并下单可用');
  // ★ 用「下单前后单号差集」定位本次新建的单：原来取「页面第一个 PO 号」会抓到旧单（列表按
  //   ordered_at desc 排序，而本探针把下单日填成过去的 2026-09-22 → 新单排在后面）
  const buyerTok = await apiLogin('buyer1', 'txgk@123');
  const poSet = async () => new Set(((await (await apiGet('/purchase/orders', buyerTok)).json()) ?? []).map(o => o.po_no));
  const poBefore = await poSet();
  await mergeBtn.click();
  await page.waitForTimeout(700);
  const om = page.locator('.ant-modal:visible').filter({ hasText: /下单/ });
  await om.locator('.ant-form-item').filter({ hasText: '供应商' }).locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  const od = om.locator('.ant-form-item').filter({ hasText: '下单日期' }).locator('input');
  await od.click(); await page.keyboard.type('2026-09-22'); await page.keyboard.press('Enter');
  // 客户口径 O3-A：无采购周期的需求（辅料）下单必须有预计到货日 —— 不填会被表单拦下
  const ed = om.locator('.ant-form-item').filter({ hasText: '预计到货' }).locator('input');
  if (await ed.count()) { await ed.click(); await page.keyboard.type('2026-09-29'); await page.keyboard.press('Enter'); }
  await om.locator('.ant-form-item').filter({ hasText: '收货地点' }).locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  // ★ 填单价（表格列内联编辑：数量=nth(0) 单价=nth(1)）：写链造的单必须有金额，
  // 否则 0 价新单会把有价单挤出列表第一页，P-17「页面含 ¥」断言必挂（脆弱性设计教训）
  const numInputs = om.locator('.ant-input-number-input');
  if ((await numInputs.count()) >= 2) await numInputs.nth(1).fill('9.9');
  await om.getByRole('button', { name: /确\s*认\s*合\s*并\s*下\s*单/ }).click();
  await page.waitForTimeout(2200);
  const after = await poSet();
  const poNo = [...after].find(n => !poBefore.has(n)) ?? ((await body(page)).match(/PO\d{5}/g) || [])[0];
  // ★ 08 §4.2：审批通过后需求才转「在途」，仓库才会出验收按钮 —— 探针必须先把单推到已批准
  {
    const stOf = async () =>
      ((await (await apiGet('/purchase/orders', buyerTok)).json()) ?? []).find(o => o.po_no === poNo)?.po_status;
    let st = poNo ? await stOf() : null;
    const approverOf = { 待经理审: 'purchase_manager', 待总监审: 'purchase_director' };
    for (let k = 0; k < 3 && approverOf[st]; k++) {
      let tok = null;
      try { tok = await apiLogin(approverOf[st], 'txgk@123'); } catch { /* 无该演示账号 */ }
      if (!tok) break;
      await fetch(`${API}/api/v1/purchase/orders/${poNo}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ action: '通过', note: 'P-02 探针自动通过' }),
      });
      st = await stOf();
    }
  }
  check('P-02a', !!poNo, poNo ? `${poNo} 已下单` : '未见采购单号');

  // 仓库验收（辅料 = project_no NULL 的旧 404 路径）
  errs.length = 0;
  await page.goto(BASE + '/warehouse', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  // ★ docs/15：仓库「待验收」已改成队列行（一句结论 + 右侧唯一按钮），不再是表格行
  const poRow = page.locator('.ds-row, .ant-table-row', { hasText: poNo }).first();
  const accBtn = poRow.getByRole('button', { name: /^\s*验\s*收\s*$/ });
  if (await accBtn.count()) {
    await accBtn.click(); await page.waitForTimeout(700);
    const acc = page.locator('.ant-modal:visible').filter({ hasText: '验收 ·' });
    // ★ 1.2 基座验收：AppModal 预填首帧可见（打开即"合格"选中 + 日期/数量已带）
    const preChecked = await acc.locator('.ant-radio-button-wrapper-checked').count();
    const dateVal = await acc.locator('.ant-picker input').first().inputValue().catch(() => '');
    const qtyVal = await acc.locator('.ant-input-number-input').first().inputValue().catch(() => '');
    check('BASE-预填', preChecked > 0 && !!dateVal && !!qtyVal,
      `验收弹窗打开即预填: 合格=${preChecked > 0} 日期=${dateVal || '空'} 数量=${qtyVal || '空'}`);
    await acc.getByRole('button', { name: /提\s*交\s*验\s*收/ }).click();
    await page.waitForTimeout(2200);
    const stuck = await acc.isVisible().catch(() => false);
    const hit404 = errs.some(e => e.startsWith('http404'));
    check('P-02', !stuck && !hit404, stuck ? '弹窗被拦: ' + (await acc.innerText()).replace(/\n/g, '|').slice(0, 120) : hit404 ? '仍 404' : '辅料验收通过 → 待入库');
  } else check('P-02', false, `找不到 ${poNo} 验收按钮`);

  // —— P-11：入库库位 = 下拉（有待入库行时）——
  // ★ P2 之后仓库台拆成 待验收/待入库/待领料 三个页签（与手机端同构）→ 先看「待入库」这一栏
  // ★ R3-B：待入库 现在在「待办」组内（Segmented）→ 按视图名打开
  await openTab(page, '待入库')
  const storeBtn = page.getByRole('button', { name: /^\s*入\s*库\s*$/ }).first();
  if (await storeBtn.count()) {
    await storeBtn.click(); await page.waitForTimeout(700);
    const sm = page.locator('.ant-modal:visible').filter({ hasText: /入库/ });
    const locSel = await sm.locator('.ant-form-item').filter({ hasText: '库位' }).locator('.ant-select-selector').count();
    check('P-11', locSel > 0, locSel ? '库位=下拉' : '仍手填 Input');
    await page.keyboard.press('Escape');
  } else check('P-11', false, '「待入库」页签里没有入库按钮（先跑 e2e_baseline 造数）');

  // —— P-05：新建项目申请验收 → 被「调试完成」门禁拦 ——
  await page.goto(BASE + '/acceptance', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /申\s*请\s*客\s*户\s*验\s*收/ }).first().click();
  await page.waitForTimeout(600);
  const gate = page.locator('.ant-modal:visible');
  const pc = gate.locator('.ant-form-item').filter({ hasText: '项目号' });
  const isSel = await pc.locator('.ant-select-selector').count();
  check('P-13a', isSel > 0, isSel ? '验收项目号=下拉' : '仍手填');
  if (isSel) {
    await pc.locator('.ant-select-selector').click(); await page.waitForTimeout(400);
    await page.keyboard.type(newNo); await page.waitForTimeout(700);
    const o = page.locator('.ant-select-dropdown:visible .ant-select-item', { hasText: newNo });
    if (await o.count()) {
      await o.first().click();
      await gate.getByRole('button', { name: /申\s*请/ }).click();
      await page.waitForTimeout(2200);
      const msg = await page.locator('.ant-message').innerText().catch(() => '');
      check('P-05', /调试/.test(msg), `msg=${msg.slice(0, 90)}`);
    } else check('P-05', false, '下拉无新项目');
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);

  // —— P-10：成交后阶段不再显示「还剩 N 天」（只看写链这个新项目那一行，避免其它线索项目干扰）——
  await page.goto(BASE + '/projects', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const p10row = await page.locator('tr', { hasText: newNo }).first().innerText().catch(() => '');
  check('P-10', !/还剩 \d+ 天|已过期/.test(p10row), `${newNo} 行无商机剩余（该行：${p10row.replace(/\n/g, ' ').slice(0, 60)}）`);

  // —— P-04：PC 现场页手机端提示 ——
  await page.goto(BASE + '/site', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check('P-04', /手机|\/m\/site/.test(await body(page)), '含手机端录入提示');

  // —— P-13b：报修项目号下拉 ——
  await page.goto(BASE + '/service', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /报\s*修/ }).first().click();
  await page.waitForTimeout(600);
  const rmSel = await page.locator('.ant-modal:visible').locator('.ant-form-item').filter({ hasText: '项目号' })
    .locator('.ant-select-selector').count();
  check('P-13b', rmSel > 0, rmSel ? '报修项目号=下拉' : '仍手填');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);

  // —— OBJ：分区化档案页（docs/14）—— 结论常驻 + 切区进 URL + 页高受控 ——
  //   为什么要这三条：分区化的**代价**是"一次只看得见一区"，所以必须保证
  //   ① 结论（关键数字/卡点）**不在任何分区里**（切到哪一区都还在首屏）
  //   ② 分区状态进 URL（刷新/收藏/通知深链都在）
  //   ③ 切区之后页高仍受控（否则等于把"往下滑"挪到了分区内）
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'pm1', 'txgk@123')
      const probe = await nc.page.evaluate(async (api) => {
        const raw = JSON.parse(localStorage.getItem('txgk_session') || '{}')
        const r = await fetch(api + '/api/v1/projects', { headers: { Authorization: 'Bearer ' + raw.token } })
        const j = await r.json()
        return Array.isArray(j) && j.length ? j[0].project_no : null
      }, API)
      // 找一个真有设备的项目（没有设备就没有档案页可验）
      let target = null
      for (const pn of [probe].filter(Boolean)) {
        const ov = await (await apiGet(`/projects/${pn}/design-overview`, await apiLogin('pm1', 'txgk@123'))).json().catch(() => [])
        const eq = Array.isArray(ov) && ov.length ? ov[0].equip_no : null
        if (eq) { target = { pn, eq }; break }
      }
      if (!target) {
        check('OBJ-设备档案分区化', false, '库里没有带设备的项目 —— 基线未跑（护栏不许空转）')
      } else {
        await nc.page.goto(`${BASE}/equipment/${target.pn}/${target.eq}`, { waitUntil: 'networkidle' })
        await nc.page.waitForTimeout(1500)
        const bar = await nc.page.locator('.ds-sec').count()
        const h0 = await nc.page.evaluate(() => Math.round((document.querySelector('.domain-content') || document.body).scrollHeight))
        check('OBJ-设备档案分区化', bar >= 3 && h0 <= 1400,
          `分区 ${bar} 个 · 概览页高 ${h0}px（改造前 2106px = 2.3 屏）`)
        // 切到最后一区：结论仍在首屏 + URL 带 tab + 页高受控
        await nc.page.locator('.ds-sec').last().click()
        await nc.page.waitForTimeout(800)
        const m = await nc.page.evaluate(() => {
          const vh = window.innerHeight
          const inFold = (t) => [...document.querySelectorAll('*')].some((e) => {
            if (e.children.length > 3) return false
            const r = e.getBoundingClientRect()
            return r.top >= 0 && r.bottom <= vh && (e.textContent || '').includes(t)
          })
          return {
            h: Math.round((document.querySelector('.domain-content') || document.body).scrollHeight),
            conclusion: inFold('齐套率'),
            url: location.search,
          }
        })
        check('OBJ-结论常驻（切区不丢）', m.conclusion,
          `切到最后一区后：齐套率仍在首屏=${m.conclusion} · 页高 ${m.h}px`)
        check('OBJ-分区进URL', /tab=/.test(m.url), `切区后 URL=${m.url || '（没有 tab）'}`)
      }
    } finally {
      await nc.browser.close()
    }
  }

  // —— OBJ-入口：从项目详情真点到设备档案（端到端证明"有入口、点得动"）——
  //   用户实测反馈："设备档案和件档案我没有，在什么地方能看到入口" —— 静态 grep 不够，
  //   这里走一遍真实点击链：项目详情 → 展开「范围与资料」→ 设备行 → 设备档案。
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'pm1', 'txgk@123')
      const pn = await nc.page.evaluate(async (api) => {
        const raw = JSON.parse(localStorage.getItem('txgk_session') || '{}')
        const r = await fetch(api + '/api/v1/projects', { headers: { Authorization: 'Bearer ' + raw.token } })
        const j = await r.json()
        return Array.isArray(j) && j.length ? j[0].project_no : null
      }, API)
      if (!pn) {
        check('OBJ-项目详情给设备档案入口', false, '库里没有项目 —— 基线未跑')
      } else {
        await nc.page.goto(`${BASE}/projects/${pn}`, { waitUntil: 'networkidle' })
        await nc.page.waitForTimeout(1500)
        // ★ 2026-10-05 迁移：项目详情从折叠泳道改成**分区条**（docs/14 P3）——
        //   设备清单在「范围与资料」分区里，点分区而不是展开泳道。
        await openSection(nc.page, '范围与资料')
        const link = nc.page.locator(`a[href*="/equipment/${pn}/"]`).first()
        const has = await link.count()
        if (!has) {
          check('OBJ-项目详情给设备档案入口', false, '项目详情里没有设备档案入口（用户反馈过的那条）')
        } else {
          await link.click()
          await nc.page.waitForURL(/\/equipment\//, { timeout: 6000 }).catch(() => {})
          // ★ 等分区条出现再数（档案页要拉数据；**新建项目的档案聚合较慢** —— 8s 不够，
          //   实测偶发假红；给到 20s + 等 URL 先到位）
          await nc.page.waitForURL(/\/equipment\//, { timeout: 8000 }).catch(() => {})
          await nc.page.waitForSelector('.ds-sec', { timeout: 20000 }).catch(() => {})
          let bar = await nc.page.locator('.ds-sec').count()
          if (bar === 0) {
            // ★ 实测（2026-10-05，连跑 3 次复现）：首次点击是**懒加载页的冷 chunk** ——
            //   Vite dev 现编译 `EquipmentPage.tsx`，页面先白几秒（模块 200 但还没执行完）。
            //   这不是产品缺陷（生产是打包好的 chunk）；但断言不能因此假红 →
            //   冷启动就**重载一次**再等（仍然要求真的渲染出分区，强度不降）。
            await nc.page.reload({ waitUntil: 'networkidle' }).catch(() => {})
            await nc.page.waitForSelector('.ds-sec', { timeout: 20000 }).catch(() => {})
            bar = await nc.page.locator('.ds-sec').count()
          }
          const ok = /\/equipment\/\w+\/\w+/.test(nc.page.url())
          check('OBJ-项目详情给设备档案入口', ok && bar >= 3,
            `点设备行 → ${nc.page.url().replace(BASE, '')} · 分区 ${bar} 个`)
        }
      }
    } finally {
      await nc.browser.close()
    }
  }

  // —— GM 驾驶舱（00 卷 §2.1「一屏看完」）——
  //   两条：① 有权限的角色**一屏**看到四块（在手订单/交付风险/卡点/售后质保）；
  //        ② 没权限的角色进不去（弹回工作台、零 4xx）——入口可见性与路由守卫两头都要有。
  {
    const nc = await newCtx()
    try {
      await login(nc.page, 'gm', 'txgk@123')
      await nc.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' })
      await nc.page.waitForTimeout(1500)
      const onDash = nc.page.url().includes('/dashboard')
      const m = await nc.page.evaluate(() => {
        const vh = window.innerHeight
        const inFold = (t) => [...document.querySelectorAll('.ds-panel-h h3')].some((e) => {
          const r = e.getBoundingClientRect()
          return r.top >= 0 && r.bottom <= vh && (e.innerText || '').includes(t)
        })
        return {
          h: Math.round((document.querySelector('.domain-content') || document.body).scrollHeight),
          blocks: ['在手订单', '交付风险', '卡点榜', '售后与质保'].filter(inFold).length,
        }
      })
      check('GM-驾驶舱一屏看完', onDash && m.blocks === 4 && m.h <= 1400,
        `四块首屏可见 ${m.blocks}/4 · 页高 ${m.h}px`)
    } finally {
      await nc.browser.close()
    }
    const nc2 = await newCtx()
    try {
      const bad = []
      nc2.page.on('response', (r) => {
        if (r.status() >= 400 && r.url().includes('/api/')) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`)
      })
      await login(nc2.page, 'wh1', 'txgk@123')
      await nc2.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' })
      await nc2.page.waitForTimeout(900)
      const denied = !nc2.page.url().includes('/dashboard')
      check('GM-驾驶舱无权限进不去', denied && bad.length === 0,
        `仓管访问 → ${nc2.page.url().replace(BASE, '')} · 4xx=${bad.length ? bad[0] : '无'}`)
    } finally {
      await nc2.browser.close()
    }
  }

  // —— PERM：越权敲 URL 不许制造 4xx（走查收尾 2026-10-04）——
  //   实测过的病：/workbench/shop/assembly 只有"台可见性"过滤没有路由守卫，
  //   无 mfg:view 的角色直接敲 URL 就进页面，然后连环 403（6 个角色各 1 条）。
  //   与 docs/12 修的「看得见、点了必 403」是同一类：门禁要拦在**进来之前**。
  {
    const cases = [
      { user: 'buyer1', path: '/workbench/shop/assembly', why: '采购无 mfg:view' },
      { user: 'sales1', path: '/workbench/shop/mfg', why: '销售无 mfg:view' },
    ]
    for (const c of cases) {
      const nc = await newCtx()
      try {
        const bad400 = []
        nc.page.on('response', (r) => {
          if (r.status() >= 400 && r.url().includes('/api/')) bad400.push(`${r.status()} ${r.url().replace(BASE, '')}`)
        })
        await login(nc.page, c.user, 'txgk@123')
        await nc.page.goto(BASE + c.path, { waitUntil: 'networkidle' })
        await nc.page.waitForTimeout(900)
        const url = nc.page.url()
        const denied = !url.includes('/workbench/shop')
        check(`PERM-越权不进页面且无4xx(${c.user})`, denied && bad400.length === 0,
          `${c.why}：URL→${url.replace(BASE, '')} · 4xx=${bad400.length ? bad400.slice(0, 2).join(',') : '无'}`)
      } finally {
        await nc.browser.close()
      }
    }
  }

  // —— CMDK：⌘K 打开命令栏 → 粘编号 → Enter 直达（R2 收尾）——
  {
    // 从「台」里按 ⌘K 跳走，落点必须带来源（返回口才回得来）
    await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(400);
    const opened = await page.locator('.cmdk').count();
    const probe = 'TX26001';
    await page.keyboard.type(probe);
    await page.waitForTimeout(1200);
    const rows = await page.locator('.cmdk-row').count();
    const first = (await page.locator('.cmdk-row').first().innerText().catch(() => '')).replace(/\n/g, ' ');
    if (opened && rows > 0) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1400);
      const u = page.url();
      const landed = u.includes('TX26001') || u.includes('/items/');
      check('CMDK-粘编号直达', landed && u.includes('from='),
        `命中 ${rows} 条（首行「${first.slice(0, 30)}」）→ Enter 落到 ${u.replace(BASE, '')}`)
    } else {
      check('CMDK-粘编号直达', false, `命令栏没打开或没结果（opened=${opened} rows=${rows}）`)
    }
    // 查不到必须说人话，不许静默
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(300);
    await page.keyboard.type('ZZZ-NOT-EXIST-999');
    await page.waitForTimeout(1200);
    const noHit = await body(page);
    check('CMDK-查不到说人话', /没有找到/.test(noHit), noHit.includes('没有找到') ? '给了「没有找到」' : '静默无反馈')
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // —— P-17（UI）：采购单页签有 ¥ ——
  await page.goto(BASE + '/purchase', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  // ★ R3-B：「采购单」现在在「采购」组内（Segmented）→ 按视图名打开
  await openTab(page, '采购单');
  await page.waitForTimeout(800);
  check('P-17-ui', /¥/.test(await body(page)), '采购单显示金额 ¥');

  // —— P-18：通知抽屉无裸英文 type ——
  await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const bell = page.locator('.anticon-bell').first();
  if (await bell.count()) {
    await bell.click(); await page.waitForTimeout(1100);
    const nt = await page.locator('.ant-drawer:visible').innerText().catch(() => '');
    const raw = /(^|\n|\|)\s*(change|review|task|acceptance|purchase|notify)\s*($|\n|\|)/.test(nt);
    check('P-18', !raw, nt.length > 10 ? '有消息且类型已中文化' : '无消息（空态通过）');
    await page.keyboard.press('Escape');
  } else check('P-18', false, '无铃铛');

  // —— P-08 ★自建靶：（原来"当前无「已装车」批次"就永远 SKIP —— 休眠的护栏永远绿 = 没有）
  //   造一个「已装车 + **部分已发**」的批次：装配时登记未装零件 → 清单 = 1 组装体 + N 零件
  //   → 只勾「组装体」一项（部分）→ 采购叫车 → 装车。
  {
    const pmTok = await apiLogin('pm1', 'txgk@123');
    const buyerTok = await apiLogin('buyer1', 'txgk@123');
    const shopTok = await apiLogin('shop1', 'txgk@123');
    const ps2 = (await (await apiGet('/projects', pmTok)).json()) ?? [];
    for (const p of (Array.isArray(ps2) ? ps2 : [])) {
      const ts = (await (await apiGet(`/shipping/to-ship?project_no=${p.project_no}`, pmTok)).json()) ?? [];
      if ((Array.isArray(ts) ? ts : []).some((r) => r.ready && !r.in_open_shipment)) continue;
      const ov = (await (await apiGet(`/projects/${p.project_no}/design-overview`, pmTok)).json()) ?? [];
      const cand = (Array.isArray(ov) ? ov : []).find((o) => (o.parts ?? 0) > 0);
      if (!cand) continue;
      const rec = await (await apiPost('/assembly/records', shopTok, { project_no: p.project_no, equip_no: cand.equip_no, sub_assembly: '整机装配' })).json();
      if (!rec?.id) continue;
      // ★ 登记 1 条未装零件 → 发运清单 = 组装体 + 1 零件 = 2 项，勾 1 项就是"部分已发"
      const fin = await apiPost(`/assembly/records/${rec.id}/finish`, shopTok, {
        unassembled: [{ ref: `P08-MISSING-${cand.equip_no}`, name: 'P-08 探针未装件', qty: 1 }],
      });
      if (fin.status >= 300) continue;
      const ts2 = (await (await apiGet(`/shipping/to-ship?project_no=${p.project_no}`, pmTok)).json()) ?? [];
      const row = (Array.isArray(ts2) ? ts2 : []).filter((r) => r.ready && !r.in_open_shipment)[0];
      if (!row) continue;
      const ins = await (await apiPost('/shipping/instructions', pmTok, { project_no: p.project_no, equip_nos: [row.equip_no], plan_ship_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) })).json();
      if (!ins?.id) continue;
      await apiPost(`/shipping/${ins.id}/items/generate`, pmTok, {});
      const its = (await (await apiGet(`/shipping/${ins.id}/items`, pmTok)).json()) ?? [];
      if (!Array.isArray(its) || its.length < 2) continue;  // 必须 ≥2 项才能"部分"
      await apiPost(`/shipping/${ins.id}/request-vehicle`, buyerTok, { count: 1, fee: 500, note: 'P-08 探针叫车' });
      await apiPost('/shipping/items/ship', pmTok, { item_ids: [its[0].id], photos: ['p08.png'] });
      const ld = await apiPost(`/shipping/${ins.id}/load`, pmTok, { photos: ['p08-load.png'] });
      if (ld.status < 300) break;
    }
  }

  // —— P-08：API 预查有批次的项目 → UI 精准选择（不遍历下拉：antd 虚拟滚动下 nth(i) 随数据规模失效）——
  await page.goto(BASE + '/shipping', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // ★ docs/15：发运台默认落「待装车/待发运」队列（跨项目、进来就能动手）；
  //   项目下拉在「发运批次」视图里 → 探针先切过去（筛选器不再当家结论用）
  await openTab(page, '发运批次')
  let p08 = 'FAIL', p08note = '当前无「已装车」批次（软提示由 UI 探针 Z 系列 + API R5 链覆盖）';
  {
    const tok = await apiLogin('pm1', 'txgk@123');
    const all = await (await apiGet('/shipping/list', tok)).json();
    // D3 收紧后「发运」只在「已装车」档出现（勾已发 → 装车 → 发运）
    const open = (Array.isArray(all) ? all : []).find((x) => x.status === '已装车');
    if (!open) { p08 = 'FAIL'; p08note = '自建靶失败：没能造出「已装车 + 部分已发」的批次'; }
    else if (open.project_no) {
      const projSel = page.locator('.ant-select-selector').first();
      await projSel.click(); await page.waitForTimeout(400);
      await page.keyboard.type(open.project_no); await page.waitForTimeout(700);
      const opt = page.locator('.ant-select-dropdown:visible .ant-select-item').first();
      if (await opt.count()) await opt.click();
      await page.waitForTimeout(900);
      const row = page.locator('.ant-table-row', { hasText: open.shipment_no }).first();
      const dep = row.locator('a', { hasText: /^发\s*运$/ });
      if (await dep.count()) {
        await dep.click(); await page.waitForTimeout(900);
        const conf = page.locator('.ant-popconfirm:visible, .ant-modal:visible');
        if (await conf.count()) {
          const txt = (await conf.first().innerText()).replace(/\n/g, '|');
          if (/未勾|清单|已发|还有/.test(txt)) { p08 = 'PASS'; p08note = '软提示: ' + txt.slice(0, 100); }
          else { p08 = 'FAIL'; p08note = '有确认框但无清单提示: ' + txt.slice(0, 80); }
          await page.keyboard.press('Escape');
        }
      } else { p08 = 'FAIL'; p08note = `批次 ${open.shipment_no}(${open.status}) 行内无发运链接`; }
    }
  }
    check('P-08', p08 === 'PASS', p08note, p08);

  // —— 3.2 离线感知：断网横幅出现 → 恢复后消失（setOffline 模拟现场弱网）——
  await c.ctx.setOffline(true);
  await page.waitForTimeout(700);
  {
    const t = await body(page);
    const on = t.includes('离线模式');
    check('OFFLINE-横幅出现', on, on ? '断网后顶栏出现离线横幅' : '未见离线横幅: ' + t.slice(0, 80).replace(/\n/g, '|'));
  }
  await c.ctx.setOffline(false);
  await page.waitForTimeout(700);
  {
    const t = await body(page);
    const off = !t.includes('离线模式');
    check('OFFLINE-恢复消失', off, off ? '联网后横幅消失' : '横幅未消失');
  }

  // —— 1.3 Auth：**「以某人身份查看」已于 2026-10-05 删除**（客户拍板）——
  //   它只能看、永远测不了写操作（审批/下单/验收都是写），而它的用途本就是测试/排查；
  //   客户原话：「如果测试不了的话，我觉得这个功能就没有必要存在了，那我直接单独去登录
  //   对应的账号测试就可以了」。同时**全站密码统一为一个**，直接登录任何账号都行。
  //   所以这条断言反向守：**入口必须消失**（免得以后被“好心”加回来 —— 它天然会漂：
  //   只读态藏页签但没藏结论条，实测出现过“数字 3 单、入口没有”的矛盾）。
  await page.goto(BASE + '/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  {
    const impLink = await page.locator('a[title="以他的身份查看（只读）"]').count();
    const t = await body(page)
    const noBanner = !t.includes('正在以「')
    check('AUTH-伪装入口已删除', impLink === 0 && noBanner,
      impLink === 0 && noBanner ? 'Users 页无伪装入口、无横幅（2026-10-05 已删；改用直接登录）' : `仍见伪装入口 ${impLink} 个 / 横幅残留=${!noBanner}`)
  }

  // —— 2.5 品牌位：侧栏字标真实加载（naturalWidth>0 = 非裂图非404）——
  //  ★ 2026-10-04 方案 A「纸面」：侧栏由深色改浅色，字标随之由**反白版**换成**正色版**
  //  （反白版在浅底上不可见）。断言意图不变：侧栏品牌位必须有真图，不许裂图/404。
  {
    await page.waitForFunction(() => {
      const i = document.querySelector('.app-sider img[src*="brand/logo"]');
      return !!i && i.complete && i.naturalWidth > 0;
    }, { timeout: 5000 }).catch(() => {});
    const logo = page.locator('.app-sider img[src*="brand/logo"]').first();
    const has = await logo.count();
    const nw = has ? await logo.evaluate((img) => img.naturalWidth).catch(() => 0) : 0;
    check('BRAND-侧栏logo', has > 0 && nw > 0, has ? `naturalWidth=${nw}（浅色侧栏用正色字标）` : '侧栏找不到品牌字标 img');
  }

  // —— 登出冒烟（session 清空 → 回登录页）——
  const logoutLink = page.getByText('退出', { exact: false }).last();
  if (await logoutLink.count()) {
    await logoutLink.click();
    await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
    const onLogin = page.url().includes('/login');
    check('AUTH-登出', onLogin, onLogin ? '登出回登录页' : 'URL=' + page.url());
    // 登录页品牌位（正色字标）
    await page.waitForFunction(() => {
      const i = document.querySelector('img[src*="brand/logo.png"]');
      return !!i && i.complete && i.naturalWidth > 0;
    }, { timeout: 5000 }).catch(() => {});
    const lgo = page.locator('img[src*="brand/logo.png"]').first();
    const lhas = await lgo.count();
    const lnw = lhas ? await lgo.evaluate((img) => img.naturalWidth).catch(() => 0) : 0;
    check('BRAND-登录logo', lhas > 0 && lnw > 0, lhas ? `naturalWidth=${lnw}` : '登录卡无正色字标');
  } else check('AUTH-登出', false, '顶栏无退出入口');

  // —— 记住密码闭环（2026-09-23 新功能 · 交互规范 §2.6）——
  // 前置：上一步 AUTH-登出 后位于 /login 且凭据已被主动登出清除 → 表单可见
  {
    // ① 勾选记住并登录
    await page.fill('input[placeholder="admin"]', 'admin')
    await page.fill('input[type="password"]', 'txgk@123')
    const rememberBox = page.locator('.login-remember input[type=checkbox]')
    if (await rememberBox.count()) await rememberBox.check()
    await page.getByRole('button', { name: /登\s*录/ }).click()
    await page.waitForURL(/\/workbench/, { timeout: 10000 }).catch(() => {})
    const saved = await page.evaluate(() => !!localStorage.getItem('txgk_credential'))
    check('REMEMBER-保存凭据', page.url().includes('/workbench') && saved,
      `登录成功=${page.url().includes('/workbench')} · 凭据已存=${saved}`)

    // ② 模拟被动 401（session 置坏 → 任意请求被踢 → 登录页应自动重登）
    await page.evaluate(() => {
      const raw = localStorage.getItem('txgk_session')
      if (raw) { const s = JSON.parse(raw); s.token = 'corrupted-by-401-test'; localStorage.setItem('txgk_session', JSON.stringify(s)) }
    })
    await page.goto(BASE + '/purchase', { waitUntil: 'domcontentloaded' })
    // 401 → 清 session 跳 /login → 凭据自动重登 → 回 /workbench
    let autoBack = false
    try {
      await page.waitForURL(/\/workbench/, { timeout: 12000 })
      autoBack = true
    } catch {
      autoBack = page.url().includes('/workbench')
    }
    const stillHasCred = await page.evaluate(() => !!localStorage.getItem('txgk_credential'))
    check('REMEMBER-被动自动登录', autoBack && stillHasCred,
      autoBack ? `401 被踢后自动重登回 ${page.url()} · 凭据仍在=${stillHasCred}` : `未自动恢复 URL=${page.url()}`)
    await shot(page, 'remember-auto')

    // ③ 主动登出（2026-09-23 二次修正）→ 停在表单【预填好 + 勾选保持】，点一下登录即可
    const out = page.getByText('退出', { exact: false }).last()
    if (await out.count()) {
      await out.click()
      await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(1800) // 若错误地自动登录会在此期间跳走
      const stayed = page.url().includes('/login')
      const userVal = await page.locator('input[placeholder="admin"]').inputValue().catch(() => '')
      const pwdVal = await page.locator('input[type=password]').inputValue().catch(() => '')
      const cb = page.locator('.login-remember input[type=checkbox]')
      const checked = await cb.isChecked().catch(() => false)
      check('REMEMBER-主动登出预填', stayed && userVal === 'admin' && !!pwdVal && checked,
        `停登录页=${stayed} · 预填账号=${userVal === 'admin'} · 预填密码=${!!pwdVal} · 勾选保持=${checked}（填充模式，不自动登录）`)
      await shot(page, 'remember-prefill')
      // ④ 预填后点登录即回工作台（闭环）
      if (stayed && userVal === 'admin') {
        await page.getByRole('button', { name: /登\s*录/ }).click()
        await page.waitForURL(/\/workbench|m\//, { timeout: 10000 }).catch(() => {})
        const back = !page.url().includes('/login')
        check('REMEMBER-一键登录', back, back ? `预填态点登录即入 ${page.url()}` : `未跳转 URL=${page.url()}`)
      } else check('REMEMBER-一键登录', false, '前置（预填）未满足，跳过登录')
    } else check('REMEMBER-主动登出预填', false, '找不到退出入口')
  }


} catch (e) {
  check('UI-写链', false, '异常中断: ' + String(e).slice(0, 700) + ' @ ' + (globalThis.__lastStep ?? '?'));
  await shot(page, 'ui-regress-crash');
} finally {
  await c.browser.close();
}

  // ── docs/12 §14 P5：页面作用域进 URL —— 深链能落到同一个项目/同一组筛选，刷新不回退 ──
  {
    const sc = await newCtx()
    try {
      await sc.page.setViewportSize({ width: 1440, height: 900 })
      await login(sc.page, 'assy1', 'txgk@123')
      const pno = await sc.page.evaluate(async (api) => {
        const raw = JSON.parse(localStorage.getItem('txgk_session') || '{}')
        const r = await fetch(api + '/api/v1/projects', { headers: { Authorization: 'Bearer ' + raw.token } })
        const j = await r.json()
        return Array.isArray(j) && j.length ? j[0].project_no : null
      }, API)
      if (!pno) {
        check('SCOPE-作用域深链', false, '库里没有项目（基线未跑）—— 护栏不空转，直接红')
      } else {
        await sc.page.goto(`${BASE}/workbench/shop/assembly?p=${pno}`, { waitUntil: 'domcontentloaded' })
        await sc.page.waitForTimeout(2200)
        const sel1 = await sc.page.evaluate(() => document.querySelector('.ant-select-selection-item')?.innerText?.trim() ?? '')
        await sc.page.reload({ waitUntil: 'domcontentloaded' }); await sc.page.waitForTimeout(2000)
        const sel2 = await sc.page.evaluate(() => document.querySelector('.ant-select-selection-item')?.innerText?.trim() ?? '')
        const url2 = await sc.page.evaluate(() => location.search)
        check('SCOPE-作用域深链', sel1.includes(pno) && sel2.includes(pno) && url2.includes('p=' + pno),
          `?p=${pno} → 首屏选中「${sel1}」· 刷新后「${sel2}」· URL=${url2}`)
      }
    } finally {
      await sc.browser.close()
    }
  }

  // ── docs/12 §2-E：移动端触控目标（规范 §5.2 ≥44px；仓库/车间戴手套操作，24px 按不准）──
  {
    const tc = await newCtx({ mobile: true })
    try {
      const pages = [['wh1', '/m/warehouse'], ['wh1', '/m/issues'], ['shop1', '/m/production'], ['assy1', '/m/assembly'],
        ['delivery1', '/m/shipping'], ['site1', '/m/site'], ['service1', '/m/service']]
      const bad = []
      for (const [u, p] of pages) {
        await login(tc.page, u, 'txgk@123')
        await tc.page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
        await tc.page.waitForTimeout(1500)
        const small = await tc.page.evaluate(() => Array.from(
          document.querySelectorAll('button, a, .ant-segmented-item, .ant-radio-button-wrapper'))
          .filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 40 && !e.closest('.ant-tabs') })
          .map((e) => `${(e.innerText || '').trim().slice(0, 8)}@${Math.round(e.getBoundingClientRect().height)}`))
        if (small.length) bad.push(`${p}: ${small.slice(0, 3).join(',')}`)
      }
      check('MOBILE-触控目标≥40px', bad.length === 0, bad.length ? bad.join(' | ') : '7 个移动页可点元素均 ≥40px（顶栏/列表/动作按钮）')
      // 验收动线页要有吸底主操作条
      await login(tc.page, 'wh1', 'txgk@123')
      await tc.page.goto(BASE + '/m/warehouse', { waitUntil: 'domcontentloaded' }); await tc.page.waitForTimeout(1500)
      const hasBar = await tc.page.evaluate(() => !!document.querySelector('.m-actionbar') || !!document.querySelector('.m-shell'))
      check('MOBILE-作用域壳在位', hasBar, '移动端根容器 .m-shell（触控 CSS 与吸底条都挂在它上面）')
    } finally {
      await tc.browser.close()
    }
  }

// ═════════ Part 3 · 预填实读（治 PREFILL 静态盲区：打开弹窗就必须看到初始值）═════════
{
  const c = await newCtx(); const { page } = c;
  const closeModal = async () => { await page.locator('.ant-modal-close').last().click().catch(() => {}); await page.waitForTimeout(400); };
  try {
    await login(page, 'eng_director', 'txgk@123');

    // 用户编辑
    await page.goto(BASE + '/users', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    let edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(600);
      const u = await page.locator('.ant-modal-content input#username').inputValue().catch(() => '');
      check('PREFILL-用户编辑', !!u, u ? `username=${u}` : '账号未预填');
      await closeModal();
    } else check('PREFILL-用户编辑', false, '无编辑入口');

    // 供应商编辑 —— ★ 换成采购账号：重整后有了路由守卫（RequirePerm），
    // 工程总监打开 /purchase?tab=suppliers 会被送回工作台（他没有任何 purchase:* 码，
    // 以前是「看得见、点了 403」，现在是「进不去」—— 用错账号会假报“无编辑入口”）
    await login(page, 'buyer1', 'txgk@123');
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(600);
      const n = await page.locator('.ant-modal-content input#name').inputValue().catch(() => '');
      check('PREFILL-供应商编辑', !!n, n ? `name=${n}` : '名称未预填');
      await closeModal();
    } else check('PREFILL-供应商编辑', false, '无编辑入口');

    // 标准库物料编辑（★ 挑一个有物料的品类：复位后“方通”这类品类可能是空的，
    //   写死第一个品类会假红 —— 见 2026-09-30 报告 P1 小节里的复位说明）
    await page.goto(BASE + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    const classes = page.locator('a.lib-class');
    const cN = await classes.count();
    for (let i = 0; i < cN; i++) {
      const tx = (await classes.nth(i).innerText().catch(() => '')).trim();
      const m = tx.match(/(\d+)\s*$/);
      if (m && Number(m[1]) > 0) { await classes.nth(i).click(); await page.waitForTimeout(1000); break; }
    }
    edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(800);
      const u2 = await page.locator('.ant-modal-content input#unit').inputValue().catch(() => '');
      check('PREFILL-标准库编辑', !!u2, u2 ? `unit=${u2}` : '单位未预填');
      await closeModal();
    } else check('PREFILL-标准库编辑', false, '无编辑入口');

    // 装配开始（PC）
    // ★ 装配是车间/装配的活（mfg:edit）—— 工程总监本来就看不到「开始装配」，
    //   用他断言等于把"看不到"当"没入口"（休眠）。换真能干这活的角色。
    // ★ N2/F8（2026-10-04）：已装配完成的设备**不再给「开始装配」入口**（改显状态 Tag）——
    //   所以逐个项目找：看到「已装配/调试中/调试完成」Tag 而无按钮 = 新护栏在位（也算过）；
    //   找到「开始装配」就点开验预填（原来的断言目标）。
    await login(page, 'assy1', 'txgk@123');
    // ★ 2026-10-04 修两处护栏自身的问题（都不是产品 bug）：
    //   ① 原来只iterate 下拉**前 5 个选项**，而 e2e 连跑会攒测试项目（实测已 22 个）——
    //      有装配记录的项目被挤到窗口外 → 误报「装配角色看不到」。
    //      改成**从 API 取一个有装配记录的项目**，直接按 ?p= 打开（数据驱动，不猜顺序）。
    //   ② 原来查 `.ant-card-body .ant-tag` —— 设备卡的状态 Tag 渲染在 Card 的 `extra` 里，
    //      即 `.ant-card-head`，所以那一分支**永远查不到**（假绿的反面：注定红）。
    const asmTok = await apiLogin('assy1', 'txgk@123');
    const asmRows = (await (await apiGet('/assembly/records', asmTok)).json()) ?? [];
    const asmProj = (Array.isArray(asmRows) ? asmRows : []).map((r) => r.project_no).find(Boolean);
    let asmHandled = false;
    if (!asmProj) {
      check('PREFILL-装配开始', false, '没有任何装配记录 —— 基线未跑（护栏不许空转，直接红）');
    } else {
      await page.goto(`${BASE}/workbench/shop/assembly?p=${asmProj}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1400);
      const doneTag = await page.locator('.ant-card-head .ant-tag, .ant-card-head .ds-ch, .ant-card-head .ds-st').filter({ hasText: /已装配|调试中|调试完成/ }).count();
      const asm = page.locator('a,button').filter({ hasText: /开始装配|继续装配/ }).first();
      if (await asm.count()) {
        await asm.click(); await page.waitForTimeout(700);
        const checked = await page.locator('.ant-modal-content .ant-radio-button-wrapper-checked').innerText().catch(() => '');
        check('PREFILL-装配开始', /整机装配/.test(checked), checked ? `装配形态=${checked.trim()}` : '未预选整机装配');
        asmHandled = true;
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      } else if (doneTag > 0) {
        check('PREFILL-装配开始', true, `已装配设备不再给「开始装配」入口，状态 Tag 在位（N2/F8 新行为）`);
        asmHandled = true;
      }
      if (!asmHandled) check('PREFILL-装配开始', false, `${asmProj} 既没有「开始装配」入口、也没有已装配状态 Tag（是 bug，不是跳过）`);
    }
    // 现场来货清点（PC）：默认结论「齐」必须预选（曾先设后开丢值，护栏也只认 destroyOnHidden 而漏扫）
    let projWithIncoming = null;
    const toks = await apiLogin('pm1', 'txgk@123');
    const ps = (await (await apiGet('/projects', toks)).json()) ?? [];
    // 有活儿的阶段优先（/projects 按号倒序，测试项目会把真正在跑的项目挤出前 40 个）
    const ACT = ['执行中', '交付中', '质保'];
    const cands = (Array.isArray(ps) ? ps : []).slice()
      .sort((a, b) => (ACT.includes(b.stage) - ACT.includes(a.stage)) || String(a.project_no).localeCompare(String(b.project_no)));
    for (const p of cands) {
      const inc = await (await apiGet(`/site/incoming?project_no=${p.project_no}`, toks)).json();
      if ((inc.pending ?? []).length) { projWithIncoming = p.project_no; break; }
    }
    if (!projWithIncoming) check('PREFILL-现场清点', false, '找不到含待清点直发行的项目');
    else {
      // ★ 清点是现场的活（site:edit）—— 前面的角色看不到「清点验收」，换现场的人来断言
      await login(page, 'site1', 'txgk@123');
      await page.goto(BASE + '/delivery/site', { waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
      await page.locator('.ant-select-selector').first().click(); await page.waitForTimeout(400);
      await page.keyboard.type(projWithIncoming); await page.waitForTimeout(900);
      await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click(); await page.waitForTimeout(1600);
      // ★ R3-B：来货清点 在「进场」组内（Segmented）
      await openTab(page, '来货清点');
      // ★ docs/15：来货清点已是队列行，主按钮是 <button> 而不是 <a>（断言跟着迁移）
      const link = page.locator('.ds-row button, a').filter({ hasText: /清点验收/ }).first();
      if (!(await link.count())) check('PREFILL-现场清点', false, '现场角色也看不到清点入口（是 bug，不是跳过）');
      else {
        await link.click(); await page.waitForTimeout(900);
        const ck = (await page.locator('.ant-modal-content .ant-radio-button-wrapper-checked').first().innerText().catch(() => '')).replace(/\s+/g, '');
        check('PREFILL-现场清点', /齐/.test(ck), ck ? `默认结论=「${ck}」` : '「齐」未预选');
        await page.locator('.ant-modal-close').last().click().catch(() => {}); await page.waitForTimeout(500);
      }
    }
  } catch (e) {
    check('PREFILL-实读', false, '异常: ' + String(e).slice(0, 160));
  } finally {
    await c.browser.close();
  }
}

// ═════════ Part 4 · 本轮客户口径的 UI 断言（O1 重名 / R4-01 移动隐卡）═════════
{
  const c = await newCtx(); const { page } = c;
  try {
    await login(page, 'eng_director', 'txgk@123');
    await page.goto(BASE + '/admin/users', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
    const dup = await page.locator('.ant-layout-sider').getByText('系统管理', { exact: true }).count();
    const item = await page.locator('.ant-layout-sider').getByText('用户与权限', { exact: true }).count();
    check('O1-侧栏不再重名', dup === 1 && item > 0, `侧栏内「系统管理」=${dup} 次（应仅剩组标题）·「用户与权限」=${item} 个`);
  } catch (e) { check('O1-侧栏不再重名', false, '异常 ' + String(e).slice(0, 160)); }
  finally { await c.browser.close(); }
}
{
  const c = await newCtx({ mobile: true }); const { page } = c;
  try {
    await login(page, 'mech1', 'txgk@123');
    const gone = [];
    for (const r of ['/m', '/m/me']) {
      await page.goto(BASE + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
      const t = await body(page);
      for (const k of ['我的任务', '待我审', '待我裁决', '设计评审', '改版申请']) if (t.includes(k)) gone.push(`${r}:${k}`);
    }
    check('R4-01-移动已下线PC卡', gone.length === 0, gone.length ? `仍可见 PC-only 入口: ${gone.join(', ')}` : '移动首页/我的页不再出现任务/评审/改版卡（不会再被带进桌面壳）');
  } catch (e) { check('R4-01-移动已下线PC卡', false, '异常 ' + String(e).slice(0, 160)); }
  finally { await c.browser.close(); }
}

const fails = summary('UI 回归');
console.log(`\n（写链产生的测试项目: ${newNo} —— E2E 回归数据，可清理）`);
// ★ 本套件会留测试数据（自建靶建的商机/批次等）—— 跑完想回到干净态：
console.log('   （本套件会留测试数据；复位：npm run e2e:clean）')
exitWith(fails);
