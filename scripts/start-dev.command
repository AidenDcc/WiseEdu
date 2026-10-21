#!/usr/bin/env bash
###############################################################################
# 教学云 AI —— 本地开发一键启动（macOS / Linux）
#
# 说明：macOS 不能执行 Windows 的 .bat，本文件是等价的「双击即可运行」脚本
#      （.command 后缀由终端直接执行）。若在 Windows 上开发，另见 start-dev.bat。
#
# 用法：
#   double click            启动 后端 + 超管端 + 机构端
#   ./scripts/start-dev.command           同上（终端运行）
#   ./scripts/start-dev.command --build   启动前重新打包后端 jar（改了 Java 代码后用）
#   ./scripts/start-dev.command --mock    前端保持 Mock 数据（不生成 .env.local）
#   ./scripts/start-dev.command --admin   只起后端 + 超管端
#   ./scripts/start-dev.command --tenant  只起后端 + 机构端
#   ./scripts/stop-dev.command            停止全部服务
#
# 端口约定：
#   后端     9999   超管端 5173   机构端 5174
#
# 关键约定：后端启动时把 servlet context-path 置空（--server.servlet.context-path=/）。
#   原因：两个前端的 vite proxy 都把 /api 前缀「剥掉」后转发到 9999，
#   即 /api/admin/packages -> http://localhost:9999/admin/packages。
#   而 application-dev.yml 默认 context-path=/jeecg-boot，直连会 404。
#   置空后前后端路径天然对齐，前端无需改任何配置。
#
# 日志：logs/backend.log、logs/admin.log、logs/tenant.log（logs/ 已被 .gitignore 忽略）
###############################################################################

set -uo pipefail

# 强制 UTF-8 输出。若终端 locale 是 C/POSIX，中文会显示成 ???，且 bash 在解析
# 「$VAR 紧跟全角字符」时可能把多字节字符并入变量名而报 unbound variable。
case "${LC_ALL:-${LANG:-}}" in
  *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) : ;;
  *) export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ;;
esac

# 本脚本位于 scripts/，仓库根是它的上一级
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# ===== 端口与产物路径 =====
BACKEND_PORT="${EDU_BACKEND_PORT:-9999}"
ADMIN_PORT=5173
TENANT_PORT=5174
START_DIR="$ROOT/Service/jeecg-module-system/jeecg-system-start"
LOG_DIR="$ROOT/logs"
BACKEND_LOG="$LOG_DIR/backend.log"

# ===== 彩色输出（非 tty 时自动退化为纯文本，避免日志里堆转义符）=====
if [ -t 1 ]; then
  C_INFO=$'\033[36m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''; C_OFF=''
fi
info() { printf '%s[启动]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s[就绪]%s %s\n' "$C_OK"   "$C_OFF" "$*"; }
warn() { printf '%s[注意]%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
err()  { printf '%s[失败]%s %s\n' "$C_ERR"  "$C_OFF" "$*"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }

usage() {
  sed -n '4,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ===== 参数解析 =====
DO_BUILD=0      # 1 = 启动前执行 maven 打包
USE_MOCK=0      # 1 = 保留前端 Mock，不写 .env.local
START_ADMIN=1
START_TENANT=1

for arg in "$@"; do
  case "$arg" in
    --build)  DO_BUILD=1 ;;
    --mock)   USE_MOCK=1 ;;
    --admin)  START_ADMIN=1; START_TENANT=0 ;;
    --tenant) START_ADMIN=0; START_TENANT=1 ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数：$arg"; echo; usage; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

# ===== 基础工具函数 =====

# 端口是否已被监听（LISTEN 态）
port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# 精确停止占用某端口的进程：先 TERM，给 8 秒优雅退出，再 KILL 兜底
kill_port() {
  local port="$1" pid
  pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -z "$pid" ] && return 0
  warn "端口 $port 被 PID $pid 占用，正在停止它"
  kill "$pid" 2>/dev/null
  local i=0
  while [ "$i" -lt 8 ]; do
    port_busy "$port" || { dim "  已释放端口 $port"; return 0; }
    sleep 1; i=$((i + 1))
  done
  kill -9 "$pid" 2>/dev/null
  sleep 1
}

