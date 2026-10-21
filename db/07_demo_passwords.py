#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把演示账号的口令统一设为 DEMO_PASSWORD，并算出 jeecg 能校验通过的哈希。

## 为什么单独一个脚本

前端 Mock 时代的登录凭据是 `sha256(salt + password)`（见 packages/shared/src/auth/accounts.ts），
后端 jeecg 用的是 `PBEWithMD5AndDES`（见 db/jeecg_pwd.py）。切到真实后端以后，
`sys_user.password` 里没有哈希（`db/seed_mock.py` 只写业务字段，不编口令）或仍是框架默认的
`123456`，于是「原来能登的 admin / admin0123」变成「账号或密码错误」。

本脚本按 `sys_user.salt` 逐账号重算哈希，幂等：同一账号重复跑，盐不变、哈希不变。

## 目标账号

除保留账号（jeecg / zhangsan / ceshi —— 框架自带、口令各异的演示用户）外，
库里所有 `sys_user` 账号的口令都设为 DEMO_PASSWORD。这样：

    平台端   admin / admin0123
    机构端   orgadmin、auditor、teacher、staff*、cdqz_admin … / admin0123

## 用法

    python3 db/07_demo_passwords.py                  # 直接改库
    python3 db/07_demo_passwords.py --dry-run        # 只打印将要执行的 SQL
    python3 db/07_demo_passwords.py --password xxx   # 换一个统一口令
    DB_NAME=jiaoyu-ai-verify python3 db/07_demo_passwords.py

连接信息走环境变量：DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME（与 init-jiaoyu-ai.sh 同名）。
"""
import argparse
import hashlib
import os
import string
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jeecg_pwd import encrypt_password  # noqa: E402

DEMO_PASSWORD = 'admin0123'

# 框架自带的演示用户：口令是 jeecg 原始的，不动
KEEP_ACCOUNTS = {'jeecg', 'zhangsan', 'ceshi'}

HOST = os.environ.get('DB_HOST', '127.0.0.1')
PORT = os.environ.get('DB_PORT', '3306')
USER = os.environ.get('DB_USER', 'root')
PASS = os.environ.get('DB_PASS', 'root')
DB = os.environ.get('DB_NAME', 'jiaoyu-ai')
MYSQL = os.path.join(os.environ.get('MYSQL_BIN', os.path.expanduser('~/tools/mysql/bin')), 'mysql')


def escape(value):
    return str(value).replace('\\', '\\\\').replace("'", "''")


def derived_salt(username):
    """
    账号还没有盐时用的稳定盐：由账号名哈希派生 8 位字母数字。

    不用随机盐是为了幂等 —— 随机盐虽然在「同一事务里盐与哈希一起更新」时也能登录，
    但每次重跑都会改动库，`--dry-run` 的输出也会漂移，没法当变更单核对。
    """
    digest = hashlib.md5(('jiaoyu-ai:' + username).encode('utf-8')).hexdigest()
    alphabet = string.ascii_letters + string.digits
    return ''.join(alphabet[int(digest[i * 2:i * 2 + 2], 16) % len(alphabet)] for i in range(8))


def query(sql):
    proc = subprocess.run(
        [MYSQL, '-h', HOST, '-P', str(PORT), '-u', USER, '-p' + PASS, '-N', '-B', '-e', sql],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError('查询失败：' + proc.stderr.strip())
    return proc.stdout


def execute(sql):
    proc = subprocess.run(
        [MYSQL, '-h', HOST, '-P', str(PORT), '-u', USER, '-p' + PASS, DB],
        input=sql, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError('执行失败：' + proc.stderr.strip())


def main():
    parser = argparse.ArgumentParser(description='统一演示账号口令并重算 jeecg 哈希')
    parser.add_argument('--password', default=DEMO_PASSWORD, help='统一口令，默认 %s' % DEMO_PASSWORD)
    parser.add_argument('--dry-run', action='store_true', help='只打印 SQL，不改库')
    args = parser.parse_args()

    rows = []
    for line in query(
        "SELECT `username`, IFNULL(`salt`, ''), IFNULL(`password`, '') "
        "FROM `%s`.`sys_user` WHERE IFNULL(`del_flag`, 0) = 0 ORDER BY `username`" % DB
    ).strip().splitlines():
        parts = line.split('\t')
        if len(parts) == 3:
            rows.append(parts)

    if not rows:
        print('sys_user 没有可处理的数据，检查库名是否正确：%s' % DB)
        return 1

    statements = ['SET NAMES utf8mb4;']
    changed = []
    kept = []
    for username, salt, password in rows:
        if username in KEEP_ACCOUNTS:
            kept.append(username)
            continue
        # 盐保持原值（8 字符），没有或不合法就按账号名派生；盐变了哈希必须跟着变
        used_salt = salt if len(salt) == 8 and salt.isascii() else derived_salt(username)
        hashed = encrypt_password(username, args.password, used_salt)
        changed.append((username, used_salt))
        statements.append(
            "UPDATE `sys_user` SET `salt` = '%s', `password` = '%s' WHERE `username` = '%s';"
            % (escape(used_salt), hashed, escape(username))
        )

    sql = '\n'.join(statements) + '\n'
    if args.dry_run:
        print(sql)
    else:
        execute(sql)

    print('库 %s：%d 个账号口令已设为「%s」' % (DB, len(changed), args.password))
    for username, _salt in changed:
        print('  - %s' % username)
    if kept:
        print('保留原口令：%s' % ', '.join(kept))
    return 0


if __name__ == '__main__':
    sys.exit(main())
