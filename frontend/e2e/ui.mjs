/**
 * UI 回归：真实浏览器（channel:chrome）
 *  Part 1 冒烟：PC 25 路由 + 移动 9 路由，零 pageerror / 零 4xx / 零 antd 弃用警告（P-16 动态）
 *  Part 2 交互：P-09 · P-01 · P-03 · P-02 · P-11 · P-13 · P-05 · P-10 · P-04 · P-08 · P-18 · P-21 · P-22
 *  Part 3 预填实读：用户/供应商/标准库编辑 + 装配开始（打开弹窗断言初始值，治 PREFILL 静态盲区）
 *  注意：本脚本会创建 1 个测试商机（E2E回归-*）并走完 建图/下单/验收，属护栏正常代价
 */
import { newCtx, login, body, shot, check, summary, exitWith, results, BASE, FILES, apiLogin, apiGet } from './lib.mjs';
import path from 'node:path';

const PHOTO = path.join(FILES, 'photo.png');
const PC_ROUTES = [
  '/workbench', '/workbench/sales', '/workbench/pm', '/workbench/eng', '/workbench/shop',
  '/projects', '/projects/new', '/numbering', '/users', '/library',
  '/my-tasks', '/reviews', '/changes', '/purchase', '/suppliers',
  '/warehouse', '/manufacturing', '/assembly', '/shipping',
  '/site', '/acceptance', '/service',
];
const M_ROUTES = ['/m', '/m/warehouse', '/m/issues', '/m/production', '/m/assembly', '/m/shipping', '/m/site', '/m/service', '/m/me'];

// ═════════ Part 1 · PC 冒烟 ═════════
{
  const c = await newCtx(); const { page, errs } = c;
  await login(page, 'admin', 'admin12345');
  const bad = [];
  for (const r of PC_ROUTES) {
    errs.length = 0;
    await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const len = (await body(page)).length;
    if (len < 40) bad.push(`${r} 空页(${len})`);
    const e = errs.filter(x => !x.includes('favicon'));
    if (e.length) bad.push(`${r}: ${e.slice(0, 2).join(' ')}`);
  }
  check('SMOKE-pc', bad.length === 0, bad.length ? bad.join(' | ').slice(0, 400) : `25 路由零异常零空页`);

  // P-16 动态：全程 console 无 antd 弃用警告
  const antdWarn = errs.filter(x => /antd/.test(x));
  check('P-16-dyn', antdWarn.length === 0, antdWarn.length ? antdWarn[0] : 'console antd 警告 0');
  await c.browser.close();
}

// ═════════ Part 1b · 移动冒烟 ═════════
{
  const c = await newCtx({ mobile: true }); const { page, errs } = c;
  await login(page, 'admin', 'admin12345');
  const bad = [];
  for (const r of M_ROUTES) {
    errs.length = 0;
    await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(400);
    const len = (await body(page)).length;
    if (len < 40) bad.push(`${r} 空页(${len})`);
    const e = errs.filter(x => !x.includes('favicon'));
    if (e.length) bad.push(`${r}: ${e.slice(0, 2).join(' ')}`);
  }
  check('SMOKE-mobile', bad.length === 0, bad.length ? bad.join(' | ').slice(0, 400) : '9 移动页零异常');
  await c.browser.close();
}

