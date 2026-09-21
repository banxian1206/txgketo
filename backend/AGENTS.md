# AGENTS.md — 同兴高科项目管理系统 · AI 开发指令

本项目**由 AI 开发**。每次会话开始先读本文件，再按 §4 流程施工。

## 1. 项目一句话

广东同兴高科智能装备有限公司（TXGK / 品牌 TXAM）的项目型制造（ETO）全生命周期系统：
**商机 → 立项 → 工程设计（设计BOM+材料BOM）→ 采购 → 仓库 → 制造 → 装配调试 → 发货发运 → 现场安装 → 现场调试 → 客户验收 → 质保售后**。
纯内网私有部署，**不集成任何外部系统**。手机端是主要终端（仓库/车间/现场没有固定办公地点）。

## 2. 文档地图（**先读再写，禁止凭记忆写代码**）

| 你要做的事 | 必读 |
|---|---|
| 业务怎么走、每个环节谁干什么 | `../00 方案·业务与建设.md` §3（主线 + 核心机制） |
| 编号怎么生成、怎么校验 | `../01 编码规则·解读与落地.md` |
| 表结构、字段、约束 | `../02 数据模型.md` |
| 终端 / OCR / AI 助手 | `../03 终端与识别.md` |
| AI 助手有哪些能力、问什么 | `../04 AI助手与物料状态链.md` |
| 工程设计流转怎么走（提交/审核/冻结/改版） | `../05 工程设计流转·审核·冻结·改版.md` |
| 当前做到哪了 | 本文件 §8 |

## 3. 技术栈（**不得擅自新增依赖**，要加先在 `../02` 或本节补一条决策）

| 层 | 选型 |
|---|---|
| 后端 | Python 3.11 · FastAPI · SQLAlchemy 2.0 · Alembic · Pydantic v2 |
| 数据库 | PostgreSQL 17（dev 端口 **35432**，库 txgk / txgk_test） |
| 前端 | React 18 · TypeScript · Vite（端口 **5207**）· Ant Design 5 |
| 手机端 | 同一套 Web 代码（响应式）+ 后续 Capacitor 打包 |
| 部署 | Docker Compose 单机（**不要 Redis / 消息队列 / K8s**，30 人规模用不上） |

## 4. 每次会话的工作流程

1. 读 §2 对应文档章节（**需求细节以文档为准**）
2. 后端：`models/` → alembic 迁移 → `services/`（注释标注来源章节，如 `# 01 卷 §6.1`）→ `api/routes/` → pytest
3. 前端：`api/` client → 页面 → 组件 → `npm run build && npx tsc --noEmit`
4. 跑 §5 自测命令，全绿才算完成
5. commit：`feat(T02): 发号引擎（01 卷 §6.1）`

## 5. 自测命令

```bash
# 基础设施（★ 必须带 -f，项目名已在 compose 里写死为 txgketo）
docker compose -f deploy/docker-compose.dev.yml up -d

# 后端
cd backend
uv pip install -r requirements-dev.txt
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m scripts.seed                      # 首次必做：组织/权限/角色/编号规则/admin
.venv/bin/python -m pytest -q                         # 单元测试（纯逻辑，不需要库）
.venv/bin/python -m uvicorn app.main:app --reload --port 8208
curl -s http://127.0.0.1:8208/api/v1/health           # {"status":"ok"}

# 前端
cd frontend && npm run dev                            # http://127.0.0.1:5207
npm run build && npx tsc --noEmit
```

初始账号：**admin / admin12345**（上线前必须改）。

## 6. 铁律

1. **编号只能由发号引擎生成**（`services/numbering.py`），任何地方禁止手工拼编号
2. **图号 = 物料号**（自制件/定制件），不要建图号↔物料号映射表
3. **自制件必带 project_no，标准件必须为 NULL** —— 这条 CHECK 约束是防串项的核心，不要绕过
4. **一切改动都是变更，必须走审批**（客户原话）；不要允许"私下改一下"
5. **所有写操作落 audit_log**（`services/audit.py`）
6. **不做工序级报工、不做工时统计** —— 车间只管"下任务 + 验收零件"（客户原则）
7. **OCR 结果永远只作候选，必须人工确认后写入**
8. **AI 助手只读**，不得提供任何写操作
9. **文档没写的业务规则，停下来问，不要自己发明**
10. **端口一律以 `../PORTS.md` 为准**：前端 5207 / 后端 8208 / PG 35432

