#!/usr/bin/env bash
# =============================================================
# jiaoyu-ai 业务库初始化（单库接管方案）
# -------------------------------------------------------------
# 作用：从零重建 jiaoyu-ai，使 JeecgBoot 框架与业务表共存于同一库。
#
# 前置：
#   - MySQL 已启动（默认 127.0.0.1:3306，root/root）
#   - 源框架库 jeecg-boot 存在（本脚本只读取它，不修改）
#   - 已安装 node + tsx（用于导出前端 mock 数据）
#
# 用法：
#   ./db/init-jiaoyu-ai.sh              # 全量初始化（会删库重建！）
#   ./db/init-jiaoyu-ai.sh --no-seed    # 只建库建表，不灌 mock 数据
#   ./db/init-jiaoyu-ai.sh --keep-db    # 保留已有库，只补表与数据
#
# 步骤：
#   1. 建库 + 执行 doc/schema.sql（140 张业务表）
#   2. 从 jeecg-boot 复制非冲突框架表（结构 + 数据）
#   3. 重建 6 张同名冲突表（框架字段为准 + 业务补充字段）
#   4. 清理历史同步触发器（保留兜底 DROP，最终库触发器为 0）
#   5. 迁移冲突表数据、edu_* 过渡表、flyway_schema_history
#   6. 下线框架示例数据与可选模块（onl / jimu / airag / chat2bi）
#   7. 收敛 6 张冲突表的重复列（05 + 06）
#   8. 从前端 mock 导出并写入各业务表
#   9. 统一演示账号口令（按 jeecg 的 PBEWithMD5AndDES 重算哈希，默认 admin0123）
# =============================================================
set -euo pipefail
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 目标库名可覆写：DB_NAME=jiaoyu-ai-verify ./db/init-jiaoyu-ai.sh  可做无破坏性演练
DB="${DB_NAME:-jiaoyu-ai}"
SRC_DB="${SRC_DB_NAME:-jeecg-boot}"
MYSQL_BIN="${MYSQL_BIN:-$HOME/tools/mysql/bin}"
MYSQL="$MYSQL_BIN/mysql"
MYSQLDUMP="$MYSQL_BIN/mysqldump"
HOST="${DB_HOST:-127.0.0.1}"
PORT="${DB_PORT:-3306}"
USER="${DB_USER:-root}"
PASS="${DB_PASS:-root}"

DO_SEED=1
KEEP_DB=0
for arg in "$@"; do
  case "$arg" in
    --no-seed) DO_SEED=0 ;;
    --keep-db) KEEP_DB=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

q() { "$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$@" 2>&1 | grep -v "Using a password" || true; }
qe() { "$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" -N -B -e "$1" 2>/dev/null; }

step() { echo; echo "==== $* ===="; }

# ---------- 0. 前置检查 ----------
step "0/9 前置检查"
[ -x "$MYSQL" ] || { echo "找不到 mysql: $MYSQL"; exit 1; }
qe "SELECT 1" >/dev/null || { echo "无法连接 MySQL $HOST:$PORT"; exit 1; }
SRC_EXISTS=$(qe "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$SRC_DB'")
[ "$SRC_EXISTS" = "1" ] || { echo "源库 $SRC_DB 不存在，无法复制框架表"; exit 1; }
echo "OK：MySQL 可连接，源库 $SRC_DB 存在"

# ---------- 1. 建库 + 业务表 ----------
step "1/9 建库并执行 schema.sql"
if [ "$KEEP_DB" = "0" ]; then
  q -e "DROP DATABASE IF EXISTS \`$DB\`;"
  echo "已删除旧库 $DB"
fi
q -e "CREATE DATABASE IF NOT EXISTS \`$DB\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/doc/schema.sql" 2>&1 | grep -v "Using a password" || true
echo "业务表数：$(qe "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")"

# ---------- 2. 复制非冲突框架表 ----------
step "2/9 复制框架表（结构与数据）"
CONFLICT="sys_user sys_tenant sys_role sys_user_role sys_dict_item sys_role_permission flyway_schema_history"
{
  qe "SELECT table_name FROM information_schema.tables WHERE table_schema='$SRC_DB'"
} | grep -vE '^sys_user$|^sys_tenant$|^sys_role$|^sys_user_role$|^sys_dict_item$|^sys_role_permission$|^flyway_schema_history$' \
  | grep -vE '^edu_' > /tmp/jy_fw_tables.txt
echo "待复制框架表：$(wc -l < /tmp/jy_fw_tables.txt | tr -d ' ') 张"
xargs "$MYSQLDUMP" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" \
  --single-transaction --set-gtid-purged=OFF --no-tablespaces --skip-add-drop-table \
  "$SRC_DB" < /tmp/jy_fw_tables.txt > /tmp/jy_fw_dump.sql 2>/dev/null
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < /tmp/jy_fw_dump.sql 2>&1 | grep -v "Using a password" || true

