// theme/status.ts —— 全站唯一状态色总表（重构 1.5 · 视觉规范 §2）
// 由 41 个散落 Map 收敛而来（同义合并、跨表冲突按规范定色）。
// 规则：① 颜色只表达状态，不作装饰 ② 一个状态词在同域内只有一个色 ③ 新状态词必须后端先有，前端不发明。
// 用法：import { PROD_STATUS as STATUS_COLOR } from '../../theme/status'（文件内引用零改动）


export const PROJECT_STAGE: Record<string, string> = { 交付中: 'cyan', 已关闭: 'default', 成交待立项: 'gold', 执行中: 'processing', 线索: 'blue', 质保: 'purple' }

export const REVIEW_STATUS: Record<string, string> = { 已发布: 'success', 已撤回: 'default', 已退回: 'error', 已通过: 'success', 待总监审: 'gold', 待经理审: 'processing' }

export const CHANGE_STATUS: Record<string, string> = { 已下发: 'gold', 已否决: 'error', 已完成: 'success', 已归档: 'default', 已批准: 'blue', 待裁决: 'processing' }

export const TASK_STATUS: Record<string, string> = { 已取消: 'default', 已完成: 'success', 待开始: 'default', 进行中: 'processing' }

// 付款计划变更单（2026-09-30）：状态值来自 models/payment_change.PAY_CHANGE_STATUS
export const PAY_CHANGE_STATUS: Record<string, string> = { 已否决: 'error', 已批准: 'success', 已撤销: 'default', 待商务总监审: 'processing' }

export const TASK_TYPE: Record<string, string> = { 制造: 'purple', 现场: 'magenta', 装配: 'cyan', 设计: 'blue', 调试: 'orange', 采购: 'gold' }

export const DRAWING_STATUS: Record<string, string> = { 审核中: 'processing', 已作废: 'default', 已发布: 'success', 草稿: 'default' }

export const DESIGN_STATE: Record<string, string> = { 完整: 'success', 已提交: 'gold', 未开始: 'default', 设计中: 'processing' }

export const BOM_STATUS: Record<string, string> = { 审核中: 'processing', 已冻结: 'success', 草稿: 'default' }

export const PROD_STATUS: Record<string, string> = { 制造中: 'processing', 完工待验收: 'gold', 已派工: 'processing', 已转运: 'success', 待领料: 'default', 返工: 'error' }

export const OUTSOURCE_STATUS: Record<string, string> = { 合格: 'success', 回厂待检: 'gold', 外协中: 'processing', 已取消: 'default', 待发出: 'default' }

export const ASSEMBLY_STATUS: Record<string, string> = { 已装配: 'gold', 装配中: 'processing', 调试中: 'gold', 调试完成: 'success' }

export const SHIP_STATUS: Record<string, string> = { 发货中: 'processing', 在途: 'gold', 已到货: 'blue', 已指令: 'default', 已签收: 'success', 已装车: 'cyan' }

export const RECEIPT_STATUS: Record<string, string> = { 不合格: 'error', 已入库: 'success', 已换货: 'orange', 已退货: 'default', 待入库: 'processing', 现场已验收: 'purple' }

// ★ 采购单一套状态机（客户口径 2026-10-07）：单头/单行共用；不再有「已批准 / 执行中」
export const ORDER_STATUS: Record<string, string> = { 草稿: 'default', 待经理审: 'processing', 待总监审: 'processing', 已退回: 'error', 在途: 'gold', 部分到货: 'cyan', 待入库: 'processing', 已入库: 'success', 不合格: 'error', 已退货: 'default', 已取消: 'default', 已完成: 'success', 已作废: 'default', 已关闭: 'default' }

// 采购单行：与单头同一套词表（审批阶段跟单头，之后走 在途→待入库→已入库）
export const PURCHASE_LINE_STATUS: Record<string, string> = { 草稿: 'default', 待经理审: 'processing', 待总监审: 'processing', 已退回: 'error', 在途: 'gold', 部分到货: 'cyan', 待入库: 'processing', 已入库: 'success', 现场已验收: 'purple', 不合格: 'error', 已退货: 'default', 已取消: 'default' }

export const LONGLEAD_STATUS: Record<string, string> = { 在途: 'gold', 已下单: 'blue', 已到货: 'success', 已取消: 'default', 已完成: 'success', 延期: 'error', 待采购: 'default', 未开始: 'default', 进行中: 'processing' }

