/**
 * API 层回归：门禁/权限/错误码断言（快，毫秒级）
 * 覆盖：P-05 验收门禁 / P-06 幽灵项目 / P-07 金额分档 / P-02 无项目验收路由 / P-15 favicon
 */
import { check, summary, exitWith, apiLogin, apiGet, API, BASE } from './lib.mjs';

const [pm, buyer, sales] = await Promise.all([apiLogin('pm1', 'txgk@123'), apiLogin('buyer1', 'txgk@123'), apiLogin('sales1', 'txgk@123')]);   // ★ 不用 admin：超管绕过权限码且无部门（护栏 tests/test_no_admin_in_e2e.py）
const wh1 = await apiLogin('wh1', 'txgk@123');

// P-06：幽灵项目 → 400 友好文案（原 500 + 裸 axios）
{
  const r = await fetch(`${API}/api/v1/acceptance/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pm}` },
    body: JSON.stringify({ project_no: 'TX99999' }),
  });
  const d = await r.json().catch(() => ({}));
  check('P-06', r.status === 400 && /不存在/.test(d.detail || ''),
    `HTTP ${r.status} · ${String(d.detail).slice(0, 60)}`);
}

// P-07：无 project:amount 角色看详情金额 → null
{
  // ★ 不再写死项目号（曾写死 TX26010，样本库重建后 404 → amount=undefined 误报 FAIL）
  const list = await (await apiGet('/projects', pm)).json();
  // 挑一个确实有金额的项目（否则 P-07-rev 无法验证"有权限应可见数字"）
  const arr = Array.isArray(list) ? list : [];
  const pno = (arr.find(p => p.amount != null) ?? arr[0])?.project_no;
  if (!pno) {
    check('P-07', false, '无项目可测，跳过');
  } else {
    const r = await apiGet(`/projects/${pno}`, wh1);
    const d = await r.json().catch(() => ({}));
    check('P-07', d.amount === null && d.est_amount === null,
      `${pno} wh1 amount=${d.amount} est=${d.est_amount}（应 null/null）`);
    // 反向：sales（有 project:amount）应见金额
    const r2 = await apiGet(`/projects/${pno}`, sales);
    const d2 = await r2.json().catch(() => ({}));
    check('P-07-rev', d2.amount !== undefined && d2.amount !== null,
      `${pno} sales amount=${d2.amount}（有权限应可见真实数字，不被脱敏）`);
  }
}

// P-05：验收门禁 —— **自建靶**：新建一个商机（线索阶段，肯定没有“调试完成”记录）→ 申请验收应被拦
// （原来找不到“未调试阶段项目”就永远 SKIP —— 休眠的护栏永远绿 = 没有。报告 §4）
{
  const me = (await (await apiGet('/my-scope', sales)).json()) ?? {};   // 顶层已有 sales1 的 token
  const probe = await (await fetch(`${API}/api/v1/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sales}` },
    body: JSON.stringify({
      customer_name: `P05 门禁客户 ${Date.now()}`,
      project_name: `P05-验收门禁探针-${Date.now()}`,
      sales_id: me.user_id,
      project_desc: 'P-05 自建靶：验证验收门禁（不登流程）',
      site_address: '探针地址',
      deadline: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
      contacts: [{ name: '探针联系人', phone: '13900000000' }],
    }),
  })).json();
  if (!probe?.project_no) {
    check('P-05', false, '自建靶失败：新建商机失败（必填项变更？）');
  } else {
    const r = await fetch(`${API}/api/v1/acceptance/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pm}` },
      body: JSON.stringify({ project_no: probe.project_no }),
    });
    const d = await r.json().catch(() => ({}));
    const msg = String(d.detail || '');
    // 未走到调试 → 必须 400 且文案指向“调试”，绝不得 500
    check('P-05', r.status === 400 && /调试/.test(msg),
      `自建靶 ${probe.project_no}（线索）申请验收 → HTTP ${r.status} · ${msg.slice(0, 60)}`);
  }
}

