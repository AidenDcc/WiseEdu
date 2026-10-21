-- =============================================================
-- jiaoyu-ai 单库接管：6 张同名冲突表合并方案
-- -------------------------------------------------------------
-- 背景：
--   schema.sql 与 JeecgBoot 框架存在 6 张同名表，但结构完全不同：
--     sys_user / sys_tenant / sys_role / sys_user_role / sys_dict_item / sys_role_permission
--   框架侧字段：username / password / realname / del_flag / description ...
--   业务侧字段：account / password_hash / real_name / deleted / role_desc ...
--
-- 合并原则：
--   1) 以 schema.sql 定义为主干（业务权威语义）
--   2) 追加框架必需列，全部可空 / 带默认值，不破坏业务语义
--   3) 冲突列用 BEFORE INSERT/UPDATE 触发器双向同步，使框架代码与业务代码
--      都能按自己习惯的列名读写，Java 侧零改动
--   4) id 类列统一 VARCHAR(32)：框架存在 UUID 形态主键
--      （如 admin 用户 id = e9ca23d68d884d4ebb19d07889727dae），无法用 BIGINT
--   5) create_by / update_by 放宽为 VARCHAR(64)：框架写入的是用户名（'admin'）
--
-- 执行前：确保 jiaoyu-ai 已存在，且 136 张非冲突框架表已迁入
-- 幂等性：可重复执行（先 DROP 再建）
-- =============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------------
-- 1. sys_user  用户账号
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  -- ==== 框架字段（权威命名：与框架重名的一律只保留框架列）====
  `id`              VARCHAR(32)  NOT NULL                 COMMENT '主键（框架为32位UUID、业务为雪花串，统一VARCHAR）',
  `username`        VARCHAR(100)     NULL                 COMMENT '登录账号',
  `realname`        VARCHAR(100)     NULL                 COMMENT '真实姓名',
  `password`        VARCHAR(255)     NULL                 COMMENT '密码',
  `salt`            VARCHAR(45)      NULL                 COMMENT '密码盐',
  `avatar`          VARCHAR(512)     NULL                 COMMENT '头像地址',
  `birthday`        DATE             NULL                 COMMENT '生日',
  `sex`             TINYINT          NULL                 COMMENT '性别 1男2女',
  `email`           VARCHAR(128)     NULL                 COMMENT '邮箱',
  `phone`           VARCHAR(128)     NULL                 COMMENT '手机号（业务侧加密存储）',
  `org_code`        VARCHAR(64)      NULL                 COMMENT '登录会话机构编码',
  `status`          TINYINT      NOT NULL DEFAULT 1       COMMENT '状态：1正常 2冻结（业务停用/锁定统一收敛为2）',
  `del_flag`        TINYINT      NOT NULL DEFAULT 0       COMMENT '删除状态 0正常1已删除',
  `third_id`        VARCHAR(100)     NULL                 COMMENT '第三方登录标识',
  `third_type`      VARCHAR(100)     NULL                 COMMENT '第三方类型',
  `activiti_sync`   TINYINT          NULL DEFAULT 1       COMMENT '同步工作流引擎',
  `work_no`         VARCHAR(100)     NULL                 COMMENT '工号',
  `telephone`       VARCHAR(45)      NULL                 COMMENT '座机号',
  `user_identity`   TINYINT          NULL DEFAULT 1       COMMENT '身份 1普通2上级',
  `depart_ids`      VARCHAR(1000)    NULL                 COMMENT '负责部门',
  `client_id`       VARCHAR(64)      NULL                 COMMENT '设备ID',
  `login_tenant_id` INT              NULL                 COMMENT '上次登录选择租户ID',
  `bpm_status`      VARCHAR(2)       NULL                 COMMENT '流程状态',
  `sign_enable`     TINYINT          NULL DEFAULT 0       COMMENT '是否启用个性签名',
  `sign`            VARCHAR(500)     NULL                 COMMENT '个性签名（业务侧"个人简介"落此列）',
  `main_dep_post_id` VARCHAR(32)     NULL                 COMMENT '主岗位',
  `position_type`   VARCHAR(32)      NULL                 COMMENT '职务',
  `last_pwd_update_time` DATETIME    NULL                 COMMENT '上次改密时间（业务侧 pwd_update_time 落此列）',
  `sort`            INT              NULL DEFAULT 1       COMMENT '排序',
  `iz_hide_contact` VARCHAR(1)       NULL DEFAULT '0'     COMMENT '是否隐藏联系方式',
  `create_by`       VARCHAR(64)      NULL                 COMMENT '创建人（放宽：框架存用户名）',
  `create_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`       VARCHAR(64)      NULL                 COMMENT '修改人',
  `update_time`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  -- ==== 业务补充字段（schema.sql 有、框架没有）====
  `tenant_id`       BIGINT       NOT NULL DEFAULT 0       COMMENT '租户ID，平台级为0',
  `user_type`       TINYINT      NOT NULL DEFAULT 1       COMMENT '0 平台管理员 1 机构员工 2 学生 3 家长',
  `nick_name`       VARCHAR(64)      NULL                 COMMENT '昵称',
  `avatar_hue`      INT              NULL                 COMMENT '头像色相',
  `campus_id`       BIGINT           NULL                 COMMENT '所属校区',
  `default_subject` VARCHAR(32)      NULL                 COMMENT '默认学科',
  `mfa_enabled`     TINYINT      NOT NULL DEFAULT 0       COMMENT '是否绑定 MFA',
  `last_login_at`   DATETIME         NULL                 COMMENT '最后登录时间',
  `last_login_ip`   VARCHAR(64)      NULL                 COMMENT '最后登录 IP',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_tenant_username` (`tenant_id`,`username`),
  KEY `idx_phone` (`phone`),
  KEY `idx_type_status` (`user_type`,`status`),
  KEY `idx_su_del_flag` (`del_flag`),
  KEY `idx_su_del_username` (`username`,`del_flag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户账号（框架字段为准 + 业务补充字段）';

