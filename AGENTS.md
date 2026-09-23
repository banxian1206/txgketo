# AGENTS.md — 同兴高科项目管理系统 · AI 开发指令

本项目**由 AI 开发**。每次会话开始先读本文件，再按 §4 流程施工。

## 1. 项目一句话

广东同兴高科智能装备有限公司（TXGK / 品牌 TXAM）的项目型制造（ETO）全生命周期系统：
**商机 → 立项 → 工程设计（设计BOM+材料BOM）→ 采购 → 仓库 → 制造 → 装配调试 → 发货发运 → 现场安装 → 现场调试 → 客户验收 → 质保售后**。
纯内网私有部署，**不集成任何外部系统**。手机端是主要终端（仓库/车间/现场没有固定办公地点）。

## 2. 文档地图（**先读再写，禁止凭记忆写代码**）

| 你要做的事 | 必读 |
|---|---|
| 业务怎么走、每个环节谁干什么 | `docs/00-方案-业务与建设.md` §3（主线 + 核心机制） |
| 编号怎么生成、怎么校验 | `docs/01-编码规则-解读与落地.md` |
| 表结构、字段、约束 | `docs/02-数据模型.md` |
| 终端 / OCR / AI 助手 | `docs/03-终端与识别.md` |
| AI 助手有哪些能力、问什么 | `docs/04-AI助手与物料状态链.md` |
| 工程设计流转怎么走（提交/审核/冻结/改版） | `docs/05-工程设计流转-审核-冻结-改版.md` |
| 当前做到哪了 | 本文件 §8 |

## 3. 技术栈（**不得擅自新增依赖**，要加先在 `docs/02-数据模型.md` 或本节补一条决策）

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

> 更新于：**06 卷 F 步（账号权限收尾）**落地：接口级权限强校验（`require_permission`，采购下单类→`purchase:edit`、验收/入库/领料→`warehouse:edit`）、金额分档（`purchase:price` 采购价 / `project:amount` 项目金额，无权限返回 null）、**离职/停用一键转交**（任务/待审/项目角色/图·程序·BOM 归属）。
> **全部完成：S0 商机 → S1 立项 → S2 工程设计 → S3 采购 → S4 仓库 → S5 制造 → S6 装配与齐套率 → S7 发运 → S8 现场安装 → S9 现场调试 → S10 客户验收与质保 → S11 质保与售后。**
> 后续可做：超期扫描自动提醒（已有 60 天质保到期看板）；经营驾驶舱/成本毛利（三期）；Excel 历史采购导入；离线队列 + Capacitor 打包。

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
- ★ **直发客户现场：下单即建「现场待验收」到货单**（R2-01 · 2026-09-23 客户口径①）——现场立即可清点。
  需求保持「在途」（货还在“供应商→现场”，且「在途」在净需求 OPEN_STATUS 里，不会算漏重复采购）；
  仓库待验收列表**不含**直发（`deliver_to=公司仓库 OR NULL`）；现场清点「齐」后 → 到货单与需求均转「现场已验收」。
  仓库验收接口对直发单会直接返回已存在的「现场待验收」单（幂等，不再重复建单；兼容修复前的旧直发单）
- ★ **发货与收货一致**（2026-09-23 客户口径）——**勾「已发」的就是实际发出的**：发运清单可以只勾一部分（组件级勾选=整棵子树），
  现场**只清点本批已勾「已发」的项**（未发的留在后续批次，不要求也不接受清点）；
  **0 项已发：既不能发运（`depart` 硬拦）、也不能清点/签收**（否则成死批次）；**部分已发（如 50/100）= 软提示确认**（P-08）；
  逐项勾到/缺/损就是为了核对“发了什么就到了什么”。发运时通知 `SITE`；清点入口在无已发项时显示“未勾「已发」，不能清点”
- ★ **弹窗预填一律用 `AppModal + initialValues`**（不用 `useEffect`/手写 `setFieldsValue`，实测不可靠）：
  静态护栏 `PREFILL-无先设后开`（含裸 `setOpen`）+ UI 层“打开弹窗读初始值”断言双重兜底
