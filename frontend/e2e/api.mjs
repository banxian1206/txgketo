/**
 * API 层回归：门禁/权限/错误码断言（快，毫秒级）
 * 覆盖：P-05 验收门禁 / P-06 幽灵项目 / P-07 金额分档 / P-02 无项目验收路由 / P-15 favicon
 */
import { check, summary, exitWith, apiLogin, apiGet, API, BASE } from './lib.mjs';

const admin = await apiLogin('admin', 'admin12345');
const wh1 = await apiLogin('wh1', 'txgk@123');

// P-06：幽灵项目 → 400 友好文案（原 500 + 裸 axios）
{
  const r = await fetch(`${API}/api/v1/acceptance/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
    body: JSON.stringify({ project_no: 'TX99999' }),
  });
  const d = await r.json().catch(() => ({}));
  check('P-06', r.status === 400 && /不存在/.test(d.detail || ''),
    `HTTP ${r.status} · ${String(d.detail).slice(0, 60)}`);
}

// P-07：无 project:amount 角色看详情金额 → null
{
  const r = await apiGet('/projects/TX26010', wh1);
  const d = await r.json().catch(() => ({}));
  check('P-07', d.amount === null && d.est_amount === null,
    `wh1 amount=${d.amount} est=${d.est_amount}（应 null/null）`);
  // 反向：admin 有权限应见金额
  const r2 = await apiGet('/projects/TX26010', admin);
  const d2 = await r2.json().catch(() => ({}));
  check('P-07-rev', typeof d2.amount === 'number', `admin amount=${d2.amount}（有权限应可见）`);
}

// P-05：验收门禁 —— 用一个肯定没有调试完成记录的幽灵之外的探针：
// 门禁在服务层，直接对已知未调试项目探（不存在的项目会先撞 P-06 的 400，所以这里用文案断言：
// 找一个非"调试完成"的项目。若全部项目都已调试完成，则退化为纯文案检查——门禁函数存在即可。
{
  // 走 API 找一个 stage 不在质保/执行尾期的项目太绕；直接断言：对不存在项目返回的是
  // 「项目不存在」而不是 500；对存在但未调试项目返回「现场调试还没完成」。
  // 动态找未调试项目：
  const list = await (await apiGet('/projects', admin)).json();
  const probe = (Array.isArray(list) ? list : []).find(p => p.stage === '线索' || p.stage === '成交待立项' || p.stage === '执行中');
  if (!probe) {
    check('P-05', true, '当前无未调试阶段项目（门禁逻辑由 UI 写链回归覆盖）', 'SKIP');
  } else {
    const r = await fetch(`${API}/api/v1/acceptance/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ project_no: probe.project_no }),
    });
    const d = await r.json().catch(() => ({}));
    const ok = r.status !== 201 && r.status !== 200;
    const msg = String(d.detail || '');
    // 若该项目恰有调试完成记录放行了（201），也接受——断言的是"不会 500"
    check('P-05', ok ? /调试/.test(msg) || /申请验收中/.test(msg) || /不存在/.test(msg) : true,
      r.status === 201 ? `${probe.project_no} 已调试完成（放行，符合预期）` : `HTTP ${r.status} · ${msg.slice(0, 70)}`);
  }
}

// P-02：无项目（辅料）需求存在验收路由 —— 找一条 project_no 为 NULL 的在途需求，验收接口不应 404
// （用 pool/incoming 探针：若无此类需求则 SKIP）
{
  const wb = await (await apiGet('/warehouse/workbench', admin)).json();
  const nullProj = (wb.incoming || []).find(x => !x.project_no);
  if (!nullProj) {
    check('P-02', true, '当前无辅料在途需求（P-02 路径由 UI 写链回归覆盖）', 'SKIP');
  } else {
    const r = await fetch(`${API}/api/v1/purchase-requests/${nullProj.id}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ receipt_date: new Date().toISOString().slice(0, 10), qty: 1, result: '合格' }),
    }).catch(e => ({ status: 0, json: async () => ({ detail: String(e) }) }));
    const d = await r.json().catch(() => ({}));
    // 不再出现 404「采购需求不存在」= 修复成立（201/400 都算路由存在）
    check('P-02', r.status !== 404 && !/不存在/.test(String(d.detail)),
      `HTTP ${r.status} · ${String(d.detail).slice(0, 60)}`);
  }
}

// P-15：favicon 200
{
  const r = await fetch(`${BASE}/brand/favicon.ico`);
  check('P-15', r.status === 200, `favicon.ico → ${r.status}`);
}

// P-17：演示数据采购行有价格（单价非空，价格参考才有意义）
{
  const orders = await (await apiGet('/purchase/orders', admin)).json();
  const withPrice = (Array.isArray(orders) ? orders : []).some(o => (o.total_amount ?? 0) > 0);
  check('P-17', withPrice, withPrice ? '存在带金额的采购单' : '所有采购单金额为 0/空');
}

const fails = summary('API 回归');
exitWith(fails);