## 7. 目录结构

```
backend/
  app/
    core/        config · db · security
    models/      base · platform · numbering · project  …
    services/    numbering（发号引擎）· audit  …
    api/         deps · schemas · routes/*
  alembic/       迁移
  scripts/       seed.py
  tests/         pytest
frontend/        React + Vite（待建）
deploy/          docker-compose.dev.yml
```

## 8. 当前进度（交接记录）

> 更新于：**05 卷 P6 改版（ECN）**落地（改版申请 → 总监裁决/下发 → 改版任务 → 重走两级审核 → 新版本；BOM 行替代；影响面人工处理；冻结内容改版必须走申请，新版/程序/图纸都被门禁拦住）。
> 下一步：**05 卷 P7 工作台/移动端**（仓库手机看电子图纸 + 拍照验收、各工作台默认筛选）。

### 8.1 采购状态线（客户口径，别再改回去了）

```
待采购（在采购池） --合并/单条下单--> 在途（等货，可分多批）
      --仓库验收合格--> 待入库 --仓库入库--> 已入库 / 直发现场：现场已验收
      --仓库验收不合格--> 不合格 --采购协商--> 换货（原供应商补发，回「在途」）
                                                  / 退货（退给原供应商，需求新建一条待采购回采购池重买）
```

- `REQUEST_STATUS = ("待采购", "在途", "待入库", "部分到货", "已入库", "现场已验收", "不合格", "已退货", "已取消")`
- `RECEIPT_STATUS = ("待入库", "已入库", "现场已验收", "不合格", "已换货", "已退货")`（到货单状态）
- **收货地点在下单时就定**（`deliver_to` + `deliver_address`），直发客户现场必填地址
- **仓库只有两个动作：验收（合格/不合格）· 入库**；到货/验收/入库都是**分批**的，
  一个采购单可以分多次送 → 分批验收、分批入库，剩下的算未到货（`部分到货`）。
  验收合格 → 待入库；不合格 → 退到采购的「**验收不合格**」
- **采购只有三个动作：下单 · 取消（未到的部分）· 更改供应商**；
  验收不合格由采购跟供应商协商：**换货**（原供应商补发）/ **退货**（需求回池重采）。
  ★ 退货≠不要了：原行数量减掉、到货单记「已退货」，同时**新建一条 `待采购` 需求回采购池**
  （`source='退货重采'`、`origin_request_id` 指回原需求），可换供应商重新合并下单；
  到货单的 `retries` / 采购单详情的「流转记录」都能看到它后来下成了哪张单
  采购侧不登记到货/发货，状态被仓库推着变
- **零件归属**：`purchase_request.part_no`（图号）——合并单里能看出「这 10 个方通分别给哪个零件的」
- 常规件通道：设备设计面「生成采购需求（进池）」= **已冻结（发布过）的** BOM 展开 − 库存 − 在跑需求（幂等，重复点不会重复进池）；草稿/审核中的行不算数（05 卷 §4）
- **发布 = 采购触发（05 卷 §5，P5）**：评审发布时按这一批冻结内容自动进池 —— 机械/电气发布→标准件/定制件；工艺发布→原材料/外协件；程序不采购。每条带 `source_release_id`（哪次发布冻结）；采购池显示来源/发布批次/归属/申请人；手工申请 `POST /purchase/manual-request` 免审核直入池（归属：项目/辅料/办公用品/其他）
- ★ **单据编号**：TK/GR/MI/RV/RL 模板不含项目号 → 一律**全局按年**取号（`scope_key=year_scope_key()`）；修正前按项目取号会跨项目撞号（迁移 `a7c1e3f50b26`）
- 长周期件立项即下单：状态「在途」+ 自动发号（旧「已下单」中间态已归一，迁移 `e9c06543ffaa`）
- 合并单 = 一张单（一个 `po_no`）+ 多行需求，**每行带项目/设备归属**；
  采购单详情（`GET /purchase/orders/{key}`）就是仓库对单、以后发货对单的地方
