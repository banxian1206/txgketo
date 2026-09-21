#!/usr/bin/env bash
# 同兴高科项目管理系统 · 开发环境一键启动
# 用法： ./dev.sh        启动（数据库 → 后端 → 前端）
#        ./dev.sh stop   停止后端与前端（数据库保留）
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)

stop_app() {
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true
}

if [[ "${1:-}" == "stop" ]]; then
  stop_app
  echo "已停止后端与前端（数据库容器仍在运行；如需停止：docker compose -f deploy/docker-compose.dev.yml down）"
  exit 0
fi

echo "① 数据库（PostgreSQL 35432）…"
# ★ 必须带 -f；compose 顶层已写死 name: txgketo，避免与其他项目的 deploy/ 目录撞项目名
docker compose -f deploy/docker-compose.dev.yml up -d

echo "② 后端依赖 + 建表 + 初始化数据…"
cd "$ROOT/backend"
[[ -d .venv ]] || uv venv .venv --python 3.11
uv pip install -q -r requirements-dev.txt
[[ -f .env ]] || cp .env.example .env
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m scripts.seed

echo "③ 后端 API :8208 …"
stop_app
nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8208 --reload > /tmp/txgketo-api.log 2>&1 &

echo "④ 前端 :5207 …"
cd "$ROOT/frontend"
[[ -d node_modules ]] || npm install --no-audit --no-fund
nohup npm run dev > /tmp/txgketo-web.log 2>&1 &

sleep 6
echo
echo "════════════════════════════════════════════"
echo "  前端  http://127.0.0.1:5207"
echo "  接口  http://127.0.0.1:8208/docs"
echo "  账号  admin / admin12345"
echo "  日志  /tmp/txgketo-api.log  /tmp/txgketo-web.log"
echo "════════════════════════════════════════════"