// P-02：无项目（辅料）需求存在验收路由 —— **自建靶**：辅料手工申请 → 合并下单 → 审批到在途
// （原来靠扫库碰运气：“无辅料在途需求”就永远 SKIP —— 休眠的护栏永远绿 = 没有。报告 §4）
{
  const suppliers = await (await apiGet('/suppliers', buyer)).json();
  const sup = Array.isArray(suppliers) ? suppliers[0] : null;
  const items = await (await apiGet('/library/items?limit=1', buyer)).json();
  const item = Array.isArray(items) ? items[0] : null;
  let seeded = null;
  if (sup && item) {
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer}` };
    const mr = await (await fetch(`${API}/api/v1/purchase/manual-request`, {
      method: 'POST', headers: h,
      // ★ 关键：**不带 project_no** —— 这正是 P-02 要测的“无项目（辅料）”路径
      body: JSON.stringify({ attribution: '辅料', item_no: item.item_no, qty: 1,
        need_date: new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10), note: 'P-02 护栏探针' }),
    })).json();
    const po = await (await fetch(`${API}/api/v1/purchase/merge-order`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ supplier_id: sup.id, ordered_at: new Date().toISOString().slice(0, 10),
        expected_date: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
        deliver_to: '公司仓库',
        lines: [{ request_id: mr.id, tax_incl: true }] }),
    })).json();
    // 推到已批准 → 需求才转「在途」、仓库才看得到这条待验收
    let st = po.status;
    const approverOf = { 待经理审: 'purchase_manager', 待总监审: 'purchase_director' };
    for (let k = 0; k < 3 && approverOf[st]; k++) {
      let tok = null;
      try { tok = await apiLogin(approverOf[st], 'txgk@123'); } catch { /* 无该演示账号 */ }
      if (!tok) break;
      await fetch(`${API}/api/v1/purchase/orders/${po.po_no}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ action: '通过', note: 'P-02 探针自动通过' }),
      });
      const cur = await (await apiGet('/purchase/orders', buyer)).json();
      st = (Array.isArray(cur) ? cur : []).find(o => o.po_no === po.po_no)?.po_status;
    }
    const wb = await (await apiGet('/warehouse/workbench', wh1)).json();
    seeded = (wb.incoming || []).find(x => x.id === mr.id) ?? null;
  }
  if (!seeded) {
    check('P-02', false, '自建靶失败：辅料申请→下单→审批后仍未出现在仓库待验收');
  } else {
    const r = await fetch(`${API}/api/v1/purchase-requests/${seeded.id}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wh1}` },
      body: JSON.stringify({ receipt_date: new Date().toISOString().slice(0, 10), qty: 1, result: '合格' }),
    }).catch(e => ({ status: 0, json: async () => ({ detail: String(e) }) }));
    const d = await r.json().catch(() => ({}));
    // 不再出现 404「采购需求不存在」= 修复成立（201/400 都算路由存在）
    check('P-02', r.status !== 404 && !/不存在/.test(String(d.detail)),
      `自建靶 #${seeded.id}（无项目）验收 → HTTP ${r.status} · ${String(d.detail).slice(0, 50)}`);
  }
}