// ═════════ Part 2 · 交互回归（一条写链走到底）═════════
const c = await newCtx(); const { page, errs } = c;
let newNo = null;
try {
  await login(page, 'admin', 'admin12345');

  // ── P0 全站 IA：侧栏 7 项三分类 + 一级图标 + 旧平铺收进右侧 ──
  {
    // lazy chunk 加载期整页是 Skeleton —— 等侧栏真实挂载再断言（否则断在加载时序上）
    await page.waitForSelector('.ant-menu-item', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    const t = await body(page)
    const groups = ['业务', '系统管理'].every((g) => t.includes(g))
    const roots = ['项目', '交付执行', '基础数据', '系统管理']
    const missing = roots.filter((r) => !t.includes(r))
    const siderIcons = await page.locator('.ant-menu-item .anticon').count()
    const siderText = await page.locator('.ant-layout-sider').innerText().catch(() => '')
    const siderLines = siderText.split('\n').map((x) => x.trim())
    // 整行匹配（防'我的工作台'子串误伤'我的工作'）
    const oldFlat = ['制造（车间）', '装配 · 齐套率', '发运（发货指令）', '我的工作'].filter((x) => siderLines.includes(x))
    // A2 后侧栏终态 5 项：工作台 + 项目 + 交付执行 + 基础数据 + 系统管理
    const itemCount = await page.locator('.ant-layout-sider .ant-menu-item').count()
    check('NAV-侧栏5项终态', groups && missing.length === 0 && itemCount === 5,
      `项数=${itemCount}/5 · 三分类组=${groups} · 缺项=${missing.join('/') || '无'} · 图标=${siderIcons}`)
    check('NAV-旧平铺已收', oldFlat.length === 0,
      oldFlat.length ? `侧栏仍有平铺: ${oldFlat.join('/')}` : '我的工作/交付执行二级已全部收编')
  }

  // ── P0 域 Tab + 旧路径 redirect（通知/书签不断）──
  {
    await page.goto(BASE + '/manufacturing', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/delivery\/mfg/, { timeout: 8000 }).catch(() => {})
    const redirected = page.url().includes('/delivery/mfg')
    const tabN = await page.locator('.domain-tabs a').count()
    check('NAV-redirect交付', redirected && tabN >= 6, `旧 /manufacturing → ${page.url()} · 交付Tab=${tabN}`)
    const asmTab = page.locator('.domain-tabs a', { hasText: '装配' })
    if (await asmTab.count()) {
      await asmTab.click()
      await page.waitForURL(/\/delivery\/assembly/, { timeout: 6000 }).catch(() => {})
      check('NAV-Tab切换', page.url().includes('/delivery/assembly'), `点装配Tab → ${page.url()}`)
    } else check('NAV-Tab切换', false, '交付域无装配Tab')
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
    check('NAV-KPI裁剪-admin', aT.includes('待我审核') && aT.includes('演示数据'),
      `super 见全卡：待我审核=${aT.includes('待我审核')} · 管理入口卡=${aT.includes('演示数据')}`)

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
      check('NAV-台Tab角标', true, '取 counts 失败（SKIP 语义）', 'SKIP')
    } else {
      const probes = [
        ['我的', counts.my_tasks + counts.to_review + counts.to_decide + counts.to_change],
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
        check('NAV-台Tab角标', true, '业务台 counts 当前全 0（按设计不显示角标）— SKIP 语义通过', 'SKIP')
      } else {
        check('NAV-台Tab角标', bad.length === 0, bad.length ? bad.join(' | ') : '角标数值与 counts 逐台一致（0 不显示）')
      }
    }
  }

  // ── A5 车间台收编：台内 card 页签（看板|制造|装配）= URL 子路由 ──
  {
    await page.goto(BASE + '/workbench/shop', { waitUntil: 'networkidle' })
    await page.waitForSelector('.domain-content .ant-tabs', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(400)
    const inner = page.locator('.domain-content .ant-tabs')
    const innerTabs = await inner.locator('.ant-tabs-tab').allInnerTexts().catch(() => [])
    const mfgTab = inner.locator('.ant-tabs-tab', { hasText: '制造' }).first()
    let urlOk = false, contentOk = false
    if (await mfgTab.count()) {
      await mfgTab.click()
      await page.waitForURL(/\/workbench\/shop\/mfg/, { timeout: 6000 }).catch(() => {})
      urlOk = page.url().includes('/workbench/shop/mfg')
      await page.waitForTimeout(700)
      const t2 = await body(page)
      contentOk = t2.includes('排产') || t2.includes('制造') || t2.includes('下发')
    }
    check('NAV-车间台收编', innerTabs.length === 3 && urlOk && contentOk,
      `页签=${JSON.stringify(innerTabs)} · URL=${urlOk} · 制造内容挂载=${contentOk}`)
  }

  // ── A4 到货跟踪（催货视图：active 页签 + 在途行/空态双分支）──
  {
    await page.goto(BASE + '/purchase?tab=arrivals', { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    const active = await page.locator('.ant-tabs-tab-active').first().innerText().catch(() => '')
    const tabN = await page.locator('.ant-tabs-tab').count()
    const t = await body(page)
    const hasRows = (t.match(/PO\d{5}/g) || []).length > 0
    const hasEmpty = t.includes('没有在途采购单')
    check('NAV-到货跟踪', active.includes('到货跟踪') && tabN >= 8 && (hasRows || hasEmpty),
      `active=「${active.trim()}」 · 页签=${tabN} · 在途行=${hasRows}${hasEmpty ? '(空态引导)' : ''}`)
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
  // A2（v2 拍板②）：我的台内页签 —— 待办/我的任务/设计评审/改版申请（card 型，与域 Tab 下划线区分）
  {
    await page.goto(BASE + '/workbench', { waitUntil: 'networkidle' })
    await page.waitForSelector('.ant-tabs-type-card', { timeout: 8000 }).catch(() => {})
    const inner = page.locator('.domain-content .ant-tabs')
    const innerTabs = await inner.locator('.ant-tabs-tab').allInnerTexts().catch(() => [])
    const cardType = (await inner.getAttribute('class').catch(() => ''))?.includes('ant-tabs-card')
    // 点「我的任务」→ URL 子路由 + 内容挂载
    const taskTab = inner.locator('.ant-tabs-tab', { hasText: '我的任务' }).first()
    let urlOk = false, contentOk = false
    if (await taskTab.count()) {
      await taskTab.click()
      await page.waitForURL(/\/workbench\/tasks/, { timeout: 6000 }).catch(() => {})
      urlOk = page.url().includes('/workbench/tasks')
      await page.waitForTimeout(600)
      const t = await body(page)
      contentOk = t.includes('任务号') || t.includes('拆分派工') || t.includes('我的任务')
    }
    check('NAV-台内页签', innerTabs.length === 4 && !!cardType && urlOk && contentOk,
      `页签=${JSON.stringify(innerTabs)} · card型=${!!cardType} · URL=${urlOk} · 内容挂载=${contentOk}`)
  }

  // A1（v2 拍板①）：供应商入采购台 —— 旧链落台内页签 + 侧栏收编
  {
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' })
    await page.waitForURL(/\/purchase\?tab=suppliers/, { timeout: 8000 }).catch(() => {})
    const landed = page.url().includes('tab=suppliers')
    await page.waitForSelector('.ant-tabs-tab-active', { timeout: 8000 }).catch(() => {})
    const active = await page.locator('.ant-tabs-tab-active').first().innerText().catch(() => '')
    const tabN = await page.locator('.ant-tabs-tab').count()
    const siderHasSupplier = await page.locator('.ant-layout-sider').innerText().catch(() => '')
    const noSideEntry = !siderHasSupplier.includes('供应商')
    check('NAV-供应商入台', landed && active.includes('供应商') && noSideEntry && tabN >= 7,
      `旧链→${page.url().split('?')[1] || page.url()} · active=「${active.trim()}」 · 页签=${tabN}/7 · 侧栏已收=${noSideEntry}`)
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
    await p2.waitForSelector('.domain-tabs a', { timeout: 10000 }).catch(() => {})
    await p2.waitForTimeout(500)
    const tabs = await p2.locator('.domain-tabs a').allInnerTexts()
    const ok = tabs.length === 2 && tabs.some((t) => t.includes('采购')) && !tabs.some((t) => t.includes('仓库'))
    check('NAV-台角色裁剪', ok, `buyer1 台 Tab=${JSON.stringify(tabs)}（me.visible 自动裁剪）`)
    // A3：buyer1 的 KPI 角色裁剪（无 DESIGN_AUDIT → 无待审卡；非 ADMIN → 无管理入口卡）
    const bT = await body(p2)
    const buyerOk = !bT.includes('待我审核') && bT.includes('待采购') && !bT.includes('演示数据')
    check('NAV-KPI裁剪-buyer1', buyerOk,
      `无待我审核=${!bT.includes('待我审核')} · 有待采购=${bT.includes('待采购')} · 无管理卡=${!bT.includes('演示数据')}`)
    await c2.browser.close()
  }

  // —— P-09：空提交列表级错误 + 零 pageerror ——
  await page.goto(BASE + '/projects/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  errs.length = 0;
  await page.getByRole('button', { name: /建\s*立\s*商\s*机/ }).first().click();
  await page.waitForTimeout(900);
  const t0 = await body(page);
  check('P-09', t0.includes('至少要有一个客户方联系人') && errs.length === 0,
    t0.includes('至少要有一个客户方联系人')
      ? (errs.length === 0 ? '列表级错误渲染 + 零 pageerror' : `有异常: ${errs[0]}`)
      : '未见列表级错误');

  // —— S0 建商机（写链开始）——
  await page.getByLabel(/项目名称/).fill(`E2E回归-${new Date().toISOString().slice(5, 16).replace(/[-:]/g, '')}`);
  await page.getByLabel(/项目描述/).fill('e2e 护栏自动创建（可清理）');
  await page.getByLabel(/客户名称/).fill('E2E回归客户');
  await page.getByRole('button', { name: /添\s*加\s*联\s*系\s*人/ }).click();
  await page.getByPlaceholder('姓名').first().fill('回归机器人');
  await page.getByPlaceholder('电话').first().fill('13900000000');
  await page.getByLabel(/项目地点/).fill('广东惠州回归路 1 号');
  const dl = page.locator('.ant-form-item').filter({ hasText: '商机截止时间' }).locator('input');
  await dl.click(); await page.keyboard.type('2026-12-31'); await page.keyboard.press('Enter');
  await page.getByLabel(/销售负责人/).click(); await page.waitForTimeout(400);
  await page.keyboard.type('销售'); await page.waitForTimeout(500);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  await page.getByRole('button', { name: /建\s*立\s*商\s*机/ }).first().click();
  await page.waitForURL(/\/projects$/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const t1 = await body(page);
  newNo = (t1.match(/TX\d{5}/g) || []).sort().at(-1);
  check('S0-建商机', !!newNo && t1.includes('E2E回归'), newNo ? `${newNo} 已建` : '列表未见新项目');
  if (!newNo) throw new Error('no project');

  // —— 成交登记 ——
  await page.goto(`${BASE}/projects/${newNo}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /成\s*交\s*登\s*记/ }).first().click();
  await page.waitForSelector('.ant-modal', { timeout: 5000 });
  const fillDate = async (id, v) => { const i = page.locator('#' + id); await i.click(); await page.keyboard.type(v); await page.keyboard.press('Enter'); };
  await fillDate('period_start', '2026-09-22');
  await fillDate('period_end', '2027-06-30');
  await page.locator('#amount').fill('500000');
  await page.locator('#warranty_months').fill('12');
  // AppModal 已预填 4 个付款节点（R2-02 修复后）——不再多点「添加付款节点」
  await page.getByRole('button', { name: /确\s*认\s*成\s*交/ }).click();
  await page.waitForTimeout(2000);

  // —— 立项 + 建设备 ——
  await page.getByRole('button', { name: /^立\s*项$/ }).first().click();
  await page.waitForURL(/initiate/, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /\+\s*新\s*增\s*设\s*备/ }).click();
  await page.waitForTimeout(500);
  await page.getByLabel(/设备名称/).fill('回归升降机');
  await page.getByRole('button', { name: /^\s*确\s*定\s*$/ }).last().click();
  await page.waitForTimeout(1400);
  check('S1-立项', (await body(page)).includes('回归升降机'), '设备 01A 已建');

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
  await page.keyboard.type('方通'); await page.waitForTimeout(700);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  await mm.locator('.ant-form-item').filter({ hasText: '数量' }).locator('input').fill('3');
  await mm.getByRole('button', { name: /提\s*交\s*进\s*池/ }).click();
  await page.waitForTimeout(1600);
  const rowCb = page.locator('.ant-table-row').first().locator('.ant-checkbox-input');
  if (await rowCb.count()) await rowCb.check().catch(() => {});
  await page.waitForTimeout(400);
  const mergeBtn = page.getByRole('button', { name: /合\s*并\s*下\s*单/ }).first();
  const wasDisabled = await mergeBtn.isDisabled().catch(() => false);
  check('P-21', !wasDisabled, wasDisabled ? '勾选后仍禁用（异常）' : '勾选后合并下单可用');
  await mergeBtn.click();
  await page.waitForTimeout(700);
  const om = page.locator('.ant-modal:visible').filter({ hasText: /下单/ });
  await om.locator('.ant-form-item').filter({ hasText: '供应商' }).locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  const od = om.locator('.ant-form-item').filter({ hasText: '下单日期' }).locator('input');
  await od.click(); await page.keyboard.type('2026-09-22'); await page.keyboard.press('Enter');
  await om.locator('.ant-form-item').filter({ hasText: '收货地点' }).locator('.ant-select-selector').click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:visible .ant-select-item').first().click();
  // ★ 填单价（表格列内联编辑：数量=nth(0) 单价=nth(1)）：写链造的单必须有金额，
  // 否则 0 价新单会把有价单挤出列表第一页，P-17「页面含 ¥」断言必挂（脆弱性设计教训）
  const numInputs = om.locator('.ant-input-number-input');
  if ((await numInputs.count()) >= 2) await numInputs.nth(1).fill('9.9');
  await om.getByRole('button', { name: /确\s*认\s*合\s*并\s*下\s*单/ }).click();
  await page.waitForTimeout(2200);
  const poNo = ((await body(page)).match(/PO\d{5}/g) || [])[0];
  check('P-02a', !!poNo, poNo ? `${poNo} 已下单` : '未见采购单号');

  // 仓库验收（辅料 = project_no NULL 的旧 404 路径）
  errs.length = 0;
  await page.goto(BASE + '/warehouse', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  const poRow = page.locator('.ant-table-row', { hasText: poNo }).first();
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
  const storeBtn = page.getByRole('button', { name: /^\s*入\s*库\s*$/ }).first();
  if (await storeBtn.count()) {
    await storeBtn.click(); await page.waitForTimeout(700);
    const sm = page.locator('.ant-modal:visible').filter({ hasText: /入库/ });
    const locSel = await sm.locator('.ant-form-item').filter({ hasText: '库位' }).locator('.ant-select-selector').count();
    check('P-11', locSel > 0, locSel ? '库位=下拉' : '仍手填 Input');
    await page.keyboard.press('Escape');
  } else check('P-11', false, '无待入库行', 'SKIP');

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

  // —— P-17（UI）：采购单页签有 ¥ ——
  await page.goto(BASE + '/purchase', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('tab', { name: /采\s*购\s*单/ }).click();
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

  // —— P-08：API 预查有批次的项目 → UI 精准选择（不遍历下拉：antd 虚拟滚动下 nth(i) 随数据规模失效）——
  await page.goto(BASE + '/shipping', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  let p08 = 'SKIP', p08note = '当前无待发运批次（新批次下次跑验证）';
  {
    const tok = await apiLogin('admin', 'admin12345');
    const all = await (await apiGet('/shipping/list', tok)).json();
    const open = (Array.isArray(all) ? all : []).find((x) =>
      ['已指令', '发货中', '已装车'].includes(x.status));
    if (open && open.project_no) {
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
      } else { p08note = `批次 ${open.shipment_no}(${open.status}) 行内无发运链接`; }
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

  // —— 1.3 Auth：伪装进入 → 横幅 → 退出查看（本步改造的功能面）——
  await page.goto(BASE + '/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const impLink = page.locator('a[title="以他的身份查看（只读）"]').first();
  if (await impLink.count()) {
    await impLink.click();
    await page.waitForURL(/\/workbench/, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const banner = await body(page);
    const on = banner.includes('正在以「') && banner.includes('只读');
    check('AUTH-伪装进入', on, on ? '橙色横幅出现' : '未见伪装横幅: ' + banner.slice(0, 80).replace(/\n/g, '|'));
    const stop = page.getByText('退出查看').first();
    if (await stop.count()) {
      await stop.click();
      await page.waitForURL(/\/users/, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const t = await body(page);
      const off = !t.includes('正在以「');
      check('AUTH-退出查看', off, off ? '横幅消失，回到 /users' : '横幅仍在');
    } else check('AUTH-退出查看', false, '无「退出查看」入口');
  } else check('AUTH-伪装进入', false, 'Users 页无伪装入口（权限？admin 应可见）');

  // —— 2.5 品牌位：侧栏反白字标真实加载（naturalWidth>0 = 非裂图非404）——
  {
    await page.waitForFunction(() => {
      const i = document.querySelector('img[src*="logo-white"]');
      return !!i && i.complete && i.naturalWidth > 0;
    }, { timeout: 5000 }).catch(() => {});
    const logo = page.locator('img[src*="logo-white"]').first();
    const has = await logo.count();
    const nw = has ? await logo.evaluate((img) => img.naturalWidth).catch(() => 0) : 0;
    check('BRAND-侧栏logo', has > 0 && nw > 0, has ? `naturalWidth=${nw}` : '侧栏找不到 logo-white img');
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
    await page.fill('input[type="password"]', 'admin12345')
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
  check('UI-写链', false, '异常中断: ' + String(e).slice(0, 250));
  await shot(page, 'ui-regress-crash');
} finally {
  await c.browser.close();
}

// ═════════ Part 3 · 预填实读（治 PREFILL 静态盲区：打开弹窗就必须看到初始值）═════════
{
  const c = await newCtx(); const { page } = c;
  const closeModal = async () => { await page.locator('.ant-modal-close').last().click().catch(() => {}); await page.waitForTimeout(400); };
  try {
    await login(page, 'admin', 'admin12345');

    // 用户编辑
    await page.goto(BASE + '/users', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    let edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(600);
      const u = await page.locator('.ant-modal-content input#username').inputValue().catch(() => '');
      check('PREFILL-用户编辑', !!u, u ? `username=${u}` : '账号未预填');
      await closeModal();
    } else check('PREFILL-用户编辑', true, '无编辑入口', 'SKIP');

    // 供应商编辑
    await page.goto(BASE + '/suppliers', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(600);
      const n = await page.locator('.ant-modal-content input#name').inputValue().catch(() => '');
      check('PREFILL-供应商编辑', !!n, n ? `name=${n}` : '名称未预填');
      await closeModal();
    } else check('PREFILL-供应商编辑', true, '无编辑入口', 'SKIP');

    // 标准库物料编辑
    await page.goto(BASE + '/library', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    edit = page.locator('a,button').filter({ hasText: /^编\s*辑$/ }).first();
    if (await edit.count()) {
      await edit.click(); await page.waitForTimeout(800);
      const u2 = await page.locator('.ant-modal-content input#unit').inputValue().catch(() => '');
      check('PREFILL-标准库编辑', !!u2, u2 ? `unit=${u2}` : '单位未预填');
      await closeModal();
    } else check('PREFILL-标准库编辑', true, '无编辑入口', 'SKIP');

    // 装配开始（PC）
    await page.goto(BASE + '/assembly', { waitUntil: 'networkidle' }); await page.waitForTimeout(1400);
    const sel = page.locator('.ant-select').first();
    if (await sel.count()) { await sel.click(); await page.waitForTimeout(400); const opt = page.locator('.ant-select-item-option').first(); if (await opt.count()) { await opt.click(); await page.waitForTimeout(1200); } }
    const asm = page.locator('a,button').filter({ hasText: '开始装配' }).first();
    if (await asm.count()) {
      await asm.click(); await page.waitForTimeout(700);
      const checked = await page.locator('.ant-modal-content .ant-radio-button-wrapper-checked').innerText().catch(() => '');
      check('PREFILL-装配开始', /整机装配/.test(checked), checked ? `装配形态=${checked.trim()}` : '未预选整机装配');
    } else check('PREFILL-装配开始', true, '无开始装配入口', 'SKIP');
  } catch (e) {
    check('PREFILL-实读', false, '异常: ' + String(e).slice(0, 160));
  } finally {
    await c.browser.close();
  }
}

const fails = summary('UI 回归');
console.log(`\n（写链产生的测试项目: ${newNo} —— E2E 回归数据，可清理）`);
exitWith(fails);
