#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把前端 mock 数据全量初始化到 jiaoyu-ai 库。

流程：
  1. scripts/dump-mock-data.mts + esbuild 产出 /tmp/mock-dump.json
  2. 本脚本读取 mock JSON 与表结构元数据（/tmp/table_meta.json）
  3. 按域映射为 INSERT 语句，输出 /tmp/seed_mock.sql

约定：
  - 机构端演示数据统一挂到 mock 租户 TENANT_ID（星辰教育培训学校，id=200）
  - 平台级数据 tenant_id=0
  - 仅对「纯业务表」做 DELETE（幂等），不触碰带框架数据的 6 张合并表
  - 主键 id 沿用 mock id；与既有数据可能冲突的表加前缀
"""
import hashlib
import json
import re
import sys
from datetime import datetime

TENANT_ID = 200          # 机构端演示租户
PLATFORM_ID = 0          # 平台级
NOW = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

MOCK = json.load(open('/tmp/mock-dump.json', encoding='utf-8'))
META = json.load(open('/tmp/table_meta.json', encoding='utf-8'))

errors = []
stats = {}
type_conflicts = {}   # 列类型为数字但收到字符串枚举的冲突记录


# ---------------------------------------------------------------- 工具
def camel(s: str) -> str:
    p = s.split('_')
    return p[0] + ''.join(x.capitalize() for x in p[1:])


def esc(s: str) -> str:
    return s.replace('\\', '\\\\').replace("'", "''")


def sqlval(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, (dict, list)):
        return "'" + esc(json.dumps(v, ensure_ascii=False)) + "'"
    return "'" + esc(str(v)) + "'"


def rows(key):
    v = MOCK.get(key)
    return v if isinstance(v, list) else []


def obj(key):
    v = MOCK.get(key)
    return v if isinstance(v, dict) else {}


def pick(r, *keys, default=None):
    for k in keys:
        if isinstance(r, dict) and r.get(k) not in (None, ''):
            return r[k]
    return default


def enum(v, allowed, default):
    return v if v in allowed else default


def split_city(city: str):
    """'浙江省杭州市西湖区' → ('浙江省', '杭州市西湖区')"""
    if not city:
        return None, None
    for suf in ('省', '市', '自治区'):
        i = city.find(suf)
        if i > 0 and (suf != '市' or i <= 9):
            return city[:i + len(suf)], city[i + len(suf):] or None
    return None, city


INT_TYPES = ('bigint', 'int', 'smallint', 'tinyint', 'mediumint')

# 各表 id 列类型（用于判断字符串主键是否需要转数字）
ID_TYPE = {t: next((m['type'] for m in cols if m['col'] == 'id'), '') for t, cols in META.items()}


def nid(s):
    """把字符串键稳定映射为 44 位整数（确定性，重复执行结果一致）"""
    return int(hashlib.md5(str(s).encode('utf-8')).hexdigest()[:11], 16)


def default_for(m):
    """列的兜底值：仅在 NOT NULL 且无数据库默认值时使用"""
    t = m['type']
    if t in INT_TYPES:
        return 0
    if t in ('decimal', 'double', 'float'):
        return 0
    if t in ('datetime', 'timestamp'):
        return NOW
    if t == 'date':
        return '2026-01-01'
    if t == 'json':
        return {}
    return ''


# ---------------------------------------------------------------- 收集器
class Sink:
    def __init__(self):
        self.data = {}          # table -> list[(cols, values)]
        self.raw = []           # 原样追加的 SQL（用于跨表镜像/回填，排在所有 INSERT 之后）

    def add(self, table, row: dict):
        if table not in META:
            errors.append(f'表不存在: {table}')
            return
        if not row:
            return
        colmeta = {m['col']: m for m in META[table]}
        # 数字型主键遇到字符串键时转成稳定整数，避免 Incorrect integer value
        if 'id' in row and ID_TYPE.get(table) in INT_TYPES:
            v = row['id']
            if not isinstance(v, (int, float)) and not (isinstance(v, str) and v.isdigit()):
                row['id'] = nid(v)
        # 数字列遇到非数字字符串：兜底转换 + 记录冲突（便于后续补语义映射）
        for k, v in list(row.items()):
            m = colmeta.get(k)
            if not m or m['type'] not in INT_TYPES:
                continue
            if isinstance(v, bool) or isinstance(v, (int, float)):
                continue
            if isinstance(v, str) and v.isdigit():
                row[k] = int(v)
                continue
            if v is None:
                continue
            type_conflicts.setdefault(f'{table}.{k}', set()).add(str(v))
            row[k] = nid(v)
        # JSON 列：字符串需保证是合法 JSON，否则包成 JSON 字符串
        for k, v in list(row.items()):
            m = colmeta.get(k)
            if not m or m['type'] != 'json' or v is None:
                continue
            if isinstance(v, str):
                try:
                    json.loads(v)
                except Exception:
                    row[k] = json.dumps(v, ensure_ascii=False)
        # 日期列：mock 中存在 '—' 之类的占位值，无法入库
        for k, v in list(row.items()):
            m = colmeta.get(k)
            if not m or m['type'] not in ('datetime', 'timestamp', 'date'):
                continue
            if isinstance(v, str) and not re.match(r'^\d{4}-\d{2}-\d{2}', v.strip()):
                if m['null'] or m['default'] not in (None, 'NULL'):
                    del row[k]
                else:
                    row[k] = NOW
        # 值为 None：有数据库默认值的直接省略（让默认生效），NOT NULL 无默认的兜底
        for k, v in list(row.items()):
            if v is not None:
                continue
            m = colmeta.get(k)
            if not m:
                del row[k]
            elif m['default'] not in (None, 'NULL') and m['extra'] != 'auto_increment':
                del row[k]
            elif not m['null']:
                row[k] = default_for(m)
        cols = [c for c in row.keys() if c in colmeta]
        if not cols:
            return
        self.data.setdefault(table, []).append((cols, [row[c] for c in cols]))
        stats[table] = stats.get(table, 0) + 1

    def emit(self, path):
        parts = ['SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS = 0;', '']
        # 纯业务表前置清理，保证可重复执行
        for t in BUSINESS_TABLES:
            if t in self.data:
                parts.append(f'DELETE FROM `{t}`;')
        # 与框架共存的合并表：只清本脚本写入的那部分（按 id 特征识别）
        parts += [
            "DELETE FROM `sys_user` WHERE `id` REGEXP '^9[0-9]{5}$';",
            "DELETE FROM `sys_tenant` WHERE `id` BETWEEN 101 AND 110 OR `id` = 200;",
            "DELETE FROM `sys_role` WHERE `id` LIKE 'OR%';",
            "DELETE FROM `sys_user_role` WHERE `id` LIKE 'UR%';",
            "DELETE FROM `sys_role_permission` WHERE `id` LIKE 'RP%';",
            "DELETE FROM `sys_dict_item` WHERE `id` LIKE 'DICT%';",
        ]
        parts.append('')
        for table, rs in self.data.items():
            for cols, vals in rs:
                c = ', '.join(f'`{x}`' for x in cols)
                v = ', '.join(sqlval(x) for x in vals)
                parts.append(f'INSERT INTO `{table}` ({c}) VALUES ({v});')
            parts.append('')
        if self.raw:
            parts.append('-- ---------- 过渡表回填 ----------')
            parts.extend(self.raw)
            parts.append('')
        parts.append('SET FOREIGN_KEY_CHECKS = 1;')
        open(path, 'w', encoding='utf-8').write('\n'.join(parts))


S = Sink()

# 可安全清空的纯业务表（不含 6 张与框架合并的表）
BUSINESS_TABLES = [t for t in META if t.startswith((
    'q_', 'p_', 't_', 'r_', 'e_', 'c_', 'g_', 'dc_', 'ai_',
))] + [
    'sys_tenant_package', 'sys_tenant_package_feature', 'sys_tenant_apply', 'sys_tenant_cert',
    'sys_tenant_config', 'sys_tenant_quota', 'sys_tenant_subscription', 'sys_tenant_menu',
    'sys_campus', 'sys_dict_type', 'sys_login_log', 'sys_operation_log', 'sys_error_log',
    'sys_notification', 'sys_notify_rule', 'sys_param', 'sys_service_health',
    'sys_backup_record', 'sys_storage_policy', 'sys_message_template', 'sys_review_flow',
    'sys_menu',
]


# ================================================================ 1. 租户域
def seed_tenant_domain():
    # --- 套餐 ---
    FEATURE_NAME = {
        'aiGenerate': 'AI 出题', 'aiVariant': 'AI 变式', 'aiPhoto': '拍照识题',
        'docImport': '文档导入', 'collab': '协同组卷', 'customPrompt': '自定义提示词',
    }
    for p in rows('tenant-store.packages'):
        pid = p.get('id')
        monthly = p.get('monthlyPrice') or 0
        S.add('sys_tenant_package', dict(
            id=pid, tenant_id=PLATFORM_ID,
            package_code=f'PKG{pid:02d}', package_name=p.get('name'),
            monthly_price=monthly, year_price=round(monthly * 12 * 0.9, 2),
            max_staff=p.get('maxStaff'), max_student=(p.get('maxStaff') or 0) * 40,
            max_concurrent=p.get('maxConcurrent'), ai_quota=p.get('aiQuota'),
            storage_gb=p.get('storageGb'), sms_enabled=p.get('smsEnabled'),
            status=1, sort_no=pid,
            remark=p.get('name'),
        ))
        for k, v in (p.get('features') or {}).items():
            S.add('sys_tenant_package_feature', dict(
                id=f'PF{pid}_{k}', tenant_id=PLATFORM_ID, package_id=pid,
                feature_key=k, feature_name=FEATURE_NAME.get(k, k), enabled=v,
            ))

    # --- 入驻申请 ---
    APPLY_STATUS = {'待审核': 0, '已通过': 1, '已驳回': 2}
    for a in rows('tenant-store.applies'):
        aid = a.get('id')
        prov, city = split_city(a.get('city'))
        S.add('sys_tenant_apply', dict(
            id=aid, tenant_id=PLATFORM_ID, apply_no=a.get('applyNo'),
            tenant_code=a.get('code'), org_name=a.get('orgName'), org_type=a.get('orgType'),
            stage_scope=a.get('stages'), contact_name=a.get('contact'),
            contact_phone=a.get('phone'), contact_email=a.get('email'),
            province=prov, city=city, address=a.get('address'), intro=a.get('intro'),
            apply_status=APPLY_STATUS.get(a.get('status'), 0),
            submitted_at=a.get('submittedAt'),
            reviewer_name=(a.get('status') != '待审核' and '管理员') or None,
            reviewed_at=None if a.get('status') == '待审核' else a.get('submittedAt'),
            create_time=a.get('submittedAt'),
        ))
        for i, f in enumerate(a.get('certFiles') or []):
            S.add('sys_tenant_cert', dict(
                id=aid * 10 + i, tenant_id=PLATFORM_ID, apply_id=aid,
                cert_category=f.get('category') or 'other',
                file_name=f.get('name'), file_type=f.get('type') or 'pdf',
                file_url=f"/upload/cert/{aid}/{f.get('name')}",
                verify_status=0 if a.get('status') == '待审核' else 1,
            ))

    # --- 机构（平台侧的 10 家）---
    for t in rows('tenant-store.tenants'):
        tid = t.get('id')
        prov, city = split_city(t.get('city'))
        S.add('sys_tenant', dict(
            id=tid, tenant_id=PLATFORM_ID, tenant_code=t.get('code'),
            short_name=t.get('name')[:8],
            logo_hue=t.get('logoHue'), tenant_type=t.get('orgType'),
            stage_scope=t.get('stages'), status=t.get('status'),
            package_id=t.get('packageId'),
            contact_name=t.get('contact'), contact_phone=t.get('phone'),
            province=prov, city=city, address=t.get('address'), intro=t.get('intro'),
            isolation_type=t.get('isolationType'), storage_region=t.get('storageRegion'),
            ai_used=t.get('aiUsed'), storage_used_gb=t.get('storageUsedGb'),
            open_time=t.get('createdAt'), create_time=t.get('createdAt'),
            # 重复字段以框架为准：name / end_date / begin_date
            name=t.get('name'), end_date=t.get('expireTime'), begin_date=t.get('createdAt'),
        ))
        # 订阅记录
        S.add('sys_tenant_subscription', dict(
            id=tid * 10 + 1, tenant_id=tid, package_id=t.get('packageId'),
            start_time=t.get('createdAt'), end_time=t.get('expireTime'),
            sub_status='active', change_type='open',
            amount=0, remark='历史开通记录',
        ))
        # 配额快照
        q = t.get('quotas') or {}
        for k, v in q.items():
            S.add('sys_tenant_quota', dict(
                id=f'Q{tid}_{k}', tenant_id=tid, quota_key=k,
                quota_value=v if isinstance(v, (int, float)) else 0, used_value=0,
                quota_source='package', warn_threshold=80,
            ))
        # AI 能力开关
        for k, v in (t.get('switches') or {}).items():
            S.add('ai_tenant_switch', dict(
                id=f'TS{tid}_{k}', tenant_id=tid, capability_key=k,
                capability_label=k, enabled=v, month_cost=0, quota_left=0,
            ))
        # 资质文件
        for i, f in enumerate(t.get('certFiles') or []):
            S.add('sys_tenant_cert', dict(
                id=tid * 100 + i, tenant_id=tid, tenant_id_ref=tid,
                cert_category=f.get('category') or 'other',
                file_name=f.get('name'), file_type=f.get('type') or 'pdf',
                file_url=f"/upload/tenant/{tid}/{f.get('name')}", verify_status=1,
            ))

    # --- 机构端演示租户（星辰教育培训学校）---
    s = obj('student-store.orgSettings')
    S.add('sys_tenant', dict(
        id=TENANT_ID, tenant_id=PLATFORM_ID, tenant_code='T20260101001',
        short_name=s.get('shortName'),
        logo_hue=248, tenant_type='培训机构', stage_scope=['高中'],
        status=2, package_id=3,
        contact_name=s.get('contact'), contact_phone=s.get('phone'),
        address=s.get('address'), intro=s.get('intro'),
        city='上海市浦东新区', province='上海市',
        isolation_type=1, storage_region='华东 2（上海）',
        ai_used=412, storage_used_gb=18.6, open_time='2026-01-01 09:00:00',
        create_time='2026-01-01 09:00:00',
        # 重复字段以框架为准：name / end_date / begin_date
        name=s.get('name') or '星辰教育培训学校',
        end_date='2027-12-31 23:59:59', begin_date='2026-01-01 09:00:00',
    ))
    S.add('sys_tenant_config', dict(
        id=1, tenant_id=TENANT_ID, org_name=s.get('name'), short_name=s.get('shortName'),
        contact_name=s.get('contact'), contact_phone=s.get('phone'),
        address=s.get('address'), intro=s.get('intro'),
        subjects=s.get('subjects'), grades=s.get('grades'),
        preferred_textbooks=s.get('preferredTextbooks'),
        export_header=s.get('name'), data_retention_month=36,
    ))
    quota = obj('org-store.aiQuota')
    S.add('sys_tenant_quota', dict(
        id='QT200_ai', tenant_id=TENANT_ID, quota_key='ai',
        quota_value=quota.get('quota') or 1000, used_value=quota.get('used') or 412,
        quota_source='package', warn_threshold=80,
    ))
    storage = obj('org-store.storageUsage')
    S.add('sys_tenant_quota', dict(
        id='QT200_storage', tenant_id=TENANT_ID, quota_key='storage',
        quota_value=int(storage.get('quotaGb') or 50), used_value=int(storage.get('usedGb') or 18),
        quota_source='package', warn_threshold=80,
    ))
    S.add('sys_tenant_subscription', dict(
        id=2001, tenant_id=TENANT_ID, package_id=3,
        start_time='2026-01-01 09:00:00', end_time='2027-12-31 23:59:59',
        sub_status='active', change_type='open', amount=1299 * 12 * 0.9,
        remark='机构端演示租户开通',
    ))


# ================================================================ 2. 用户 / 权限 / 字典
def seed_user_permission():
    # mock 里存在重复账号（多个 'admin'），且与框架内置账号同名：
    # 统一做去重，冲突时追加用户 id 后缀，保证 sys_user.uk_username 不冲突
    RESERVED = {'admin', 'jeecg', 'zhangsan', 'ceshi', 'cdqz_admin'}
    seen_accounts = set()

    def uniq_account(acc, uid):
        base = acc or f'user{uid}'
        a = base
        if a in RESERVED or a in seen_accounts:
            a = f'{base}{uid}'
        n = 2
        while a in RESERVED or a in seen_accounts:
            a = f'{base}{uid}_{n}'
            n += 1
        seen_accounts.add(a)
        return a

    # 说明：sys_user 已按「重复字段以框架为准 + 补齐业务独有字段」收敛，
    # 只写框架列（username/realname/password/sign/del_flag/status）与
    # 业务独有列（tenant_id/user_type/nick_name/avatar_hue/campus_id/
    # default_subject/mfa_enabled/last_login_at/last_login_ip）。
    # status 统一框架语义：1 正常，2 冻结（业务"停用/锁定"映射为 2）。

    # --- 用户：mockUsers（机构端演示账号）---
    # ui_roles 收集「账号 → 前端 UI 角色」，等 sys_role 建完再落 sys_user_role。
    # 缺了这一层，后端 EduAuthController.resolveUiRole 只能按「有租户 = teacher」兜底，
    # 机构管理员登进去看到的是教师菜单。
    #
    # tenant_id 一律用 TENANT_ID(200)，不取 mock 里的 tenantId：
    # mockUsers 写的是 1000，那是 mock 自己的编号，落到库里会撞上 jeecg 自带的演示租户 1000（北京国炬），
    # 登录后机构名显示「国炬」且看不到任何教学云演示数据；机构演示数据（题库/员工/班级）都在 200。
    ui_roles = []
    for u in rows('data.mockUsers'):
        uid = u.get('id')
        acc = uniq_account(u.get('account'), uid)
        S.add('sys_user', dict(
            id=str(900000 + uid), tenant_id=TENANT_ID,
            user_type=1, username=acc, salt=None,
            realname=u.get('name'), nick_name=u.get('name'),
            avatar_hue=u.get('avatarHue'), phone=u.get('phone'), email=u.get('email'),
            sign=u.get('intro'), status=1, mfa_enabled=0,
            org_code=u.get('orgName'), del_flag=0,
        ))
        ui_roles.append((str(900000 + uid), TENANT_ID, u.get('role')))

    # --- 用户：平台账号 ---
    for u in rows('admin-store.adminAccounts'):
        uid = u.get('id')
        acc = uniq_account(u.get('account'), uid)
        S.add('sys_user', dict(
            id=str(910000 + uid), tenant_id=PLATFORM_ID, user_type=0,
            username=acc, realname=u.get('name'), nick_name=u.get('name'),
            status=1 if u.get('enabled') else 2, mfa_enabled=0,
            del_flag=0, last_login_at=u.get('lastLoginAt'), org_code='平台运营',
        ))

    # --- 用户：机构员工 ---
    for st in rows('org-store.staff'):
        sid = st.get('id')
        acc = uniq_account(f'staff{sid}', sid)
        S.add('sys_user', dict(
            id=str(920000 + sid), tenant_id=TENANT_ID, user_type=1,
            username=acc, realname=st.get('name'), nick_name=st.get('name'),
            phone=st.get('phone'), status=1 if st.get('enabled') else 2, mfa_enabled=0,
            del_flag=0, last_login_at=st.get('lastLoginAt'), org_code='星辰教育',
        ))
        ui_roles.append((str(920000 + sid), TENANT_ID, st.get('role')))

    # --- 角色 ---
    for r in rows('org-store.orgRoles'):
        rid = r.get('id')
        S.add('sys_role', dict(
            id=f'OR{rid}', tenant_id=TENANT_ID, role_code=f'ORG_ROLE_{rid}',
            role_name=r.get('name'),
            builtin=1 if r.get('builtin') else 0, locked=1 if r.get('locked') else 0,
            data_scope=1, enabled=1, sort_no=rid,
            # 重复字段以框架为准：description（原 role_desc 的信息并入）
            description=f"机构角色：{r.get('name')}",
        ))
        # 权限点
        n = 0
        for module, ops in (r.get('perms') or {}).items():
            for op in ops:
                n += 1
                S.add('sys_role_permission', dict(
                    id=f'RP{rid}_{module}_{n}', tenant_id=TENANT_ID,
                    role_id=f'OR{rid}', module_key=module, op_key=op,
                    deleted=0,
                ))

    # --- 用户角色（机构端）---
    # 两个来源：mockUsers 的 UI 角色（orgAdmin/auditor/teacher）与员工的中文角色名。
    # 统一落到 sys_role 里 mock 机构角色 ORG_ROLE_n，后端 resolveUiRole 按 n 映射回 UI 角色。
    ROLE_BY_UI = {'orgAdmin': 'OR1', 'auditor': 'OR2', 'teacher': 'OR3'}
    ROLE_BY_NAME = {'管理员': 'OR1', '审核员': 'OR2', '老师': 'OR3',
                    '出题专员': 'OR4', '年级学科组长': 'OR5'}
    for user_id, tenant_id, ui_role in ui_roles:
        role_id = ROLE_BY_UI.get(ui_role) or ROLE_BY_NAME.get(ui_role)
        if not role_id:
            continue
        S.add('sys_user_role', dict(
            id=f'UR{user_id}_{role_id}', tenant_id=tenant_id, user_id=user_id,
            role_id=role_id, create_by='admin', create_time=NOW, deleted=0,
        ))

    # 业务库自带的学校管理员（cdqz_admin 来自 03 数据迁移）不在 mock 里，单独补一条机构管理员关系；
    # 否则登录后按「有租户 = teacher」兜底，学校管理员看到的是教师菜单。
    S.raw.append(
        "INSERT INTO `sys_user_role` (`id`,`tenant_id`,`user_id`,`role_id`,`create_by`,`create_time`,`deleted`)\n"
        "SELECT CONCAT('UR', u.`id`, '_OR1'), u.`tenant_id`, u.`id`, 'OR1', 'admin', NOW(), 0\n"
        "  FROM `sys_user` u\n"
        " WHERE u.`username` = 'cdqz_admin'\n"
        "   AND NOT EXISTS (SELECT 1 FROM `sys_user_role` x WHERE x.`id` = CONCAT('UR', u.`id`, '_OR1'));"
    )

    # --- 平台菜单 ---
    for m in rows('admin-store.adminMenus'):
        S.add('sys_menu', dict(
            id=m.get('id'), tenant_id=PLATFORM_ID, menu_scope=0,
            parent_id=m.get('parentId'), menu_title=m.get('title'),
            menu_path=m.get('path'), menu_icon=m.get('icon'),
            menu_type=0 if not m.get('parentId') and m.get('path') == '/dashboard' else 1,
            sort_no=m.get('sort'), visible=1 if m.get('enabled') else 0,
            builtin=1 if m.get('builtin') else 0,
        ))

    # --- 机构端菜单树 ---
    for i, m in enumerate(rows('org-store.orgMenuTree'), start=1):
        S.add('sys_menu', dict(
            id=1000 + i, tenant_id=TENANT_ID, menu_scope=1,
            menu_title=m.get('title'), menu_path=f"/org/{m.get('key')}",
            menu_icon=m.get('key'), menu_type=1, sort_no=i,
            visible=1 if m.get('enabled') else 0, builtin=1,
            module_key=m.get('key'),
        ))

    # --- 租户菜单授权 ---
    for i, m in enumerate(rows('admin-store.tenantMenus'), start=1):
        S.add('sys_tenant_menu', dict(
            id=i, tenant_id=PLATFORM_ID, menu_id=1000 + i,
            menu_key=m.get('key'), enabled=1 if m.get('enabled') else 0, sort_no=i,
        ))

    # --- 字典类型 ---
    for i, d in enumerate(rows('admin-store.DICT_TYPES'), start=1):
        S.add('sys_dict_type', dict(
            id=i, tenant_id=PLATFORM_ID, dict_type=d.get('key'),
            dict_name=d.get('title'), dict_group='教务字典',
            editable=1, remark=d.get('hint'),
        ))

    # --- 字典项 ---
    item_no = 0
    for dtype, items in (obj('admin-store.dictStore') or {}).items():
        for it in items or []:
            item_no += 1
            iid = it.get('id')
            S.add('sys_dict_item', dict(
                id=f'DICT{500000 + item_no}', tenant_id=PLATFORM_ID, dict_type=dtype,
                ref_count=it.get('refCount') or 0,
                grades=it.get('grades'), stages=it.get('stages'),
                subjects=it.get('subjects'),
                # 重复字段以框架为准：item_text / item_value / sort_order / status
                item_text=it.get('name'), item_value=it.get('code'),
                sort_order=it.get('sort') or item_no,
                status=1 if it.get('enabled', True) else 0,
            ))
    # 地区 / 竞赛 也进字典
    for dtype, key in (('region', 'admin-store.REGIONS'), ('competition', 'admin-store.COMPETITIONS')):
        for i, name in enumerate(rows(key), start=1):
            item_no += 1
            S.add('sys_dict_item', dict(
                id=f'DICT{500000 + item_no}', tenant_id=PLATFORM_ID, dict_type=dtype,
                ref_count=0,
                item_text=name, item_value=str(i), sort_order=i, status=1,
            ))


# ================================================================ 3. 校区 / 知识体系
def seed_knowledge():
    for c in rows('org-store.campuses'):
        cid = c.get('id')
        S.add('sys_campus', dict(
            id=cid, tenant_id=TENANT_ID, campus_name=c.get('name'),
            campus_code=c.get('code'), address=c.get('address'),
            manager_name=c.get('manager'), staff_count=c.get('staffCount') or 0,
            enabled=1 if c.get('enabled') else 0, sort_no=cid,
        ))

    # 考试类型树
    for n in rows('admin-store.examTypeNodes'):
        S.add('dc_exam_type_node', dict(
            id=n.get('id'), tenant_id=PLATFORM_ID, parent_id=n.get('parentId'),
            node_name=n.get('name'), node_code=n.get('code') or f"ET{n.get('id')}",
            node_kind=enum(n.get('kind'), ('exam', 'competition', 'other'), 'exam'),
            sort_no=n.get('sort') or 0, enabled=1 if n.get('enabled') else 0,
            ref_count=n.get('refCount') or 0,
        ))

    # 知识点树
    for n in rows('admin-store.knowledgeNodes'):
        S.add('dc_knowledge_node', dict(
            id=n.get('id'), tenant_id=PLATFORM_ID, parent_id=n.get('parentId'),
            node_name=n.get('name'), node_code=n.get('code') or f"K{n.get('id')}",
            stage=n.get('stage') or '高中', subject=n.get('subject') or '数学',
            node_level=1 if not n.get('parentId') else 2,
            sort_no=n.get('sort') or 0, enabled=1 if n.get('enabled') else 0,
            ref_count=0, is_leaf=0,
        ))

    # 教材版本
    for t in rows('admin-store.textbooks'):
        S.add('dc_textbook_version', dict(
            id=t.get('id'), tenant_id=PLATFORM_ID, stage=t.get('stage'),
            subject=t.get('subject'), version_name=t.get('name'),
            publisher=t.get('publisher'), hue=t.get('hue'), region=t.get('region'),
            years=t.get('years'), enabled=1 if t.get('enabled') else 0,
            sort_no=t.get('sort') or 0,
        ))

    # 教材册次
    for v in rows('admin-store.textbookVolumes'):
        S.add('dc_textbook_volume', dict(
            id=v.get('id'), tenant_id=PLATFORM_ID, textbook_id=v.get('textbookId'),
            volume_alias=v.get('alias'), grade=v.get('grade'), term=v.get('term'),
            school_year=v.get('year'), enabled=1 if v.get('enabled') else 0,
            sort_no=v.get('sort') or 0,
        ))


# ================================================================ 4. 题库
def seed_questions():
    # 分类
    for c in rows('org-store.categories'):
        S.add('q_question_category', dict(
            id=c.get('id'), tenant_id=TENANT_ID, parent_id=c.get('parentId'),
            category_name=c.get('name'), library=c.get('library'),
            owner_id=c.get('ownerId'), sort_no=c.get('id'),
        ))

    def add_question(q, tenant, default_library='org', offset=0):
        qid = (q.get('id') or 0) + offset
        S.add('q_question', dict(
            id=qid, tenant_id=tenant,
            library=q.get('library') or default_library,
            scope=q.get('scope') or 'school',
            category_id=q.get('categoryId'),
            question_category='独立单题',
            subject=q.get('subject'), grade=q.get('grade'),
            question_type=q.get('type'), difficulty=q.get('difficulty'),
            term=q.get('term'), exam_type=q.get('examType'),
            region=q.get('region'), source=q.get('source') or '自有题库',
            stem=q.get('stem'), options_json=q.get('options'),
            option_columns=q.get('optionColumns'),
            answer=q.get('answer'), analysis=q.get('analysis'),
            knowledge_json=q.get('knowledge'),
            owner_id=q.get('ownerId'), owner_name=q.get('owner') or '未知',
            status=q.get('status') or 'approved',
            use_count=q.get('useCount') or 0,
            ai_flag=1 if (q.get('aiChecks') or q.get('source') == 'AI 生成') else 0,
            ai_checks_json=q.get('aiChecks'), temp_flag=0,
            update_time=q.get('updatedAt'), create_time=q.get('updatedAt'),
        ))
        for i, k in enumerate(q.get('knowledge') or [], start=1):
            if isinstance(k, str) and k.strip():
                S.add('q_question_knowledge', dict(
                    id=f'QK{qid}_{i}', tenant_id=tenant, question_id=qid,
                    knowledge_name=k.strip(), subject=q.get('subject') or '数学',
                ))

    for q in rows('org-store.questions'):
        add_question(q, TENANT_ID, 'org')
    for q in rows('exam-seeds.EXAM_QUESTIONS'):
        add_question(q, TENANT_ID, 'org', offset=50000)

    # 纠错
    for c in rows('org-store.questionCorrections'):
        cid = c.get('id')
        S.add('q_question_correction', dict(
            id=cid, tenant_id=TENANT_ID, question_id=c.get('questionId'),
            correction_types=c.get('types'), description=c.get('description'),
            reporter_id=None, reporter_name=c.get('reporter') or '教师',
            handle_status=0, create_time=c.get('createdAt'),
        ))


# ================================================================ 5. 试卷
def seed_papers():
    def add_paper(p, tenant, sections_sum, offset=0):
        pid = (p.get('id') or 0) + offset
        sections = p.get('sections') or []
        total = sum(s.get('totalScore') or 0 for s in sections) if sections else 0
        qcount = sum(len(s.get('questions') or []) for s in sections)
        S.add('p_paper', dict(
            id=pid, tenant_id=tenant, paper_name=p.get('name'),
            subject=p.get('subject'), grade=p.get('grade'),
            duration=p.get('duration') or 120,
            total_score=total or 150, question_count=qcount or 20,
            status=p.get('status') or 'approved',
            scope=p.get('scope') or 'school',
            paper_source=p.get('source') or p.get('paperSource') or '手动组卷',
            difficulty=p.get('difficulty'), exam_type=p.get('examType'),
            competition=p.get('competition'), region=p.get('region'),
            paper_year=p.get('year'), paper_month=p.get('month'),
            view_count=p.get('viewCount') or 0, download_count=p.get('downloadCount') or 0,
            owner_id=p.get('ownerId'), owner_name=p.get('owner') or '未知',
            update_time=p.get('updatedAt'), create_time=p.get('updatedAt'),
            ai_flag=0,
        ))
        for si, sec in enumerate(sections, start=1):
            sid = pid * 1000 + si
            qs = sec.get('questions') or []
            sec_total = sum(x.get('score') or 0 for x in qs)
            S.add('p_paper_section', dict(
                id=sid, tenant_id=tenant, paper_id=pid,
                section_title=sec.get('title') or f'第{si}部分',
                sort_no=si, total_score=sec_total, question_count=len(qs),
            ))
            for qi, qq in enumerate(qs, start=1):
                S.add('p_paper_section_question', dict(
                    id=sid * 100 + qi, tenant_id=tenant, paper_id=pid,
                    section_id=sid,
                    question_id=(qq.get('questionId') or 0) + (50000 if pid > 50000 else 0),
                    sort_no=qi, score=qq.get('score') or 0,
                ))

    for p in rows('org-store.papers'):
        # 试卷题量在 questions 里，totalScore 不在 mock，用 section 累加
        add_paper(p, TENANT_ID, True)
    for p in rows('exam-seeds.EXAM_PAPERS'):
        add_paper(p, TENANT_ID, True, offset=50000)

    # AI 组卷模板
    for t in rows('org-store.aiComposeTemplates'):
        S.add('p_ai_compose_template', dict(
            id=t.get('id'), tenant_id=TENANT_ID, template_name=t.get('name'),
            subject=t.get('subject'), grade=t.get('grade'),
            knowledge_json=t.get('knowledge'), exam_type=t.get('examType'),
            difficulty=t.get('difficulty'), region=t.get('region'),
            paper_year=t.get('year'), structure_json=t.get('structure'),
            use_count=t.get('useCount') or 0,
            owner_id=None, owner_name=t.get('owner') or '未知',
            update_time=t.get('updatedAt'),
        ))

    # 协同任务
    for t in rows('org-store.collabTasks'):
        S.add('p_paper_collab_task', dict(
            id=t.get('id'), tenant_id=TENANT_ID, paper_id=t.get('paperId'),
            task_name=t.get('name'), subject=t.get('subject') or '数学',
            grade=t.get('grade') or '高一', duration=t.get('duration') or 120,
            structure_json=t.get('members'), viewers_json=t.get('viewers'),
            requirement_remark=t.get('requirement'),
            task_status=t.get('status') or 'collecting',
            owner_id=None, owner_name=t.get('owner') or '未知',
            create_time=t.get('createdAt'),
        ))


# ================================================================ 6. 教学文档 / 资源
def seed_teaching():
    for d in rows('org-store.teachDocs'):
        did = d.get('id')
        S.add('t_teach_doc', dict(
            id=did, tenant_id=TENANT_ID,
            doc_kind=d.get('kind') or 'lesson',
            doc_name=d.get('name'), subject=d.get('subject'), grade=d.get('grade'),
            textbook_version=d.get('textbook'), knowledge_json=d.get('knowledge'),
            doc_source=d.get('source') or '自建',
            doc_status=d.get('status') or 'draft',
            content=json.dumps(d.get('blocks') or [], ensure_ascii=False),
            content_mode='blocks_json',
            page_json=d.get('slides'), view_count=d.get('views') or 0,
            owner_id=None, owner_name=d.get('owner') or '未知',
            update_time=d.get('updatedAt'), create_time=d.get('updatedAt'),
        ))

    for t in rows('org-store.teachTemplates'):
        S.add('t_teach_template', dict(
            id=t.get('id'), tenant_id=TENANT_ID,
            template_kind=t.get('kind') or 'lesson',
            template_name=t.get('name'), template_desc=t.get('desc'),
            scope=t.get('scope') or 'org',
            builtin=1 if t.get('builtin') else 0,
            enabled=1 if t.get('enabled') else 0,
            is_default=1 if t.get('isDefault') else 0,
            periods=t.get('periods'),
            content=json.dumps(t.get('content') or {}, ensure_ascii=False),
            owner_id=None, owner_name=t.get('owner') or '平台',
            use_count=0, update_time=t.get('updatedAt'),
        ))

    for t in rows('org-store.prepTasks'):
        S.add('t_prep_task', dict(
            id=t.get('id'), tenant_id=TENANT_ID, task_name=t.get('name'),
            subject=t.get('subject'), grade=t.get('grade'),
            doc_kind=t.get('docKind'), doc_name=t.get('docName'),
            requirement_note=t.get('requirement'),
            task_status=t.get('status') or 'working',
            owner_id=None, owner_name=t.get('owner') or '未知',
            update_time=t.get('updatedAt'),
        ))

    # 教辅
    R_STATUS = {'recognizing': 'recognizing', 'proofreading': 'proofreading',
                'done': 'done', 'failed': 'failed'}
    for m in rows('org-store.materials'):
        mid = m.get('id')
        chapters = m.get('chapters') or []
        examples = sum(len(c.get('examples') or []) for c in chapters)
        S.add('r_material', dict(
            id=mid, tenant_id=TENANT_ID, material_name=m.get('name'),
            material_type=m.get('type') or 'docx',
            subject=m.get('subject'), grade=m.get('grade') or '高一',
            size_mb=m.get('sizeMb') or 0,
            recognize_status=R_STATUS.get(m.get('status'), 'done'),
            chapter_count=len(chapters), example_count=examples,
            owner_id=None, owner_name=m.get('owner') or '未知',
            create_time=m.get('createdAt'),
        ))
        for ci, c in enumerate(chapters, start=1):
            S.add('r_material_chapter', dict(
                id=mid * 1000 + ci, tenant_id=TENANT_ID,
                material_id=mid, chapter_title=c.get('title'),
                sort_no=ci, knowledge_json=c.get('knowledge'),
            ))
            for ei, ex in enumerate(c.get('examples') or [], start=1):
                S.add('r_material_example', dict(
                    id=mid * 10000 + ci * 100 + ei, tenant_id=TENANT_ID,
                    material_id=mid, chapter_id=mid * 1000 + ci,
                    stem=ex.get('stem'), answer=ex.get('answer'),
                    analysis=ex.get('analysis'),
                    example_status=ex.get('status') or 'pending', sort_no=ei,
                ))

    # 媒体
    for m in rows('org-store.mediaResources'):
        S.add('r_media', dict(
            id=m.get('id'), tenant_id=TENANT_ID, media_name=m.get('name'),
            media_kind=m.get('kind') or 'image',
            subject=m.get('subject'), knowledge_json=m.get('knowledge'),
            size_mb=m.get('sizeMb') or 0,
            linked_count=m.get('linkedCount') or 0,
            owner_id=None, owner_name=m.get('owner') or '未知',
            create_time=m.get('createdAt'),
        ))

    # 文件夹 / 文件
    for f in rows('org-store.folders'):
        S.add('r_file_folder', dict(
            id=f.get('id'), tenant_id=TENANT_ID, parent_id=f.get('parentId'),
            folder_name=f.get('name'), owner_id=None, folder_path=f.get('name'),
            pinned=0, sort_no=f.get('id'),
        ))
    R_RECOG = {'none': 'none', 'done': 'done', 'recognizing': 'recognizing'}
    for f in rows('org-store.orgFiles'):
        S.add('r_file', dict(
            id=f.get('id'), tenant_id=TENANT_ID,
            folder_id=f.get('folderId') or 0, file_name=f.get('name'),
            file_kind=f.get('kind') or 'doc',
            size_mb=f.get('sizeMb') or 0,
            recognize_status=R_RECOG.get(f.get('recognize'), 'none'),
            owner_id=None, owner_name=f.get('owner') or '未知',
            shared=0, pinned=0, download_count=0,
            create_time=f.get('uploadedAt'), update_time=f.get('updatedAt'),
        ))

    # 公式
    FORMULA_STATUS = {'published': 'published', 'draft': 'draft'}
    for f in rows('org-store.orgFormulas'):
        S.add('r_formula', dict(
            id=f.get('id'), tenant_id=TENANT_ID, formula_name=f.get('name'),
            formula_scope='school', subject=f.get('subject'),
            category=f.get('category'), latex=f.get('latex'),
            formula_status=FORMULA_STATUS.get(f.get('status'), 'published'),
            owner_id=None, owner_name=f.get('owner') or '未知',
            collect_count=0, use_count=0, sort_no=f.get('id'),
            update_time=f.get('updatedAt'),
        ))
    for f in rows('org-store.standardFormulas'):
        S.add('r_formula', dict(
            id=90000 + (f.get('id') or 0), tenant_id=PLATFORM_ID,
            formula_name=f.get('name'), formula_scope='platform',
            subject='数学', branch=f.get('branch'), chapter=f.get('chapter'),
            latex=f.get('latex'), knowledge_json=f.get('knowledge'),
            formula_status='published', collect_count=f.get('collected') or 0,
            use_count=0, sort_no=f.get('id'),
        ))

    # 视频片段
    for v in rows('org-store.videoClips'):
        S.add('r_video_clip', dict(
            id=v.get('id'), tenant_id=TENANT_ID, media_id=v.get('mediaId'),
            media_name=v.get('mediaName'), clip_title=v.get('title'),
            start_sec=v.get('start') or 0, end_sec=v.get('end') or 0,
            knowledge_json=v.get('knowledge'), question_ids=v.get('questionIds'),
            note=v.get('note'), creator_name=v.get('createdBy'),
            create_time=v.get('createdAt'),
        ))

    # 资源审批
    APPROVAL_STATUS = {'pending': 'pending', 'approved': 'approved', 'rejected': 'rejected'}
    for a in rows('org-store.approvals'):
        aid = a.get('id')
        S.add('r_resource_approval', dict(
            id=aid, tenant_id=TENANT_ID,
            resource_kind=a.get('kind') or 'question',
            resource_id=a.get('resourceId'), resource_name=a.get('name'),
            subject=a.get('subject'), grade=a.get('grade'),
            scope=a.get('scope') or 'school',
            applicant_id=None, applicant_name=a.get('applicant') or '未知',
            approval_status=APPROVAL_STATUS.get(a.get('status'), 'pending'),
            reviewer_name=a.get('reviewer'), reviewed_at=a.get('reviewedAt'),
            opinion=a.get('opinion'), submitted_at=a.get('submittedAt'),
            create_time=a.get('submittedAt'),
        ))
        for i, lg in enumerate(a.get('logs') or [], start=1):
            S.add('r_resource_approval_log', dict(
                id=aid * 100 + i, tenant_id=TENANT_ID, approval_id=aid,
                action=lg.get('action'), opinion=lg.get('note'),
                operator_name=lg.get('by'), create_time=lg.get('at'),
            ))

    # 资源广场
    for r in rows('org-store.squareResources'):
        S.add('r_square_resource', dict(
            id=r.get('id'), tenant_id=PLATFORM_ID,
            resource_title=r.get('title'), resource_kind=r.get('kind') or 'question',
            subject=r.get('subject'), knowledge=r.get('knowledge'),
            sharer_name=r.get('sharer'), org_name=r.get('org'),
            collect_count=r.get('collects') or 0,
            download_count=r.get('downloads') or 0,
            resource_desc=r.get('desc'), audit_status='approved',
        ))


# ================================================================ 7. 教学业务
def seed_edu_business():
    # 班级
    for c in rows('student-store.classes'):
        cid = c.get('id')
        S.add('e_class', dict(
            id=cid, tenant_id=TENANT_ID, class_name=c.get('name'),
            grade=c.get('grade') or '高一',
            head_teacher_name=c.get('headTeacher'),
            assistant_name=c.get('assistant'),
            student_count=c.get('studentCount') or 0,
            subjects=c.get('subjects'), room=c.get('room'),
            enabled=1 if c.get('enabled') else 0,
            create_time=c.get('createdAt'),
        ))

    # 学生
    CONSENT = ('granted', 'pending', 'withdrawn')
    WARN = ('none', 'watch', 'risk')
    STATUS = ('在读', '转班', '休学', '退出')
    for s in rows('student-store.students'):
        sid = s.get('id')
        S.add('e_student', dict(
            id=sid, tenant_id=TENANT_ID, student_no=s.get('studentNo'),
            student_name=s.get('name'), gender=s.get('gender'),
            class_name=s.get('className'), grade=s.get('grade'),
            guardian_name=s.get('guardianName'), guardian_phone=s.get('guardianPhone'),
            consent_status=enum(s.get('consentStatus'), CONSENT, 'pending'),
            tags_json=s.get('tags'),
            warning_level=enum(s.get('warning'), WARN, 'none'),
            last_score=s.get('lastScore'), last_percentile=s.get('lastPercentile'),
            enroll_at=s.get('enrolledAt'),
            student_status=enum(s.get('status'), STATUS, '在读'),
        ))

    # 同意记录
    for c in rows('student-store.consents'):
        S.add('e_consent_record', dict(
            id=c.get('id'), tenant_id=TENANT_ID, student_id=c.get('studentId'),
            guardian_name=c.get('guardianName'), relation=c.get('relation'),
            doc_version=c.get('docVersion'),
            consent_status=enum(c.get('status'), CONSENT, 'pending'),
            scopes=c.get('scopes'), sign_channel=c.get('channel'),
        ))

    # 考试
    for e in rows('org-store.examSessions'):
        S.add('e_exam_session', dict(
            id=e.get('id'), tenant_id=TENANT_ID, session_name=e.get('name'),
            paper_id=(e.get('paperId') or 0) + (50000 if (e.get('paperId') or 0) < 1000 else 0),
            paper_name=e.get('paperName'),
            subject=e.get('subject'), grade=e.get('grade'),
            classes_json=e.get('classes'),
            student_count=e.get('studentCount') or 0,
            exam_at=e.get('examAt'),
            session_status=e.get('status') or 'ready',
            full_score=e.get('fullScore') or 150,
            created_by_name=e.get('createdBy'),
            update_time=e.get('updatedAt'),
        ))

    # 答卷
    for ai, a in enumerate(rows('org-store.examAnswers'), start=1):
        aid = a.get('id')
        S.add('e_exam_answer', dict(
            id=aid, tenant_id=TENANT_ID, session_id=a.get('sessionId'),
            # 唯一键为 (session_id, student_id)：按 session 内序号派生出唯一学生 id
            student_id=int(f"{a.get('sessionId') or 0}{ai:04d}"),
            student_name=a.get('student'),
            class_name=a.get('className'), total_score=a.get('total'),
            answer_status=a.get('status') or 'graded',
        ))
        for it in a.get('items') or []:
            qi = it.get('qIndex')
            S.add('e_exam_answer_item', dict(
                id=f'EAI{aid}_{qi}', tenant_id=TENANT_ID, answer_id=aid,
                question_id=(it.get('questionId') or 0) + 50000, q_index=qi,
                section_title=it.get('sectionTitle'), question_type=it.get('type'),
                knowledge_json=it.get('knowledge'),
                full_score=it.get('full'), score=it.get('score'),
                answer_text=it.get('answer'),
                is_correct=1 if it.get('correct') else 0,
                ai_adopted=0, review_status='confirmed',
            ))

    # 作业
    for h in rows('org-store.homeworks'):
        hid = h.get('id')
        S.add('e_homework', dict(
            id=hid, tenant_id=TENANT_ID, homework_name=h.get('name'),
            subject=h.get('subject'), grade=h.get('grade'),
            classes_json=h.get('classes'),
            assign_at=h.get('assignAt'), deadline=h.get('deadline'),
            require_text=h.get('require'),
            answer_mode='online', allow_analysis=1, ai_grading=1,
            homework_status=h.get('status') or 'ongoing',
            submitted_count=h.get('submitted') or 0,
            total_count=h.get('total') or 0,
            owner_id=None, owner_name=h.get('owner') or '未知',
            update_time=h.get('updatedAt'),
        ))
        for i, qid in enumerate(h.get('questionIds') or [], start=1):
            S.add('e_homework_question', dict(
                id=f'HQ{hid}_{i}', tenant_id=TENANT_ID, homework_id=hid,
                question_id=qid, sort_no=i,
            ))

    # 作业提交
    for si, s in enumerate(rows('org-store.submissions'), start=1):
        S.add('e_homework_submission', dict(
            id=s.get('id'), tenant_id=TENANT_ID, homework_id=s.get('homeworkId'),
            student_id=int(f"{s.get('homeworkId') or 0}{si:04d}"),
            student_name=s.get('student'),
            class_name=s.get('className'), submit_at=s.get('submittedAt'),
            submit_status=s.get('status') or 'submitted',
            score=s.get('score'), correct_rate=s.get('correctRate'),
            wrong_question_ids=s.get('wrongQuestionIds'),
        ))

    # 错题
    for m in rows('org-store.mistakes'):
        S.add('e_mistake', dict(
            id=m.get('id'), tenant_id=TENANT_ID, question_id=m.get('questionId'),
            scope=m.get('scope') or 'personal', source=m.get('source'),
            student_name=m.get('student'), wrong_answer=m.get('wrongAnswer'),
            wrong_count=m.get('wrongCount') or 1,
            reason=m.get('reason'), mastery=m.get('mastery') or '未掌握',
            practiced_count=1 if m.get('practiced') else 0,
            note=m.get('note'), last_wrong_at=m.get('lastWrongAt'),
            create_time=m.get('addedAt'),
        ))


# ================================================================ 8. 系统运营
def seed_system_ops():
    n = 0
    for key, tenant in (('admin-store.loginLogs', PLATFORM_ID), ('org-store.orgLoginLogs', TENANT_ID)):
        for lg in rows(key):
            n += 1
            S.add('sys_login_log', dict(
                id=n, tenant_id=tenant, account=lg.get('account'),
                login_ip=lg.get('ip'), device=lg.get('device'),
                result=1 if lg.get('ok') else 0,
                risk_flag=0 if lg.get('ok') else 1,
                create_time=lg.get('time'),
            ))

    n = 0
    for key, tenant in (('admin-store.operationLogs', PLATFORM_ID), ('org-store.orgOperationLogs', TENANT_ID)):
        for lg in rows(key):
            n += 1
            S.add('sys_operation_log', dict(
                id=n, tenant_id=tenant,
                biz_module=lg.get('module') or 'system',
                action=lg.get('action') or '操作', target=lg.get('target'),
                result=1 if lg.get('ok') else 0,
                operator_name=lg.get('account'),
                create_time=lg.get('time'),
            ))

    for e in rows('admin-store.errorLogs'):
        S.add('sys_error_log', dict(
            id=e.get('id'), tenant_id=PLATFORM_ID, level=e.get('level') or 'error',
            message=e.get('stack') or '未知错误',
            stack=e.get('stack'), occur_time=e.get('time'),
            create_time=e.get('time'),
        ))

    n = 0
    for nt in rows('admin-store.notifications'):
        n += 1
        S.add('sys_notification', dict(
            id=n, tenant_id=PLATFORM_ID, receiver_id=910000 + (rows('admin-store.adminAccounts')[0].get('id') or 1),
            msg_type=nt.get('type') or 'system', title=nt.get('title'),
            content=nt.get('content'), read_flag=1 if nt.get('read') else 0,
            create_time=nt.get('time'),
        ))
    for m in rows('org-store.orgMessages'):
        n += 1
        S.add('sys_notification', dict(
            id=n, tenant_id=TENANT_ID, receiver_id=900000 + (rows('data.mockUsers')[0].get('id') or 101),
            msg_type='business', msg_tab=m.get('tab'), title=m.get('title'),
            content=m.get('summary'), biz_module=m.get('module'),
            link=m.get('link'), read_flag=1 if m.get('read') else 0,
            create_time=m.get('time'),
        ))

    for r in rows('org-store.notifyMatrix'):
        S.add('sys_notify_rule', dict(
            id=r.get('key'), tenant_id=TENANT_ID, biz_key=r.get('key'),
            biz_label=r.get('label'), in_app=1 if r.get('inApp') else 0,
            sms=1 if r.get('sms') else 0, email=1 if r.get('email') else 0,
            enabled=1,
        ))

    for p in rows('content-store.systemParams'):
        S.add('sys_param', dict(
            id=p.get('key'), tenant_id=PLATFORM_ID, param_key=p.get('key'),
            param_name=p.get('label'), param_value=p.get('value'),
            param_group=p.get('group') or '通用', value_type='string',
            editable=1 if p.get('editable') else 0, hot_effect=0,
            remark=p.get('desc'),
        ))

    for h in rows('content-store.serviceHealth'):
        S.add('sys_service_health', dict(
            id=h.get('key'), tenant_id=PLATFORM_ID, service_key=h.get('key'),
            service_name=h.get('name'), status=h.get('status') or 'healthy',
            uptime=h.get('uptime'), latency_ms=h.get('latencyMs'),
            cpu_rate=h.get('cpu'), memory_rate=h.get('memory'),
            collect_time=NOW,
        ))

    for b in rows('content-store.backups'):
        S.add('sys_backup_record', dict(
            id=b.get('id'), tenant_id=PLATFORM_ID, backup_name=b.get('name'),
            backup_kind=b.get('kind') or 'full', backup_scope=b.get('scope'),
            size_gb=b.get('sizeGb'), status=b.get('status') or 'success',
            started_at=b.get('startedAt'), finished_at=b.get('finishedAt'),
            restore_times=b.get('restoreTimes') or 0,
        ))

    for s in rows('content-store.storagePolicies'):
        S.add('sys_storage_policy', dict(
            id=s.get('key'), tenant_id=PLATFORM_ID, policy_key=s.get('key'),
            policy_name=s.get('label'), provider=s.get('provider'),
            bucket=s.get('bucket'), max_upload_mb=s.get('maxUploadMb') or 100,
            accept_types=s.get('acceptTypes'), enabled=1 if s.get('enabled') else 0,
            used_gb=s.get('usedGb'), quota_gb=s.get('quotaGb'),
        ))

    for t in rows('content-store.messageTemplates'):
        S.add('sys_message_template', dict(
            id=t.get('id'), tenant_id=PLATFORM_ID, tpl_code=f"TPL{t.get('id'):03d}",
            tpl_name=t.get('name'), scene=t.get('scene'),
            channels=t.get('channels'), content=t.get('content'),
            enabled=1 if t.get('enabled') else 0, update_time=t.get('updatedAt'),
        ))

    for f in rows('student-store.reviewFlows'):
        S.add('sys_review_flow', dict(
            id=f.get('key'), tenant_id=TENANT_ID, flow_key=f.get('key'),
            flow_label=f.get('label'), enabled=1 if f.get('enabled') else 0,
            levels=f.get('levels'), level1_reviewers=f.get('level1Reviewers'),
            level2_reviewers=f.get('level2Reviewers'),
            ai_precheck=1 if f.get('aiPrecheck') else 0,
        ))


# ================================================================ 9. AI 域
def seed_ai():
    for m in rows('admin-store.aiModels'):
        S.add('ai_model', dict(
            id=m.get('id'), tenant_id=PLATFORM_ID, model_name=m.get('name'),
            model_type=enum(m.get('type'), ('llm', 'multimodal', 'ocr'), 'llm'),
            provider=m.get('provider'), api_url=m.get('apiUrl'),
            qps=m.get('qps') or 10, timeout_sec=60,
            price_per_k=m.get('pricePerK') or 0,
            enabled=1 if m.get('enabled') else 0,
            calls_month=m.get('callsThisMonth') or 0,
            cost_month=m.get('costThisMonth') or 0,
            last_check_at=m.get('lastCheckAt'),
            last_check_ok=1 if m.get('lastCheckOk') else 0,
        ))

    n = 0
    for lg in rows('admin-store.aiCallLogs'):
        n += 1
        S.add('ai_call_log', dict(
            id=n, tenant_id=PLATFORM_ID, trace_id=f'TR{n:06d}',
            scene=lg.get('scene'), model_key=lg.get('model'),
            model_name=lg.get('model'),
            input_tokens=lg.get('inputTokens') or 0,
            output_tokens=lg.get('outputTokens') or 0,
            cost_amount=0, cost_ms=lg.get('costMs') or 0,
            result=1 if lg.get('ok') else 0,
            create_time=lg.get('time'),
        ))
    for lg in rows('student-store.aiRequestLogs'):
        n += 1
        S.add('ai_call_log', dict(
            id=n, tenant_id=TENANT_ID, trace_id=f'TR{n:06d}',
            scene=lg.get('scene'), model_key='default',
            input_tokens=lg.get('promptTokens') or 0,
            output_tokens=lg.get('completionTokens') or 0,
            cost_amount=lg.get('cost') or 0, cost_ms=lg.get('elapsed') or 0,
            result=1 if lg.get('status') == 'success' else 0,
            create_time=lg.get('createdAt'),
        ))

    # 提示词模板
    n = 0
    for key, tenant, scope in (('admin-store.prompts', PLATFORM_ID, 'platform'),
                               ('org-store.platformPrompts', PLATFORM_ID, 'platform'),
                               ('org-store.orgPrompts', TENANT_ID, 'school')):
        for p in rows(key):
            n += 1
            tid = nid(f'PT{n}')
            S.add('ai_prompt_template', dict(
                id=tid, tenant_id=tenant, prompt_name=p.get('name'),
                scene=p.get('scene') or '通用', content=p.get('content') or '',
                prompt_status=p.get('status') or 'published',
                is_default=1 if p.get('isDefault') else 0,
                remark=p.get('remark'), update_time=p.get('updatedAt'),
            ))
            for vi, v in enumerate(p.get('versions') or [], start=1):
                S.add('ai_prompt_version', dict(
                    id=nid(f'PTV{n}_{vi}'), tenant_id=tenant, template_id=tid,
                    version_no=v.get('version') or vi,
                    content=v.get('content') or p.get('content') or '',
                    change_note=v.get('note'), gray_status='full',
                ))

    # 计费规则
    for b in rows('content-store.billingRules'):
        S.add('ai_billing_rule', dict(
            id=b.get('id'), tenant_id=PLATFORM_ID, scene=b.get('scene'),
            model_key=b.get('model'), billing_unit=b.get('unit') or '1k_tokens',
            price=b.get('price') or 0, currency='CNY',
            enabled=1 if b.get('enabled') else 0,
        ))
    for b in rows('content-store.tenantBillingRules'):
        S.add('ai_billing_rule', dict(
            id=10000 + (b.get('id') or 0), tenant_id=b.get('tenantId') or TENANT_ID,
            scene=b.get('scene'), model_key=b.get('model'),
            billing_unit=b.get('unit') or '1k_tokens', price=b.get('price') or 0,
            currency='CNY', enabled=1 if b.get('enabled') else 0,
        ))

    # 质量评估
    for q in rows('content-store.qualityEvals'):
        sc = q.get('scores') or {}
        S.add('ai_quality_eval', dict(
            id=q.get('id'), tenant_id=PLATFORM_ID, scene=q.get('scene'),
            model_key=q.get('model'), dataset_name=q.get('dataset'),
            sample_count=q.get('sampleCount') or 0,
            score_accuracy=sc.get('accuracy'), score_completeness=sc.get('completeness'),
            score_grade_fit=sc.get('gradeFit'), score_safety=sc.get('safety'),
            overall_score=q.get('overall'), delta=q.get('delta'), ran_at=q.get('ranAt'),
        ))

    # 敏感词策略
    for s in rows('content-store.sensitivePolicies'):
        S.add('ai_sensitive_policy', dict(
            id=s.get('id'), tenant_id=PLATFORM_ID, policy_name=s.get('name'),
            policy_action=s.get('action') or 'block', scope=s.get('scope') or 'global',
            words_json=s.get('words'), enabled=1 if s.get('enabled') else 0,
            hits_30d=s.get('hits30d') or 0,
        ))

    # 追踪
    for t in rows('content-store.traceRecords'):
        S.add('ai_trace', dict(
            id=t.get('id'), tenant_id=PLATFORM_ID, trace_id=t.get('traceId'),
            scene=t.get('scene'), model_key=t.get('model'),
            artifact_kind=t.get('artifactKind'),
            artifact_title=t.get('artifactTitle'),
            input_digest=t.get('inputDigest'),
            safety_result=t.get('safety') or 'pass',
            create_time=t.get('createdAt'),
        ))

    # 任务
    for t in rows('student-store.aiTasks'):
        S.add('ai_task', dict(
            id=t.get('id'), tenant_id=TENANT_ID, task_no=f"AIT{t.get('id'):06d}",
            scene=t.get('scene'), task_title=t.get('title'),
            creator_name=t.get('creator'), task_status=t.get('status') or 'success',
            elapsed_sec=t.get('elapsed'), tokens=t.get('tokens'),
            output_count=t.get('outputCount'), create_time=t.get('createdAt'),
        ))

    # 产物复核
    for a in rows('student-store.aiArtifacts'):
        S.add('ai_artifact_review', dict(
            id=a.get('id'), tenant_id=TENANT_ID,
            artifact_kind=a.get('kind') or 'question',
            artifact_title=a.get('title'), scene=a.get('scene'),
            review_status=a.get('status') or 'pending',
            auto_check=1 if a.get('autoCheck') else 0,
            auto_check_note=a.get('autoCheckNote'),
            ai_labeled=1 if a.get('aiLabeled') else 0,
            create_time=a.get('createdAt'),
        ))

    # Agent 配置
    cfg = obj('admin-store.agentConfig')
    S.add('ai_agent_config', dict(
        id=1, tenant_id=PLATFORM_ID, agent_name='题目质量审核 Agent',
        agent_desc='多模型交叉校验题目语义、计算、公式与图形描述',
        scene='question_check', auto_fix_types=cfg.get('autoFix'),
        auto_fix_threshold=0.9, min_confidence=0.7, max_similarity=0.85,
        version_no=cfg.get('version') or 1, config_status='active',
    ))
    for i, it in enumerate(cfg.get('items') or [], start=1):
        S.add('ai_agent_check_item', dict(
            id=i, tenant_id=PLATFORM_ID, agent_id=1, item_key=it.get('key'),
            item_label=it.get('label'), enabled=1 if it.get('enabled') else 0,
            model_id=it.get('modelId'), weight=it.get('weight') or 10,
            timeout_sec=it.get('timeoutSec') or 30,
            ocr_only=1 if it.get('ocrOnly') else 0, sort_no=i,
        ))


# ================================================================ 10. 内容平台
def seed_content_platform():
    for q in rows('content-store.platformQuestions'):
        S.add('c_public_question', dict(
            id=q.get('id'), tenant_id=PLATFORM_ID,
            question_type=q.get('type'), subject=q.get('subject'), grade=q.get('grade'),
            difficulty=q.get('difficulty'), knowledge_json=q.get('knowledge'),
            stem=q.get('stem'), answer=q.get('answer'), analysis=q.get('analysis'),
            content_status=q.get('status') or 'published',
            quality_grade=q.get('quality'), content_source=q.get('source'),
            ref_count=len(q.get('refs') or []) if isinstance(q.get('refs'), list) else 0,
            ai_status='passed', update_time=q.get('updatedAt'),
        ))
    for q in rows('admin-store.publicQuestions'):
        S.add('c_public_question', dict(
            id=20000 + (q.get('id') or 0), tenant_id=PLATFORM_ID,
            question_type=q.get('type'), subject=q.get('subject'),
            grade=q.get('grade') or '高一', difficulty=q.get('difficulty'),
            knowledge_json=q.get('knowledge'), stem=q.get('stem'),
            answer=q.get('answer'), analysis=q.get('analysis'),
            content_status='published', content_source='机构投递',
            ref_count=q.get('variantCount') or 0, ai_status=q.get('aiStatus'),
            create_time=q.get('createdAt'),
        ))

    for p in rows('content-store.platformPapers'):
        S.add('c_public_paper', dict(
            id=p.get('id'), tenant_id=PLATFORM_ID, paper_name=p.get('name'),
            subject=p.get('subject'), grade=p.get('grade'),
            question_count=p.get('questionCount') or 0,
            full_score=p.get('fullScore') or 150, paper_source=p.get('source'),
            content_status=p.get('status') or 'published',
            ref_count=len(p.get('refs') or []) if isinstance(p.get('refs'), list) else 0,
            update_time=p.get('updatedAt'),
        ))
    for p in rows('admin-store.publicPapers'):
        S.add('c_public_paper', dict(
            id=20000 + (p.get('id') or 0), tenant_id=PLATFORM_ID,
            paper_name=p.get('name'), subject=p.get('subject'), grade='高一',
            question_count=p.get('questionCount') or 0,
            full_score=p.get('totalScore') or 150, paper_source='机构投递',
            content_status='published', ref_count=p.get('parallelCount') or 0,
            create_time=p.get('createdAt'),
        ))

    for t in rows('content-store.feedbackTickets'):
        S.add('c_feedback_ticket', dict(
            id=t.get('id'), tenant_id=PLATFORM_ID, ticket_title=t.get('title'),
            content_type=t.get('contentType'), content_name=t.get('contentName'),
            reporter_name=t.get('reporter'), tenant_name=t.get('tenantName'),
            ticket_kind=t.get('kind') or 'quality',
            priority=t.get('priority') or 'mid',
            ticket_status=t.get('status') or 'open',
            create_time=t.get('createdAt'),
        ))

    for d in rows('content-store.distributions'):
        S.add('c_content_distribution', dict(
            id=d.get('id'), tenant_id=PLATFORM_ID,
            content_type=d.get('contentType'), content_name=d.get('contentName'),
            scope_type=d.get('scopeType') or 'all',
            scope_value=d.get('scopeText'),
            tenant_count=d.get('tenantCount') or 0,
            dist_status=d.get('status') or 'synced',
            synced_at=d.get('syncedAt'),
        ))

    for s in rows('content-store.spotChecks'):
        S.add('c_compliance_check', dict(
            id=s.get('id'), tenant_id=PLATFORM_ID, check_title=s.get('title'),
            check_scope=s.get('scope') or 'all',
            sample_count=s.get('sampleCount') or 0,
            flagged_count=s.get('flagged') or 0,
            confirmed_count=s.get('confirmed') or 0,
            check_status=s.get('status') or 'done',
            samples_json=s.get('samples'), finished_at=s.get('createdAt'),
            create_time=s.get('createdAt'),
        ))


# ================================================================ 执行
# ================================================================ 11. 过渡表回填
def seed_transition_tables():
    """把 schema.sql 的主模型回填到 Wave1/2 的过渡表。

    背景：`EduTenantAdminMapper` / `EduTenantApplyMapper` 目前直读
    `edu_tenant_ext` / `edu_tenant_apply`（`INNER JOIN`），而 mock 数据落在
    `sys_tenant` / `sys_tenant_apply`。单库接管后两套表并存，若不回填，
    会出现「数据在库里、管理端页面却是空的」。

    因此灌完业务表后做一次镜像（`ON DUPLICATE KEY` 幂等）：
      - sys_tenant        → edu_tenant_ext   （1:1，按 org_tenant_id 唯一键）
      - sys_tenant_apply  → edu_tenant_apply （按 id / apply_no 唯一键）
    框架自带的 1000/1001/1002 也会被覆盖为 sys_tenant 的真实值，不会丢行。
    """
    S.raw.append("""
