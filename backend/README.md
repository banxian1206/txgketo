# 同兴高科项目管理系统 · 后端

FastAPI + SQLAlchemy 2.0 + PostgreSQL 17。

- 开发规范与任务包：见 [`../AGENTS.md`](../AGENTS.md)（每次会话先读）
- 业务 / 数据模型 / 接口设计：见 [`../docs/`](../docs/)

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

> 也可以直接用仓库根的 `./dev.sh` 一键起数据库 + 后端 + 前端。

初始账号：**admin / admin12345**（上线前必须改）。

## 端口

| 用途 | 端口 |
|---|---|
| 后端 API | 8208 |
| PostgreSQL | 35432（库 `txgk` / 测试库 `txgk_test`） |

端口全景见 `../../PORTS.md`。

## 测试

```bash
.venv/bin/python -m pytest -q          # 单元测试（纯逻辑，不需要数据库）

# 端到端脚本（都走真实 HTTP 接口，需先起后端）
.venv/bin/python -m scripts.seed_s0_s1          # 清库 + 重建物料 + 只走 S0→S1
.venv/bin/python -m scripts.e2e_full_test       # S0→S11 基础链路
.venv/bin/python -m scripts.e2e_complex_test    # S0→S11 高复杂度场景
```

## 目录

```
app/
  core/       config.py  db.py  security.py
  models/     12 个业务域（platform / project / purchasing / production / ...）
  services/   领域服务（numbering 发号引擎、review_flow、change_flow、kitting、...）
  api/        deps.py  schemas.py  routes/*.py
  main.py
alembic/      数据库迁移（versions/）
scripts/      初始化 seed + 端到端测试种子脚本
tests/        pytest 单元测试

../data/uploads/   运行时上传文件（仓库根 data/，已 gitignore，勿手动整理）
```