# ---------- 3~5. 冲突表 / 触发器 / 数据 ----------
step "3/9 重建 6 张冲突表"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/01_merge_conflict_tables.sql" 2>&1 | grep -v "Using a password" || true

step "4/9 清理历史同步触发器"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/02_sync_triggers.sql" 2>&1 | grep -v "Using a password" || true

step "5/9 迁移冲突表数据 + 过渡表 + Flyway 历史"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/03_migrate_conflict_data.sql" 2>&1 | grep -v "Using a password" | tail -10 || true

EDU_TABLES=$(qe "SELECT GROUP_CONCAT(table_name SEPARATOR ' ') FROM information_schema.tables WHERE table_schema='$SRC_DB' AND table_name LIKE 'edu_%'")
if [ -n "$EDU_TABLES" ]; then
  # shellcheck disable=SC2086
  "$MYSQLDUMP" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" --single-transaction \
    --set-gtid-purged=OFF --no-tablespaces --skip-add-drop-table \
    "$SRC_DB" $EDU_TABLES flyway_schema_history > /tmp/jy_edu_dump.sql 2>/dev/null
  "$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < /tmp/jy_edu_dump.sql 2>&1 | grep -v "Using a password" || true
  echo "已迁移过渡表：$EDU_TABLES"
fi

# ---------- 6~7. 下线可选模块 / 收敛冲突表重复列 ----------
step "6/9 下线框架示例数据与可选模块"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/04_cleanup_optional_modules.sql" 2>&1 | grep -v "Using a password" || true
echo "清理后表数：$(qe "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")"

step "7/9 收敛冲突表重复列（重复字段以框架为准）"
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/05_sys_user_unify_columns.sql" 2>&1 | grep -v "Using a password" || true
"$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < "$ROOT/db/06_unify_remaining_conflict_tables.sql" 2>&1 | grep -v "Using a password" || true
echo "sys_user 列数：$(qe "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='sys_user'")"

# ---------- 8. mock 数据 ----------
if [ "$DO_SEED" = "1" ]; then
  step "8/9 初始化前端 mock 数据"
  cd "$ROOT"
  ESB=$(find node_modules/.pnpm -path "*esbuild/bin/esbuild" 2>/dev/null | head -1)
  if [ -z "$ESB" ]; then
    echo "未找到 esbuild，跳过 mock 数据（可先执行 pnpm install）"
  else
    mkdir -p /tmp/mockbundle
    for m in org-store admin-store tenant-store content-store student-store exam-seeds data; do
      "$ESB" "packages/shared/src/mock/$m.ts" --bundle --format=esm --platform=node \
        --external:vue --external:echarts \
        --define:import.meta.env='{"DEV":false,"PROD":true,"MODE":"production","VITE_USE_MOCK":"false"}' \
        --outfile="/tmp/mockbundle/$m.mjs" --log-level=error
    done
    node scripts/dump-mock-bundled.mjs /tmp/mockbundle /tmp/mock-dump.json > /dev/null
    # 表结构元数据
    qe "SELECT table_name, column_name, data_type, is_nullable, column_default, column_key, extra
        FROM information_schema.columns WHERE table_schema='$DB' ORDER BY table_name, ordinal_position" \
      > /tmp/table_meta.tsv
    python3 - <<'PY'
import json, subprocess
rows = [l.split('\t') for l in open('/tmp/table_meta.tsv', encoding='utf-8').read().strip().split('\n') if len(l.split('\t')) >= 7]
meta = {}
for t, c, dt, nul, dflt, key, extra in rows:
    meta.setdefault(t, []).append(dict(col=c, type=dt, null=(nul == 'YES'), default=dflt, key=key, extra=extra))
json.dump(meta, open('/tmp/table_meta.json', 'w'), ensure_ascii=False)
print(f'表结构元数据：{len(meta)} 张表')
PY
    python3 db/seed_mock.py | tail -5
    "$MYSQL" -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" < /tmp/seed_mock.sql 2>&1 | grep -v "Using a password" || true
    echo "mock 数据已写入"
  fi
else
  step "8/9 跳过 mock 数据（--no-seed）"
fi

# ---------- 9. 演示账号口令 ----------
step "9/9 统一演示账号口令（admin0123）"
DB_NAME="$DB" DB_HOST="$HOST" DB_PORT="$PORT" DB_USER="$USER" DB_PASS="$PASS" MYSQL_BIN="$MYSQL_BIN" \
  python3 "$ROOT/db/07_demo_passwords.py" || echo "口令重置失败：请检查 python3 是否可用，登录将退回框架默认口令"

step "完成"
echo "库：$DB"
echo "表数：$(qe "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")"
echo "触发器：$(qe "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$DB'")"
echo
echo "下一步：将 Service/jeecg-module-system/jeecg-system-start/src/main/resources/application-dev.yml"
echo "       数据源 url 指向 /$DB 后重启后端。"
