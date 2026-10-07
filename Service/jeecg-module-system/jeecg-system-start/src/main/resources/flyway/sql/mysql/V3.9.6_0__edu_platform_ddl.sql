-- ---author:教学云---date:20261006-----for:教学云业务接入 Wave 1 建表（租户域三表 + 机构端隔离样板表）。全部 IF NOT EXISTS，可重复执行。
--
-- 命名与建表约定：
--   1. 教学云业务表一律 edu_ 前缀，避免与框架 sys_ 表及上游外部 jar（jeecg-boot-platform 等）重名。
--   2. 主键 id varchar(36) 存雪花串，与框架 JeecgEntity 的 IdType.ASSIGN_ID 一致。
--   3. 机构端业务表必须带 tenant_id（int NOT NULL DEFAULT 0）并建索引，这是 TenantLineInnerInterceptor 的行级隔离列。
--      注意 DEFAULT 0 不可省：平台侧（无租户）写入时值就是 0，NULL 会让 tenant_id = 0 的条件查不到。
--   4. 教学云“引用某个租户”的外键列一律命名 org_tenant_id，绝不能叫 tenant_id ——
--      MybatisInterceptor 会对字段名恰为 tenantId 且值为 null 的字段自动注入当前登录租户，叫 tenant_id 会被静默改写成当前租户。
--   5. 变长结构（stages/cert_files/switches/quotas/features）用 text 存 JSON 字符串，不用 json 类型，兼容 MySQL 5.7 脚本基线。
--   6. 平台侧表（edu_package / edu_tenant_ext / edu_tenant_apply）是全局共享数据，不登记进 TENANT_TABLE，不做行级隔离。