-- sys_tenant → edu_tenant_ext（管理端机构列表直读此表）
INSERT INTO `edu_tenant_ext`
  (`id`,`org_tenant_id`,`tenant_code`,`logo_hue`,`biz_status`,`org_type`,`stages`,
   `package_id`,`trial_end_time`,`contact`,`phone`,`city`,`address`,`intro`,`cert_files`,
   `isolation_type`,`storage_region`,`storage_used_gb`,`ai_used`,`disable_reason`,
   `switches`,`quotas`,`create_time`,`del_flag`)
SELECT CONCAT('ext-', LPAD(t.`id`, 6, '0')), t.`id`, t.`tenant_code`,
       IFNULL(t.`logo_hue`, 0), IFNULL(t.`status`, 2), t.`tenant_type`,
       IF(JSON_VALID(t.`stage_scope`), t.`stage_scope`, JSON_ARRAY()),
       NULLIF(t.`package_id`, 0), t.`trial_end_time`,
       t.`contact_name`, t.`contact_phone`,
       CONCAT(IFNULL(t.`province`, ''), IFNULL(t.`city`, '')),
       t.`address`, t.`intro`,
       (SELECT JSON_ARRAYAGG(JSON_OBJECT('category', c.`cert_category`,
                                         'name', c.`file_name`,
                                         'type', c.`file_type`))
          FROM `sys_tenant_cert` c WHERE c.`tenant_id_ref` = t.`id`),
       CASE WHEN t.`isolation_type` = 2 THEN 'dedicated' ELSE 'shared' END,
       t.`storage_region`, IFNULL(t.`storage_used_gb`, 0), IFNULL(t.`ai_used`, 0),
       t.`disable_reason`,
       (SELECT JSON_OBJECTAGG(s.`capability_key`, s.`enabled`)
          FROM `ai_tenant_switch` s WHERE s.`tenant_id` = t.`id`),
       (SELECT JSON_OBJECTAGG(q.`quota_key`, q.`quota_value`)
          FROM `sys_tenant_quota` q WHERE q.`tenant_id` = t.`id`),
       IFNULL(t.`open_time`, t.`create_time`), IFNULL(t.`del_flag`, 0)
  FROM `sys_tenant` t
 WHERE IFNULL(t.`del_flag`, 0) = 0
