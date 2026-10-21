#!/usr/bin/env bash
###############################################################################
# 教学云 AI —— 本地开发环境一键停止
#
# 用法：./stop-dev.command   （或双击运行）
#
# 停止顺序：先停前端（vite），再停后端（java）。
# 每个服务先按 logs/*.pid 精确停止；pid 文件缺失或进程已被替换时，
# 回退到按端口兜底清理 —— 避免出现「端口还占着但 pid 已失效」的僵局。
#
# 不停止 MySQL / Redis：那是长期驻留的中间件，反复启停会拖慢开发节奏，
# 需要时手动 kill 即可（或关闭它们的启动脚本）。
###############################################################################

set -uo pipefail

# 与 start-dev.command 一致：强制 UTF-8，避免中文输出乱码
case "${LC_ALL:-${LANG:-}}" in
  *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) : ;;
  *) export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

LOG_DIR="$ROOT/logs"
BACKEND_PORT="${EDU_BACKEND_PORT:-9999}"

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=''; C_WARN=''; C_DIM=''; C_OFF=''
fi
ok()   { printf '%s[已停止]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[注意]%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# 停止某个端口上的监听进程：TERM → 等 8 秒 → KILL
kill_port() {
  local port="$1" pid i=0
  pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -z "$pid" ] && return 1
  kill "$pid" 2>/dev/null
  while [ "$i" -lt 8 ]; do
    port_busy "$port" || return 0
    sleep 1; i=$((i + 1))
  done
  kill -9 "$pid" 2>/dev/null
  sleep 1
  ! port_busy "$port"
}

# 优先用 pid 文件；失败再按端口兜底
stop_service() {
  local name="$1" port="$2" pid_file="$LOG_DIR/$1.pid" pid=""

  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # pnpm/vite 是父进程树，直接 kill 父进程可能留下孤儿子进程，这里杀整个进程组
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    fi
    rm -f "$pid_file"
  fi

  if kill_port "$port"; then
    ok "$name (端口 $port)"
  elif port_busy "$port"; then
    warn "$name (端口 $port) 停止失败，可能被其他用户/进程占用"
  else
    dim "  $name 未在运行 (端口 $port)"
  fi
}

echo
dim "=============================================================="
dim " 教学云 AI · 停止本地服务"
dim "=============================================================="
echo

stop_service tenant 5174
stop_service admin  5173
stop_service backend "$BACKEND_PORT"

echo
dim "--------------------------------------------------------------"
printf 'MySQL(3306) / Redis(6379) 保持运行；日志保留在 %s\n' "$LOG_DIR"
dim "--------------------------------------------------------------"

if [ -t 0 ]; then
  echo
  read -r -p "按回车关闭此窗口..." _
fi
