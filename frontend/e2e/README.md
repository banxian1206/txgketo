# E2E 护栏（重构 Phase 1.0）

真实浏览器端到端回归 —— **重构每一步的准入证**。依据：`docs/99-E2E测试报告-2026-09-22-前端UI.md` §9 的 22 项回归点。

## 跑法

```bash
# 前置：后端 :8208 + 前端 :5207 已起（见 AGENTS §5）
cd frontend
npm run e2e            # 全量：静态 → API → UI（约 2~3 分钟）
npm run e2e:static     # 只静态 grep 断言（秒级，commit 前必跑）
npm run e2e:api        # 只 API 门禁/权限断言
npm run e2e:ui         # 只浏览器（冒烟 34 路由 + 交互写链）
```

任一断言红 → `exit 1`（可直接接 CI）。结果快照：`e2e/shots/last-results.json`。

## 三层结构

| 文件 | 覆盖 | 断言数 |
|---|---|---|
| `static.mjs` | 反模式不许写回来：`window.prompt`/`destroyOnClose`/`addonAfter` = 0、Skeleton/Alert/标准库入口存在、状态色 Map 基线、emoji 图标禁入 | 8 |
| `api.mjs` | 门禁与权限：P-06 幽灵 400、P-07 金额分档（wh1=null/admin=有）、P-05 调试门禁、P-02 无项目验收路由、P-15 favicon、P-17 演示价格 | ~8 |
| `ui.mjs` | 冒烟（PC 25 + 移动 9 路由，零 pageerror/4xx/antd 警告）+ 交互写链：P-09 校验、S0→S1 建项目、P-03 预选、P-01 建图、P-02 辅料验收、P-11 库位、P-05 门禁、P-10/04/13/14/17/18/21，P-08 有条件验 | ~25 |

## 约定

- **浏览器**：`channel:'chrome'`（系统 Chrome）——不依赖 playwright 缓存，缓存被系统清掉也不影响（§9.6 教训）
- **账号**：admin/admin12345 · wh1/txgk@123（dev 库，见 AGENTS §5）
- **写数据**：`ui.mjs` 每轮创建 1 个 `E2E回归-*` 商机（含建图/下单/验收）—— 这是护栏的正常代价；跑完可从项目列表关闭/删除
- **SKIP 语义**：当前无数据无法验的项（如 P-08 无待发批次）标 SKIP 不算失败，有数据时自动转 PASS/FAIL
- **加断言**：新修的 bug → 在对应层加一条 `check('P-xx', ...)`，防止回归

## 历史

- 2026-09-22：从 `/tmp/e2e`（44 个一次性脚本）提炼入库；原始 22 项问题已全部修复并复测（报告 §9）
- 2026-09-23：断言随功能/修复增长至 **60 条**（R2/R3 复核、PREFILL 静态+UI 实读、SHIP 发货收货一致、REMEMBER 记住密码×3、BRAND/OFFLINE）——新功能必须同步补断言（AGENTS §4 第 5 步）