ON DUPLICATE KEY UPDATE
  `tenant_code`      = VALUES(`tenant_code`),
  `logo_hue`         = VALUES(`logo_hue`),
  `biz_status`       = VALUES(`biz_status`),
  `org_type`         = VALUES(`org_type`),
  `stages`           = VALUES(`stages`),
  `package_id`       = VALUES(`package_id`),
  `trial_end_time`   = VALUES(`trial_end_time`),
  `contact`          = VALUES(`contact`),
  `phone`            = VALUES(`phone`),
  `city`             = VALUES(`city`),
  `address`          = VALUES(`address`),
  `intro`            = VALUES(`intro`),
  `cert_files`       = VALUES(`cert_files`),
  `isolation_type`   = VALUES(`isolation_type`),
  `storage_region`   = VALUES(`storage_region`),
  `storage_used_gb`  = VALUES(`storage_used_gb`),
  `ai_used`          = VALUES(`ai_used`),
  `disable_reason`   = VALUES(`disable_reason`),
  `switches`         = VALUES(`switches`),
  `quotas`           = VALUES(`quotas`);

-- sys_tenant_apply → edu_tenant_apply（管理端入驻申请列表直读此表）
-- 状态语义换算：sys_tenant_apply.apply_status 0待审/1通过/2驳回
--               edu_tenant_apply.status      1待审/2通过/3驳回
INSERT INTO `edu_tenant_apply`
  (`id`,`apply_no`,`code`,`org_name`,`org_type`,`stages`,`contact`,`phone`,`email`,
   `city`,`address`,`intro`,`cert_files`,`status`,`reject_reason`,`apply_tenant_id`,
   `submitted_at`,`reviewed_at`,`reviewed_by`,`create_time`,`del_flag`)