- **退换货留痕**（到货单上）：`inspect_note` 仓库不合格原因、`resolve_note` 采购协商备注、`resolved_by/resolved_at` 处理人/时间；
  采购单详情的行展开是「流转记录」（验收 + 处理 + 经办），行上显示「原订购 X · 换 Y · 退 Z」；
  采购工作台有独立的「退换记录」页签
- 状态重算：`_recalc_request_status()`（由到货单反推，验收/入库/协商后调用；注意 `autoflush=False`，改完先 `session.flush()`）

### 8.2 已完成（可用的功能）

| 模块 | 状态 | 关键落点 |
|---|---|---|
| 平台基础（组织/用户/角色/权限/操作日志） | ✅ | `models/platform.py` |
| 发号引擎（规则表+行锁取号+图号解析+父级推导） | ✅ | `services/numbering.py` |
| 商机登记（发号/客户/联系人/资料包/编辑留痕） | ✅ | `routes/project.py` |
| 成交登记 / 关闭订单（阶段状态机） | ✅ | `services/project_stage.py` |
| 立项（团队/设备清单/节点计划/长周期件/生成任务） | ✅ | `routes/initiation.py`、`routes/tasks.py` |
| 任务体系（我的任务、立项自动分派） | ✅ | `models/task.py` |
| 标准库三层（类别→品类→型号，规格模板，防重复建码） | ✅ | `models/library.py`、`routes/library.py` |
| 工程设计（图纸树/版本/设计BOM/材料BOM） | ✅ | `models/engineering.py`、`routes/engineering.py` |
| **设计评审（05 卷 P3）** | ✅ | `models/review.py`（评审单/明细/审核记录/发布）+ `services/review_flow.py`（两级审核、发布=冻结、撤回/退回、任务联动）+ `routes/reviews.py`、`pages/Reviews.tsx`、`components/SubmitReviewModal.tsx`/`ReviewDetailModal.tsx`；图纸改「上传草稿 + 提交评审」，不再单级发布 |
| **PLC 程序版本（05 卷 P4）** | ✅ | `models/program.py`（程序 + 程序版本）+ `routes/programs.py`（建程序/上传草稿/改版/版本留档）；程序走评审单（`review_flow` 支持 PROGRAM，发布后任务联动）；设计面「PLC 程序版本」卡片 |
| **发布→采购触发 + 手工申请（05 卷 P5）** | ✅ | `services/bom_demand.py`（`release_demand`/`plan_release_purchase`/`create_release_demands`，BUY_TYPES 加外协/定制）；发布时自动进池（`review_flow._publish_round`）；`POST /purchase/manual-request`；`purchase_request` 加 attribution/requester_id/source_release_id，project_no 可空；采购池显示来源/批次/归属/申请人；`components/ManualPurchaseModal.tsx` |
| **改版申请 ECN（05 卷 P6）** | ✅ | `models/change.py` + `services/change_flow.py`（申请/裁决/下发/修订/影响面/完成）+ `routes/changes.py`；图纸/程序/BOM 行的 new-version 被门禁拦住（必须先批准并下发）；BOM 替代行 `superseded_by_id`（旧行排除出需求）；`pages/Changes.tsx`、`components/ChangeRequestModal.tsx`/`ChangeDetailModal.tsx` |
| 供应商主数据 + 报价 + 能供品类 | ✅ | `models/purchasing.py`、`routes/suppliers.py` |
| 推荐供应商（多路证据打分） | ✅ | `GET /purchase/recommend/{item_no}` |
| 价格参考（上次成交/历史区间/各家报价） | ✅ | `GET /purchase/price-reference/{item_no}` |
| **采购池 + 合并下单**（后端 + 前端） | ✅ | `GET /purchase/pool`、`POST /purchase/merge-order`；`pages/PurchaseWorkbench.tsx`、`components/MergeOrderModal.tsx` |
| **BOM → 净需求 → 采购池（常规件）** | ✅ | `services/bom_demand.py`（标准件+原材料、图纸 qty 连乘、扣库存/扣在跑需求）；`POST /projects/{no}/equipment/{equip}/generate-purchase`；`EquipmentDesign.tsx`「生成采购需求（进池）」 |
| **采购单视图 + 采购三动作** | ✅ | `GET /purchase/orders`、`.../cancel`、`.../change-supplier`、`.../negotiate`（验收不合格→换货/退货）；`components/PurchaseOrderDrawer.tsx`、`components/ReceiptNegotiateModal.tsx` |
| **仓库两个动作：验收 / 入库（分批）** | ✅ | `POST /projects/{no}/purchase-requests/{id}/inspect`、`POST /goods-receipts/{id}/store`；`pages/Warehouse.tsx`、`warehouse/workbench`（`incoming` 待验收 / `pending_storage` 待入库） |
| 采购流程（下单/发货登记已废弃） | ✅ | `routes/initiation.py`（单条下单自动发号，含 `deliver_to/deliver_address`） |
| 仓库三件事（验收/入库/领料单） | ✅ | `models/warehouse.py`、`routes/warehouse.py` |
| **组织与岗位（05 卷 P1）** | ✅ | `models/platform.py`（`PROFESSIONS`/`POSITIONS`）· `services/reviewers.py`（组长→总监审核链）· `scripts/seed.py`（工程部→机械/电气/程序/工艺组；旧设计部/工艺部停用）· 用户与岗位页 `pages/Users.tsx` |
| **任务体系改造（05 卷 P2）** | ✅ | `task.depends_on_id/parent_task_id`；立项派给设计组长、工艺挂机械（机械首次发布才解锁）；`POST /tasks/{id}/split` 组长拆分派工；`GET /my-tasks?scope=team` 我组；`pages/MyTasks.tsx` |
| 前端页面 | ✅ | 商机列表/详情/新建、我的任务、立项、设计工作面、采购工作台（采购池/采购单/验收不合格/退换记录/入库记录五页签）、供应商、标准库、仓库 |

