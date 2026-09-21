# 同兴高科项目管理系统 · 后端

FastAPI + SQLAlchemy 2.0 + PostgreSQL 17。详细开发指令见 [`AGENTS.md`](./AGENTS.md)。

## 快速启动

```bash
# 1. 基础设施（★ -f 必须带；项目名已在 compose 里写死为 txgketo，避免与其他项目的 deploy/ 撞车）
cd .. && docker compose -f deploy/docker-compose.dev.yml up -d && cd backend

# 2. 依赖
uv venv .venv --python 3.11
uv pip install -r requirements-dev.txt

# 3. 配置
cp .env.example .env

# 4. 建表 + 初始化数据
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m scripts.seed          # 组织/权限/角色/编号规则/管理员

# 5. 启动
.venv/bin/python -m uvicorn app.main:app --reload --port 8208
# → http://127.0.0.1:8208/docs  （自动生成的接口文档）
```

初始账号：**admin / admin12345**（上线前必须改）。

## 端口

| 用途 | 端口 |
|---|---|
| 后端 API | 8208 |
| PostgreSQL | 35432（库 `txgk` / 测试库 `txgk_test`） |

## 测试

```bash
.venv/bin/python -m pytest -q     # 发号引擎纯逻辑测试（20 条，不需要数据库）
```

## 目录

```
app/
  core/       config.py  db.py  security.py
  models/     base.py  platform.py  numbering.py  project.py
  services/   numbering.py（发号引擎）  audit.py（操作日志）
  api/        deps.py  schemas.py  routes/{health,auth,platform,project,numbering}.py
  main.py
alembic/      迁移脚本
scripts/      seed.py
tests/        测试
```

## 已实现接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 健康检查 |
| POST | `/api/v1/auth/login` | 登录（返回 JWT） |
| GET | `/api/v1/auth/me` | 当前用户 |
| GET | `/api/v1/orgs` · `/api/v1/roles` · `/api/v1/users` | 组织 / 角色 / 用户 |
| POST | `/api/v1/users` | 新建用户 |
| GET | `/api/v1/projects/next-number` | 试算下一个项目号（不消耗序列） |
| POST | `/api/v1/projects` | **新建商机**（自动发号 `TX{YY}{NNN}`） |
| GET | `/api/v1/projects` · `/api/v1/projects/{no}` | 项目列表 / 详情 |
| GET | `/api/v1/projects/{no}/detail` | **详情抽屉一次拉齐**：基本信息 + 联系人 + 资料包 + 付款节点 |
| POST | `/api/v1/projects/{no}/attachments` | **上传资料**（分类：客户资料/方案/报价/合同/技术协议） |
| GET | `/api/v1/projects/{no}/attachments` | 资料列表 |
| GET | `/api/v1/projects/{no}/attachments/{id}/download` | 下载资料 |
| GET | `/api/v1/projects/{no}/attachments/{id}/preview` | **在线预览**（图片/PDF/文本 inline，其他返回 octet-stream） |
| GET | `/api/v1/audit-logs` | **操作记录**（可按 object_type / object_ref 过滤） |
| GET | `/api/v1/numbering/rules` | 编号规则 |
| GET | `/api/v1/numbering/drawing/parse` | 图号解析（含层级与父图号） |
| GET | `/api/v1/numbering/drawing/compose` | 图号组装（4 组层次码） |