-- ----------------------------
-- 1. 套餐：平台端定义，机构端引用。与框架 sys_tenant_pack（菜单权限包）语义不同，切勿复用
-- ----------------------------
CREATE TABLE IF NOT EXISTS `edu_package` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '主键',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '套餐名称',
  `monthly_price` decimal(10,2) NULL DEFAULT 0.00 COMMENT '月费（元）',
  `ai_quota` int(11) NULL DEFAULT 0 COMMENT '每月 AI 调用额度（次）',
  `storage_gb` int(11) NULL DEFAULT 0 COMMENT '存储空间（GB）',
  `max_staff` int(11) NULL DEFAULT 0 COMMENT '最大员工数',
  `max_concurrent` int(11) NULL DEFAULT 0 COMMENT '最大并发数',
  `features` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '功能开关 JSON（前端 FeatureSwitches）',
  `sms_enabled` tinyint(1) NULL DEFAULT 0 COMMENT '是否含短信服务(0-否,1-是)',
  `sort_no` int(11) NULL DEFAULT 0 COMMENT '排序号',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '备注',
  `create_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '创建人',
  `create_time` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '更新人',
  `update_time` datetime NULL DEFAULT NULL COMMENT '更新时间',
  `del_flag` tinyint(1) NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_edu_package_sort` (`sort_no`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = '教学云-套餐' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- 2. 租户扩展：与框架 sys_tenant 1:1
--
-- 为什么不 ALTER sys_tenant：SysTenant 实体未继承 JeecgEntity、id 是手工 Integer，且 SysTenantController
-- 约 60 个端点与回收站逻辑都依赖该表；新字段 20 多个且会持续变，混进去会波及 QueryGenerator 自动查询。
-- 字段分工避免重复存储：sys_tenant 保留 name/create_time/create_by/end_date(前端 expireTime)/status/del_flag，其余进本表。
-- ----------------------------
CREATE TABLE IF NOT EXISTS `edu_tenant_ext` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '主键',
  `org_tenant_id` int(10) NOT NULL COMMENT '关联 sys_tenant.id（列名不可改为 tenant_id，见文件头约定 4）',
  `tenant_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '租户编码（业务展示用）',
  `biz_status` int(3) NULL DEFAULT 1 COMMENT '业务状态(1试用,2正式,3到期,4禁用)',
  `org_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '机构类型（公立学校/民办学校/培训机构等）',
  `stages` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '学段 JSON 数组，如 ["小学","初中"]',
  `package_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '套餐ID → edu_package.id',
  `trial_end_time` datetime NULL DEFAULT NULL COMMENT '试用到期时间',
  `contact` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '联系人',
  `phone` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '联系电话',
  `city` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '所在城市',
  `intro` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '机构简介',
  `cert_files` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '资质文件 JSON 数组',
  `isolation_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'shared' COMMENT '隔离方式：shared-共享库行级隔离 / dedicated-独立库',
  `storage_region` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '存储区域',
  `storage_used_gb` decimal(10,2) NULL DEFAULT 0.00 COMMENT '已用存储（GB）',
  `ai_used` int(11) NULL DEFAULT 0 COMMENT '本月已用 AI 调用次数',
  `disable_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '禁用原因',
  `switches` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '租户级功能开关 JSON',
  `quotas` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '租户级配额覆盖 JSON',
  `create_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '创建人',
  `create_time` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '更新人',
  `update_time` datetime NULL DEFAULT NULL COMMENT '更新时间',
  `del_flag` tinyint(1) NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_edu_tenant_ext_org` (`org_tenant_id`) USING BTREE,
  KEY `idx_edu_tenant_ext_code` (`tenant_code`) USING BTREE,
  KEY `idx_edu_tenant_ext_pkg` (`package_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = '教学云-租户扩展（1:1 sys_tenant）' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- 3. 入驻申请：机构申请“开通一个租户”
--
-- 为什么不复用框架机制：框架现成的是“用户申请加入某个已存在租户”（saveTenantJoinUser/joinTenantByHouseNumber，
-- 落 sys_tenant_pack_user.status），主体、生命周期、字段都不同。框架 sys_tenant.apply_status 保留不动。
-- 通过后由 ISysBaseAPI 开户：sys_tenant + 租户管理员 sys_user + sys_user_tenant，回填 apply_tenant_id。
-- ----------------------------
CREATE TABLE IF NOT EXISTS `edu_tenant_apply` (
  `id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '主键',
  `apply_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '申请单号，如 AP20260913001',
  `org_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '机构名称',
  `org_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '机构类型',
  `stages` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '学段 JSON 数组',
  `contact` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '联系人',
  `phone` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '联系电话',
  `email` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '联系邮箱',
  `intro` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '机构简介',
  `cert_files` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '资质文件 JSON 数组',
  `status` int(3) NULL DEFAULT 1 COMMENT '审核状态(1待审,2通过,3驳回)',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '驳回原因',
  `apply_tenant_id` int(10) NULL DEFAULT NULL COMMENT '审批通过后开通的 sys_tenant.id',
  `submitted_at` datetime NULL DEFAULT NULL COMMENT '提交时间',
  `reviewed_at` datetime NULL DEFAULT NULL COMMENT '审核时间',
  `reviewed_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '审核人',
  `create_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '创建人',
  `create_time` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '更新人',
  `update_time` datetime NULL DEFAULT NULL COMMENT '更新时间',
  `del_flag` tinyint(1) NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_edu_tenant_apply_no` (`apply_no`) USING BTREE,
  KEY `idx_edu_tenant_apply_status` (`status`) USING BTREE,
  KEY `idx_edu_tenant_apply_submit` (`submitted_at`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = '教学云-入驻申请' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- 4. 机构端隔离样板表：题库分类
--
-- 这张表是机构端唯一一张 Wave 1 表，作用是把“租户隔离真的生效了”变成可验证的事实。
-- 注意 tenant_id 有索引且不由业务代码赋值，值由 TenantLineInnerInterceptor 在 SQL 层自动追加。
--
-- 字段按前端 @aiteach/shared 的 OrgCategory 对齐（id / name / library / parentId / ownerId），
-- 而不是按“科目 + 学段 + 题量”那套平台侧题库分类的口径 —— 本表要直接喂给机构端已有的分类树页面。
-- 由此带来两点与框架惯例的偏离，都是有意的：
--   1. id 用 bigint AUTO_INCREMENT，不用雪花串。前端 OrgCategory.id 是 number，
--      19 位雪花串超出 JS Number.MAX_SAFE_INTEGER，会静默丢精度。
--   2. owner_id 用 varchar(36)：它存的是 sys_user.id（雪花串），必须当字符串存传，
--      前端 ownerId 的 number 类型需相应放宽为 string | number（与 SessionUser.id 同一次改动）。
-- ----------------------------
CREATE TABLE IF NOT EXISTS `edu_question_category` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '分类名称',
  `library` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'personal' COMMENT '题库归属：personal-个人题库 / org-机构公共题库 / wrong-错题库',
  `parent_id` bigint(20) NULL DEFAULT NULL COMMENT '父分类ID，顶层为 NULL',
  `owner_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '创建者 sys_user.id（雪花串）',
  `sort_no` int(11) NULL DEFAULT 0 COMMENT '排序号',
  `tenant_id` int(11) NOT NULL DEFAULT 0 COMMENT '租户ID，由 TenantLineInnerInterceptor 自动维护，业务代码不要赋值',
  `create_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '创建人',
  `create_time` datetime NULL DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '更新人',
  `update_time` datetime NULL DEFAULT NULL COMMENT '更新时间',
  `del_flag` tinyint(1) NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_edu_qcat_tenant` (`tenant_id`) USING BTREE,
  KEY `idx_edu_qcat_parent` (`parent_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci COMMENT = '教学云-题库分类（机构端，行级租户隔离）' ROW_FORMAT = DYNAMIC;