### 8.3 ★ 未完成（下次会话要做的）

| # | 事项 | 说明 |
|---|---|---|
| 1 | Excel 历史采购导入 | 客户已确认后期要做（物料/供应商/单价/数量/日期 → 写价格库） |
| 2 | 制造 / 装配 / 发运 / 现场 / 验收 / 售后 | 流程上还没做（见 `../00 方案` §3 S5–S11） |
| 3 | 领料单数量算法对齐 | `warehouse/generate-issue` 还是旧算法（材料只乘直接父件、标准件不乘）；建议改成 `bom_demand` 那套按树累计 |
| 4 | 工程设计流转（05 卷 P7） | P7 工作台/移动端（仓库手机看电子图纸 + 拍照验收、各工作台默认筛选）；口径见 `../05 工程设计流转·审核·冻结·改版.md` |

> 本轮顺手修复：`update_purchase_request` 漏导入 `REQUEST_STATUS`，改采购需求状态会 500。

### 8.4 关键接口速查（新增的）

```
GET  /api/v1/purchase/pool                       采购池（按物料归拢，标 mergeable）
POST /api/v1/purchase/merge-order                合并下单（多条需求 → 一个 po_no）
GET  /api/v1/purchase/orders                     采购单列表（按 po_no 归拢，含状态/金额/归属）
GET  /api/v1/purchase/orders/{key}               采购单详情（每行：项目/设备/价格/到货单）
POST /api/v1/purchase/orders/{key}/cancel        取消未到的部分（已到货的按实际留着）
POST /api/v1/purchase/orders/{key}/change-supplier  更改供应商（还没到的行；可顺便改价）
POST /api/v1/purchase/orders/{key}/negotiate     验收不合格处理：换货 / 退货
POST /api/v1/projects/{no}/equipment/{equip}/generate-purchase  BOM → 净需求 → 采购池（扣库存/在途，幂等）
POST /api/v1/projects/{no}/purchase-requests/{id}/order    单条下单（自动发号，含 deliver_to/address）
POST /api/v1/projects/{no}/purchase-requests/{id}/inspect   仓库验收（分批；合格→待入库，不合格→采购）
POST /api/v1/goods-receipts/{id}/store           入库（分批；记库位+库存+流水）
GET  /api/v1/goods-receipts?status=待入库        到货单（待入库/已入库/现场已验收/不合格/已换货/已退货）
GET  /api/v1/warehouse/workbench                  仓库待办（incoming 待验收 / pending_storage 待入库 / 领料）
GET  /api/v1/my-tasks?scope=mine|team             我的任务 / 我组任务（组长台；blocked 字段标「等待前置」）
POST /api/v1/tasks/{id}/split                     组长拆分派工：一条任务拆给多个组员（子任务继承前置依赖）
GET  /api/v1/tasks/{id}/review-candidates         可提交评审的草稿内容（图纸/设计BOM/材料BOM/自制外协判定）
POST /api/v1/tasks/{id}/submit-review             勾选提交评审（任务级一张单、多轮留档）
GET  /api/v1/tasks/{id}/review-ticket             任务的评审单（多轮明细 + 审核记录 + 发布批次）
GET  /api/v1/review-tickets?scope=todo|mine|all   评审列表（组长/总监待办）
POST /api/v1/review-tickets/{id}/review           两级审核（通过/退回，退回必填说明）
POST /api/v1/review-tickets/{id}/withdraw         提交人撤回（解锁回草稿）
GET  /api/v1/projects/{p}/equipment/{e}/my-design-tasks  设计面「我的提交」卡片
POST /api/v1/drawings/{no}/draft                  上传/更新草稿文件（审核走评审单，不再单级发布）
GET  /api/v1/projects/{p}/equipment/{e}/programs  PLC 程序列表（建程序用 POST 同路径）
POST /api/v1/programs/{id}/draft                  上传程序草稿
POST /api/v1/programs/{id}/new-version            程序改版（V2 → 草稿）
GET  /api/v1/programs/{id}/versions               程序版本留档
POST /api/v1/purchase/manual-request              手工采购申请（归属：项目/辅料/办公用品/其他；免审核直入池）
GET  /api/v1/change-requests?scope=pending|todo|mine|all  改版申请列表
POST /api/v1/change-requests                      提改版申请（挂具体冻结版本）
POST /api/v1/change-requests/{id}/decide          总监裁决（批准/否决；否决必填替代方案）
POST /api/v1/change-requests/{id}/dispatch        批准后下发改版任务
POST /api/v1/change-requests/{id}/revise-bom      BOM 行改版：生成替代草稿行
GET  /api/v1/change-requests/{id}/impact          影响面（已生成采购需求/已领料，人工处理）
GET/POST/PATCH /api/v1/users                      用户与岗位：专业/岗位（审核人）、组织、角色、停用、重置密码
POST /api/v1/warehouse/projects/{no}/equipment/{equip}/generate-issue  按 BOM 生成领料单
GET  /api/v1/purchase/recommend/{item_no}         推荐供应商（打分+理由）
GET  /api/v1/purchase/price-reference/{item_no}   价格参考
```

### 8.5 交付前自检（吃过两次亏，必须问）

每做完一块功能，先问自己三件事：
1. **谁用？**（设计师 / 采购员 / 仓库 / 项目经理）
2. **他从哪个页面进来？**（要滚很久吗？要猜吗？）
3. **进来之后知道下一步点哪里吗？**

> 教训：字段写进了模型和接口但忘了放前端表单（来源/旧改/邮箱）；入口藏在很深的表格里导致"做完了但找不到"。

### 8.6 当前环境

- 后端 :8208 · 前端 :5207 · PG 35432（`docker compose -f deploy/docker-compose.dev.yml up -d`，compose 顶层写死了 `name: txgketo`）
- 测试：`.venv/bin/python -m pytest -q` → **27 passed**
- 账号：admin / admin12345