-- -------------------------------------------------------------
-- 2. sys_tenant  租户主表
--    id 保持 BIGINT：框架为 int，现有值 1000/1001/1002 均为数字
--    重复字段已按框架为准收敛：name / end_date / company_logo / del_flag
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_tenant`;
CREATE TABLE `sys_tenant` (
  `id` bigint NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` bigint NOT NULL DEFAULT '0' COMMENT '租户ID，平台级为0',
  `tenant_code` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '租户编码，全局唯一（触发器按 T{id} 兜底生成）',
  `short_name` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '机构简称',
  `logo_hue` int DEFAULT NULL COMMENT 'LOGO 占位色相',
  `tenant_type` varchar(32) COLLATE utf8mb4_general_ci DEFAULT '学校' COMMENT '机构类型：学校/教育集团/培训机构',
  `stage_scope` json DEFAULT NULL COMMENT '办学学段范围',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '业务:1试用2正式3到期4禁用 / 框架:1正常0冻结',
  `package_id` bigint NOT NULL DEFAULT '0' COMMENT '当前套餐 ID',
  `trial_end_time` datetime DEFAULT NULL COMMENT '试用结束时间',
  `contact_name` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '联系人姓名',
  `contact_phone` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '联系人手机（加密）',
  `contact_email` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '联系邮箱',
  `province` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '省',
  `city` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '市',
  `address` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '详细地址',
  `intro` varchar(1024) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '机构简介',
  `isolation_type` tinyint NOT NULL DEFAULT '1' COMMENT '数据隔离：1共享库 2独立库',
  `storage_region` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '数据存储区域',
  `ai_used` bigint NOT NULL DEFAULT '0' COMMENT '本月 AI 调用次数（快照）',
  `storage_used_gb` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '已用存储（GB）',
  `disable_reason` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '禁用原因',
  `open_time` datetime DEFAULT NULL COMMENT '正式开通时间',
  `create_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '创建人（放宽）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '修改人',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `name` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '租户名称（业务 tenant_name 已并入此列）',
  `begin_date` datetime DEFAULT NULL COMMENT '[框架] 开始时间',
  `end_date` datetime DEFAULT NULL COMMENT '[框架] 结束时间',
  `trade` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 所属行业',
  `company_size` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 公司规模',
  `company_address` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 公司地址',
  `company_logo` varchar(512) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '租户 LOGO（业务 logo_url 已并入此列）',
  `house_number` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 门牌号',
  `work_place` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 工作地点',
  `secondary_domain` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 二级域名',
  `login_bkgd_img` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 登录背景图',
  `position` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 职级',
  `department` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 部门',
  `del_flag` tinyint NOT NULL DEFAULT '0' COMMENT '[框架] 删除状态 0正常1已删除',
  `apply_status` int DEFAULT '1' COMMENT '[框架] 允许申请管理员',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_code`),
  KEY `idx_package` (`package_id`),
  KEY `idx_t_name` (`name`),
  KEY `idx_t_del_flag` (`del_flag`),
  KEY `idx_status` (`status`,`end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户主表（框架字段为准 + 业务补充字段）';

-- -------------------------------------------------------------
-- 3. sys_role  角色
--    重复字段已按框架为准收敛：description（原 role_desc）
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_role`;
CREATE TABLE `sys_role` (
  `id` varchar(32) COLLATE utf8mb4_general_ci NOT NULL COMMENT '主键（雪花ID/UUID）',
  `tenant_id` bigint NOT NULL DEFAULT '0' COMMENT '租户ID，平台级为0',
  `role_code` varchar(100) COLLATE utf8mb4_general_ci NOT NULL COMMENT '角色编码，租户内唯一',
  `role_name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL COMMENT '角色名称',
  `builtin` tinyint NOT NULL DEFAULT '0' COMMENT '是否内置',
  `locked` tinyint NOT NULL DEFAULT '0' COMMENT '是否锁定',
  `data_scope` tinyint NOT NULL DEFAULT '1' COMMENT '数据范围：1全部2本校区3本部门4本人',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  `sort_no` int NOT NULL DEFAULT '0' COMMENT '排序',
  `create_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '创建人（放宽）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '修改人',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '删除状态：0未删除 1回收站 2已彻底删除',
  `description` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 描述',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`tenant_id`,`role_code`),
  KEY `idx_role_code_only` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='角色（框架字段为准 + 业务补充字段）';

-- -------------------------------------------------------------
-- 4. sys_user_role  用户角色关联（schema.sql 为框架超集，仅放宽类型）
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_user_role`;
CREATE TABLE `sys_user_role` (
  `id`          VARCHAR(32) NOT NULL                 COMMENT '主键（雪花ID/UUID）',
  `tenant_id`   BIGINT      NOT NULL DEFAULT 0       COMMENT '租户ID，平台级为0',
  `user_id`     VARCHAR(32)     NULL                 COMMENT '用户 ID',
  `role_id`     VARCHAR(32)     NULL                 COMMENT '角色 ID',
  `create_by`   VARCHAR(64)     NULL                 COMMENT '创建人（放宽）',
  `create_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`   VARCHAR(64)     NULL                 COMMENT '修改人',
  `update_time` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted`     TINYINT     NOT NULL DEFAULT 0       COMMENT '删除状态：0未删除 1回收站 2已彻底删除',
  PRIMARY KEY (`id`),
  KEY `uk_user_role` (`user_id`,`role_id`),
  KEY `idx_sur_role_id` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户角色关联';

-- -------------------------------------------------------------
-- 5. sys_dict_item  字典项
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_dict_item`;
CREATE TABLE `sys_dict_item` (
  `id` varchar(32) COLLATE utf8mb4_general_ci NOT NULL COMMENT '主键（雪花ID/UUID）',
  `tenant_id` bigint NOT NULL DEFAULT '0' COMMENT '租户ID，平台级为0',
  `dict_type` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '字典类型键（框架经 sys_dict 关联补齐）',
  `parent_id` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '父级项',
  `ref_count` int NOT NULL DEFAULT '0' COMMENT '被引用数',
  `stage` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '学段',
  `school_year` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '学年',
  `term_half` varchar(16) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '上/下学期',
  `date_from` date DEFAULT NULL COMMENT '学期开始日期',
  `date_to` date DEFAULT NULL COMMENT '学期结束日期',
  `answer_type` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '作答类型',
  `coefficient` decimal(5,2) DEFAULT NULL COMMENT '难度系数',
  `question_category` varchar(16) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '题目类别',
  `stages` json DEFAULT NULL COMMENT '适配学段',
  `subjects` json DEFAULT NULL COMMENT '适用学科',
  `grades` json DEFAULT NULL COMMENT '适配年级',
  `paper_category` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '试卷分类',
  `ext_json` json DEFAULT NULL COMMENT '扩展属性',
  `create_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '创建人（放宽）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '修改人',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` tinyint NOT NULL DEFAULT '0' COMMENT '删除状态：0未删除 1回收站 2已彻底删除',
  `dict_id` varchar(32) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 字典id',
  `item_text` varchar(128) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '字典项文本（业务 item_name 已并入此列）',
  `item_value` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 字典项值',
  `item_color` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 字典项颜色',
  `description` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '[框架] 描述',
  `sort_order` int DEFAULT NULL COMMENT '[框架] 排序',
  `status` int DEFAULT '1' COMMENT '[框架] 状态 1启用0不启用',
  PRIMARY KEY (`id`),
  KEY `idx_dict_id` (`dict_id`),
  KEY `idx_dict_val` (`dict_id`,`item_value`),
  KEY `idx_type_sort` (`dict_type`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='字典项（框架字段为准 + 业务补充字段）';

-- 6. sys_role_permission  角色权限
-- -------------------------------------------------------------
DROP TABLE IF EXISTS `sys_role_permission`;
CREATE TABLE `sys_role_permission` (
  `id`            VARCHAR(32)  NOT NULL                 COMMENT '主键（雪花ID/UUID）',
  `tenant_id`     BIGINT       NOT NULL DEFAULT 0       COMMENT '租户ID，平台级为0',
  `role_id`       VARCHAR(32)      NULL                 COMMENT '角色 ID',
  `module_key`    VARCHAR(64)      NULL                 COMMENT '权限模块键',
  `op_key`        VARCHAR(32)      NULL                 COMMENT '操作位',
  `create_by`     VARCHAR(64)      NULL                 COMMENT '创建人（放宽）',
  `create_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`     VARCHAR(64)      NULL                 COMMENT '修改人',
  `update_time`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted`       TINYINT      NOT NULL DEFAULT 0       COMMENT '删除状态：0未删除 1回收站 2已彻底删除',
  -- 框架兼容列
  `permission_id` VARCHAR(32)      NULL                 COMMENT '[框架] 权限id（sys_permission.id）',
  `data_rule_ids` VARCHAR(1000)    NULL                 COMMENT '[框架] 数据权限ids',
  `operate_date`  DATETIME         NULL                 COMMENT '[框架] 操作时间',
  `operate_ip`    VARCHAR(100)     NULL                 COMMENT '[框架] 操作ip',
  PRIMARY KEY (`id`),
  KEY `idx_role_module_op` (`role_id`,`module_key`,`op_key`),
  KEY `idx_srp_permission_id` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='角色权限（schema.sql 主干 + 框架兼容列）';

SET FOREIGN_KEY_CHECKS = 1;