SELECT a.`id`, a.`apply_no`, a.`tenant_code`, a.`org_name`, a.`org_type`,
       IF(JSON_VALID(a.`stage_scope`), a.`stage_scope`, JSON_ARRAY()),
       a.`contact_name`, a.`contact_phone`, a.`contact_email`,
       CONCAT(IFNULL(a.`province`, ''), IFNULL(a.`city`, '')),
       a.`address`, a.`intro`,
       (SELECT JSON_ARRAYAGG(JSON_OBJECT('category', c.`cert_category`,
                                         'name', c.`file_name`,
                                         'type', c.`file_type`))
          FROM `sys_tenant_cert` c WHERE c.`apply_id` = a.`id`),
       CASE a.`apply_status` WHEN 1 THEN 2 WHEN 2 THEN 3 ELSE 1 END,
       a.`reject_reason`, a.`tenant_id_created`,
       a.`submitted_at`, a.`reviewed_at`, a.`reviewer_name`,
       IFNULL(a.`submitted_at`, a.`create_time`), IFNULL(a.`deleted`, 0)
  FROM `sys_tenant_apply` a
 WHERE a.`deleted` = 0
ON DUPLICATE KEY UPDATE
  `org_name`      = VALUES(`org_name`),
  `org_type`      = VALUES(`org_type`),
  `stages`        = VALUES(`stages`),
  `contact`       = VALUES(`contact`),
  `phone`         = VALUES(`phone`),
  `email`         = VALUES(`email`),
  `city`          = VALUES(`city`),
  `address`       = VALUES(`address`),
  `intro`         = VALUES(`intro`),
  `cert_files`    = VALUES(`cert_files`),
  `status`        = VALUES(`status`),
  `reject_reason` = VALUES(`reject_reason`),
  `reviewed_at`   = VALUES(`reviewed_at`),
  `reviewed_by`   = VALUES(`reviewed_by`);

