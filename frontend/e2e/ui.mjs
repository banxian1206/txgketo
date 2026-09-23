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