// R2-01：直发客户现场 → 下单即建「现场待验收」到货单（现场立即可清点；仓库列表不含直发）
{
  const projects = await (await apiGet('/projects', pm)).json();
  const proj = (Array.isArray(projects) ? projects : []).find(p => ['执行中', '交付中', '质保'].includes(p.stage)) || (Array.isArray(projects) ? projects[0] : null);
  const suppliers = await (await apiGet('/suppliers', buyer)).json();
  const sup = Array.isArray(suppliers) ? suppliers[0] : null;
  const items = await (await apiGet('/library/items?limit=1', buyer)).json();
  const item = Array.isArray(items) ? items[0] : null;
  if (!proj || !sup || !item) {
    check('R2-01', false, '缺少造数前置（项目/供应商/物料），跳过');
  } else {
    // ★ 采购单要用真实采购员身份下（buyer1）：admin 无部门，审批链的
    //   `director_for` 会全局兜底到「第一个总监」（往往是工程总监）而采购总监审不了 → 单卡死。
    //   见本轮发现 N21（已另行报告，不属于本探针要测的 R2-01 口径）。
    const buyer = await apiLogin('buyer1', 'txgk@123');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer}` };
    const mr = await (await fetch(`${API}/api/v1/purchase/manual-request`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ attribution: '项目', project_no: proj.project_no, item_no: item.item_no, qty: 1,
        need_date: new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10), note: 'R2-01 护栏探针' }),
    })).json();
    const po = await (await fetch(`${API}/api/v1/purchase/merge-order`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ supplier_id: sup.id, ordered_at: new Date().toISOString().slice(0, 10),
        // 客户口径 O3-A：手工单无采购周期 → 预计到货日必填（不填会被 400 拦，本探针要往下跑）
        expected_date: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
        deliver_to: '直发客户现场', deliver_address: 'E2E 探针地址',
        // ★ tax_incl 重构后必填（08 §3.2 / 客户口径#10），不传会 422 而撞不到本探针要测的门禁
        lines: [{ request_id: mr.id, tax_incl: true }] }),
    })).json();
    // ★ 08 §4.2：直发【现场待验收】到货单在审批通过后才建 —— 必须先把单推到已批准再查
    let st = po.status;
    const approverOf = { 待经理审: 'purchase_manager', 待总监审: 'purchase_director' };
    for (let k = 0; k < 3 && approverOf[st]; k++) {
      let tok = null;
      try { tok = await apiLogin(approverOf[st], 'txgk@123'); } catch { /* 无该演示账号 */ }
      if (!tok) break;
      await fetch(`${API}/api/v1/purchase/orders/${po.po_no}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ action: '通过', note: 'R2-01 探针自动通过' }),
      });
      const cur = await (await apiGet('/purchase/orders', buyer)).json();
      st = (Array.isArray(cur) ? cur : []).find(o => o.po_no === po.po_no)?.po_status;
    }
    const inc = await (await apiGet(`/site/incoming?project_no=${proj.project_no}`, pm)).json();
    const hit = (inc.pending || []).some(x => x.item_no === item.item_no && x.status === '现场待验收');
    const wb = await (await apiGet('/warehouse/workbench', wh1)).json();
    const notInWh = !(wb.incoming || []).some(x => x.id === mr.id);
    check('R2-01', hit && notInWh,
      `PO=${po.po_no ?? '?'} · 审批后=${st} · 现场待清点=${hit} · 仓库不含直发=${notInWh}（本探针会留一条待清点数据）`);
  }
}

// 观察-02：通知「接收方视角」—— 不只看发出，还要看该收的人真收到（用便宜的售后报修触发）
{
  const projects = await (await apiGet('/projects', pm)).json();
  const proj = (Array.isArray(projects) ? projects : []).find(p => ['执行中', '交付中', '质保'].includes(p.stage)) || (Array.isArray(projects) ? projects[0] : null);
  if (!proj) {
    check('RCPT-售后报修→项目经理', false, '无项目可探');
  } else {
    const svc = await apiLogin('service1', 'txgk@123');
    const pm = await apiLogin('pm1', 'txgk@123');
    const uniq = `E2E通知探针-${Date.now()}`;
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${svc}` };
    const so = await (await fetch(`${API}/api/v1/service/orders`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ project_no: proj.project_no, fault: uniq }),
    })).json();
    const fetchItems = async (token, unread) => {
      const r = await (await fetch(`${API}/api/v1/notifications?unread=${unread}`, { headers: { Authorization: `Bearer ${token}` } })).json();
      return r.items ?? [];
    };
    const pmHit = (await fetchItems(pm, true)).find(n => /报修已受理/.test(n.title || '') && (n.body || '').includes(uniq));
    check('RCPT-售后报修→项目经理', !!pmHit, pmHit ? `pm1 收到「${pmHit.title}」` : `pm1 未收到（工单 ${so.so_no ?? '?'}）`);
    const svcSelf = (await fetchItems(svc, false)).find(n => /报修已受理/.test(n.title || '') && (n.body || '').includes(uniq));
    check('RCPT-操作人不自收', !svcSelf, svcSelf ? '操作人收到了自己触发的通知（应排除）' : '操作人未收到自己触发的（预期）');
  }
}

// P-15：favicon 200
{
  const r = await fetch(`${BASE}/brand/favicon.ico`);
  check('P-15', r.status === 200, `favicon.ico → ${r.status}`);
}

// P-17：演示数据采购行有价格（单价非空，价格参考才有意义）
{
  const orders = await (await apiGet('/purchase/orders', buyer)).json();
  const withPrice = (Array.isArray(orders) ? orders : []).some(o => (o.total_amount ?? 0) > 0);
  check('P-17', withPrice, withPrice ? '存在带金额的采购单' : '所有采购单金额为 0/空');
}

// ── O3-A（客户口径）：预计到货日必须有 —— 无采购周期又不填 → 400 ──
{
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer}` };
  const projects = await (await apiGet('/projects', pm)).json();
  const proj = (Array.isArray(projects) ? projects : []).find(p => ['执行中', '交付中', '质保'].includes(p.stage));
  const sup = ((await (await apiGet('/suppliers', buyer)).json()) ?? [])[0];
  const item = ((await (await apiGet('/library/items?limit=1', buyer)).json()) ?? [])[0];
  if (!proj || !sup || !item) {
    check('O3A-预计到货必填', false, '缺造数前置，跳过');
  } else {
    const mr = await (await fetch(`${API}/api/v1/purchase/manual-request`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ attribution: '辅料', item_no: item.item_no, qty: 1, unit: item.unit, note: 'O3A 护栏探针' }),
    })).json();
    const ordered = new Date().toISOString().slice(0, 10);
    const noDate = await fetch(`${API}/api/v1/purchase/merge-order`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ supplier_id: sup.id, ordered_at: ordered, deliver_to: '公司仓库',
        lines: [{ request_id: mr.id, tax_incl: true }] }),
    });
    const d1 = await noDate.json().catch(() => ({}));
    const withDate = await fetch(`${API}/api/v1/purchase/merge-order`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ supplier_id: sup.id, ordered_at: ordered,
        expected_date: new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10),
        deliver_to: '公司仓库', lines: [{ request_id: mr.id, tax_incl: true }] }),
    });
    check('O3A-预计到货必填',
      noDate.status === 400 && /预计到货/.test(String(d1.detail)) && withDate.status < 300,
      `不填→${noDate.status}「${String(d1.detail ?? '').slice(0, 34)}」 · 填了→${withDate.status}`);
  }
}