# 等待端口就绪，$1=端口 $2=超时秒数
wait_port() {
  local port="$1" timeout="${2:-60}" i=0
  while [ "$i" -lt "$timeout" ]; do
    port_busy "$port" && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# HTTP 探活：必须是 200 才算就绪。
#   --noproxy '*'：本机若配置了 http_proxy，curl 会把 localhost 请求也交给代理，
#   代理连不上后端就回 502 —— 不排除掉会「把失败误判为就绪」。
#   只认 200（而非任意状态码）：Tomcat 端口先开、Spring 上下文后起，
#   早期请求常返回 404/500，不能视为可用。
http_ready() {
  local code
  code="$(curl --noproxy '*' -s -o /dev/null -m 2 -w '%{http_code}' "$1" 2>/dev/null)"
  [ "$code" = "200" ]
}

# ===== 运行环境准备 =====

# 1) JDK 17：Maven 的 <profile.name> 与 jakarta 依赖都要求 17
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
  for d in /Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home \
           "$HOME/tools/jdk17/Contents/Home" \
           "$HOME/tools/jdk17"; do
    if [ -x "$d/bin/java" ]; then export JAVA_HOME="$d"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
  err "未找到 JDK 17，请安装后重试（或设置 JAVA_HOME）"
  exit 1
fi

# 2) Maven（仅 --build 时需要；本机为免安装解压版）
if [ -d "$HOME/tools/apache-maven-3.9.16/bin" ]; then
  export PATH="$JAVA_HOME/bin:$HOME/tools/apache-maven-3.9.16/bin:$PATH"
else
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# 3) pnpm：nvm 安装的 node 不在非交互 shell 的默认 PATH 里，这里显式补齐
if ! command -v pnpm >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$d/pnpm" ] && { export PATH="$d:$PATH"; break; }
  done
fi
if ! command -v pnpm >/dev/null 2>&1; then
  warn "未找到 pnpm —— 后端仍会启动，但两个前端需你手动执行 pnpm dev:admin / dev:tenant"
fi

# 4) 对象存储凭据：Service/oss.env 存在且当前 shell 未提供 AK 时自动加载。
#    已在 ~/.zshrc 等处 export 的值优先，这里不覆盖。
if [ -z "${EDU_OSS_ACCESS_KEY:-}" ] && [ -f "$ROOT/Service/oss.env" ]; then
  set -a
  . "$ROOT/Service/oss.env"
  set +a
  ok "已加载 OSS 凭据：Service/oss.env"
fi

ok "JAVA_HOME=$JAVA_HOME"

# ===== 中间件：MySQL(3306) / Redis(6379) =====
# 已在运行则跳过；未运行则按本机免安装目录尝试拉起。
ensure_mysql() {
  port_busy 3306 && { ok "MySQL 已在运行 (3306)"; return 0; }
  local bin="$HOME/tools/mysql/bin/mysqld"
  if [ ! -x "$bin" ]; then
    err "MySQL 未运行且找不到 $bin，请先手动启动 MySQL"
    return 1
  fi
  warn "MySQL 未运行，尝试启动"
  nohup "$bin" --basedir="$HOME/tools/mysql" --datadir="$HOME/tools/mysql-data" \
    --port=3306 --socket=/tmp/mysql.sock >"$LOG_DIR/mysql.log" 2>&1 &
  if wait_port 3306 30; then ok "MySQL 已启动 (3306)"; else err "MySQL 启动失败，见 logs/mysql.log"; return 1; fi
}

ensure_redis() {
  port_busy 6379 && { ok "Redis 已在运行 (6379)"; return 0; }
  local bin="$HOME/tools/redis-7.4.1/bin/redis-server"
  if [ ! -x "$bin" ]; then
    err "Redis 未运行且找不到 $bin，请先手动启动 Redis"
    return 1
  fi
  warn "Redis 未运行，尝试启动"
  "$bin" --port 6379 --daemonize yes >/dev/null 2>&1
  if wait_port 6379 15; then ok "Redis 已启动 (6379)"; else err "Redis 启动失败"; return 1; fi
}

# 后端强依赖两者（数据源 + Shiro 会话缓存），缺失直接退出，避免起个半死的服务
ensure_mysql || exit 1
ensure_redis || exit 1

# ===== 可选：重新打包后端 =====
# 注意必须带 clean：Spring Boot repackage 在增量 package 时不会重写 fat jar，
# 会出现「代码改了、jar 没变」的假象（本项目已踩过）。
if [ "$DO_BUILD" = "1" ]; then
  info "重新打包后端（这个步骤约 1~2 分钟）"
  ( cd "$ROOT/Service" && mvn -q -pl jeecg-boot-module/jeecg-module-edu-platform install -DskipTests ) \
    || { err "edu-platform 模块安装失败"; exit 1; }
  ( cd "$START_DIR" && mvn -q clean package -DskipTests ) \
    || { err "system-start 打包失败"; exit 1; }
  ok "打包完成"
fi

# ===== 后端 =====
# 取最新的 fat jar（排除 repackage 留下的 *.jar.original）
JAR="$(ls -t "$START_DIR"/target/jeecg-system-start-*.jar 2>/dev/null | grep -v '\.original$' | head -1)"

start_backend() {
  if port_busy "$BACKEND_PORT"; then
    ok "后端已在 $BACKEND_PORT 端口运行，跳过启动"
    return 0
  fi
  if [ -z "${JAR:-}" ] || [ ! -f "$JAR" ]; then
    err "未找到后端 jar：$START_DIR/target/jeecg-system-start-*.jar"
    err "请先执行：./scripts/start-dev.command --build"
    return 1
  fi

  info "启动后端：$(basename "$JAR") → 端口 ${BACKEND_PORT}（context-path 置空）"
  # nohup + disown：脱离当前终端会话，关掉终端窗口服务也不会停
  nohup "$JAVA_HOME/bin/java" -Xmx1024m -jar "$JAR" \
    --server.port="$BACKEND_PORT" \
    --server.servlet.context-path=/ \
    >"$BACKEND_LOG" 2>&1 &
  echo $! >"$LOG_DIR/backend.pid"
  disown 2>/dev/null || true

  # 就绪判定走 HTTP 而非仅看端口：Tomcat 端口先开、Spring 上下文后起，
  # 只看端口会在应用尚未初始化完时就返回成功。
  local i=0
  while [ "$i" -lt 120 ]; do
    if http_ready "http://127.0.0.1:$BACKEND_PORT/sys/getEncryptedString"; then
      ok "后端就绪：http://localhost:$BACKEND_PORT  (Swagger: /doc.html)"
      return 0
    fi
    sleep 1; i=$((i + 1))
  done

  err "后端 120 秒内未就绪，最后 20 行日志："
  tail -20 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    /'
  err "完整日志：$BACKEND_LOG"
  return 1
}

# ===== 前端 =====
# 前端联调真实后端：写 apps/admin/.env.local 覆盖 VITE_USE_MOCK。
# .env.local 的优先级高于 .env.development，且 *.local 已被 .gitignore 忽略，不会污染仓库。
prepare_frontend_env() {
  local env_file="$ROOT/apps/admin/.env.local"
  if [ "$USE_MOCK" = "1" ]; then
    warn "--mock 已指定：前端继续使用 Mock 数据"
    return 0
  fi
  if [ -f "$env_file" ]; then
    if grep -q '^VITE_USE_MOCK=false' "$env_file"; then
      ok "前端已配置为走真实后端（apps/admin/.env.local）"
    else
      warn "apps/admin/.env.local 已存在但未设置 VITE_USE_MOCK=false，请手动调整"
    fi
    return 0
  fi
  printf '# 由 start-dev.command 生成：走真实后端（未登记的接口仍自动回退 Mock）\nVITE_USE_MOCK=false\n' >"$env_file"
  ok "已生成 apps/admin/.env.local（VITE_USE_MOCK=false）"
}

start_frontend() {
  local app="$1" port="$2" label="$3"
  if port_busy "$port"; then
    ok "$label 已在 $port 运行，跳过启动"
    return 0
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    return 1
  fi
  info "启动 $label → 端口 $port"
  # 必须在仓库根目录执行：pnpm --filter 依赖 workspace 根
  nohup pnpm --filter "@aiteach/$app" dev >"$LOG_DIR/$app.log" 2>&1 &
  echo $! >"$LOG_DIR/$app.pid"
  disown 2>/dev/null || true
  if wait_port "$port" 60; then
    ok "$label 就绪：http://localhost:$port"
    return 0
  fi
  err "$label 启动超时，日志：$LOG_DIR/$app.log"
  return 1
}

# ===== 主流程 =====
echo
dim "=============================================================="
dim " 教学云 AI · 本地开发环境"
dim "=============================================================="
echo

BACKEND_OK=1
start_backend || BACKEND_OK=0

if [ "$BACKEND_OK" = "1" ]; then
  prepare_frontend_env
else
  warn "后端未就绪，前端仍会启动（接口将回退 Mock）"
fi

[ "$START_ADMIN" = "1" ]  && start_frontend admin  "$ADMIN_PORT"  "超管端"
[ "$START_TENANT" = "1" ] && start_frontend tenant "$TENANT_PORT" "机构端"

echo
dim "--------------------------------------------------------------"
printf '%s访问地址%s\n' "$C_OK" "$C_OFF"
[ "$START_ADMIN" = "1" ]  && printf '  超管端   http://localhost:%s\n' "$ADMIN_PORT"
[ "$START_TENANT" = "1" ] && printf '  机构端   http://localhost:%s\n' "$TENANT_PORT"
printf '  后端     http://localhost:%s  (Swagger %s/doc.html)\n' "$BACKEND_PORT" "http://localhost:$BACKEND_PORT"
printf '  登录     admin / 123456\n'
echo
printf '%s日志%s  %s\n' "$C_DIM" "$C_OFF" "$LOG_DIR"
printf '%s停止%s  ./scripts/stop-dev.command\n' "$C_DIM" "$C_OFF"
dim "--------------------------------------------------------------"

# 双击运行时会开一个终端窗口；这里停一下让用户看清结果，关窗口不影响后台服务
if [ -t 0 ]; then
  echo
  read -r -p "按回车关闭此窗口（服务会在后台继续运行）..." _
fi