- ★ **`project.pm_id` 必须与项目角色「项目经理」同步**（任命/解绑时写），所有“通知项目经理”分支（直发到货/入库完成/报修受理…）靠它定位；
  新增/换人会自动写入（修复前从未赋值 → 通知静默丢失，存量由迁移 `p2b3c4d5e6f7` 回填）
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
- **发布 = 采购触发（05 卷 §5，P5）**：评审发布时按这一批冻结内容自动进池 —— 机械/电气发布→标准件/定制件；工艺发布→原材料/外协件/定制件；程序不采购。每条带 `source_release_id`（哪次发布冻结）；采购池显示来源/发布批次/归属/申请人；手工申请 `POST /purchase/manual-request` 免审核直入池（归属：项目/辅料/办公用品/其他）
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
| **移动端 / 工作台（05 卷 P7）** | ✅ | `GET /drawings/{no}/file`、`/programs/{id}/file`（电子图纸/程序下载）；`goods_receipt.photos` + `POST/GET /goods-receipts/{id}/photos`；`routes/mobile.py`（`/m/home`、`/m/materials/{id}`）；`layouts/MobileLayout.tsx` + `pages/m/*`（仓库验收动线：看图→拍照→合格/不合格→入库；领料）；`utils/image.ts` 前端压缩；PWA manifest |
| **用户·角色·组织（06 卷 A 步）** | ✅ | 岗位三级 + `title`（迁移 `d0f4a6c83b25`）；组织增改停用 `POST/PATCH /orgs`；`GET /my-scope`；用户管理按部门范围（总监只能管本部门/只能勾本部门角色）；审核链 `director_for`（按部门找总监）+ 自动跳级；`pages/Users.tsx`（用户 / 组织架构 / 角色说明 三页签） |
| **工作台框架（06 卷 B 步）** | ✅ | `GET /workbench/me`（可见工作台 + 待办数字 + 我的项目）；侧栏三分组 + 按角色显示工作台；登录默认进「我的工作台」；`pages/Workbench.tsx` + `pages/workbench/DeptWorkbench.tsx`（部门台统一外壳）；`routes/workbench.py` |
| **站内消息 + 红点（06 卷 C 步）** | ✅ | `models/notify.py` + `services/notify.py` + `routes/notifications.py`；触发钩子：任务派工/转派/拆分、评审提交/通过/退回/发布、改版申请/裁决/下发/完成、验收合格→仓库·不合格→采购·直发现场→项目经理、**入库完成→采购+项目经理**、发布进采购池；**发布扇出**（项目团队全员 + 下游工艺 + 采购）；`components/NotificationsDrawer.tsx` + 顶栏铃铛红点（PC/移动端 60s 轮询）+ **我的工作台消息区**；**经理空缺自动跳级**、改版裁决通知只发申请人所在部门的总监、移动端消息链接映射 |
| **工程部工作台（06 卷 D 步）** | ✅ | `GET /workbench/eng/board`（设备×四专业进度、待终审、待裁决改版、卡住/超期）；`pages/workbench/EngWorkbench.tsx`（组员/经理/总监三视角按岗位自动切；我的任务·评审单·改版 / 我组待审·组员进度 / 部门看板） |
| **工作台收尾（06 卷 E 步）** | ✅ | 采购工作台待办头（待下单/在途/验收不合格/退换）+ 仓库待办头（待验收/待入库/待领料）；`GET /workbench/sales/board` + `SalesWorkbench.tsx`（商机/待立项/回款）；`GET /workbench/pm/board` + `PmWorkbench.tsx`（项目全链进度/风险）；车间台已接 S5 制造（`GET /workbench/shop`） |
| **账号与角色可用性（06 卷 §4）** | ✅ | 岗位统一三级（组员/经理/总监，迁移 `f3a5c7e9b104`）；**演示账号一键生成**（`services/demo.py` + `POST /demo-users` + `scripts/seed_demo_users.py`，19 个，密码 `txgk@123`）；**以某人身份查看**（`X-Impersonate`，GET 生效、写操作 403、顶栏橙色横幅） |
| **权限强校验 + 金额分档 + 离职转交（06 卷 F 步）** | ✅ | `deps.require_permission`/`has_permission`/`scrub_money`；采购下单类→`purchase:edit`、验收/入库/领料→`warehouse:edit`；金额：`purchase:price`（采购单/报价/价格参考）、`project:amount`（项目金额/列表）无权限返回 null；`POST /users/{id}/handover` 一键转交；前端 `hasPerm()` 按钮显隐 + Users 页「转交」弹窗 |
| **入口补齐（领料 / 回款 / 日志 / 其他入库·库位 / 价格参考）** | ✅ | ① 仓库待办页「生成领料单（按设备）」（`generateEquipmentIssue`）；② `POST /projects/{p}/payment-terms/{seq}/receive` 登记回款（多次累加、超额拦截）+ 项目详情付款节点「登记回款」（`payment:edit`）；③「用户与权限」加「操作日志」页签（`GET /audit-logs`）；④ 库存页「其他入库」（`POST /warehouse/inbound`，退料回库/盘盈）；⑤ 仓库新增「库位」页签 + 新建库位（`GET/POST /warehouse/locations`）；⑥ 采购工作台「价格参考」页签（物料搜索 + 历史价 + 推荐供应商，需 `purchase:price`，后端同步收紧） |
| **S5 制造（★只管两头）** | ✅ | 迁移 `g1b3d5f70c29`（`prod_order`/`prod_task`/`prod_acceptance`/`outsource_task`；编号 `PR{YY}{NNN}` 排产单 / `WX{YY}{NNN}` 外协单）；`services/manufacturing.py`（按设备**已发布图纸**展开：自制件→排产单、外协件→外协任务，幂等）；`routes/manufacturing.py`（生成/列表/工作台/下发/开工/验收/转运/外协发出·回厂·验收 + 拍照 `POST /manufacturing/photos` ✓鉴权取回）；`pages/Manufacturing.tsx`（PC）、`pages/m/ProductionM.tsx`（手机批量）、车间台 `GET /workbench/shop`；通知 MFG 角色 + 不合格通知项目团队/设计；**不做工序级报工/工时** |
| **S6 装配与齐套率** | ✅ | 迁移 `h2c4e6a81d35`（`kitting_snapshot` / `assembly_record`）；`services/kitting.py`（自制件看排产是否已转运、外协看是否合格、采购/库存看是否到货入库 → **齐套率只展示**）；`routes/assembly.py`（齐套率/概览/装配开始·完成/厂内调试/装配台）；`pages/Assembly.tsx`（项目 → 各设备齐套率进度条 + 明细 + 装配记录/调试）；**项目详情新增「齐套率」卡**；车间台计数装配中/待调试；**不设 100% 门槛，随时可开装** |
| **S7 发运（发货指令）** | ✅ | 迁移 `i3e5a7c92d48`（`shipment`/`shipment_line`/`site_receipt`；编号 `FH{YY}{NNN}`）→ **发运清单部分已按用户反馈重构为 `shipment_item`，见下一行** |
| **手机端补齐（S5–S7）** | ✅ | 底部入口**按角色/权限显示**（`MobileLayout.tsx`：首页/仓库/领料/制造/装配/发运/我的）；新增 `/m/assembly`（齐套率 + 开始装配/装配完成/厂内调试，拍照）、`/m/shipping`（勾选设备下指令 + 装箱/装车/发运/到货/现场验收，拍照）；`/m/home` 待办加上制造/装配/发运计数；现场到货验收允许 `ship:edit` 或 `site:edit`；演示账号新增 `delivery1`/`site1`/`service1`/`assy1`/`qc1`（密码 `txgk@123`） |
| **S8 现场安装** | ✅ | 迁移 `j4f6b8d03e59`（`site_survey`/`site_daily`/`site_issue`/`site_commission`/`site_incoming`）；`services/site.py`（勘测→定入场时间、每日汇报勾选+拍照/录像、现场问题→变更、申请调试→通知装配/项目、直发件现场清点）；`routes/site.py`（写 `site:edit` 或 `project:edit`，读登录）；**直发到货改为「现场待验收」（原来直接置“现场已验收”）**，现场清点后反推采购需求状态；`pages/m/SiteM.tsx`（现场主终端）、`pages/Site.tsx`（PC 现场台）；`/m/home` 加现场问题/待派调试计数 |
| **S9 现场调试 / S10 客户验收与质保** | ✅ | 迁移 `k5a7c9e14f60`（`acceptance`/`acceptance_document`）；现场调试：`site_commission` 加「调试完成」+ 每日汇报 stage（单机调试/联调）；验收：`services/acceptance.py`（调试完成→申请验收→传资料包→客户签字确认→**自动进入质保期**：`warranty_start=验收日`、`warranty_end=+质保月数`、项目阶段→质保）+ 60 天到期提醒（含质保金）；`routes/acceptance.py`（申请/资料包上传·下载·签收/客户确认/验收台）；`pages/Acceptance.tsx`（PC）+ SiteM「客户验收」页签；发运 → 项目自动进入「交付中」阶段 |
| **S11 质保与售后** | ✅ | 迁移 `l6b8d0f25a71`（`service_order`/`spare_part`/`spare_part_move`；编号 `SV{YY}{NNN}` 沿用既有规则）；`routes/service.py`（报修自动判定**在保/过保** → 派工 → 到场 → 处理完成（工时/照片）→ 客户签字关单；备件建账 + 收发（领出扣库存、可关联工单、低库存标红））；`pages/Service.tsx`（PC 售后台）+ `pages/m/ServiceM.tsx`（手机端，service:edit）；`/m/home` 加售后工单待办；质保到期提醒在验收台（60 天 + 质保金） |
| **全链路演示数据** | ✅ | `scripts/seed_demo_project.py`：用演示账号走**真实 API** 把 S0 商机 → 成交 → 立项 → 设计（评审/发布/进池）→ 采购（合并下单/验收/入库/直发）→ 领料 → 排产（合格转运/在制/返工）→ 外协 → 装配调试 → 发运（装箱/装车/到货/现场验收）→ 现场（勘测/日报/问题/申请调试）→ 客户验收（资料包/签字/**自动质保**）→ 售后工单/备件 → 回款，全部串起来；每次运行新建一个项目（不动已有数据）；跑法：`.venv/bin/python -m scripts.seed_demo_project` |
| **分段重测（S0→S1）** | ✅ | `scripts/seed_s0_s1.py`：**清空业务数据**（保留账号/组织/角色/标准库类目，序列归零）→ 重建 8 条常用标准库物料 → 走 S0 商机/成交 + S1 立项（团队/设备/节点/长周期件/派任务）；跑法：`DATABASE_URL=... .venv/bin/python -m scripts.seed_s0_s1`；⚠ admin 密码是 `admin12345`，其余演示账号 `txgk@123` |
| **S0→S11 端到端验收测试** | ✅ | `scripts/e2e_full_test.py`：模拟真实订单，全程 HTTP 接口（不查库、不改系统），每个动作后 GET 回读校验 + 权限抽查（3 项 403）+ 超额回款拦截；跑法：先复位业务数据再 `python -m scripts.e2e_full_test` |
| **首轮 e2e 问题修复（4+1 项）** | ✅ | ① **总装图不再排产/计入齐套**（`manufacturing.generate_orders` / `kitting.compute` 跳过 `parent_drawing_no is None` 的总装图——它是装配对象不是加工件）；② **直发件需求状态「待现场验收」**（`_recalc_request_status` 全直发时不再误显「待入库」；REQUEST_STATUS/单据汇总/再下单拦截同步）；③ **标准节点生成即带默认计划起止**（按合同周期均分，无周期则按交期天数/120 天兑底）；④ **评审单总监通过后状态「已发布」**（原「已通过」；前端 Reviews/ReviewDetailModal/EquipmentDesign 状态色同步）；⑤ **齐套率口径：已领到车间的料算到位**（库存 + 本项目已领走 ≥ 需求，不再因领料出库误报缺料）；⑥ **商机归属**：创建商机**必选「销售负责人」**（`ProjectCreateIn.sales_id` 必填；此前该字段在 schema 里重复定义被选填覆盖，导致 sales_id 为空、商机成交后从商务部台「消失」——商务无法全程跟进；商务部台按 sales_id 展示全周期+待回款）；e2e 增加「部门可见性抽查」：商务/项目经理/工程/仓库/制造/装配/发运/现场/售后 九个角色都能看到该订单；⑧ **必填项治理（用户要求）**：创建商机必填 = 客户/项目名/销售负责人(必选)/项目描述/项目地点/商机截止/联系人≥1(姓名+电话)；成交登记必填 = 签订日/交期/合同金额/质保月数/付款节点≥1；后端 422 强校验 + 前端红色校验双保险（注意：schemas.py 曾出现同名字段重复定义、选填覆盖必填，已清理并用 AST 检查）；其余（项目方式/线索来源/节拍产能/预估金额/竞争对手/风险备注/履约保证金等）保持选填；**S1–S11 动作级必填同步收紧（后端 400/422 + 前端校验）**：下单必填供应商（id或名称）｜仓库验收不合格必填原因｜入库必填库位｜领走必填领料人｜制造不合格/返工必填原因｜发运现场验收缺件/破损必填明细｜勘测必填约定入场时间｜每日汇报必须带照片｜申请调试必填派谁去｜验收通过必填客户签字人｜售后报修必填故障描述｜评审退回必填说明（原有）|⑦ **部门台口径**：商务部台/项目经理台对 **总监/管理员看全部门**，普通角色看自己归属的（此前 admin/总监打开商务部台是空白，被用户当作「订单丢失」） |
| **S7 发运 / S8 现场 重构（用户反馈）** | ✅ | 迁移 `m8d0f2b47a93`：`packing_list`（手填装箱）→ **`shipment_item` 发运清单**（按设备结构自动生成：组件→子组件→零件 + 标准件/原材料，数量按结构连乘）；**散件发运不装箱**，逐项勾「已发」+ 拍照（勾大组件=整棵子树），结构外补充项（说明书/备件/工具）手动加；现场**按同一份清单逐项清点**「到/缺/损」（漏项 400 拦下，缺/损必须写数量+原因，结论自动判定齐/缺件/破损并通知）；`site`/`shipping` 照片上传对 `ship:edit` 或 `site:edit` 开放；PC `Shipping.tsx` + 手机 `ShippingM.tsx` 同步 |
| **工艺改判「定制件」自动进池** | ✅ | 缺口：工艺把自制件改判定制件后不进采购池（只有外协件进）。已修：`bom_demand.release_demand` ③ 对「外协件/定制件」同等待遇；`bom_demand.equipment_demand`（设备面手动补跑）也纳入定制件/外协件的图号物料 |
| 供应商主数据 + 报价 + 能供品类 | ✅ | `models/purchasing.py`、`routes/suppliers.py` |
| 推荐供应商（多路证据打分） | ✅ | `GET /purchase/recommend/{item_no}` |
| 价格参考（上次成交/历史区间/各家报价） | ✅ | `GET /purchase/price-reference/{item_no}` |
| **采购池 + 合并下单**（后端 + 前端） | ✅ | `GET /purchase/pool`、`POST /purchase/merge-order`；`pages/PurchaseWorkbench.tsx`、`components/MergeOrderModal.tsx` |
| **BOM → 净需求 → 采购池（常规件）** | ✅ | `services/bom_demand.py`（标准件+原材料、图纸 qty 连乘、扣库存/扣在跑需求）；`POST /projects/{no}/equipment/{equip}/generate-purchase`；`EquipmentDesign.tsx`「生成采购需求（进池）」 |
| **采购单视图 + 采购三动作** | ✅ | `GET /purchase/orders`、`.../cancel`、`.../change-supplier`、`.../negotiate`（验收不合格→换货/退货）；`components/PurchaseOrderDrawer.tsx`、`components/ReceiptNegotiateModal.tsx` |
| **仓库两个动作：验收 / 入库（分批）** | ✅ | `POST /projects/{no}/purchase-requests/{id}/inspect`、`POST /goods-receipts/{id}/store`；`pages/Warehouse.tsx`、`warehouse/workbench`（`incoming` 待验收 / `pending_storage` 待入库） |
| 采购流程（下单/发货登记已废弃） | ✅ | `routes/initiation.py`（单条下单自动发号，含 `deliver_to/deliver_address`） |
| 仓库三件事（验收/入库/领料单） | ✅ | `models/warehouse.py`、`routes/warehouse.py` |
| **组织与岗位（05 卷 P1）** | ✅ | `models/platform.py`（`PROFESSIONS`/`POSITIONS`）· `services/reviewers.py`（经理→总监审核链）· `scripts/seed.py`（工程部→机械/电气/程序/工艺组；旧设计部/工艺部停用）· 用户与岗位页 `pages/Users.tsx` |
| **任务体系改造（05 卷 P2）** | ✅ | `task.depends_on_id/parent_task_id`；立项派给经理、工艺挂机械（机械首次发布才解锁）；`POST /tasks/{id}/split` 经理拆分派工；`GET /my-tasks?scope=team` 我组；`pages/MyTasks.tsx` |
| 前端页面 | ✅ | 商机列表/详情/新建、我的任务、立项、设计工作面、采购工作台（采购池/采购单/验收不合格/退换记录/入库记录五页签）、供应商、标准库、仓库 |

### 8.3 ★ 未完成（下次会话要做的）

| # | 事项 | 说明 |
|---|---|---|
| 1 | Excel 历史采购导入 | 客户已确认后期要做（物料/供应商/单价/数量/日期 → 写价格库） |
| 2 | 制造 / 装配 / 发运 / 现场 / 验收 / 售后 | 流程上还没做（见 `docs/00-方案-业务与建设.md` §3 S5–S11） |
| 3 | 领料单数量算法对齐 | `warehouse/generate-issue` 还是旧算法（材料只乘直接父件、标准件不乘）；建议改成 `bom_demand` 那套按树累计 |
| 4 | 移动端离线队列 + Capacitor 打包 | 03 卷：现场弱网「拍完先存本地、有网再传」；需要时再打包 APK/ipa（同一份代码） |
| 6 | **超期扫描（任务/交期到期提醒）** | 本期只展示“超期”，**自动扫描下期**。注：**没有“到货登记”这个动作**（新流程已废弃，AGENTS §8.1：采购侧不登记到货/发货，状态由仓库验收/入库推着变）——所以不存在“到货提醒”，仓库是主动看「待验收」清单收货；验收/入库的通知已接 |

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
GET  /api/v1/my-tasks?scope=mine|team             我的任务 / 我组任务（经理台；blocked 字段标「等待前置」）
POST /api/v1/tasks/{id}/split                     经理拆分派工：一条任务拆给多个组员（子任务继承前置依赖）
GET  /api/v1/tasks/{id}/review-candidates         可提交评审的草稿内容（图纸/设计BOM/材料BOM/自制外协判定）
POST /api/v1/tasks/{id}/submit-review             勾选提交评审（任务级一张单、多轮留档）
GET  /api/v1/tasks/{id}/review-ticket             任务的评审单（多轮明细 + 审核记录 + 发布批次）
GET  /api/v1/review-tickets?scope=todo|mine|all   评审列表（经理/总监待办）
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
GET  /api/v1/drawings/{no}/file                   电子图纸（当前版本附件，手机看图/外协随单）
GET  /api/v1/programs/{id}/file                   程序文件（当前版本附件）
POST /api/v1/goods-receipts/{id}/photos           验收拍照（手机端，多张）
GET  /api/v1/goods-receipts/{id}/photos/{idx}     看验收照片
GET  /api/v1/m/home                               手机端首页待办（按角色）
GET  /api/v1/m/materials/{request_id}             手机端一条货详情（物料+供应商+图纸+到货单/照片）
GET  /api/v1/my-scope                             我能管什么（是否管理员/总监、可勾角色、可选岗位）
POST /api/v1/demo-users                           演示账号：{action: create/disable/enable}（仅管理员）
   以某人身份查看（仅管理员，只读）：请求头 X-Impersonate: <user_id>；写操作一律 403
POST /api/v1/users/{id}/handover                  离职/停用一键转交：{to_user_id, deactivate}

制造（S5）—— 权限：查看 mfg:view，操作 mfg:edit（车间/系统专员/质检）
POST /api/v1/manufacturing/projects/{p}/equipment/{e}/generate-orders  按已发布图纸生成排产单（自制件）+ 外协任务（幂等）
GET  /api/v1/manufacturing/orders                  排产单列表（project_no/equip_no/status/overdue_only）
GET  /api/v1/manufacturing/workbench               车间台汇总
POST /api/v1/manufacturing/orders/{id}/dispatch    下发（原材料+图纸，photos 必填）
POST /api/v1/manufacturing/orders/{id}/start       开工
POST /api/v1/manufacturing/orders/{id}/accept      到期验收 {result: 合格/不合格/返工, photos}
POST /api/v1/manufacturing/orders/{id}/transfer    验收合格后转运装配区（photos 必填）
GET  /api/v1/manufacturing/outsource               外协列表
POST /api/v1/manufacturing/outsource/{id}/send|return|accept   外协发出 / 回厂 / 验收
POST /api/v1/manufacturing/photos                  制造拍照上传（multipart files）→ token
GET  /api/v1/manufacturing/photos?token=...        取制造照片（带鉴权）
GET  /api/v1/workbench/shop                        车间台（同 /manufacturing/workbench）

装配与齐套（S6）—— 权限：mfg:view / mfg:edit；**齐套率只展示，不设门槛**
GET  /api/v1/assembly/kitting?project_no=&equip_no=  一台设备齐套率 + 明细（到了多少 / 还差什么）
GET  /api/v1/assembly/kitting/overview?project_no=   项目下每台设备齐套率
POST /api/v1/assembly/records                       开始装配（整机/组件预装，快照当时齐套率）
POST /api/v1/assembly/records/{id}/finish           装配完成
POST /api/v1/assembly/records/{id}/debug            厂内调试记录 {result, note, photos}
GET  /api/v1/assembly/records                       装配记录列表
GET  /api/v1/assembly/workbench                     装配台（计数 + 概览 + 记录）

发运（S7）—— 写：ship:edit（项目经理 / 交付发运）；读：登录即可
GET  /api/v1/shipping/to-ship?project_no=            待发设备（装配完成且不在未完成批次）
POST /api/v1/shipping/instructions                   下达发货指令 {project_no, equip_nos[]}
GET  /api/v1/shipping/list | /workbench | /{id}      批次列表 / 发运台 / 详情
GET  /api/v1/shipping/{id}/items                     发运清单（按结构生成的行，含已发/拍照/清点结果）
POST /api/v1/shipping/{id}/items/generate            按设备结构生成发运清单（组件→零件+标准件/原材料）
POST /api/v1/shipping/{id}/items/manual              结构外补充项 {name, qty}
POST /api/v1/shipping/items/ship                     逐项勾「已发」{item_ids[], photos[]}（勾组件=子树全勾）
POST /api/v1/shipping/items/{item_id}/place          登记摆放位置照片
POST /api/v1/shipping/{id}/load                      装车 {vehicle, driver, plate_no, photos}
POST /api/v1/shipping/{id}/depart                    发运（在途）
POST /api/v1/shipping/{id}/arrive                    登记到货
POST /api/v1/shipping/{id}/receipt                   现场逐项清点 {checks:[{item_id,result:到/缺/损,received_qty,reason}], photos}（漏项 400）
POST/GET /api/v1/shipping/photos                     发运拍照上传 / 取回

移动端（03 卷）—— 底部入口按角色显示；页面均走「清单 + 勾选 + 拍照」
GET  /api/v1/m/home                                 手机首页待办（含 to_dispatch/to_accept/to_transfer/assembling/to_debug/shipments_open/shipments_receive）
页面：/m（首页）· /m/warehouse（验收·入库）· /m/issues（领料）· /m/production（制造）· /m/assembly（装配·齐套率）· /m/shipping（发运）· /m/site（现场）· /m/me

现场（S8）—— 写：site:edit 或 project:edit；读：登录即可
POST /api/v1/site/survey                              现场勘测（承重/通道/电/气/网 + 约定入场时间）
GET  /api/v1/site/survey?project_no=
POST /api/v1/site/daily                               每日汇报 {stage: 安装/单机调试/联调, done_items[], photos, videos, problem}
GET  /api/v1/site/daily?project_no=
POST /api/v1/site/issues | GET                    现场问题（→ 变更）
POST /api/v1/site/issues/{id}/link-change            {change_id} 或 {close:true}
POST /api/v1/site/commission                        申请调试 {dispatch_to, plan_date}
POST /api/v1/site/commission/{id}/arrive|start      已到现场 / 开始调试
GET  /api/v1/site/incoming?project_no=              待现场清点的直发件
POST /api/v1/site/incoming/{receipt_id}/accept      现场清点 {result: 齐/缺件/破损, shortage_detail[], photos}
GET  /api/v1/site/workbench                         现场台汇总
POST/GET /api/v1/site/photos                        现场拍照/录像上传 / 取回
POST /api/v1/site/commission/{id}/finish            调试完成（可申请验收）

验收与质保（S10）—— 写：acceptance:edit；读：登录即可
POST /api/v1/acceptance/apply                        申请客户验收 {project_no}
GET  /api/v1/acceptance?project_no=                  验收单列表
POST /api/v1/acceptance/{id}/documents               上传验收资料包（multipart, doc_type）
GET  /api/v1/acceptance/documents/{doc_id}           下载资料（带鉴权）
POST /api/v1/acceptance/documents/{doc_id}/sign      标记已签
POST /api/v1/acceptance/{id}/confirm                 客户确认 {result: 通过/不通过, signed_by, accepted_at} → 自动质保
GET  /api/v1/acceptance/workbench                    验收台 + 质保到期提醒（60 天）

售后（S11）—— 写：service:edit；读：登录即可
POST /api/v1/service/orders                          报修（自动判定在保/过保）
GET  /api/v1/service/orders | /workbench             工单列表 / 售后台
POST /api/v1/service/orders/{id}/dispatch|arrive|fix|sign   派工 / 到场 / 处理完成 / 客户签字关单
GET  /api/v1/service/parts | POST /parts             备件列表 / 建账
POST /api/v1/service/parts/move                     备件收发（领出/退回/补货，可关联工单）
GET  /api/v1/service/parts/moves                    收发记录
POST/GET /api/v1/service/photos                     售后拍照上传 / 取回
POST /api/v1/projects/{p}/payment-terms/{seq}/receive  登记回款（多次累加；payment:edit）
   权限强校验：采购下单类→purchase:edit；验收/入库/领料→warehouse:edit；金额→purchase:price / project:amount（无权限返回 null）
POST/PATCH /api/v1/orgs（/{id}）                   组织维护：部门/组 增改停用（停用不删）
GET  /api/v1/users?org_id&role_code&is_active&q   用户列表（筛选；管理权限在后端校验）
GET  /api/v1/workbench/me                          我的工作台：可见工作台 + 待办数字 + 我的项目
GET  /api/v1/workbench/eng/board                  工程部看板：设备×四专业进度 + 待终审 + 待裁决 + 超期
GET  /api/v1/workbench/sales/board                商务部看板：我的商机/待立项/回款
GET  /api/v1/workbench/pm/board                   项目经理看板：项目全链进度 + 风险
GET  /api/v1/notifications                         站内消息列表（?unread=true 只看未读）
GET  /api/v1/notifications/unread-count            未读数（红点）
POST /api/v1/notifications/{id}/read · /read-all   已读 / 全部已读
POST /api/v1/warehouse/projects/{no}/equipment/{equip}/generate-issue  按 BOM 生成领料单
GET  /api/v1/purchase/recommend/{item_no}         推荐供应商（打分+理由）
GET  /api/v1/purchase/price-reference/{item_no}   价格参考（需 purchase:price，无权限 403）
GET  /api/v1/warehouse/locations                  库位列表
POST /api/v1/warehouse/locations                  新建库位（warehouse:edit）
POST /api/v1/warehouse/inbound                    其他入库（退料回库/盘盈，warehouse:edit）
```

### 8.5 交付前自检（吃过两次亏，必须问）

每做完一块功能，先问自己三件事：
1. **谁用？**（设计师 / 采购员 / 仓库 / 项目经理）
2. **他从哪个页面进来？**（要滚很久吗？要猜吗？）
3. **进来之后知道下一步点哪里吗？**

> 教训：字段写进了模型和接口但忘了放前端表单（来源/旧改/邮箱）；入口藏在很深的表格里导致"做完了但找不到"。

### 8.6 当前环境

- 后端 :8208 · 前端 :5207 · PG 35432（`docker compose -f deploy/docker-compose.dev.yml up -d`，compose 顶层写死了 `name: txgketo`）
- 测试：`.venv/bin/python -m pytest -q` → **31 passed**
- 账号：admin / admin12345

### 8.7 产品决策（2026-09-22，客户确认）

| # | 决策 | 落地位置 |
|---|---|---|
| 1 | **附件必填**：图纸/程序没有上传文件，不允许提交评审 | `review_flow.submit_round`（DRAWING / PROGRAM 分支校验 `ver.file_path`） |
| 2 | **总装图强制随批发布**：总装图是设备的父级，本批任何内容发布时它必须同时发布（或已发布） | `review_flow.submit_round`（校验 `{p}-{equip}-00-00-00-00` 在勾选内或已发布） |
| 3 | **超额验收硬拦**：到货数量不得超过「订购 − 有效到货」（多送的走换货/退货或先改需求） | `initiation.inspect_purchase_request` |
| 4 | **同型设备复制设计**：立项时同型第二台（01B…）在设计发布后自动继承母机图纸/BOM/程序（图号换成本设备、附件复制、BOM 直接冻结、生成自己的采购需求、设计任务置为已完成） | `services/equipment_clone.py`（`_publish_round` 发布后 + 建设备时触发） |

- 同型判定：同项目、同 `seq_no`、不同 `letter`（01A/01B/01C…）。
- 同型复制**幂等**：按图号/父件+子件/程序名去重，重复发布不重复进池；`equipment_demand` 依赖物料行 `source_type`，复制时必须同步生成/校正 Item（图号即物料号）。
- **待办**：母机改版（ECN）自动同步到同型设备尚未实现，留待后续。
- 自查脚本：`backend/scripts/multiproj_walkthrough.py`（4 项目并发 S0→S11 + 深度功能点，跑前会复位业务数据）。
- 旧脚本：`seed_s0_s1.py` 已修表清单；`e2e_full_test.py` / `e2e_complex_test.py` 仍需补齐「附件必填 / 总装图强制」两步（否则会被新规则 400 拦下）。