-- sys_user.tenant_id → sys_user_tenant（框架 SaaS 模式的用户-租户关系表）
-- 背景：框架 SysUserController#queryPageList 在 OPEN_SYSTEM_TENANT_CONTROL=true 时，
--       按 sys_user_tenant 里当前租户的成员过滤。迁移过来的 sys_user_tenant 只有 4 行
--       （框架自带的 admin + 开户流程新建的管理员），mock 用户没有关系行，
--       导致「用户管理」只看到 admin 一条。这里按 sys_user.tenant_id 补齐。
-- 幂等：id 由 user_id + tenant_id 的 CRC32 派生，重复执行走 NOT EXISTS。
INSERT INTO `sys_user_tenant` (`id`,`user_id`,`tenant_id`,`status`,`create_by`,`create_time`)
SELECT CONCAT('SUT', LPAD(CRC32(CONCAT(u.`id`, '-', u.`tenant_id`)), 10, '0')),
       u.`id`, u.`tenant_id`, '1', 'admin', IFNULL(u.`create_time`, NOW())
  FROM `sys_user` u
 WHERE IFNULL(u.`del_flag`, 0) = 0
   AND u.`tenant_id` IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM `sys_user_tenant` t
                    WHERE t.`user_id` = u.`id` AND t.`tenant_id` = u.`tenant_id`);
""")


def main():
    seed_tenant_domain()
    seed_user_permission()
    seed_knowledge()
    seed_questions()
    seed_papers()
    seed_teaching()
    seed_edu_business()
    seed_system_ops()
    seed_ai()
    seed_content_platform()
    seed_transition_tables()

    S.emit('/tmp/seed_mock.sql')

    print(f'{"表名":<32} {"条数":>6}')
    print('-' * 42)
    total = 0
    for t, c in sorted(stats.items()):
        print(f'{t:<32} {c:>6}')
        total += c
    print('-' * 42)
    print(f'{"合计":<32} {total:>6}')
    if type_conflicts:
        print(f'\n-- 数字列收到字符串枚举（已自动转换，建议补语义映射）：')
        for k, vs in sorted(type_conflicts.items()):
            print(f'  {k}: {sorted(vs)}')
    if errors:
        print(f'\n!! {len(errors)} 个问题：')
        for e in errors[:20]:
            print('  -', e)


if __name__ == '__main__':
    main()