// ── R5-01/R5-02：装车与发运双门禁 · 已装车可补勾 · 发运后清单锁死 ──
{
  const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
  const post = async (url, body, token = pm) => {
    const r = await fetch(`${API}/api/v1${url}`, { method: 'POST', headers: H(token), body: JSON.stringify(body ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* noop */ }
    return { code: r.status, j };
  };
  const PH = ['e2e-guard-probe.png'];
  // ★ **自建靶**（原来靠扫库碰运气：“无可下达设备”就永远 SKIP —— 休眠的护栏永远绿 = 没有。报告 §4）
  //   造一台“装配完成 + 有已发布结构”的设备：设计面有零件的设备 → 开始装配 → 装配完成。
  let target = null;
  const shop1 = await apiLogin('shop1', 'txgk@123');   // mfg:edit
  const postAs = async (url, body, token) => {
    const r = await fetch(`${API}/api/v1${url}`, { method: 'POST', headers: H(token), body: JSON.stringify(body ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* noop */ }
    return { code: r.status, j };
  };
  const ps = (await (await apiGet('/projects', pm)).json()) ?? [];
  for (const p of (Array.isArray(ps) ? ps : [])) {
    const ts = (await (await apiGet(`/shipping/to-ship?project_no=${p.project_no}`, pm)).json()) ?? [];
    const all = Array.isArray(ts) ? ts : (ts.items ?? []);
    const already = all.find(r => r.ready && !r.in_open_shipment);
    if (already) { target = { pno: p.project_no, equip: already.equip_no }; break; }
    // 没有现成“装配完成”的 → 自己造一台（挑有零件的设备）
    const ov = (await (await apiGet(`/projects/${p.project_no}/design-overview`, pm)).json()) ?? [];
    const cand = (Array.isArray(ov) ? ov : []).find(o => (o.parts ?? 0) > 0);
    if (!cand) continue;
    const rec = await postAs('/assembly/records', { project_no: p.project_no, equip_no: cand.equip_no, sub_assembly: '整机装配' }, shop1);
    if (!rec.j?.id) continue;
    const fin = await postAs(`/assembly/records/${rec.j.id}/finish`, {}, shop1);
    if (fin.code >= 300) continue;
    const ts2 = (await (await apiGet(`/shipping/to-ship?project_no=${p.project_no}`, pm)).json()) ?? [];
    const rows2 = (Array.isArray(ts2) ? ts2 : (ts2.items ?? [])).filter(r => r.ready && !r.in_open_shipment);
    if (rows2.length) { target = { pno: p.project_no, equip: rows2[0].equip_no }; break; }
  }
  if (!target) {
    check('R5-01-装车硬拦', false, '自建靶失败：没能造出“装配完成 + 已发布结构”的设备');
    check('R5-01-已装车可补勾', false, '同上');
    check('R5-02-锁死报400非500', false, '同上');
  } else {
    // ★ N2（2026-10-04 走查核实）：重开「开始装配」必须 400，且待发设备**不得变不可发**
    const again = await postAs('/assembly/records', { project_no: target.pno, equip_no: target.equip, sub_assembly: '整机装配' }, shop1);
    const ts3r = (await (await apiGet(`/shipping/to-ship?project_no=${target.pno}`, pm)).json()) ?? [];
    const row3 = (Array.isArray(ts3r) ? ts3r : []).find(r => r.equip_no === target.equip);
    check('N2-重开装配被拦且仍可发',
      again.code === 400 && row3?.ready === true,
      `重开→${again.code}「${String(again.j?.detail ?? '').replace(/\n/g, ' ').slice(0, 30)}」 · 待发状态 ready=${row3?.ready}`);
    const ins = await post('/shipping/instructions', { project_no: target.pno, equip_nos: [target.equip], plan_ship_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) });
    const sid = ins.j?.id;
    await post(`/shipping/${sid}/items/generate`, {});
    const its = (await (await apiGet(`/shipping/${sid}/items`, pm)).json()) ?? [];
    if (!sid || its.length === 0) {
      check('R5-01-装车硬拦', false, `自建靶批次 ${ins.j?.shipment_no ?? '?'} 清单为空（结构未发布）`);
      check('R5-01-已装车可补勾', false, '同上');
      check('R5-02-锁死报400非500', false, '同上');
      check('R5-探针自清理', false, '同上');
    } else {
    const shot = async () => (await (await apiGet(`/shipping/${sid}`, pm)).json()).status;
    // ★ §2.2：采购先叫车（否则“0 项已发”那条会被“未叫车”先拦住，测不到真因）
    await post(`/shipping/${sid}/request-vehicle`, { count: 1, fee: 900, note: 'R5 探针叫车' }, buyer);
    // ① 0 项已发：装车与发运都必须 400
    const ld0 = await post(`/shipping/${sid}/load`, { photos: PH });
    const dp0 = await post(`/shipping/${sid}/depart`, {});
    check('R5-01-装车硬拦',
      ld0.code === 400 && dp0.code === 400 && /一项都没勾/.test(String(ld0.j?.detail)) && await shot() === '发货中',
      `装车→${ld0.code}「${String(ld0.j?.detail ?? '').slice(0, 24)}」 · 发运→${dp0.code} · 状态=${await shot()}`);
    // ② 勾 1 项 → 装车 → 已装车档仍能补勾（死端不复发）
    await post('/shipping/items/ship', { item_ids: [its[0].id], photos: PH });
    const ld1 = await post(`/shipping/${sid}/load`, { photos: PH });
    const tick2 = await post('/shipping/items/ship', { item_ids: [its[1]?.id ?? its[0].id], photos: PH });
    check('R5-01-已装车可补勾',
      ld1.code === 200 && await shot() === '已装车' && tick2.code === 200,
      `装车→${ld1.code} 状态=${await shot()} · 已装车档补勾→${tick2.code}「${String(tick2.j?.detail ?? tick2.j?.marked ?? '').slice(0, 24)}」`);
    // ③ 发运后清单锁死，且错误码是 400 不是 500（R5-02）
    await post(`/shipping/${sid}/depart`, {});
    const lock = await post('/shipping/items/ship', { item_ids: [its[its.length - 1].id], photos: PH });
    check('R5-02-锁死报400非500',
      await shot() === '在途' && lock.code === 400 && /锁死/.test(String(lock.j?.detail)),
      `在途后补勾→${lock.code}「${String(lock.j?.detail ?? '').slice(0, 34)}」`);
    // ④ 探针自清理：到货 + 清点 → 已签收（不留未完成批次）
    await post(`/shipping/${sid}/arrive`, {});
    const shipped = (((await (await apiGet(`/shipping/${sid}`, pm)).json()) ?? {}).items ?? []).filter(i => i.shipped);
    const rec = await post(`/shipping/${sid}/receipt`, {
      checks: shipped.map(i => ({ item_id: i.id, result: '到', received_qty: i.qty })), photos: PH, remark: 'R5 护栏探针自清理',
    });
    check('R5-探针自清理', rec.code < 300 && await shot() === '已签收', `清点→${rec.code} · 终点状态=${await shot()}`);
    }
  }
}

// ── PC-01：付款计划变更单（成交后改计划：只改未收节点 + 商务总监审批）──
//    2026-09-30 客户拍板；自建靶（不复用库里的脏数据 —— 护栏不得依赖环境）
{
  const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
  const post = async (url, body, token) => {
    const r = await fetch(`${API}/api/v1${url}`, { method: 'POST', headers: H(token), body: JSON.stringify(body ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* noop */ }
    return { code: r.status, j };
  };
  const sales = await apiLogin('sales1', 'txgk@123');
  const salesDir = await apiLogin('sales_director', 'txgk@123');
  // ① 自建靶：建商机 → 成交登记（4 节点 30/40/30/10）→ 第 1 个节点收一笔
  const me = (await (await apiGet('/auth/me', sales)).json()) ?? {};
  const created = await post('/projects', {
    project_name: `E2E护栏-付款变更-${Date.now() % 100000}`, project_desc: '付款计划变更单护栏自建靶',
    customer_name: 'E2E客户', contacts: [{ name: '张工', phone: '13800000000' }],
    sales_id: me.id,
    deadline: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10),
    site_address: 'E2E 探针地址',
  }, sales);
  const pno = created.j?.project_no;
  const deal = await post(`/projects/${pno}/deal`, {
    period_start: new Date().toISOString().slice(0, 10),
    period_end: new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10),
    amount: 3_000_000, warranty_months: 12, warranty_amount: 300_000,
    payment_terms: [
      { node_name: '预付款', percent: 30, amount: 900_000 },
      { node_name: '发货款', percent: 40, amount: 1_200_000 },
      { node_name: '质保金', percent: 30, amount: 900_000 },
    ],
  }, sales);
  const recv = await post(`/projects/${pno}/payment-terms/1/receive`, { received_amount: 900_000 }, sales);
  check('PC-01-自建靶', created.code < 300 && deal.code < 300 && recv.code < 300,
    `项目 ${pno} · 成交 ${deal.code} · 收预付款 ${recv.code}`);

  // ② 改已收节点 → 必须 400（只改未来节点）
  const touchPaid = await post(`/projects/${pno}/payment-changes`, {
    reason: '试图改已收的预付款', terms: [{ node_name: '预付款', percent: 30 }],
  }, sales);
  check('PC-01-已收节点不可改',
    touchPaid.code === 400 && /已经收到过款/.test(String(touchPaid.j?.detail)),
    `→${touchPaid.code}「${String(touchPaid.j?.detail ?? '').slice(0, 40)}」`);

  // ③ 比例对不上 → 400（已收 30% + 新计划 40% = 70%）
  const badPct = await post(`/projects/${pno}/payment-changes`, {
    reason: '比例故意不对', terms: [{ node_name: '发货款', percent: 40 }],
  }, sales);
  check('PC-01-比例合计必须100%',
    badPct.code === 400 && /必须是 100%/.test(String(badPct.j?.detail)),
    `→${badPct.code}「${String(badPct.j?.detail ?? '').slice(0, 40)}」`);

  // ④ 正常提交（未收 40%+30% = 70%，加已收 30% = 100%）→ 非总监审 → 400；总监批 → 已批准
  const ok = await post(`/projects/${pno}/payment-changes`, {
    reason: '客户把发货/质保谈成 40%/30%', terms: [
      { node_name: '发货款', percent: 40, trigger_node: '发货' },
      { node_name: '质保金', percent: 30, trigger_node: '质保' },
    ],
  }, sales);
  const cid = ok.j?.id;
  const notBoss = await post(`/payment-changes/${cid}/decide`, { approve: true }, sales);
  const passed = await post(`/payment-changes/${cid}/decide`, { approve: true, note: '按新比例' }, salesDir);
  const det = (await (await apiGet(`/projects/${pno}/detail`, sales)).json()) ?? {};
  const terms = det.payment_terms ?? [];
  const paidKept = terms.find((t) => t.seq === 1);
  check('PC-01-提交与审批链',
    ok.code < 300 && notBoss.code === 400 && passed.j?.status === '已批准',
    `提交→${ok.code} · 非总监→${notBoss.code}「${String(notBoss.j?.detail ?? '').slice(0, 18)}」 · 总监→${passed.j?.status}`);
  check('PC-01-只改未收节点',
    terms.length === 3 && Number(paidKept?.received_amount ?? 0) === 900_000 &&
      Number(terms.find((t) => t.node_name === '质保金')?.percent ?? 0) === 30,
    `节点 ${terms.length} 条 · 已收预付款保持 ¥${Number(paidKept?.received_amount ?? 0).toLocaleString()} · ` +
      `质保金 ${terms.find((t) => t.node_name === '质保金')?.percent}%`);
}

// ── F9：现场勘测 / 申请调试 重复提交不得堆记录（2026-10-04 走查核实）──
//    修前实测：连点 3 次 → 3 条勘测 + 3 条调试申请（通知也跟着重复）。现在必须幂等。
{
  const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
  const post = async (url, body2, token) => {
    const r = await fetch(`${API}/api/v1${url}`, { method: 'POST', headers: H(token), body: JSON.stringify(body2 ?? {}) });
    let j = null; try { j = await r.json(); } catch { /* noop */ }
    return { code: r.status, j };
  };
  const sales = await apiLogin('sales1', 'txgk@123');
  const site = await apiLogin('site1', 'txgk@123');
  const me = (await (await apiGet('/auth/me', sales)).json()) ?? {};
  const created = await post('/projects', {
    project_name: `E2E护栏-F9重复提交-${Date.now() % 100000}`, project_desc: 'F9 幂等自建靶',
    customer_name: 'E2E客户', contacts: [{ name: '张工', phone: '13800000000' }],
    sales_id: me.id,
    deadline: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10),
    site_address: 'E2E 探针地址',
  }, sales);
  const pno = created.j?.project_no;
  if (!pno) {
    check('F9-勘测幂等', false, '自建靶失败：新建商机失败');
    check('F9-申请调试幂等', false, '自建靶失败：新建商机失败');
  } else {
    const s1 = await post('/site/survey', { project_no: pno, enter_date: '2026-11-01', contact: '李现场' }, site);
    const s2 = await post('/site/survey', { project_no: pno, enter_date: '2026-11-02', contact: '李现场' }, site);
    const surveys = await (await apiGet(`/site/survey?project_no=${pno}`, site)).json();
    check('F9-勘测幂等',
      s1.code < 300 && s2.code < 300 && s2.j?.reused === true && Array.isArray(surveys) && surveys.length === 1 &&
        surveys[0].enter_date === '2026-11-02',
      `两次提交→${s1.code}/${s2.code} · reused=${s2.j?.reused} · 记录数=${Array.isArray(surveys) ? surveys.length : '?'} · 约定入场=${surveys?.[0]?.enter_date}`);

    const c1 = await post('/site/commission', { project_no: pno, dispatch_to: '王工', plan_date: '2026-11-03' }, site);
    const c2 = await post('/site/commission', { project_no: pno, dispatch_to: '李工', plan_date: '2026-11-04' }, site);
    const commissions = await (await apiGet(`/site/commission?project_no=${pno}`, site)).json();
    check('F9-申请调试幂等',
      c1.code < 300 && c2.code < 300 && c2.j?.reused === true && Array.isArray(commissions) && commissions.length === 1 &&
        commissions[0].dispatch_to === '李工',
      `两次提交→${c1.code}/${c2.code} · reused=${c2.j?.reused} · 记录数=${Array.isArray(commissions) ? commissions.length : '?'} · 派=${commissions?.[0]?.dispatch_to}`);
  }
}

const fails = summary('API 回归');
// ★ 本套件会留测试数据（自建靶建的商机/批次等）—— 跑完想回到干净态：
console.log('   （本套件会留测试数据；复位：npm run e2e:clean）')
exitWith(fails);