export const ACCEPTANCE_STATUS: Record<string, string> = { 已通过: 'success', 待验收: 'gold', 未通过: 'error' }

export const SERVICE_ORDER_STATUS: Record<string, string> = { 已关闭: 'success', 已到场: 'gold', 已派工: 'processing', 待受理: 'error', 待客户签字: 'cyan' }

export const SITE_ISSUE_STATUS: Record<string, string> = { 已转变更: 'processing', 已闭环: 'success', 待处理: 'error' }

export const SITE_COMMISSION_STATUS: Record<string, string> = { 已到现场: 'processing', 已开始调试: 'success', 已申请: 'gold' }

export const WH_ISSUE_STATUS: Record<string, string> = { 已备料: 'processing', 部分领料: 'warning', 已领走: 'success', 待备料: 'gold' }

export const ENG_BOARD_STATE: Record<string, string> = { 审核中: 'processing', 已发布: 'success', 已退回: 'error', 待开始: 'default', 未派: 'default', 进行中: 'blue' }

/**
 * ★ 通知类型 → 中文名（**唯一出口**，2026-10-05 逐页走查加）
 *
 * 之前这张表在 `NotificationsDrawer` 里，前端另一处（我的工作台的消息区）**根本没翻**，
 * 直接渲染 `n.type` → 首屏上出现 `service` / `acceptance` / `site` 三个英文标签；
 * 抽屉那张又漏了 `site`（库里最高频，65 条）和 `ship` → `?? n.type` 兜底照样露英文。
 *
 * 规矩：
 *   ① 键必须**覆盖后端 `NOTIF_TYPES` 全集**（backend/app/models/notify.py）——
 *      前后端对账由 `e2e:static` 的 `NOTIF-消息类型不许裸露英文` 钉着（那条能红才算数）。
 *   ② 谁都不许再直接渲染 `notification.type` 裸值。
 * ⚠ 颜色**故意不给**（方案 A：颜色只给异常，类型靠文字区分）——原先那张空的
 *   `NOTIF_TYPE`/`WB_TYPE`（`{}`）是「彩色 Tag 收敛」时留下的死代码，已删。
 */
export const NOTIF_TYPE_LABEL: Record<string, string> = {
  task: '任务',
  review: '评审',
  change: '改版',
  release: '发布',
  warehouse: '仓库',
  purchase: '采购',
  acceptance: '验收',
  service: '售后',
  site: '现场',
  ship: '发运',
  mfg: '制造',
  payment: '回款',
}

/** 取中文名；**没有兜底成裸 key**（漏翻要在护栏里红，不许悄悄显示英文） */
export function notifTypeLabel(type: string): string {
  return NOTIF_TYPE_LABEL[type] ?? String(type)
}

// OCR 外部集成的配置状态（第十轮 R-1/§3：`available` 只说明"配没配"，徽标要按 state 说实话）
export const OCR_STATE: Record<string, string> = { unconfigured: 'default', unverified: 'warning', verified: 'success', failed: 'error' }

// 配置状态的**人话**（与 OCR_STATE 成对，别在业务文件里各写一份）
export const OCR_STATE_TEXT: Record<string, string> = { unconfigured: '未启用', unverified: '已配置（未验证）', verified: '已验证可用', failed: '上次测试失败' }

/**
 * ★ 状态色（antd 预设名）→ 方案 A「纸面」的语义 tone（圆点 / 文字色）。
 *
 * 为什么单列一张：A 的状态画法是「圆点 + 文字」而不是彩色药丸，于是每个页面都要把
 * `status.ts` 里的预设色名翻译成 tone。如果让各页自己写 if/else，必然一周后就漂出
 * 十套口径（docs/12 §1.1 的教训）。所以翻译只此一处。
 *
 * 用法：`<Status tone={toneOf(STAGE_COLOR[stage])}>{stage}</Status>`
 */
export type Tone = 'ok' | 'warn' | 'err' | 'run'

const TONE_OF: Record<string, Tone> = {
  success: 'ok', green: 'ok', lime: 'ok',
  error: 'err', red: 'err', volcano: 'err', magenta: 'err',
  warning: 'warn', gold: 'warn', orange: 'warn',
  processing: 'run', blue: 'run', cyan: 'run', purple: 'run', geekblue: 'run',
}

/** 无 tone（default / 未知）→ 中性灰，调用方按需处理 */
export function toneOf(color?: string): Tone | undefined {
  return color ? TONE_OF[color] : undefined
}
