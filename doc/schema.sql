-- 教学云AI 平台数据库 DDL
-- 由 build_db.py 从 schema_part*.py 同源生成，禁止手工修改
-- 表数量：145；全表含 7 个公共字段（id/tenant_id/create_by/create_time/update_by/update_time/deleted）
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `sys_tenant`;
CREATE TABLE `sys_tenant` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `tenant_code` VARCHAR(64) NOT NULL COMMENT '租户编码，全局唯一（入驻申请编号沿用）',
  `tenant_name` VARCHAR(128) NOT NULL COMMENT '机构名称',
  `short_name` VARCHAR(64) NULL COMMENT '机构简称',
  `logo_url` VARCHAR(512) NULL COMMENT '机构 LOGO 地址',
  `logo_hue` INT NULL COMMENT 'LOGO 占位色相（无图时生成字母头像）',
  `tenant_type` VARCHAR(32) NOT NULL COMMENT '机构类型：学校/教育集团/培训机构',
  `stage_scope` JSON NULL COMMENT '办学学段范围（小学/初中/高中）',
  `status` TINYINT NOT NULL COMMENT '状态：1 试用 2 正式 3 已到期 4 已禁用',
  `package_id` BIGINT NOT NULL COMMENT '当前套餐 ID',
  `expire_time` DATETIME NOT NULL COMMENT '服务到期时间',
  `trial_end_time` DATETIME NULL COMMENT '试用结束时间',
  `contact_name` VARCHAR(64) NOT NULL COMMENT '联系人姓名',
  `contact_phone` VARCHAR(128) NOT NULL COMMENT '联系人手机（加密存储）',
  `contact_email` VARCHAR(128) NULL COMMENT '联系邮箱',
  `province` VARCHAR(32) NULL COMMENT '省',
  `city` VARCHAR(64) NULL COMMENT '市（含区县，展示用）',
  `address` VARCHAR(255) NULL COMMENT '详细地址',
  `intro` VARCHAR(1024) NULL COMMENT '机构简介',
  `isolation_type` TINYINT NOT NULL COMMENT '数据隔离：1 共享库（tenant_id 隔离）2 独立库',
  `storage_region` VARCHAR(64) NULL COMMENT '数据存储区域',
  `ai_used` BIGINT NOT NULL COMMENT '本月 AI 调用次数（快照）',
  `storage_used_gb` DECIMAL(12,2) NOT NULL COMMENT '已用存储（GB，快照）',
  `disable_reason` VARCHAR(255) NULL COMMENT '禁用/冻结原因',
  `open_time` DATETIME NULL COMMENT '正式开通时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_code (tenant_code),
  KEY idx_status (status, expire_time),
  KEY idx_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户主表';

DROP TABLE IF EXISTS `sys_tenant_apply`;
CREATE TABLE `sys_tenant_apply` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `apply_no` VARCHAR(64) NOT NULL COMMENT '申请单号',
  `tenant_code` VARCHAR(64) NOT NULL COMMENT '预生成机构编号（通过后沿用为租户编码）',
  `org_name` VARCHAR(128) NOT NULL COMMENT '机构名称',
  `org_type` VARCHAR(32) NOT NULL COMMENT '机构类型',
  `stage_scope` JSON NULL COMMENT '办学学段',
  `contact_name` VARCHAR(64) NOT NULL COMMENT '联系人',
  `contact_phone` VARCHAR(128) NOT NULL COMMENT '联系电话（加密）',
  `contact_email` VARCHAR(128) NULL COMMENT '联系邮箱',
  `province` VARCHAR(32) NULL COMMENT '省',
  `city` VARCHAR(64) NULL COMMENT '市',
  `address` VARCHAR(255) NULL COMMENT '详细地址',
  `intro` VARCHAR(1024) NULL COMMENT '机构简介',
  `apply_status` TINYINT NOT NULL COMMENT '0 待审核 1 已通过 2 已驳回',
  `submitted_at` DATETIME NOT NULL COMMENT '提交时间',
  `reviewer_id` BIGINT NULL COMMENT '审核人 ID',
  `reviewer_name` VARCHAR(64) NULL COMMENT '审核人姓名',
  `reviewed_at` DATETIME NULL COMMENT '审核时间',
  `reject_reason` VARCHAR(512) NULL COMMENT '驳回原因',
  `tenant_id_created` BIGINT NULL COMMENT '审核通过后生成的租户 ID',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_apply_no (apply_no),
  KEY idx_status_time (apply_status, submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='机构入驻申请';

DROP TABLE IF EXISTS `sys_tenant_cert`;
CREATE TABLE `sys_tenant_cert` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `apply_id` BIGINT NULL COMMENT '所属申请单 ID',
  `tenant_id_ref` BIGINT NULL COMMENT '所属租户 ID（入驻通过后回填）',
  `cert_category` VARCHAR(16) NOT NULL COMMENT '分类：license 营业执照/permit 许可证/legal 法人信息',
  `file_name` VARCHAR(255) NOT NULL COMMENT '文件名称',
  `file_type` VARCHAR(16) NOT NULL COMMENT 'pdf / img',
  `file_url` VARCHAR(512) NOT NULL COMMENT '文件访问地址（签名 URL 由服务端生成）',
  `file_size_kb` BIGINT NULL COMMENT '文件大小（KB）',
  `verify_status` TINYINT NOT NULL COMMENT '0 待核验 1 已核验 2 存疑',
  `verify_note` VARCHAR(512) NULL COMMENT '核验意见',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_apply (apply_id),
  KEY idx_tenant_ref (tenant_id_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户资质材料';

DROP TABLE IF EXISTS `sys_tenant_package`;
CREATE TABLE `sys_tenant_package` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `package_code` VARCHAR(32) NOT NULL COMMENT '套餐编码',
  `package_name` VARCHAR(64) NOT NULL COMMENT '套餐名称',
  `monthly_price` DECIMAL(12,2) NOT NULL COMMENT '月费（元）',
  `year_price` DECIMAL(12,2) NULL COMMENT '年费（元）',
  `max_staff` INT NOT NULL COMMENT '员工账号数上限',
  `max_student` INT NULL COMMENT '学生账号数上限',
  `max_concurrent` INT NOT NULL COMMENT '并发上限',
  `ai_quota` BIGINT NOT NULL COMMENT '月 AI 调用额度',
  `storage_gb` INT NOT NULL COMMENT '存储上限（GB）',
  `sms_enabled` TINYINT NOT NULL COMMENT '是否含短信',
  `status` TINYINT NOT NULL COMMENT '0 下架 1 上架 2 内部测试',
  `sort_no` INT NOT NULL COMMENT '排序',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_package_code (package_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='套餐定义';

DROP TABLE IF EXISTS `sys_tenant_package_feature`;
CREATE TABLE `sys_tenant_package_feature` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `package_id` BIGINT NOT NULL COMMENT '套餐 ID',
  `feature_key` VARCHAR(64) NOT NULL COMMENT '功能键：aiGenerate/aiVariant/aiPhoto/docImport/collab/customPrompt 等',
  `feature_name` VARCHAR(64) NOT NULL COMMENT '功能名称',
  `enabled` TINYINT NOT NULL COMMENT '是否包含',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_pkg_feature (package_id, feature_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='套餐功能权益';

DROP TABLE IF EXISTS `sys_tenant_quota`;
CREATE TABLE `sys_tenant_quota` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `quota_key` VARCHAR(64) NOT NULL COMMENT '配额项：staff/student/storage/ai/monthConcurrent',
  `quota_value` BIGINT NOT NULL COMMENT '配额值',
  `used_value` BIGINT NOT NULL COMMENT '已用值（快照，用于预警）',
  `quota_source` VARCHAR(16) NOT NULL COMMENT '来源：package 套餐默认 / tenant 单独配置 / gift 赠送',
  `warn_threshold` INT NULL COMMENT '预警阈值（百分比，默认 80）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_quota (tenant_id, quota_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户配额';

DROP TABLE IF EXISTS `sys_tenant_subscription`;
CREATE TABLE `sys_tenant_subscription` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `tenant_id` BIGINT NOT NULL COMMENT '租户 ID',
  `package_id` BIGINT NOT NULL COMMENT '套餐 ID',
  `start_time` DATETIME NOT NULL COMMENT '生效开始',
  `end_time` DATETIME NOT NULL COMMENT '生效结束',
  `sub_status` VARCHAR(16) NOT NULL COMMENT 'active 生效中/expired 已过期/grace 宽限期/canceled 已取消',
  `change_type` VARCHAR(16) NOT NULL COMMENT 'open 开通/renew 续费/upgrade 升级/downgrade 降级/trial 试用/compensate 补偿',
  `amount` DECIMAL(12,2) NULL COMMENT '成交金额（元，含赠送折算 0）',
  `order_no` VARCHAR(64) NULL COMMENT '关联订单号',
  `operator_id` BIGINT NULL COMMENT '操作人',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_tenant_status (tenant_id, sub_status),
  KEY idx_end_time (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户订阅记录';

DROP TABLE IF EXISTS `sys_tenant_config`;
CREATE TABLE `sys_tenant_config` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `tenant_id` BIGINT NOT NULL COMMENT '租户 ID',
  `org_name` VARCHAR(128) NOT NULL COMMENT '机构名称（展示名）',
  `short_name` VARCHAR(64) NULL COMMENT '简称',
  `contact_name` VARCHAR(64) NULL COMMENT '联系人',
  `contact_phone` VARCHAR(128) NULL COMMENT '联系电话（加密）',
  `address` VARCHAR(255) NULL COMMENT '地址',
  `intro` VARCHAR(1024) NULL COMMENT '简介',
  `subjects` JSON NULL COMMENT '开设学科',
  `grades` JSON NULL COMMENT '开设年级',
  `preferred_textbooks` JSON NULL COMMENT '教材版本偏好',
  `export_header` VARCHAR(255) NULL COMMENT '导出抬头',
  `export_template` VARCHAR(64) NULL COMMENT '默认导出模板',
  `data_retention_month` INT NULL COMMENT '数据留存月数',
  `config_json` JSON NULL COMMENT '其他扩展配置',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_cfg (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户业务配置';

DROP TABLE IF EXISTS `sys_review_flow`;
CREATE TABLE `sys_review_flow` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `flow_key` VARCHAR(32) NOT NULL COMMENT '流程键：question/paper/resource',
  `flow_label` VARCHAR(64) NOT NULL COMMENT '流程名称',
  `enabled` TINYINT NOT NULL COMMENT '是否启用审核',
  `levels` TINYINT NOT NULL COMMENT '审核级数 1 或 2',
  `level1_reviewers` JSON NULL COMMENT '一级审核人 ID 列表',
  `level2_reviewers` JSON NULL COMMENT '二级审核人 ID 列表',
  `ai_precheck` TINYINT NOT NULL COMMENT '是否启用 AI 预审',
  `subject_scope` JSON NULL COMMENT '适用学科（空为全部）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_flow (tenant_id, flow_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='审核流程配置';

DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `user_type` TINYINT NOT NULL COMMENT '0 平台管理员 1 机构员工 2 学生 3 家长',
  `account` VARCHAR(64) NOT NULL COMMENT '登录账号',
  `password_hash` VARCHAR(128) NULL COMMENT '密码哈希（学生/家长可免密登录时为空）',
  `salt` VARCHAR(32) NULL COMMENT '密码盐',
  `real_name` VARCHAR(64) NOT NULL COMMENT '姓名',
  `nick_name` VARCHAR(64) NULL COMMENT '昵称',
  `avatar` VARCHAR(512) NULL COMMENT '头像地址',
  `avatar_hue` INT NULL COMMENT '头像色相',
  `phone` VARCHAR(128) NULL COMMENT '手机号（加密）',
  `email` VARCHAR(128) NULL COMMENT '邮箱',
  `intro` VARCHAR(512) NULL COMMENT '个人简介',
  `campus_id` BIGINT NULL COMMENT '所属校区',
  `default_subject` VARCHAR(32) NULL COMMENT '默认学科',
  `status` TINYINT NOT NULL COMMENT '0 停用 1 启用 2 锁定',
  `mfa_enabled` TINYINT NOT NULL COMMENT '是否绑定 MFA',
  `last_login_at` DATETIME NULL COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(64) NULL COMMENT '最后登录 IP',
  `pwd_update_time` DATETIME NULL COMMENT '密码最后修改时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_account (tenant_id, account),
  KEY idx_phone (phone),
  KEY idx_type_status (user_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户账号';

DROP TABLE IF EXISTS `sys_role`;
CREATE TABLE `sys_role` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `role_code` VARCHAR(64) NOT NULL COMMENT '角色编码，租户内唯一',
  `role_name` VARCHAR(64) NOT NULL COMMENT '角色名称',
  `role_desc` VARCHAR(255) NULL COMMENT '角色说明',
  `builtin` TINYINT NOT NULL COMMENT '是否内置（内置不可删除）',
  `locked` TINYINT NOT NULL COMMENT '是否锁定（机构管理员角色锁定）',
  `data_scope` TINYINT NOT NULL COMMENT '数据范围：1 全部 2 本校区 3 本部门 4 本人',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_role_code (tenant_id, role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='角色';

DROP TABLE IF EXISTS `sys_user_role`;
CREATE TABLE `sys_user_role` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `user_id` BIGINT NOT NULL COMMENT '用户 ID',
  `role_id` BIGINT NOT NULL COMMENT '角色 ID',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_user_role (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户角色关联';

DROP TABLE IF EXISTS `sys_role_permission`;
CREATE TABLE `sys_role_permission` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `role_id` BIGINT NOT NULL COMMENT '角色 ID',
  `module_key` VARCHAR(64) NOT NULL COMMENT '权限模块键（question/paper/teach…）',
  `op_key` VARCHAR(32) NOT NULL COMMENT '操作位：查看/新增/编辑/删除/审核/导出/配置…',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_role_module_op (role_id, module_key, op_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='角色权限';

DROP TABLE IF EXISTS `sys_menu`;
CREATE TABLE `sys_menu` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `menu_scope` TINYINT NOT NULL COMMENT '0 平台端 1 机构端',
  `parent_id` BIGINT NULL COMMENT '父节点 ID（空为顶级）',
  `menu_title` VARCHAR(64) NOT NULL COMMENT '菜单名称',
  `menu_path` VARCHAR(255) NOT NULL COMMENT '路由路径（叶子唯一）',
  `menu_icon` VARCHAR(64) NULL COMMENT '图标名',
  `menu_type` TINYINT NOT NULL COMMENT '0 分组 1 页面 2 按钮',
  `module_key` VARCHAR(64) NULL COMMENT '所属权限模块',
  `op_key` VARCHAR(32) NULL COMMENT '叶子额外要求的操作权限',
  `edition` VARCHAR(32) NULL COMMENT '所属版本（标准版/专业版）',
  `sort_no` INT NOT NULL COMMENT '同级排序',
  `visible` TINYINT NOT NULL COMMENT '是否显示',
  `builtin` TINYINT NOT NULL COMMENT '是否内置',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scope_parent (menu_scope, parent_id),
  UNIQUE KEY uk_scope_path (menu_scope, menu_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='菜单';

DROP TABLE IF EXISTS `sys_tenant_menu`;
CREATE TABLE `sys_tenant_menu` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `tenant_id` BIGINT NOT NULL COMMENT '租户 ID',
  `menu_id` BIGINT NOT NULL COMMENT '菜单 ID',
  `menu_key` VARCHAR(128) NOT NULL COMMENT '菜单路径键（与前端菜单 key 一致）',
  `enabled` TINYINT NOT NULL COMMENT '是否开放',
  `sort_no` INT NULL COMMENT '排序覆盖',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_menu (tenant_id, menu_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='机构菜单开关';

DROP TABLE IF EXISTS `sys_dict_type`;
CREATE TABLE `sys_dict_type` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `dict_type` VARCHAR(64) NOT NULL COMMENT '类型键：subject/grade/term/questionType/difficulty/examType/competition/region/copyright',
  `dict_name` VARCHAR(64) NOT NULL COMMENT '类型名称',
  `dict_group` VARCHAR(16) NOT NULL COMMENT '分组：base 基础字典 / system 系统数据字典',
  `editable` TINYINT NOT NULL COMMENT '是否允许机构维护',
  `remark` VARCHAR(255) NULL COMMENT '说明',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_dict_type (dict_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='字典类型';

DROP TABLE IF EXISTS `sys_dict_item`;
CREATE TABLE `sys_dict_item` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `dict_type` VARCHAR(64) NOT NULL COMMENT '字典类型键',
  `item_name` VARCHAR(128) NOT NULL COMMENT '名称',
  `item_code` VARCHAR(64) NULL COMMENT '编码（学科/年级/题型/地区必填）',
  `parent_id` BIGINT NULL COMMENT '父级项（无层级时为空）',
  `sort_no` INT NOT NULL COMMENT '排序',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `ref_count` INT NOT NULL COMMENT '被引用数（大于 0 时仅可停用不可删除）',
  `stage` VARCHAR(32) NULL COMMENT '学段（年级挂靠学段等单值场景）',
  `school_year` VARCHAR(32) NULL COMMENT '学年（学期类字典）',
  `term_half` VARCHAR(16) NULL COMMENT '上/下学期',
  `date_from` DATE NULL COMMENT '学期开始日期',
  `date_to` DATE NULL COMMENT '学期结束日期',
  `answer_type` VARCHAR(32) NULL COMMENT '作答类型（题型字典）',
  `coefficient` DECIMAL(5,2) NULL COMMENT '难度系数（难度字典）',
  `question_category` VARCHAR(16) NULL COMMENT '题目类别：独立单题/材料组合题',
  `stages` JSON NULL COMMENT '适配学段（多选）',
  `subjects` JSON NULL COMMENT '适用学科',
  `grades` JSON NULL COMMENT '适配年级',
  `paper_category` VARCHAR(64) NULL COMMENT '试卷分类（考试类型投影）',
  `ext_json` JSON NULL COMMENT '扩展属性',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_type_sort (dict_type, sort_no),
  UNIQUE KEY uk_type_code (dict_type, item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='字典项';

DROP TABLE IF EXISTS `sys_param`;
CREATE TABLE `sys_param` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `param_key` VARCHAR(128) NOT NULL COMMENT '参数键',
  `param_name` VARCHAR(128) NOT NULL COMMENT '参数名称',
  `param_value` VARCHAR(2048) NULL COMMENT '参数值',
  `param_group` VARCHAR(64) NOT NULL COMMENT '参数分组',
  `value_type` VARCHAR(16) NOT NULL COMMENT 'string/number/boolean/json',
  `editable` TINYINT NOT NULL COMMENT '是否允许在线修改',
  `hot_effect` TINYINT NOT NULL COMMENT '是否热生效',
  `remark` VARCHAR(255) NULL COMMENT '说明',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_param_key (param_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='系统参数';

DROP TABLE IF EXISTS `sys_message_template`;
CREATE TABLE `sys_message_template` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `tpl_code` VARCHAR(64) NOT NULL COMMENT '模板编码',
  `tpl_name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `scene` VARCHAR(64) NOT NULL COMMENT '业务场景',
  `channels` JSON NOT NULL COMMENT '渠道：inApp/sms/email/push',
  `content` TEXT NOT NULL COMMENT '模板正文（支持 ${变量}）',
  `variables` JSON NULL COMMENT '变量定义',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tpl_code (tpl_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='消息模板';

DROP TABLE IF EXISTS `sys_notify_rule`;
CREATE TABLE `sys_notify_rule` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `biz_key` VARCHAR(64) NOT NULL COMMENT '业务键：homeworkRemind/auditRemind/warningNotify…',
  `biz_label` VARCHAR(64) NOT NULL COMMENT '业务名称',
  `in_app` TINYINT NOT NULL COMMENT '站内信',
  `sms` TINYINT NOT NULL COMMENT '短信',
  `email` TINYINT NOT NULL COMMENT '邮件',
  `receivers` JSON NULL COMMENT '接收角色/接收人',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_biz_key (tenant_id, biz_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='通知规则';

DROP TABLE IF EXISTS `sys_notification`;
CREATE TABLE `sys_notification` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `receiver_id` BIGINT NOT NULL COMMENT '接收人 ID',
  `msg_type` VARCHAR(16) NOT NULL COMMENT 'apply 入驻/quota 配额/system 系统/todo 待办/review 审核/collab 协作',
  `msg_tab` VARCHAR(16) NULL COMMENT '前端分页签：todo/review/collab/system',
  `title` VARCHAR(255) NOT NULL COMMENT '标题',
  `content` VARCHAR(2048) NULL COMMENT '摘要内容',
  `biz_module` VARCHAR(64) NULL COMMENT '业务模块',
  `biz_id` BIGINT NULL COMMENT '业务 ID',
  `link` VARCHAR(512) NULL COMMENT '跳转路径',
  `read_flag` TINYINT NOT NULL COMMENT '是否已读',
  `read_at` DATETIME NULL COMMENT '阅读时间',
  `sender_id` BIGINT NULL COMMENT '发送人（系统为空）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_receiver (receiver_id, read_flag),
  KEY idx_type_time (msg_type, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='消息通知';

DROP TABLE IF EXISTS `sys_operation_log`;
CREATE TABLE `sys_operation_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `biz_module` VARCHAR(64) NOT NULL COMMENT '业务模块',
  `action` VARCHAR(64) NOT NULL COMMENT '动作：新增/编辑/删除/审核/导出/登录…',
  `target` VARCHAR(255) NULL COMMENT '操作对象',
  `target_id` VARCHAR(64) NULL COMMENT '对象 ID',
  `request_uri` VARCHAR(255) NULL COMMENT '请求地址',
  `request_method` VARCHAR(16) NULL COMMENT '请求方法',
  `params` TEXT NULL COMMENT '请求参数（脱敏）',
  `ip` VARCHAR(64) NULL COMMENT '来源 IP',
  `user_agent` VARCHAR(512) NULL COMMENT 'UA',
  `result` TINYINT NOT NULL COMMENT '1 成功 0 失败',
  `error_msg` VARCHAR(1024) NULL COMMENT '失败原因',
  `cost_ms` INT NULL COMMENT '耗时（毫秒）',
  `operator_name` VARCHAR(64) NULL COMMENT '操作人姓名（冗余便于查询）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_module_time (biz_module, create_time),
  KEY idx_operator (create_by, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='操作日志';

DROP TABLE IF EXISTS `sys_login_log`;
CREATE TABLE `sys_login_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `user_id` BIGINT NULL COMMENT '用户 ID',
  `account` VARCHAR(64) NOT NULL COMMENT '登录账号',
  `login_ip` VARCHAR(64) NULL COMMENT 'IP',
  `location` VARCHAR(128) NULL COMMENT '归属地',
  `device` VARCHAR(64) NULL COMMENT '设备',
  `browser` VARCHAR(64) NULL COMMENT '浏览器',
  `result` TINYINT NOT NULL COMMENT '1 成功 0 失败',
  `fail_reason` VARCHAR(255) NULL COMMENT '失败原因',
  `risk_flag` TINYINT NOT NULL COMMENT '异常标记（异地/频繁失败）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_account_time (account, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='登录日志';

DROP TABLE IF EXISTS `sys_error_log`;
CREATE TABLE `sys_error_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `level` VARCHAR(16) NOT NULL COMMENT 'ERROR/WARN',
  `biz_module` VARCHAR(64) NULL COMMENT '模块',
  `message` VARCHAR(1024) NOT NULL COMMENT '异常摘要',
  `stack` TEXT NULL COMMENT '堆栈',
  `trace_id` VARCHAR(64) NULL COMMENT '链路 ID',
  `occur_time` DATETIME NOT NULL COMMENT '发生时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_level_time (level, occur_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='异常日志';

DROP TABLE IF EXISTS `sys_audit_log`;
CREATE TABLE `sys_audit_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `object_type` VARCHAR(64) NOT NULL COMMENT '对象类型：tenant/question/paper/content/role…',
  `object_id` VARCHAR(64) NULL COMMENT '对象 ID',
  `object_name` VARCHAR(255) NULL COMMENT '对象名称',
  `action` VARCHAR(64) NOT NULL COMMENT '动作',
  `before_json` JSON NULL COMMENT '变更前快照',
  `after_json` JSON NULL COMMENT '变更后快照',
  `approval_no` VARCHAR(64) NULL COMMENT '二次审批单号',
  `audit_desc` VARCHAR(1024) NULL COMMENT '审计说明',
  `operator_name` VARCHAR(64) NULL COMMENT '操作人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_object (object_type, object_id),
  KEY idx_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='审计日志';

DROP TABLE IF EXISTS `sys_storage_policy`;
CREATE TABLE `sys_storage_policy` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `policy_key` VARCHAR(64) NOT NULL COMMENT '策略键',
  `policy_name` VARCHAR(64) NOT NULL COMMENT '策略名称',
  `provider` VARCHAR(64) NOT NULL COMMENT '服务商',
  `bucket` VARCHAR(128) NULL COMMENT '存储桶',
  `region` VARCHAR(64) NULL COMMENT '区域',
  `domain` VARCHAR(255) NULL COMMENT 'CDN 加速域名',
  `max_upload_mb` INT NOT NULL COMMENT '单文件大小上限（MB）',
  `accept_types` JSON NULL COMMENT '允许的文件类型',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `used_gb` DECIMAL(12,2) NULL COMMENT '已用容量',
  `quota_gb` DECIMAL(12,2) NULL COMMENT '容量上限',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_policy_key (policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='存储策略';

DROP TABLE IF EXISTS `sys_backup_record`;
CREATE TABLE `sys_backup_record` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `backup_name` VARCHAR(128) NOT NULL COMMENT '备份名称',
  `backup_kind` VARCHAR(16) NOT NULL COMMENT 'auto 自动 / manual 手动',
  `backup_scope` VARCHAR(128) NULL COMMENT '备份范围',
  `size_gb` DECIMAL(12,2) NULL COMMENT '备份大小（GB）',
  `status` VARCHAR(16) NOT NULL COMMENT 'running/done/failed',
  `started_at` DATETIME NOT NULL COMMENT '开始时间',
  `finished_at` DATETIME NULL COMMENT '结束时间',
  `restore_times` INT NOT NULL COMMENT '恢复演练次数',
  `file_url` VARCHAR(512) NULL COMMENT '备份文件地址',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_time (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据备份记录';

DROP TABLE IF EXISTS `sys_service_health`;
CREATE TABLE `sys_service_health` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `service_key` VARCHAR(64) NOT NULL COMMENT '服务键',
  `service_name` VARCHAR(64) NOT NULL COMMENT '服务名称',
  `status` VARCHAR(16) NOT NULL COMMENT 'up/degraded/down',
  `uptime` DECIMAL(5,2) NULL COMMENT '近 24h 可用率（%）',
  `latency_ms` INT NULL COMMENT '平均响应（毫秒）',
  `cpu_rate` DECIMAL(5,2) NULL COMMENT 'CPU 使用率（%）',
  `memory_rate` DECIMAL(5,2) NULL COMMENT '内存使用率（%）',
  `queue_backlog` INT NULL COMMENT '队列积压',
  `last_alert_at` DATETIME NULL COMMENT '最近告警时间',
  `collect_time` DATETIME NOT NULL COMMENT '采集时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_service_time (service_key, collect_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='服务健康快照';

DROP TABLE IF EXISTS `sys_export_task`;
CREATE TABLE `sys_export_task` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_type` VARCHAR(16) NOT NULL COMMENT 'export 导出 / import 导入',
  `biz_module` VARCHAR(64) NOT NULL COMMENT '业务模块',
  `file_name` VARCHAR(255) NULL COMMENT '文件名',
  `file_url` VARCHAR(512) NULL COMMENT '结果文件地址',
  `total_count` INT NULL COMMENT '总条数',
  `success_count` INT NULL COMMENT '成功条数',
  `fail_count` INT NULL COMMENT '失败条数',
  `fail_file_url` VARCHAR(512) NULL COMMENT '失败明细文件',
  `status` VARCHAR(16) NOT NULL COMMENT 'waiting/running/done/failed',
  `started_at` DATETIME NULL COMMENT '开始时间',
  `finished_at` DATETIME NULL COMMENT '结束时间',
  `params` TEXT NULL COMMENT '任务参数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_type_status (task_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='导入导出任务';

DROP TABLE IF EXISTS `sys_campus`;
CREATE TABLE `sys_campus` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `campus_name` VARCHAR(64) NOT NULL COMMENT '校区名称',
  `campus_code` VARCHAR(32) NOT NULL COMMENT '校区编码',
  `address` VARCHAR(255) NULL COMMENT '地址',
  `manager_id` BIGINT NULL COMMENT '负责人 ID',
  `manager_name` VARCHAR(64) NULL COMMENT '负责人姓名',
  `staff_count` INT NOT NULL COMMENT '员工数（快照）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_campus_code (tenant_id, campus_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='校区';

DROP TABLE IF EXISTS `sys_recycle_bin`;
CREATE TABLE `sys_recycle_bin` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `biz_kind` VARCHAR(32) NOT NULL COMMENT '类型：题目/试卷/教辅/文件/讲义/课件/教案/学案/协同组卷任务/集体备课/作业',
  `biz_id` BIGINT NOT NULL COMMENT '业务对象 ID',
  `biz_name` VARCHAR(255) NOT NULL COMMENT '对象名称',
  `owner_id` BIGINT NULL COMMENT '归属人',
  `owner_name` VARCHAR(64) NULL COMMENT '归属人姓名',
  `deleted_by` BIGINT NULL COMMENT '删除人',
  `deleted_by_name` VARCHAR(64) NULL COMMENT '删除人姓名',
  `deleted_at` DATETIME NOT NULL COMMENT '删除时间',
  `expire_at` DATETIME NULL COMMENT '自动清理时间',
  `restored_flag` TINYINT NOT NULL COMMENT '是否已恢复',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_kind_owner (biz_kind, owner_id),
  KEY idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='回收站';

DROP TABLE IF EXISTS `dc_textbook_version`;
CREATE TABLE `dc_textbook_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `stage` VARCHAR(32) NOT NULL COMMENT '学段',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `version_name` VARCHAR(64) NOT NULL COMMENT '版本名称（如人教版）',
  `publisher` VARCHAR(64) NOT NULL COMMENT '出版社',
  `hue` INT NULL COMMENT '封面色相',
  `region` JSON NULL COMMENT '适用地区（多选）',
  `years` JSON NULL COMMENT '修订年份（多选）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_stage_subject (stage, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教材版本';

DROP TABLE IF EXISTS `dc_textbook_volume`;
CREATE TABLE `dc_textbook_volume` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `textbook_id` BIGINT NOT NULL COMMENT '教材版本 ID',
  `volume_alias` VARCHAR(64) NOT NULL COMMENT '册别名（必修第一册/上册）',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `term` VARCHAR(16) NOT NULL COMMENT '学期：上学期/下学期',
  `school_year` VARCHAR(32) NULL COMMENT '适配学年',
  `cover_url` VARCHAR(512) NULL COMMENT '封面图',
  `file_url` VARCHAR(512) NULL COMMENT '教材电子版地址',
  `file_name` VARCHAR(255) NULL COMMENT '电子版文件名',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_textbook (textbook_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教材分册';

DROP TABLE IF EXISTS `dc_textbook_catalog`;
CREATE TABLE `dc_textbook_catalog` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `volume_id` BIGINT NOT NULL COMMENT '分册 ID',
  `parent_id` BIGINT NULL COMMENT '父章节',
  `chapter_title` VARCHAR(255) NOT NULL COMMENT '章节标题',
  `chapter_level` TINYINT NOT NULL COMMENT '层级 1-5',
  `chapter_path` VARCHAR(512) NULL COMMENT '路径（/根/章/节）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_volume_parent (volume_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教材目录';

DROP TABLE IF EXISTS `dc_textbook_catalog_knowledge`;
CREATE TABLE `dc_textbook_catalog_knowledge` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `catalog_id` BIGINT NOT NULL COMMENT '章节 ID',
  `knowledge_id` BIGINT NOT NULL COMMENT '知识点 ID',
  `knowledge_name` VARCHAR(255) NOT NULL COMMENT '知识点名称快照',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_catalog_kp (catalog_id, knowledge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='目录知识点关联';

DROP TABLE IF EXISTS `dc_knowledge_node`;
CREATE TABLE `dc_knowledge_node` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NULL COMMENT '父节点',
  `node_name` VARCHAR(255) NOT NULL COMMENT '知识点名称',
  `node_code` VARCHAR(64) NOT NULL COMMENT '知识点编码（平台唯一）',
  `stage` VARCHAR(32) NOT NULL COMMENT '学段',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `node_level` TINYINT NOT NULL COMMENT '层级 1-5',
  `node_path` VARCHAR(512) NULL COMMENT '路径',
  `sort_no` INT NOT NULL COMMENT '同级排序',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `ref_count` INT NOT NULL COMMENT '被引用数',
  `is_leaf` TINYINT NOT NULL COMMENT '是否叶子（叶子标签与题目 knowledge 匹配）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_node_code (node_code),
  KEY idx_parent (parent_id),
  KEY idx_subject (stage, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='知识点树';

DROP TABLE IF EXISTS `dc_exam_type_node`;
CREATE TABLE `dc_exam_type_node` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NULL COMMENT '父节点（空为一级分组）',
  `node_name` VARCHAR(128) NOT NULL COMMENT '节点名称',
  `node_code` VARCHAR(64) NOT NULL COMMENT '节点编码（平台唯一）',
  `node_kind` VARCHAR(16) NOT NULL COMMENT 'examType 考试类型 / competition 杯赛',
  `stages` JSON NULL COMMENT '适配学段',
  `subjects` JSON NULL COMMENT '适配学科',
  `node_path` VARCHAR(512) NULL COMMENT '路径',
  `sort_no` INT NOT NULL COMMENT '排序',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `ref_count` INT NOT NULL COMMENT '被题目引用数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_exam_code (node_code),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='考试类型树';

DROP TABLE IF EXISTS `q_question`;
CREATE TABLE `q_question` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `library` VARCHAR(16) NOT NULL COMMENT '题库归属：personal 个人 / org 校本 / wrong 错题',
  `category_id` BIGINT NULL COMMENT '题库分类目录 ID',
  `question_category` VARCHAR(16) NOT NULL COMMENT '题目类别：独立单题 / 材料组合题（组合题 stem 存共用材料）',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `question_type` VARCHAR(32) NOT NULL COMMENT '题型（字典 questionType）',
  `difficulty` VARCHAR(16) NOT NULL COMMENT '难度（字典 difficulty）',
  `textbook_version` VARCHAR(64) NULL COMMENT '教材版本',
  `term` VARCHAR(16) NULL COMMENT '学期',
  `exam_type` VARCHAR(64) NULL COMMENT '考试类型（字典 examType）',
  `competition` VARCHAR(64) NULL COMMENT '杯赛名称（字典 competition）',
  `region` VARCHAR(64) NULL COMMENT '来源地区（字典 region）',
  `source` VARCHAR(32) NOT NULL COMMENT '来源：手动录入/AI 出题/AI 变式/拍照识别/文档导入/教辅导入/名校考试',
  `source_remark` VARCHAR(255) NULL COMMENT '来源备注',
  `stem` LONGTEXT NOT NULL COMMENT '题干（富文本，可含公式与图片）',
  `options_json` JSON NULL COMMENT '选项数组（选择题/多选题）',
  `option_columns` TINYINT NULL COMMENT '选项排布：1/2/4 列',
  `answer` LONGTEXT NULL COMMENT '答案（选择题字母串、判断对错、填空以｜相连、解答富文本）',
  `fill_answers_json` JSON NULL COMMENT '填空题各空答案与等价写法',
  `analysis` LONGTEXT NULL COMMENT '解析（富文本）',
  `knowledge_json` JSON NULL COMMENT '知识点名称数组（冗余，供列表渲染）',
  `owner_id` BIGINT NOT NULL COMMENT '归属人 ID',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '归属人姓名',
  `status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/checking 机审中/pending 待审核/approved 已通过/rejected 已驳回/offline 已下架',
  `variant_of` BIGINT NULL COMMENT '母题 ID（变式题回溯）',
  `use_count` INT NOT NULL COMMENT '被组卷/引用次数',
  `ai_flag` TINYINT NOT NULL COMMENT '是否 AI 生成（合规标识）',
  `ai_model_key` VARCHAR(64) NULL COMMENT '生成所用模型',
  `ai_checks_json` JSON NULL COMMENT 'AI 质检项结果',
  `ai_suspects_json` JSON NULL COMMENT 'AI 疑点列表',
  `review_opinion` VARCHAR(1024) NULL COMMENT '审核意见',
  `reviewer_id` BIGINT NULL COMMENT '终审人 ID',
  `reviewer_name` VARCHAR(64) NULL COMMENT '终审人姓名',
  `reviewed_at` DATETIME NULL COMMENT '终审时间',
  `published_at` DATETIME NULL COMMENT '入库（通过）时间',
  `temp_flag` TINYINT NOT NULL COMMENT '是否临时题（AI 草稿直接进试题篮，不占配额不参与检索）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_lib_status (library, status),
  KEY idx_subject_grade (subject, grade),
  KEY idx_owner (owner_id),
  KEY idx_type_diff (question_type, difficulty),
  KEY idx_updated (update_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目主表';

DROP TABLE IF EXISTS `q_question_sub`;
CREATE TABLE `q_question_sub` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '母题 ID',
  `sort_no` INT NOT NULL COMMENT '子题序号（卷面 (1)(2)(3) 按顺序现算）',
  `question_type` VARCHAR(32) NOT NULL COMMENT '子题题型（仅独立单题类题型）',
  `difficulty` VARCHAR(16) NOT NULL COMMENT '难度',
  `stem` LONGTEXT NOT NULL COMMENT '子题题干',
  `options_json` JSON NULL COMMENT '选项',
  `option_columns` TINYINT NULL COMMENT '选项排布',
  `answer` LONGTEXT NULL COMMENT '答案',
  `fill_answers_json` JSON NULL COMMENT '填空答案',
  `analysis` LONGTEXT NULL COMMENT '解析',
  `knowledge_json` JSON NULL COMMENT '子题知识点',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_question (question_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='材料组合题子题';

DROP TABLE IF EXISTS `q_question_knowledge`;
CREATE TABLE `q_question_knowledge` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `knowledge_id` BIGINT NULL COMMENT '知识点 ID（历史数据可为空，靠名称匹配）',
  `knowledge_name` VARCHAR(255) NOT NULL COMMENT '知识点名称（与知识点树叶子 tag 一致）',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科（冗余便于聚合）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_q_kp (question_id, knowledge_name),
  KEY idx_kp (knowledge_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目知识点关联';

DROP TABLE IF EXISTS `q_question_category`;
CREATE TABLE `q_question_category` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NULL COMMENT '父目录',
  `category_name` VARCHAR(128) NOT NULL COMMENT '目录名称',
  `library` VARCHAR(16) NOT NULL COMMENT '所属题库：personal/org/wrong',
  `owner_id` BIGINT NULL COMMENT '归属人（个人目录）',
  `category_path` VARCHAR(512) NULL COMMENT '路径',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_lib_parent (library, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题库分类目录';

DROP TABLE IF EXISTS `q_question_favorite`;
CREATE TABLE `q_question_favorite` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `folder_name` VARCHAR(64) NOT NULL COMMENT '收藏夹名称',
  `scope` VARCHAR(16) NOT NULL COMMENT 'personal 个人 / group 备课组',
  `owner_id` BIGINT NOT NULL COMMENT '创建人',
  `group_id` BIGINT NULL COMMENT '备课组 ID（组级收藏夹）',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `item_count` INT NOT NULL COMMENT '收藏题数（快照）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目收藏夹';

DROP TABLE IF EXISTS `q_question_favorite_item`;
CREATE TABLE `q_question_favorite_item` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `favorite_id` BIGINT NOT NULL COMMENT '收藏夹 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `remark` VARCHAR(255) NULL COMMENT '收藏备注',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_fav_q (favorite_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='收藏夹条目';

DROP TABLE IF EXISTS `q_question_correction`;
CREATE TABLE `q_question_correction` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `correction_types` JSON NOT NULL COMMENT '问题类型（题干错误/答案错误/解析错误…）',
  `description` LONGTEXT NULL COMMENT '问题描述（富文本）',
  `reporter_id` BIGINT NOT NULL COMMENT '反馈人',
  `reporter_name` VARCHAR(64) NOT NULL COMMENT '反馈人姓名',
  `handle_status` TINYINT NOT NULL COMMENT '0 待处理 1 处理中 2 已修正 3 已驳回',
  `handler_id` BIGINT NULL COMMENT '处理人',
  `handle_opinion` VARCHAR(1024) NULL COMMENT '处理意见',
  `handled_at` DATETIME NULL COMMENT '处理时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_question (question_id),
  KEY idx_status (handle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目纠错记录';

DROP TABLE IF EXISTS `q_question_version`;
CREATE TABLE `q_question_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `version_no` INT NOT NULL COMMENT '版本号',
  `change_summary` VARCHAR(255) NULL COMMENT '变更摘要',
  `before_json` JSON NULL COMMENT '变更前快照',
  `after_json` JSON NULL COMMENT '变更后快照',
  `operator_id` BIGINT NULL COMMENT '操作人',
  `operator_name` VARCHAR(64) NULL COMMENT '操作人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_q_version (question_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目版本';

DROP TABLE IF EXISTS `q_question_check`;
CREATE TABLE `q_question_check` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `check_round` TINYINT NOT NULL COMMENT '质检轮次',
  `check_name` VARCHAR(128) NOT NULL COMMENT '检查项名称',
  `check_pass` TINYINT NOT NULL COMMENT '是否通过',
  `check_note` VARCHAR(1024) NULL COMMENT '结论说明',
  `fixed_content` LONGTEXT NULL COMMENT '自动修正后内容',
  `model_key` VARCHAR(64) NULL COMMENT '质检模型',
  `confidence` DECIMAL(5,2) NULL COMMENT '置信度（0-100）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_question (question_id, check_round)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目 AI 质检结果';

DROP TABLE IF EXISTS `q_basket_item`;
CREATE TABLE `q_basket_item` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `user_id` BIGINT NOT NULL COMMENT '用户 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `source_page` VARCHAR(64) NULL COMMENT '来源页面（题库/组卷/智能组卷）',
  `temp_flag` TINYINT NOT NULL COMMENT '是否临时题',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_user_q (user_id, question_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试题篮条目';

DROP TABLE IF EXISTS `p_paper`;
CREATE TABLE `p_paper` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_name` VARCHAR(255) NOT NULL COMMENT '试卷名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `duration` INT NOT NULL COMMENT '考试时长（分钟）',
  `total_score` DECIMAL(6,2) NOT NULL COMMENT '卷面总分',
  `question_count` INT NOT NULL COMMENT '题目总数',
  `status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/aiReview AI 复审/pending 待审核/approved 已通过/rejected 已驳回',
  `paper_source` VARCHAR(16) NOT NULL COMMENT '来源：手动组卷/协同组卷/AI 组卷/真题导入/文档识别',
  `difficulty` VARCHAR(16) NULL COMMENT '整卷难度',
  `exam_type` VARCHAR(64) NULL COMMENT '考试类型',
  `competition` VARCHAR(64) NULL COMMENT '杯赛名称',
  `region` VARCHAR(64) NULL COMMENT '地区',
  `paper_year` VARCHAR(8) NULL COMMENT '试卷年份',
  `paper_month` VARCHAR(8) NULL COMMENT '试卷月份',
  `folder_id` BIGINT NULL COMMENT '我的文件文件夹 ID（0 为根）',
  `file_id` BIGINT NULL COMMENT '关联文件 ID',
  `view_count` INT NOT NULL COMMENT '浏览次数',
  `download_count` INT NOT NULL COMMENT '下载次数',
  `parallel_of` BIGINT NULL COMMENT '母卷 ID（平行卷）',
  `parallel_label` VARCHAR(16) NULL COMMENT '平行卷标号（A/B/C）',
  `notices_json` JSON NULL COMMENT '卷首注意事项条目',
  `extras_json` JSON NULL COMMENT '卷面附加区块（表格/四线格/横线）',
  `attachments_json` JSON NULL COMMENT '随卷参考资料（媒体）',
  `shared_square` TINYINT NOT NULL COMMENT '是否分享到知识广场',
  `ai_flag` TINYINT NOT NULL COMMENT '是否 AI 生成',
  `ai_checks_json` JSON NULL COMMENT '整卷质检结果',
  `ai_suspects_json` JSON NULL COMMENT '疑点列表',
  `review_opinion` VARCHAR(1024) NULL COMMENT '审核意见',
  `owner_id` BIGINT NOT NULL COMMENT '创建人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '创建人姓名',
  `published_at` DATETIME NULL COMMENT '通过审核时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_owner (owner_id),
  KEY idx_status (status),
  KEY idx_subject_grade (subject, grade),
  KEY idx_parallel (parallel_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试卷主表';

DROP TABLE IF EXISTS `p_paper_section`;
CREATE TABLE `p_paper_section` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `section_title` VARCHAR(255) NOT NULL COMMENT '大题标题（一、选择题）',
  `sort_no` INT NOT NULL COMMENT '大题顺序',
  `material` LONGTEXT NULL COMMENT '大题共用材料',
  `material_hint` VARCHAR(512) NULL COMMENT '材料作答提示',
  `total_score` DECIMAL(6,2) NOT NULL COMMENT '大题总分',
  `question_count` INT NOT NULL COMMENT '大题题数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_paper (paper_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试卷大题';

DROP TABLE IF EXISTS `p_paper_section_question`;
CREATE TABLE `p_paper_section_question` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `section_id` BIGINT NOT NULL COMMENT '大题 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `sort_no` INT NOT NULL COMMENT '题内序号（卷面题号按卷内顺序现算）',
  `score` DECIMAL(6,2) NOT NULL COMMENT '本题分值',
  `question_snapshot` JSON NULL COMMENT '题目快照（防题库改动污染历史卷）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_section (section_id, sort_no),
  KEY idx_paper (paper_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='大题题目';

DROP TABLE IF EXISTS `p_paper_version`;
CREATE TABLE `p_paper_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `version_no` INT NOT NULL COMMENT '版本号',
  `actor_id` BIGINT NULL COMMENT '操作人',
  `actor_name` VARCHAR(64) NULL COMMENT '操作人姓名',
  `summary` VARCHAR(255) NULL COMMENT '变更摘要',
  `question_count` INT NOT NULL COMMENT '题数',
  `total_score` DECIMAL(6,2) NOT NULL COMMENT '总分',
  `sections_json` LONGTEXT NOT NULL COMMENT '卷面完整快照（sections 深拷贝）',
  `replaced` TINYINT NOT NULL COMMENT '是否已被替换',
  `replace_note` VARCHAR(255) NULL COMMENT '替换说明',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_paper_version (paper_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试卷版本';

DROP TABLE IF EXISTS `p_paper_comment`;
CREATE TABLE `p_paper_comment` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `target` VARCHAR(16) NOT NULL COMMENT 'head 卷头 / section 大题 / question 题目',
  `section_id` BIGINT NULL COMMENT '大题 ID',
  `question_id` BIGINT NULL COMMENT '题目 ID',
  `author_id` BIGINT NULL COMMENT '评论人 ID',
  `author_name` VARCHAR(64) NULL COMMENT '评论人姓名',
  `comment_source` VARCHAR(16) NOT NULL COMMENT 'manual 手工 / ai AI 检测 / correct 纠错自动生成',
  `body` VARCHAR(2048) NOT NULL COMMENT '评论内容',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_paper_target (paper_id, target)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='卷面评论';

DROP TABLE IF EXISTS `p_paper_collab_task`;
CREATE TABLE `p_paper_collab_task` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '关联试卷 ID（一对一）',
  `task_name` VARCHAR(255) NOT NULL COMMENT '任务名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `duration` INT NOT NULL COMMENT '时长（分钟）',
  `structure_json` JSON NULL COMMENT '题型要求（题型/题数/单题分值）',
  `difficulty_json` JSON NULL COMMENT '难度占比要求',
  `knowledge_json` JSON NULL COMMENT '考察知识点要求',
  `requirement_remark` VARCHAR(1024) NULL COMMENT '命题说明',
  `viewers_json` JSON NULL COMMENT '额外可见人（空数组表示不限制）',
  `task_status` VARCHAR(16) NOT NULL COMMENT 'collecting 收题中/reviewing 待验收/ready 待送审/submitted 已送审/done 已完成/rejected 已驳回',
  `owner_id` BIGINT NOT NULL COMMENT '发起人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '发起人姓名',
  `deadline` DATETIME NULL COMMENT '截止时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (task_status),
  KEY idx_paper (paper_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='协同组卷任务';

DROP TABLE IF EXISTS `p_paper_collab_member`;
CREATE TABLE `p_paper_collab_member` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_id` BIGINT NOT NULL COMMENT '任务 ID',
  `user_id` BIGINT NULL COMMENT '成员用户 ID',
  `member_name` VARCHAR(64) NOT NULL COMMENT '成员姓名',
  `question_types` JSON NOT NULL COMMENT '负责题型（仅可为本组题型选题）',
  `perms` JSON NOT NULL COMMENT '授权范围：选题/改分值/编辑卷头/只读',
  `quota` INT NOT NULL COMMENT '分配题数',
  `member_status` VARCHAR(16) NOT NULL COMMENT 'invited 待接受/working 组卷中/submitted 已提交/accepted 已验收',
  `review_note` VARCHAR(512) NULL COMMENT '退回整改意见',
  `last_active_at` DATETIME NULL COMMENT '最近活跃时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_task_member (task_id, member_name),
  KEY idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='协同组卷成员';

DROP TABLE IF EXISTS `p_paper_blueprint`;
CREATE TABLE `p_paper_blueprint` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NULL COMMENT '关联试卷（模板时为空）',
  `blueprint_name` VARCHAR(128) NOT NULL COMMENT '细目表名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `row_dim` VARCHAR(16) NOT NULL COMMENT '行维度：knowledge 知识点',
  `col_dim` VARCHAR(16) NOT NULL COMMENT '列维度：difficulty 难度 / ability 能力层级',
  `is_template` TINYINT NOT NULL COMMENT '是否模板',
  `scope` VARCHAR(16) NOT NULL COMMENT 'org 机构 / personal 个人',
  `owner_id` BIGINT NULL COMMENT '创建人',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject (subject, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='双向细目表';

DROP TABLE IF EXISTS `p_paper_blueprint_cell`;
CREATE TABLE `p_paper_blueprint_cell` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `blueprint_id` BIGINT NOT NULL COMMENT '细目表 ID',
  `row_key` VARCHAR(128) NOT NULL COMMENT '行键（知识点）',
  `row_name` VARCHAR(255) NOT NULL COMMENT '行名称',
  `col_key` VARCHAR(64) NOT NULL COMMENT '列键',
  `col_name` VARCHAR(64) NOT NULL COMMENT '列名称',
  `target_count` INT NOT NULL COMMENT '目标题量',
  `target_score` DECIMAL(6,2) NULL COMMENT '目标分值',
  `filled_count` INT NOT NULL COMMENT '已填题量',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_bp_cell (blueprint_id, row_key, col_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='细目表单元格';

DROP TABLE IF EXISTS `p_paper_template`;
CREATE TABLE `p_paper_template` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `template_name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `structure_json` JSON NOT NULL COMMENT '卷头与结构（大题/题型配比/分值/用时）',
  `scope` VARCHAR(16) NOT NULL COMMENT 'org 机构 / personal 个人',
  `owner_id` BIGINT NULL COMMENT '创建人',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `use_count` INT NOT NULL COMMENT '使用次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject (subject, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='模板试卷';

DROP TABLE IF EXISTS `p_ai_compose_template`;
CREATE TABLE `p_ai_compose_template` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `template_name` VARCHAR(255) NOT NULL COMMENT '模板名称（默认取卷名）',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `knowledge_json` JSON NULL COMMENT '知识点（硬条件）',
  `exam_type` VARCHAR(64) NULL COMMENT '考试类型',
  `difficulty` VARCHAR(16) NULL COMMENT '难度',
  `region` VARCHAR(64) NULL COMMENT '优先地区',
  `paper_year` VARCHAR(8) NULL COMMENT '优先年份（含 earlier 哨兵）',
  `structure_json` JSON NULL COMMENT '卷面结构（题型/题量）',
  `use_count` INT NOT NULL COMMENT '被复用次数',
  `owner_id` BIGINT NOT NULL COMMENT '归属人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '归属人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='智能组卷参数模板';

DROP TABLE IF EXISTS `p_paper_ref`;
CREATE TABLE `p_paper_ref` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `ref_type` VARCHAR(16) NOT NULL COMMENT '引用方：homework 作业 / exam 考试 / teach_doc 备课 / collab 协同组卷',
  `ref_id` BIGINT NOT NULL COMMENT '引用方 ID',
  `ref_name` VARCHAR(255) NULL COMMENT '引用方名称',
  `ref_status` VARCHAR(16) NULL COMMENT '引用方状态（进行中/已结束）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_paper (paper_id),
  KEY idx_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试卷引用关系';

DROP TABLE IF EXISTS `t_teach_doc`;
CREATE TABLE `t_teach_doc` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_kind` VARCHAR(16) NOT NULL COMMENT 'plan 教案/guide 学案/lecture 讲义/courseware 课件',
  `doc_name` VARCHAR(255) NOT NULL COMMENT '文档名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `textbook_version` VARCHAR(64) NULL COMMENT '教材版本',
  `chapter` VARCHAR(255) NULL COMMENT '章节（教材目录中的位置）',
  `knowledge_json` JSON NULL COMMENT '知识点范围',
  `doc_source` VARCHAR(16) NOT NULL COMMENT 'personal 个人/school 校本/platform 平台（决定编辑权限）',
  `doc_status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/published 已发布',
  `content` LONGTEXT NULL COMMENT '正文（文档流富文本 HTML，标题层级 h1-h4）',
  `page_json` JSON NULL COMMENT '页面设置档位（纸张/页边距/字体/页眉页脚/页码）',
  `plan_json` JSON NULL COMMENT '教案结构化扩展（兼容旧数据）',
  `view_count` INT NOT NULL COMMENT '浏览次数',
  `shared_square` TINYINT NOT NULL COMMENT '是否分享到知识广场',
  `word_count` INT NULL COMMENT '字数',
  `owner_id` BIGINT NOT NULL COMMENT '创建人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '创建人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_kind_owner (doc_kind, owner_id),
  KEY idx_subject (subject, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='备课文档';

DROP TABLE IF EXISTS `t_teach_plan`;
CREATE TABLE `t_teach_plan` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '备课文档 ID',
  `objective_knowledge` LONGTEXT NULL COMMENT '知识与技能目标',
  `objective_process` LONGTEXT NULL COMMENT '过程与方法目标',
  `objective_emotion` LONGTEXT NULL COMMENT '情感态度价值观目标',
  `key_points` LONGTEXT NULL COMMENT '教学重点',
  `hard_points` LONGTEXT NULL COMMENT '教学难点',
  `methods` JSON NULL COMMENT '教学方法',
  `aids` JSON NULL COMMENT '教具与媒体',
  `periods` INT NULL COMMENT '课时数',
  `blackboard` LONGTEXT NULL COMMENT '板书设计',
  `reflection` LONGTEXT NULL COMMENT '教学反思',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_plan_doc (doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教案教学设计';

DROP TABLE IF EXISTS `t_teach_plan_step`;
CREATE TABLE `t_teach_plan_step` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '备课文档 ID',
  `sort_no` INT NOT NULL COMMENT '环节顺序',
  `step_kind` VARCHAR(16) NOT NULL COMMENT 'lead 导入/teach 新授/consolidate 巩固/summary 小结/homework 作业/free 自定义',
  `step_title` VARCHAR(255) NOT NULL COMMENT '环节名称',
  `teacher_act` LONGTEXT NULL COMMENT '教师活动',
  `student_act` LONGTEXT NULL COMMENT '学生活动',
  `design_intent` LONGTEXT NULL COMMENT '设计意图',
  `minutes` INT NULL COMMENT '时间分配（分钟）',
  `question_ids` JSON NULL COMMENT '本环节引用题目',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_doc (doc_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教案教学过程环节';

DROP TABLE IF EXISTS `t_teach_doc_block`;
CREATE TABLE `t_teach_doc_block` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '备课文档 ID',
  `sort_no` INT NOT NULL COMMENT '块顺序',
  `block_kind` VARCHAR(16) NOT NULL COMMENT 'goal/explain/example/practice/summary/homework/preview/explore/check/extend/text',
  `block_title` VARCHAR(255) NULL COMMENT '块标题',
  `body` LONGTEXT NULL COMMENT '块正文（富文本）',
  `question_ids` JSON NULL COMMENT '引用的题库题目',
  `page_break` TINYINT NOT NULL COMMENT '是否强制分页',
  `teacher_note` LONGTEXT NULL COMMENT '教师批注（仅教师版渲染）',
  `ref_mode` VARCHAR(16) NULL COMMENT '题目引用模式：snapshot 快照 / dynamic 动态引用',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_doc (doc_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='文档块';

DROP TABLE IF EXISTS `t_teach_doc_slide`;
CREATE TABLE `t_teach_doc_slide` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '备课文档 ID',
  `sort_no` INT NOT NULL COMMENT '页序',
  `layout` VARCHAR(16) NOT NULL COMMENT 'cover/bullets/image/question/section/end',
  `slide_title` VARCHAR(255) NULL COMMENT '页标题',
  `subtitle` VARCHAR(255) NULL COMMENT '副标题',
  `bullets` JSON NULL COMMENT '要点列表',
  `note` LONGTEXT NULL COMMENT '讲稿备注（不投屏）',
  `question_id` BIGINT NULL COMMENT '例题页引用题目',
  `thumb_url` VARCHAR(512) NULL COMMENT '缩略图',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_doc (doc_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='课件页面';

DROP TABLE IF EXISTS `t_teach_doc_version`;
CREATE TABLE `t_teach_doc_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '备课文档 ID',
  `version_no` INT NOT NULL COMMENT '版本号',
  `summary` VARCHAR(255) NULL COMMENT '版本说明',
  `content_snapshot` LONGTEXT NOT NULL COMMENT '正文快照',
  `operator_id` BIGINT NULL COMMENT '操作人',
  `operator_name` VARCHAR(64) NULL COMMENT '操作人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_doc_version (doc_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='备课文档版本';

DROP TABLE IF EXISTS `t_teach_template`;
CREATE TABLE `t_teach_template` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `template_kind` VARCHAR(16) NOT NULL COMMENT 'plan/guide/lecture',
  `template_name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `template_desc` VARCHAR(512) NULL COMMENT '模板说明',
  `scope` VARCHAR(16) NOT NULL COMMENT 'org 机构 / personal 个人',
  `builtin` TINYINT NOT NULL COMMENT '是否系统内置（可停用不可删）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `is_default` TINYINT NOT NULL COMMENT '是否该类型默认模板',
  `subject` VARCHAR(32) NULL COMMENT '预填学科',
  `grade` VARCHAR(32) NULL COMMENT '预填年级',
  `periods` INT NULL COMMENT '预填课时数',
  `content` LONGTEXT NOT NULL COMMENT '文档骨架（富文本 HTML）',
  `owner_id` BIGINT NULL COMMENT '创建人',
  `owner_name` VARCHAR(64) NULL COMMENT '创建人姓名',
  `use_count` INT NOT NULL COMMENT '使用次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_kind_scope (template_kind, scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='备课模板';

DROP TABLE IF EXISTS `t_prep_task`;
CREATE TABLE `t_prep_task` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_name` VARCHAR(255) NOT NULL COMMENT '任务名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `doc_kind` VARCHAR(16) NULL COMMENT '关联文档类型',
  `doc_id` BIGINT NULL COMMENT '关联备课文档',
  `doc_name` VARCHAR(255) NULL COMMENT '关联文档名称',
  `topic` VARCHAR(255) NULL COMMENT '备课主题',
  `goal` LONGTEXT NULL COMMENT '教学目标',
  `key_points` LONGTEXT NULL COMMENT '重点',
  `hard_points` LONGTEXT NULL COMMENT '难点',
  `deadline` DATETIME NULL COMMENT '截止时间',
  `requirement_note` VARCHAR(1024) NULL COMMENT '备课说明',
  `task_status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/ongoing 备课中/review 研讨中/done 已定稿',
  `owner_id` BIGINT NOT NULL COMMENT '发起人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '发起人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (task_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='集体备课任务';

DROP TABLE IF EXISTS `t_prep_member`;
CREATE TABLE `t_prep_member` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_id` BIGINT NOT NULL COMMENT '任务 ID',
  `user_id` BIGINT NULL COMMENT '成员用户 ID',
  `member_name` VARCHAR(64) NOT NULL COMMENT '成员姓名',
  `duty` VARCHAR(128) NULL COMMENT '分工：教学目标/过程设计/例题选取/作业设计',
  `member_status` VARCHAR(16) NOT NULL COMMENT 'pending 待开始/working 进行中/submitted 已提交',
  `last_active_at` DATETIME NULL COMMENT '最近活跃时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_prep_member (task_id, member_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='集体备课成员';

DROP TABLE IF EXISTS `t_prep_comment`;
CREATE TABLE `t_prep_comment` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_id` BIGINT NOT NULL COMMENT '任务 ID',
  `author_id` BIGINT NULL COMMENT '评论人',
  `author_name` VARCHAR(64) NOT NULL COMMENT '评论人姓名',
  `target` VARCHAR(128) NULL COMMENT '针对的环节/版本',
  `body` VARCHAR(2048) NOT NULL COMMENT '评论内容',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='集体备课研讨记录';

DROP TABLE IF EXISTS `t_prep_version`;
CREATE TABLE `t_prep_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_id` BIGINT NOT NULL COMMENT '任务 ID',
  `version_no` INT NOT NULL COMMENT '版本号',
  `author_name` VARCHAR(64) NULL COMMENT '提交人',
  `summary` VARCHAR(255) NULL COMMENT '版本说明',
  `snapshot` LONGTEXT NOT NULL COMMENT '正文快照（JSON）',
  `replaced` TINYINT NOT NULL COMMENT '是否已被替换',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_prep_version (task_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='集体备课版本';

DROP TABLE IF EXISTS `r_file_folder`;
CREATE TABLE `r_file_folder` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NULL COMMENT '父目录（空为根）',
  `folder_name` VARCHAR(128) NOT NULL COMMENT '目录名称',
  `owner_id` BIGINT NOT NULL COMMENT '归属人',
  `folder_path` VARCHAR(512) NULL COMMENT '路径',
  `pinned` TINYINT NOT NULL COMMENT '是否置顶',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_owner_parent (owner_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='我的文件目录';

DROP TABLE IF EXISTS `r_file`;
CREATE TABLE `r_file` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `folder_id` BIGINT NOT NULL COMMENT '所在目录（0 为根）',
  `file_name` VARCHAR(255) NOT NULL COMMENT '文件名称',
  `file_kind` VARCHAR(16) NOT NULL COMMENT '类型：doc/paper/lecture/aiPaper/composePaper/courseware/book/word/ppt/pdf/video/audio/h5/image/miniapp/other/animation',
  `file_ext` VARCHAR(16) NULL COMMENT '扩展名',
  `mime` VARCHAR(128) NULL COMMENT 'MIME',
  `size_mb` DECIMAL(12,2) NOT NULL COMMENT '大小（MB）',
  `file_url` VARCHAR(512) NULL COMMENT '访问地址（签名 URL）',
  `storage_key` VARCHAR(512) NULL COMMENT '对象存储 Key',
  `recognize_status` VARCHAR(16) NOT NULL COMMENT '识别状态：none/recognizing/done/failed',
  `owner_id` BIGINT NOT NULL COMMENT '创建者',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '创建者姓名',
  `shared` TINYINT NOT NULL COMMENT '是否他人分享进来',
  `shared_from_id` BIGINT NULL COMMENT '分享人',
  `pinned` TINYINT NOT NULL COMMENT '是否置顶',
  `paper_id` BIGINT NULL COMMENT '关联试卷 ID',
  `teach_doc_id` BIGINT NULL COMMENT '关联备课文档 ID',
  `download_count` INT NOT NULL COMMENT '下载次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_folder (folder_id),
  KEY idx_owner (owner_id),
  KEY idx_kind (file_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='我的文件';

DROP TABLE IF EXISTS `r_material`;
CREATE TABLE `r_material` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `material_name` VARCHAR(255) NOT NULL COMMENT '资料名称',
  `material_type` VARCHAR(64) NOT NULL COMMENT '类型：同步教辅/专项训练/试卷集/校本资料',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `size_mb` DECIMAL(12,2) NULL COMMENT '文件大小（MB）',
  `recognize_status` VARCHAR(16) NOT NULL COMMENT 'recognizing 识别中/proofreading 校对中/done 已完成/failed 失败',
  `fail_reason` VARCHAR(512) NULL COMMENT '失败原因',
  `chapter_count` INT NOT NULL COMMENT '章节数',
  `example_count` INT NOT NULL COMMENT '条目数',
  `owner_id` BIGINT NOT NULL COMMENT '上传人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '上传人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject (subject, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教辅资料';

DROP TABLE IF EXISTS `r_material_chapter`;
CREATE TABLE `r_material_chapter` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `material_id` BIGINT NOT NULL COMMENT '教辅 ID',
  `chapter_title` VARCHAR(255) NOT NULL COMMENT '章节标题',
  `sort_no` INT NOT NULL COMMENT '排序',
  `knowledge_json` JSON NULL COMMENT '关联知识点',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_material (material_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教辅章节';

DROP TABLE IF EXISTS `r_material_example`;
CREATE TABLE `r_material_example` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `material_id` BIGINT NOT NULL COMMENT '教辅 ID',
  `chapter_id` BIGINT NOT NULL COMMENT '章节 ID',
  `stem` LONGTEXT NOT NULL COMMENT '题干/文段',
  `answer` LONGTEXT NULL COMMENT '答案',
  `analysis` LONGTEXT NULL COMMENT '解析',
  `example_status` VARCHAR(16) NOT NULL COMMENT 'pending 待处理/imported 已入库/ignored 已忽略',
  `question_id` BIGINT NULL COMMENT '入库后生成的题目 ID',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_chapter (chapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教辅条目';

DROP TABLE IF EXISTS `r_media`;
CREATE TABLE `r_media` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `media_name` VARCHAR(255) NOT NULL COMMENT '资源名称',
  `media_kind` VARCHAR(16) NOT NULL COMMENT 'video 视频/animation 小程序动画/image 图片',
  `subject` VARCHAR(32) NULL COMMENT '学科',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `size_mb` DECIMAL(12,2) NULL COMMENT '大小（MB）',
  `duration_sec` INT NULL COMMENT '时长（秒）',
  `mime` VARCHAR(128) NULL COMMENT 'MIME',
  `file_url` VARCHAR(512) NULL COMMENT '可引用地址',
  `cover_url` VARCHAR(512) NULL COMMENT '封面图',
  `editor_type` VARCHAR(32) NULL COMMENT '绘图编辑器：jsxgraph/fabric-chem/ketcher/fabric-general',
  `project_json` LONGTEXT NULL COMMENT '绘图工程原始数据',
  `molfile_text` LONGTEXT NULL COMMENT 'Ketcher 分子工程',
  `linked_count` INT NOT NULL COMMENT '被引用次数',
  `owner_id` BIGINT NOT NULL COMMENT '上传人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '上传人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_kind (media_kind),
  KEY idx_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='媒体资源';

DROP TABLE IF EXISTS `r_video_clip`;
CREATE TABLE `r_video_clip` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `media_id` BIGINT NOT NULL COMMENT '源视频 ID',
  `media_name` VARCHAR(255) NULL COMMENT '源视频名称',
  `clip_title` VARCHAR(255) NOT NULL COMMENT '切片标题',
  `start_sec` INT NOT NULL COMMENT '起始秒',
  `end_sec` INT NOT NULL COMMENT '结束秒',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `question_ids` JSON NULL COMMENT '关联题目',
  `note` VARCHAR(512) NULL COMMENT '说明',
  `creator_id` BIGINT NULL COMMENT '创建人',
  `creator_name` VARCHAR(64) NULL COMMENT '创建人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_media (media_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='微课切片';

DROP TABLE IF EXISTS `r_formula_standard`;
CREATE TABLE `r_formula_standard` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `formula_name` VARCHAR(255) NOT NULL COMMENT '公式名称',
  `branch` VARCHAR(64) NULL COMMENT '分支（代数/几何/物理…）',
  `chapter` VARCHAR(128) NULL COMMENT '章节',
  `latex` LONGTEXT NOT NULL COMMENT 'LaTeX 表达式',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `collect_count` INT NOT NULL COMMENT '收藏次数',
  `sort_no` INT NOT NULL COMMENT '排序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_branch (branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='标准公式库';

DROP TABLE IF EXISTS `r_formula_org`;
CREATE TABLE `r_formula_org` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `formula_name` VARCHAR(255) NOT NULL COMMENT '公式名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `category` VARCHAR(64) NOT NULL COMMENT '细分类',
  `latex` LONGTEXT NOT NULL COMMENT 'LaTeX 表达式',
  `formula_scope` VARCHAR(16) NOT NULL COMMENT 'mine 我的 / shared 机构共享',
  `formula_status` VARCHAR(16) NOT NULL COMMENT 'pending 待审/approved 已通过/rejected 已驳回/off 已下架',
  `owner_id` BIGINT NOT NULL COMMENT '归属人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '归属人姓名',
  `use_count` INT NOT NULL COMMENT '使用次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scope_status (formula_scope, formula_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='机构与个人公式';

DROP TABLE IF EXISTS `r_resource_ref`;
CREATE TABLE `r_resource_ref` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `resource_type` VARCHAR(16) NOT NULL COMMENT 'question/paper/media/material/formula',
  `resource_id` BIGINT NOT NULL COMMENT '资源 ID',
  `ref_type` VARCHAR(16) NOT NULL COMMENT 'teach_doc/paper/homework/courseware/slide',
  `ref_id` BIGINT NOT NULL COMMENT '引用方 ID',
  `ref_block_id` BIGINT NULL COMMENT '引用块 ID',
  `ref_mode` VARCHAR(16) NULL COMMENT 'snapshot 快照 / dynamic 动态引用',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_resource (resource_type, resource_id),
  KEY idx_ref (ref_type, ref_id),
  UNIQUE KEY uk_ref (resource_type, resource_id, ref_type, ref_id, ref_block_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='资源引用关系';

DROP TABLE IF EXISTS `r_resource_approval`;
CREATE TABLE `r_resource_approval` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `resource_kind` VARCHAR(16) NOT NULL COMMENT '题目/试卷/讲义/课件/教案/学案/视频',
  `resource_id` BIGINT NULL COMMENT '资源 ID',
  `resource_name` VARCHAR(255) NOT NULL COMMENT '资源名称',
  `subject` VARCHAR(32) NULL COMMENT '学科',
  `grade` VARCHAR(32) NULL COMMENT '年级',
  `scope` VARCHAR(16) NOT NULL COMMENT '目标范围：personal/group/school/public',
  `applicant_id` BIGINT NOT NULL COMMENT '申请人',
  `applicant_name` VARCHAR(64) NOT NULL COMMENT '申请人姓名',
  `approval_status` VARCHAR(16) NOT NULL COMMENT 'pending 待审批/approved 已通过/rejected 已驳回',
  `reviewer_id` BIGINT NULL COMMENT '审批人',
  `reviewer_name` VARCHAR(64) NULL COMMENT '审批人姓名',
  `reviewed_at` DATETIME NULL COMMENT '审批时间',
  `opinion` VARCHAR(1024) NULL COMMENT '审批意见',
  `submitted_at` DATETIME NOT NULL COMMENT '提交时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (approval_status),
  KEY idx_kind (resource_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='资源审批单';

DROP TABLE IF EXISTS `r_resource_approval_log`;
CREATE TABLE `r_resource_approval_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `approval_id` BIGINT NOT NULL COMMENT '审批单 ID',
  `action` VARCHAR(32) NOT NULL COMMENT 'submit 提交/approve 通过/reject 驳回/revoke 撤回',
  `operator_id` BIGINT NULL COMMENT '操作人',
  `operator_name` VARCHAR(64) NULL COMMENT '操作人姓名',
  `note` VARCHAR(512) NULL COMMENT '说明',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_approval (approval_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='审批流转日志';

DROP TABLE IF EXISTS `r_square_resource`;
CREATE TABLE `r_square_resource` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `resource_title` VARCHAR(255) NOT NULL COMMENT '资源标题',
  `resource_kind` VARCHAR(16) NOT NULL COMMENT '题目/试卷/教辅/视频/动画',
  `subject` VARCHAR(32) NULL COMMENT '学科',
  `knowledge` VARCHAR(255) NULL COMMENT '主知识点',
  `sharer_id` BIGINT NULL COMMENT '分享人',
  `sharer_name` VARCHAR(64) NOT NULL COMMENT '分享人姓名',
  `org_name` VARCHAR(128) NULL COMMENT '所属机构（脱敏展示）',
  `collect_count` INT NOT NULL COMMENT '收藏数',
  `download_count` INT NOT NULL COMMENT '下载数',
  `resource_desc` VARCHAR(1024) NULL COMMENT '简介',
  `source_id` BIGINT NULL COMMENT '源资源 ID',
  `audit_status` VARCHAR(16) NOT NULL COMMENT 'pending 待审/approved 已通过/rejected 已驳回/offline 已下架',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_kind (resource_kind),
  KEY idx_audit (audit_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='知识广场资源';

DROP TABLE IF EXISTS `r_square_interaction`;
CREATE TABLE `r_square_interaction` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `resource_id` BIGINT NOT NULL COMMENT '广场资源 ID',
  `user_id` BIGINT NOT NULL COMMENT '用户 ID',
  `action` VARCHAR(16) NOT NULL COMMENT 'collect 收藏/download 下载/like 点赞',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_user_resource_action (resource_id, user_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='广场互动';

DROP TABLE IF EXISTS `r_prompt_org`;
CREATE TABLE `r_prompt_org` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `prompt_name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `scene` VARCHAR(64) NOT NULL COMMENT '适用场景',
  `content` LONGTEXT NOT NULL COMMENT '模板正文（支持 变量占位）',
  `prompt_status` VARCHAR(16) NOT NULL COMMENT 'enabled 启用/disabled 停用',
  `is_default` TINYINT NOT NULL COMMENT '是否场景默认',
  `source_prompt_id` BIGINT NULL COMMENT '来源平台模板 ID',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `versions_json` JSON NULL COMMENT '历史版本（版本号/时间/正文）',
  `owner_id` BIGINT NOT NULL COMMENT '创建人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '创建人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scene (scene)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='机构提示词模板';

DROP TABLE IF EXISTS `e_class`;
CREATE TABLE `e_class` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `class_name` VARCHAR(64) NOT NULL COMMENT '班级名称（高一(1)班）',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `campus_id` BIGINT NULL COMMENT '校区',
  `head_teacher_id` BIGINT NULL COMMENT '班主任 ID',
  `head_teacher_name` VARCHAR(64) NULL COMMENT '班主任姓名',
  `assistant_name` VARCHAR(64) NULL COMMENT '助教姓名',
  `student_count` INT NOT NULL COMMENT '学生数（快照）',
  `subjects` JSON NULL COMMENT '本学期学科',
  `room` VARCHAR(64) NULL COMMENT '教室',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_grade (grade),
  KEY idx_campus (campus_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='班级';

DROP TABLE IF EXISTS `e_student`;
CREATE TABLE `e_student` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_no` VARCHAR(64) NOT NULL COMMENT '学号（租户内唯一）',
  `student_name` VARCHAR(64) NOT NULL COMMENT '姓名',
  `gender` VARCHAR(8) NULL COMMENT '性别',
  `class_id` BIGINT NULL COMMENT '当前班级',
  `class_name` VARCHAR(64) NULL COMMENT '班级名称（冗余）',
  `grade` VARCHAR(32) NULL COMMENT '年级',
  `guardian_name` VARCHAR(64) NULL COMMENT '监护人姓名',
  `guardian_phone` VARCHAR(128) NULL COMMENT '监护人手机（加密）',
  `guardian_relation` VARCHAR(16) NULL COMMENT '关系：父亲/母亲/其他',
  `id_card_cipher` VARCHAR(255) NULL COMMENT '身份证号（加密，非必采集）',
  `consent_status` VARCHAR(16) NOT NULL COMMENT 'granted 已同意/pending 待签署/withdrawn 已撤回',
  `tags_json` JSON NULL COMMENT '画像标签',
  `warning_level` VARCHAR(16) NOT NULL COMMENT 'none 正常/watch 关注/risk 预警',
  `last_score` DECIMAL(6,2) NULL COMMENT '最近考试总分',
  `last_percentile` DECIMAL(5,2) NULL COMMENT '年级百分位',
  `enroll_at` DATE NULL COMMENT '入校日期',
  `student_status` VARCHAR(16) NOT NULL COMMENT '在读/转班/休学/退出',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_student_no (tenant_id, student_no),
  KEY idx_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生档案';

DROP TABLE IF EXISTS `e_guardian_binding`;
CREATE TABLE `e_guardian_binding` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `guardian_user_id` BIGINT NOT NULL COMMENT '家长用户 ID',
  `guardian_name` VARCHAR(64) NULL COMMENT '家长姓名',
  `relation` VARCHAR(16) NULL COMMENT '父亲/母亲/其他',
  `phone` VARCHAR(128) NULL COMMENT '手机（加密）',
  `bind_status` VARCHAR(16) NOT NULL COMMENT 'pending 待核验/bound 已绑定/unbound 已解绑',
  `bind_channel` VARCHAR(16) NULL COMMENT 'invite 邀请码 / phone 手机号核验',
  `bound_at` DATETIME NULL COMMENT '绑定时间',
  `unbound_at` DATETIME NULL COMMENT '解绑时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_student_guardian (student_id, guardian_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='家长绑定关系';

DROP TABLE IF EXISTS `e_consent_record`;
CREATE TABLE `e_consent_record` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `guardian_name` VARCHAR(64) NOT NULL COMMENT '监护人姓名',
  `relation` VARCHAR(16) NULL COMMENT '关系',
  `doc_version` VARCHAR(32) NOT NULL COMMENT '同意书版本',
  `consent_status` VARCHAR(16) NOT NULL COMMENT 'granted/pending/withdrawn',
  `scopes` JSON NULL COMMENT '同意范围（学情分析/作业批改/画像推送等）',
  `sign_channel` VARCHAR(16) NULL COMMENT '签署渠道：app 纸质 h5',
  `signed_at` DATETIME NULL COMMENT '签署时间',
  `withdrawn_at` DATETIME NULL COMMENT '撤回时间',
  `file_url` VARCHAR(512) NULL COMMENT '同意书扫描件',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_student (student_id),
  KEY idx_status (consent_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='监护人知情同意';

DROP TABLE IF EXISTS `e_homework`;
CREATE TABLE `e_homework` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `homework_name` VARCHAR(255) NOT NULL COMMENT '作业名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `paper_id` BIGINT NULL COMMENT '来源试卷（整卷作业）',
  `paper_name` VARCHAR(255) NULL COMMENT '试卷名称',
  `classes_json` JSON NOT NULL COMMENT '布置班级',
  `assign_at` DATETIME NOT NULL COMMENT '布置时间',
  `deadline` DATETIME NOT NULL COMMENT '截止时间',
  `require_text` VARCHAR(1024) NULL COMMENT '作业要求',
  `answer_mode` VARCHAR(16) NOT NULL COMMENT 'online 在线作答/photo 拍照上传',
  `allow_analysis` TINYINT NOT NULL COMMENT '是否允许查看解析',
  `ai_grading` TINYINT NOT NULL COMMENT '是否启用 AI 批改',
  `homework_status` VARCHAR(16) NOT NULL COMMENT 'assigned 已布置/ongoing 进行中/closed 已截止',
  `submitted_count` INT NOT NULL COMMENT '已提交数',
  `total_count` INT NOT NULL COMMENT '应交数',
  `owner_id` BIGINT NOT NULL COMMENT '布置人',
  `owner_name` VARCHAR(64) NOT NULL COMMENT '布置人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status_deadline (homework_status, deadline),
  KEY idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='作业';

DROP TABLE IF EXISTS `e_homework_question`;
CREATE TABLE `e_homework_question` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `homework_id` BIGINT NOT NULL COMMENT '作业 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `sort_no` INT NOT NULL COMMENT '题序',
  `score` DECIMAL(6,2) NULL COMMENT '分值',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_homework (homework_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='作业题目';

DROP TABLE IF EXISTS `e_homework_submission`;
CREATE TABLE `e_homework_submission` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `homework_id` BIGINT NOT NULL COMMENT '作业 ID',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `student_name` VARCHAR(64) NOT NULL COMMENT '学生姓名',
  `class_name` VARCHAR(64) NULL COMMENT '班级',
  `submit_at` DATETIME NULL COMMENT '提交时间',
  `submit_status` VARCHAR(16) NOT NULL COMMENT 'submitted 已交/late 迟交/missing 未交',
  `score` DECIMAL(6,2) NULL COMMENT '得分',
  `correct_rate` DECIMAL(5,2) NULL COMMENT '正确率',
  `wrong_question_ids` JSON NULL COMMENT '错题 ID',
  `comment` VARCHAR(1024) NULL COMMENT '评语',
  `grader_id` BIGINT NULL COMMENT '批改人',
  `graded_at` DATETIME NULL COMMENT '批改时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_hw_student (homework_id, student_id),
  KEY idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='作业提交';

DROP TABLE IF EXISTS `e_exam_session`;
CREATE TABLE `e_exam_session` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_name` VARCHAR(255) NOT NULL COMMENT '考试名称',
  `paper_id` BIGINT NOT NULL COMMENT '试卷 ID',
  `paper_name` VARCHAR(255) NOT NULL COMMENT '试卷名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `classes_json` JSON NOT NULL COMMENT '参考班级',
  `student_count` INT NOT NULL COMMENT '参考人数',
  `exam_at` DATETIME NOT NULL COMMENT '考试时间',
  `session_status` VARCHAR(16) NOT NULL COMMENT 'preparing 待考/grading 阅卷中/finished 已完成',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '卷面总分',
  `created_by_name` VARCHAR(64) NULL COMMENT '创建人姓名',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (session_status),
  KEY idx_paper (paper_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='考试场次';

DROP TABLE IF EXISTS `e_exam_answer`;
CREATE TABLE `e_exam_answer` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '考试场次',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `student_name` VARCHAR(64) NOT NULL COMMENT '学生姓名',
  `class_name` VARCHAR(64) NULL COMMENT '班级',
  `total_score` DECIMAL(6,2) NULL COMMENT '总分',
  `answer_status` VARCHAR(16) NOT NULL COMMENT 'pending 待阅/graded 已阅/absent 缺考/cheat 违纪',
  `remark` VARCHAR(512) NULL COMMENT '异常备注',
  `grader_id` BIGINT NULL COMMENT '阅卷人',
  `graded_at` DATETIME NULL COMMENT '阅卷时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_session_student (session_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='答卷';

DROP TABLE IF EXISTS `e_exam_answer_item`;
CREATE TABLE `e_exam_answer_item` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `answer_id` BIGINT NOT NULL COMMENT '答卷 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `q_index` INT NOT NULL COMMENT '卷面题号',
  `section_title` VARCHAR(255) NULL COMMENT '大题标题',
  `question_type` VARCHAR(32) NULL COMMENT '题型',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '本题满分',
  `score` DECIMAL(6,2) NULL COMMENT '最终得分',
  `answer_text` LONGTEXT NULL COMMENT '学生作答',
  `is_correct` TINYINT NULL COMMENT '是否正确',
  `ai_score` DECIMAL(6,2) NULL COMMENT 'AI 评分',
  `ai_confidence` DECIMAL(5,2) NULL COMMENT 'AI 置信度',
  `ai_adopted` TINYINT NOT NULL COMMENT 'AI 分是否被采纳',
  `review_status` VARCHAR(16) NOT NULL COMMENT '待复核/已复核/已覆盖',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_answer (answer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='答题明细';

DROP TABLE IF EXISTS `e_grading_duty`;
CREATE TABLE `e_grading_duty` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '考试场次',
  `section_title` VARCHAR(255) NOT NULL COMMENT '大题标题',
  `question_ids` JSON NULL COMMENT '本分工题目',
  `grader_ids` JSON NULL COMMENT '阅卷人 ID',
  `grader_names` JSON NULL COMMENT '阅卷人姓名',
  `grading_mode` VARCHAR(16) NOT NULL COMMENT 'single 单评 / double 双评',
  `done_count` INT NOT NULL COMMENT '已阅数',
  `total_count` INT NOT NULL COMMENT '应阅数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='阅卷分工';

DROP TABLE IF EXISTS `e_grading_record`;
CREATE TABLE `e_grading_record` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '考试场次',
  `answer_id` BIGINT NOT NULL COMMENT '答卷 ID',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `grader_id` BIGINT NULL COMMENT '阅卷人',
  `grader_name` VARCHAR(64) NULL COMMENT '阅卷人姓名',
  `score` DECIMAL(6,2) NOT NULL COMMENT '评分',
  `comment` VARCHAR(512) NULL COMMENT '评语',
  `round_no` TINYINT NOT NULL COMMENT '评次（双评时 1/2）',
  `is_arbitration` TINYINT NOT NULL COMMENT '是否仲裁结果',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_answer_q (answer_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='评卷记录';

DROP TABLE IF EXISTS `e_paper_analysis`;
CREATE TABLE `e_paper_analysis` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '考试场次',
  `student_count` INT NOT NULL COMMENT '参考人数',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '满分',
  `avg_score` DECIMAL(6,2) NULL COMMENT '平均分',
  `max_score` DECIMAL(6,2) NULL COMMENT '最高分',
  `min_score` DECIMAL(6,2) NULL COMMENT '最低分',
  `median` DECIMAL(6,2) NULL COMMENT '中位数',
  `std_dev` DECIMAL(6,2) NULL COMMENT '标准差',
  `pass_rate` DECIMAL(5,2) NULL COMMENT '及格率（%）',
  `excellent_rate` DECIMAL(5,2) NULL COMMENT '优秀率（%）',
  `difficulty` DECIMAL(5,2) NULL COMMENT '整卷难度系数',
  `discrimination` DECIMAL(5,2) NULL COMMENT '整卷区分度',
  `bands_json` JSON NULL COMMENT '分数段分布',
  `knowledge_json` JSON NULL COMMENT '知识点得分率',
  `classes_json` JSON NULL COMMENT '班级对比',
  `suggestions_json` JSON NULL COMMENT '讲评建议',
  `calc_time` DATETIME NULL COMMENT '计算时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_analysis_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='试卷分析快照';

DROP TABLE IF EXISTS `e_question_analysis`;
CREATE TABLE `e_question_analysis` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '考试场次',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `q_index` INT NOT NULL COMMENT '题号',
  `section_title` VARCHAR(255) NULL COMMENT '大题',
  `question_type` VARCHAR(32) NULL COMMENT '题型',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '满分',
  `avg_score` DECIMAL(6,2) NULL COMMENT '平均得分',
  `score_rate` DECIMAL(5,2) NULL COMMENT '得分率',
  `difficulty` DECIMAL(5,2) NULL COMMENT '难度系数',
  `discrimination` DECIMAL(5,2) NULL COMMENT '区分度',
  `correct_rate` DECIMAL(5,2) NULL COMMENT '客观题正确率',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_session_question (session_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='题目分析明细';

DROP TABLE IF EXISTS `e_mistake`;
CREATE TABLE `e_mistake` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_id` BIGINT NOT NULL COMMENT '题目 ID',
  `scope` VARCHAR(128) NOT NULL COMMENT '归属（班级名或个人名）',
  `source` VARCHAR(255) NULL COMMENT '来源（考试名/作业名）',
  `student_id` BIGINT NULL COMMENT '学生 ID（个人错题）',
  `student_name` VARCHAR(64) NULL COMMENT '学生姓名',
  `wrong_answer` LONGTEXT NULL COMMENT '错误作答',
  `wrong_count` INT NOT NULL COMMENT '错误次数',
  `reason` VARCHAR(32) NULL COMMENT '错误原因：概念不清/方法不当/计算失误/审题偏差/表达不规范/时间不足',
  `mastery` VARCHAR(16) NOT NULL COMMENT 'weak 未掌握/improving 巩固中/mastered 已掌握',
  `practiced_count` INT NOT NULL COMMENT '重练次数',
  `note` VARCHAR(512) NULL COMMENT '备注',
  `last_wrong_at` DATETIME NULL COMMENT '最近错误时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scope (scope),
  KEY idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='错题';

DROP TABLE IF EXISTS `e_mastery`;
CREATE TABLE `e_mastery` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `knowledge_id` BIGINT NULL COMMENT '知识点 ID',
  `knowledge_name` VARCHAR(255) NOT NULL COMMENT '知识点名称',
  `mastery` DECIMAL(5,2) NOT NULL COMMENT '掌握度（0-100）',
  `trend` VARCHAR(8) NOT NULL COMMENT 'up 上升/flat 持平/down 下降',
  `practice_count` INT NOT NULL COMMENT '练习次数',
  `weak_flag` TINYINT NOT NULL COMMENT '是否薄弱（掌握度小于 60）',
  `calc_time` DATETIME NULL COMMENT '计算时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_student_kp (student_id, subject, knowledge_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='知识点掌握度';

DROP TABLE IF EXISTS `e_student_profile`;
CREATE TABLE `e_student_profile` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `overall_mastery` DECIMAL(5,2) NULL COMMENT '综合掌握度（加权）',
  `percentile` DECIMAL(5,2) NULL COMMENT '年级百分位',
  `diagnosis` LONGTEXT NULL COMMENT 'AI 归因结论',
  `suggestion` LONGTEXT NULL COMMENT 'AI 建议动作',
  `calc_time` DATETIME NULL COMMENT '计算时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_profile_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生学情画像';

DROP TABLE IF EXISTS `e_class_profile`;
CREATE TABLE `e_class_profile` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `class_id` BIGINT NOT NULL COMMENT '班级 ID',
  `student_count` INT NULL COMMENT '学生数',
  `subject_mastery_json` JSON NULL COMMENT '各学科平均掌握度（含上学期对比）',
  `weak_nodes_json` JSON NULL COMMENT '薄弱知识点列表',
  `score_bands_json` JSON NULL COMMENT '最近一次统考分数段',
  `advice_json` JSON NULL COMMENT 'AI 班级诊断与教学建议',
  `calc_time` DATETIME NULL COMMENT '计算时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='班级学情报告';

DROP TABLE IF EXISTS `e_practice_push`;
CREATE TABLE `e_practice_push` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `student_id` BIGINT NOT NULL COMMENT '学生 ID',
  `push_title` VARCHAR(255) NOT NULL COMMENT '推送标题',
  `question_count` INT NOT NULL COMMENT '题目数',
  `weak_points_json` JSON NULL COMMENT '薄弱知识点',
  `pushed_at` DATETIME NOT NULL COMMENT '推送时间',
  `done_count` INT NOT NULL COMMENT '已完成数',
  `push_status` VARCHAR(16) NOT NULL COMMENT 'pending 待确认/pushed 已下发/done 已完成/canceled 已取消',
  `homework_id` BIGINT NULL COMMENT '生成的作业 ID',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='个性化练习推送';

DROP TABLE IF EXISTS `ai_model`;
CREATE TABLE `ai_model` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `model_name` VARCHAR(64) NOT NULL COMMENT '模型名称',
  `model_type` VARCHAR(16) NOT NULL COMMENT 'llm/multimodal/ocr',
  `provider` VARCHAR(64) NOT NULL COMMENT '服务商',
  `api_url` VARCHAR(512) NOT NULL COMMENT '接口地址',
  `api_key_cipher` VARCHAR(1024) NULL COMMENT '密钥（加密存储）',
  `qps` INT NOT NULL COMMENT 'QPS 上限',
  `timeout_sec` INT NOT NULL COMMENT '超时（秒）',
  `price_per_k` DECIMAL(10,4) NULL COMMENT '单价（元/千 tokens）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `calls_month` BIGINT NOT NULL COMMENT '本月调用次数',
  `cost_month` DECIMAL(12,2) NOT NULL COMMENT '本月成本（元）',
  `last_check_at` DATETIME NULL COMMENT '最近健康检查时间',
  `last_check_ok` TINYINT NULL COMMENT '最近健康检查结果',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_model_name (model_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='模型接入';

DROP TABLE IF EXISTS `ai_agent_config`;
CREATE TABLE `ai_agent_config` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `agent_name` VARCHAR(64) NOT NULL COMMENT '智能体名称',
  `agent_desc` VARCHAR(255) NULL COMMENT '说明',
  `scene` VARCHAR(64) NOT NULL COMMENT '适用场景',
  `auto_fix_types` JSON NULL COMMENT '可自动修复的错误类型',
  `auto_fix_threshold` DECIMAL(5,2) NULL COMMENT '自动修复置信度阈值',
  `min_confidence` DECIMAL(5,2) NULL COMMENT '转人工最低置信度',
  `max_similarity` DECIMAL(5,2) NULL COMMENT '转人工最高相似度',
  `version_no` INT NOT NULL COMMENT '配置版本',
  `config_status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/published 已发布',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scene (scene)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='智能体编排配置';

DROP TABLE IF EXISTS `ai_agent_check_item`;
CREATE TABLE `ai_agent_check_item` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `agent_id` BIGINT NOT NULL COMMENT '智能体配置 ID',
  `item_key` VARCHAR(64) NOT NULL COMMENT '检查项键',
  `item_label` VARCHAR(128) NOT NULL COMMENT '检查项名称',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `model_id` BIGINT NULL COMMENT '绑定模型',
  `weight` INT NOT NULL COMMENT '权重',
  `timeout_sec` INT NOT NULL COMMENT '超时（秒）',
  `ocr_only` TINYINT NOT NULL COMMENT '是否仅可绑定多模态/OCR 模型',
  `sort_no` INT NOT NULL COMMENT '执行顺序',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_agent_item (agent_id, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='智能体检查项';

DROP TABLE IF EXISTS `ai_prompt_template`;
CREATE TABLE `ai_prompt_template` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `prompt_name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `scene` VARCHAR(64) NOT NULL COMMENT '适用场景',
  `content` LONGTEXT NOT NULL COMMENT '模板正文（支持 变量占位）',
  `prompt_status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/published 已发布/disabled 已停用',
  `is_default` TINYINT NOT NULL COMMENT '是否场景默认',
  `source_prompt_id` BIGINT NULL COMMENT '派生来源（平台模板）',
  `gray_rule` JSON NULL COMMENT '灰度规则（租户标签/套餐/比例）',
  `remark` VARCHAR(255) NULL COMMENT '说明',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scene_status (scene, prompt_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Prompt 模板';

DROP TABLE IF EXISTS `ai_prompt_version`;
CREATE TABLE `ai_prompt_version` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `template_id` BIGINT NOT NULL COMMENT '模板 ID',
  `version_no` INT NOT NULL COMMENT '版本号',
  `content` LONGTEXT NOT NULL COMMENT '版本正文',
  `change_note` VARCHAR(255) NULL COMMENT '变更说明',
  `gray_status` VARCHAR(16) NOT NULL COMMENT 'none 未灰度/graying 灰度中/released 已全量/rolled_back 已回滚',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_prompt_version (template_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Prompt 版本';

DROP TABLE IF EXISTS `ai_call_log`;
CREATE TABLE `ai_call_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `trace_id` VARCHAR(64) NOT NULL COMMENT '链路 ID',
  `user_id` BIGINT NULL COMMENT '调用人',
  `scene` VARCHAR(64) NOT NULL COMMENT '场景：出题/组卷/讲义/阅卷/识题/识卷/问答',
  `model_key` VARCHAR(64) NOT NULL COMMENT '模型标识',
  `model_name` VARCHAR(64) NULL COMMENT '模型名称',
  `input_tokens` INT NOT NULL COMMENT '输入 tokens',
  `output_tokens` INT NOT NULL COMMENT '输出 tokens',
  `cost_amount` DECIMAL(12,6) NOT NULL COMMENT '费用（元）',
  `cost_ms` INT NOT NULL COMMENT '耗时（毫秒）',
  `result` TINYINT NOT NULL COMMENT '1 成功 0 失败',
  `error_type` VARCHAR(32) NULL COMMENT '超时/限流/内容安全/解析失败/模型异常',
  `error_msg` VARCHAR(1024) NULL COMMENT '错误信息',
  `input_digest` VARCHAR(2048) NULL COMMENT '输入摘要（脱敏）',
  `output_digest` VARCHAR(2048) NULL COMMENT '输出摘要（脱敏）',
  `prompt_version` INT NULL COMMENT 'Prompt 版本',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_time (create_time),
  KEY idx_tenant_scene (tenant_id, scene),
  KEY idx_result (result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 调用日志';

DROP TABLE IF EXISTS `ai_task`;
CREATE TABLE `ai_task` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `task_no` VARCHAR(64) NOT NULL COMMENT '任务号',
  `scene` VARCHAR(64) NOT NULL COMMENT '场景',
  `task_title` VARCHAR(255) NOT NULL COMMENT '任务标题',
  `creator_id` BIGINT NULL COMMENT '发起人',
  `creator_name` VARCHAR(64) NULL COMMENT '发起人姓名',
  `task_status` VARCHAR(16) NOT NULL COMMENT 'running 进行中/success 已完成/failed 失败/reviewing 待复核',
  `elapsed_sec` INT NULL COMMENT '耗时（秒）',
  `tokens` INT NULL COMMENT 'token 消耗',
  `output_count` INT NULL COMMENT '产物数量',
  `biz_type` VARCHAR(32) NULL COMMENT '业务类型',
  `biz_id` BIGINT NULL COMMENT '业务对象 ID',
  `params_json` JSON NULL COMMENT '入参快照',
  `result_json` JSON NULL COMMENT '结果摘要',
  `error_msg` VARCHAR(1024) NULL COMMENT '失败原因',
  `started_at` DATETIME NULL COMMENT '开始时间',
  `finished_at` DATETIME NULL COMMENT '结束时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_task_no (task_no),
  KEY idx_status (task_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 任务';

DROP TABLE IF EXISTS `ai_artifact_review`;
CREATE TABLE `ai_artifact_review` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `artifact_kind` VARCHAR(16) NOT NULL COMMENT '题目/试卷/讲义/课件/批改/画像',
  `artifact_id` BIGINT NULL COMMENT '产物 ID',
  `artifact_title` VARCHAR(255) NOT NULL COMMENT '产物标题',
  `scene` VARCHAR(64) NULL COMMENT '生成场景',
  `model_key` VARCHAR(64) NULL COMMENT '生成模型',
  `review_status` VARCHAR(16) NOT NULL COMMENT 'pending 待复核/approved 已通过/rejected 已驳回',
  `auto_check` VARCHAR(16) NOT NULL COMMENT 'pass/warn/error',
  `auto_check_note` VARCHAR(1024) NULL COMMENT '自动质检结论',
  `ai_labeled` TINYINT NOT NULL COMMENT '是否已加 AI 标识',
  `reviewer_id` BIGINT NULL COMMENT '复核人',
  `reviewer_name` VARCHAR(64) NULL COMMENT '复核人姓名',
  `reviewed_at` DATETIME NULL COMMENT '复核时间',
  `review_note` VARCHAR(1024) NULL COMMENT '复核意见',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (review_status),
  KEY idx_kind (artifact_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 产物复核';

DROP TABLE IF EXISTS `ai_quality_eval`;
CREATE TABLE `ai_quality_eval` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `scene` VARCHAR(64) NOT NULL COMMENT '场景',
  `model_key` VARCHAR(64) NULL COMMENT '模型',
  `dataset_name` VARCHAR(128) NOT NULL COMMENT '评测集名称',
  `sample_count` INT NOT NULL COMMENT '样本数',
  `score_accuracy` DECIMAL(5,2) NULL COMMENT '事实准确率',
  `score_completeness` DECIMAL(5,2) NULL COMMENT '信息完整度',
  `score_grade_fit` DECIMAL(5,2) NULL COMMENT '年级适配度',
  `score_safety` DECIMAL(5,2) NULL COMMENT '内容安全分',
  `overall_score` DECIMAL(5,2) NULL COMMENT '综合分',
  `delta` DECIMAL(5,2) NULL COMMENT '较上一轮变化',
  `ran_at` DATETIME NOT NULL COMMENT '评测时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scene_time (scene, ran_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 质量评测';

DROP TABLE IF EXISTS `ai_trace`;
CREATE TABLE `ai_trace` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `trace_id` VARCHAR(64) NOT NULL COMMENT '链路 ID',
  `scene` VARCHAR(64) NOT NULL COMMENT '场景',
  `model_key` VARCHAR(64) NULL COMMENT '模型',
  `artifact_kind` VARCHAR(32) NULL COMMENT '产物类型',
  `artifact_id` BIGINT NULL COMMENT '产物 ID',
  `artifact_title` VARCHAR(255) NULL COMMENT '产物标题',
  `input_digest` VARCHAR(2048) NULL COMMENT '输入摘要（脱敏）',
  `safety_result` VARCHAR(16) NOT NULL COMMENT 'pass/masked/blocked',
  `prompt_version` INT NULL COMMENT 'Prompt 版本',
  `knowledge_version` VARCHAR(32) NULL COMMENT '知识库版本',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 生成留痕';

DROP TABLE IF EXISTS `ai_billing_rule`;
CREATE TABLE `ai_billing_rule` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `scene` VARCHAR(64) NOT NULL COMMENT '场景',
  `model_key` VARCHAR(64) NOT NULL COMMENT '模型',
  `billing_unit` VARCHAR(16) NOT NULL COMMENT 'call 按次 / 1k-token 按千 token',
  `price` DECIMAL(10,4) NOT NULL COMMENT '单价（元）',
  `currency` VARCHAR(8) NOT NULL COMMENT '币种（CNY）',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `effective_from` DATETIME NULL COMMENT '生效时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scene (scene, model_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 计费规则';

DROP TABLE IF EXISTS `ai_quota_account`;
CREATE TABLE `ai_quota_account` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `account_type` VARCHAR(16) NOT NULL COMMENT 'gift 赠送/recharge 充值/monthly 月度套餐额度',
  `total_amount` DECIMAL(12,2) NOT NULL COMMENT '总额度（元）',
  `used_amount` DECIMAL(12,2) NOT NULL COMMENT '已用（元）',
  `frozen_amount` DECIMAL(12,2) NOT NULL COMMENT '冻结（元）',
  `expire_time` DATETIME NULL COMMENT '过期时间',
  `account_status` VARCHAR(16) NOT NULL COMMENT 'active 有效/expired 已过期/frozen 已冻结',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_tenant (tenant_id, account_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 额度账户';

DROP TABLE IF EXISTS `ai_quota_flow`;
CREATE TABLE `ai_quota_flow` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `account_id` BIGINT NOT NULL COMMENT '账户 ID',
  `flow_type` VARCHAR(16) NOT NULL COMMENT 'recharge 充值/gift 赠送/consume 消费/freeze 冻结/unfreeze 解冻/refund 退回/expire 过期',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '变动金额（元，正负）',
  `balance_after` DECIMAL(12,2) NOT NULL COMMENT '变动后余额',
  `biz_type` VARCHAR(32) NULL COMMENT '业务类型',
  `biz_id` BIGINT NULL COMMENT '业务 ID',
  `remark` VARCHAR(255) NULL COMMENT '说明',
  `occur_time` DATETIME NOT NULL COMMENT '发生时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_account_time (account_id, occur_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 额度流水';

DROP TABLE IF EXISTS `ai_tenant_switch`;
CREATE TABLE `ai_tenant_switch` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `capability_key` VARCHAR(64) NOT NULL COMMENT '能力键：aiGenerate/aiVariant/aiPhoto/aiPaper/aiLecture/aiCourseware/aiGrading/aiProfile/aiChat',
  `capability_label` VARCHAR(64) NOT NULL COMMENT '能力名称',
  `enabled` TINYINT NOT NULL COMMENT '是否开启',
  `month_cost` DECIMAL(12,2) NOT NULL COMMENT '本月用量（元）',
  `quota_left` DECIMAL(12,2) NOT NULL COMMENT '剩余额度（元）',
  `trial_quota` DECIMAL(12,2) NULL COMMENT '体验额度（元）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_tenant_cap (tenant_id, capability_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='租户 AI 能力开关';

DROP TABLE IF EXISTS `ai_sensitive_policy`;
CREATE TABLE `ai_sensitive_policy` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `policy_name` VARCHAR(128) NOT NULL COMMENT '策略名称',
  `policy_action` VARCHAR(16) NOT NULL COMMENT '命中动作：block 拒答/human 转人工/mask 替换脱敏',
  `scope` VARCHAR(64) NOT NULL COMMENT '适用场景：学生问答/教师助手/出题/全部',
  `words_json` JSON NULL COMMENT '词库',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `hits_30d` INT NOT NULL COMMENT '近 30 天命中次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scope (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='内容安全策略';

DROP TABLE IF EXISTS `ai_knowledge_doc`;
CREATE TABLE `ai_knowledge_doc` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_name` VARCHAR(255) NOT NULL COMMENT '文档名称',
  `subject` VARCHAR(32) NULL COMMENT '学科',
  `doc_type` VARCHAR(32) NOT NULL COMMENT '类型：教材/课标/考纲/错题语料',
  `version_no` VARCHAR(32) NULL COMMENT '教材或课标版本',
  `file_url` VARCHAR(512) NULL COMMENT '文件地址',
  `chunk_count` INT NOT NULL COMMENT '切片数',
  `vector_status` VARCHAR(16) NOT NULL COMMENT 'pending 待向量化/indexing 向量化中/ready 已就绪/failed 失败',
  `namespace` VARCHAR(64) NULL COMMENT '向量库命名空间（按学科/租户隔离）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='AI 知识库文档';

DROP TABLE IF EXISTS `c_public_question`;
CREATE TABLE `c_public_question` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `question_type` VARCHAR(32) NOT NULL COMMENT '题型',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `difficulty` VARCHAR(16) NULL COMMENT '难度',
  `knowledge_json` JSON NULL COMMENT '知识点',
  `stem` LONGTEXT NOT NULL COMMENT '题干',
  `answer` LONGTEXT NULL COMMENT '答案',
  `analysis` LONGTEXT NULL COMMENT '解析',
  `content_status` VARCHAR(16) NOT NULL COMMENT 'draft 草稿/pending 待审/published 已上架/rejected 已驳回/offline 已下架',
  `quality_grade` VARCHAR(4) NULL COMMENT '质量分级 A/B/C',
  `content_source` VARCHAR(64) NULL COMMENT '来源：真题/教辅/投稿/AI 生成',
  `ref_count` INT NOT NULL COMMENT '被租户引用次数',
  `ai_status` VARCHAR(32) NULL COMMENT 'AI 质检状态',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject_status (subject, content_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='公共题库题目';

DROP TABLE IF EXISTS `c_public_paper`;
CREATE TABLE `c_public_paper` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `paper_name` VARCHAR(255) NOT NULL COMMENT '试卷名称',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `grade` VARCHAR(32) NOT NULL COMMENT '年级',
  `question_count` INT NOT NULL COMMENT '题量',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '总分',
  `paper_source` VARCHAR(64) NULL COMMENT '来源：真题/教辅/投稿',
  `content_status` VARCHAR(16) NOT NULL COMMENT 'draft/pending/published/rejected/offline',
  `ref_count` INT NOT NULL COMMENT '引用次数',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_subject_status (subject, content_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='公共试卷';

DROP TABLE IF EXISTS `c_content_distribution`;
CREATE TABLE `c_content_distribution` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `content_type` VARCHAR(16) NOT NULL COMMENT '题目/试卷/教辅/素材',
  `content_id` BIGINT NULL COMMENT '内容 ID',
  `content_name` VARCHAR(255) NOT NULL COMMENT '内容名称',
  `scope_type` VARCHAR(16) NOT NULL COMMENT 'all 全部租户/package 指定套餐/tenant 指定租户',
  `scope_value` JSON NULL COMMENT '范围值（套餐 ID 或租户 ID 列表）',
  `tenant_count` INT NOT NULL COMMENT '授权租户数',
  `dist_status` VARCHAR(16) NOT NULL COMMENT 'syncing 同步中/synced 已同步/paused 已暂停',
  `synced_at` DATETIME NULL COMMENT '最近同步时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_type (content_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='内容分发授权';

DROP TABLE IF EXISTS `c_compliance_check`;
CREATE TABLE `c_compliance_check` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `check_title` VARCHAR(255) NOT NULL COMMENT '抽检任务名称',
  `check_scope` VARCHAR(255) NULL COMMENT '抽检范围',
  `sample_count` INT NOT NULL COMMENT '抽检数量',
  `flagged_count` INT NOT NULL COMMENT 'AI 命中疑似问题数',
  `confirmed_count` INT NOT NULL COMMENT '人工确认违规数',
  `check_status` VARCHAR(16) NOT NULL COMMENT 'running 进行中/done 已完成/closed 已关闭',
  `samples_json` JSON NULL COMMENT '命中样例（内容名/原因/风险等级）',
  `finished_at` DATETIME NULL COMMENT '完成时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status (check_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='内容合规抽检';

DROP TABLE IF EXISTS `c_feedback_ticket`;
CREATE TABLE `c_feedback_ticket` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `ticket_title` VARCHAR(255) NOT NULL COMMENT '工单标题',
  `content_type` VARCHAR(32) NULL COMMENT '内容类型',
  `content_id` BIGINT NULL COMMENT '内容 ID',
  `content_name` VARCHAR(255) NULL COMMENT '内容名称',
  `reporter_id` BIGINT NULL COMMENT '反馈人',
  `reporter_name` VARCHAR(64) NULL COMMENT '反馈人姓名',
  `tenant_name` VARCHAR(128) NULL COMMENT '所属机构',
  `ticket_kind` VARCHAR(32) NOT NULL COMMENT '问题类型：内容错误/版权争议/敏感内容/其他',
  `priority` VARCHAR(16) NOT NULL COMMENT 'high/normal/low',
  `ticket_status` VARCHAR(16) NOT NULL COMMENT 'open 待处理/processing 处理中/resolved 已解决/rejected 已驳回',
  `resolved_at` DATETIME NULL COMMENT '解决时间',
  `reply` VARCHAR(2048) NULL COMMENT '处理回复',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_status_priority (ticket_status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='内容问题反馈工单';

DROP TABLE IF EXISTS `c_review_record`;
CREATE TABLE `c_review_record` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `object_type` VARCHAR(32) NOT NULL COMMENT '对象类型',
  `object_id` BIGINT NOT NULL COMMENT '对象 ID',
  `object_name` VARCHAR(255) NULL COMMENT '对象名称',
  `agent_passed` INT NULL COMMENT 'AI 通过项数',
  `agent_total` INT NULL COMMENT 'AI 检查项总数',
  `auto_fixed` INT NULL COMMENT '自动修正项数',
  `reviewer_id` BIGINT NULL COMMENT '审核人',
  `reviewer_name` VARCHAR(64) NULL COMMENT '审核人姓名',
  `conclusion` VARCHAR(32) NULL COMMENT '结论：通过/驳回/待议',
  `timeline_json` JSON NULL COMMENT '审核过程时间线',
  `reviewed_at` DATETIME NULL COMMENT '审核时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_object (object_type, object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='内容审核记录';

DROP TABLE IF EXISTS `sys_sso_client`;
CREATE TABLE `sys_sso_client` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `name` VARCHAR(64) NOT NULL COMMENT '系统编码（全局唯一，大写）',
  `cn_name` VARCHAR(100) NOT NULL COMMENT '系统名称',
  `sys_type` VARCHAR(16) NOT NULL COMMENT '类型：research 教研 / academic 教务 / third 第三方',
  `sso_type` VARCHAR(16) NOT NULL COMMENT '接入方式：oauth2 / cas / saml / custom',
  `auth_url` VARCHAR(500) NULL COMMENT '授权地址',
  `token_url` VARCHAR(500) NULL COMMENT '换取令牌地址',
  `userinfo_url` VARCHAR(500) NULL COMMENT '获取用户信息地址',
  `redirect_uri` VARCHAR(500) NOT NULL COMMENT '回调地址（白名单校验）',
  `app_key` VARCHAR(64) NULL COMMENT '应用标识',
  `app_secret_cipher` VARCHAR(255) NULL COMMENT '应用密钥（加密存储，展示仅末 4 位）',
  `secret_update_time` DATETIME NULL COMMENT '密钥最近轮换时间',
  `ticket_ttl` INT NOT NULL COMMENT '一次性票据有效期（秒），默认 60',
  `enabled` TINYINT NOT NULL COMMENT '是否启用：1 启用 / 0 停用',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_name (name),
  KEY idx_type (sys_type, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='外部系统接入（SSO）';

DROP TABLE IF EXISTS `sys_user_ext_map`;
CREATE TABLE `sys_user_ext_map` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `client_id` BIGINT NOT NULL COMMENT '所属外部系统ID（sys_sso_client.id）',
  `ext_user_id` VARCHAR(128) NOT NULL COMMENT '外部系统用户唯一标识',
  `ext_user_name` VARCHAR(100) NULL COMMENT '外部系统用户显示名',
  `ext_dept_id` VARCHAR(128) NULL COMMENT '外部系统部门ID',
  `user_id` BIGINT NULL COMMENT '本平台用户ID（未确认时为空）',
  `match_status` VARCHAR(16) NOT NULL COMMENT '匹配状态：auto 自动 / manual 人工绑定 / pending 待确认 / conflict 冲突',
  `match_type` VARCHAR(16) NULL COMMENT '匹配依据：phone 手机号 / name 姓名 / manual 人工',
  `bind_time` DATETIME NULL COMMENT '绑定时间',
  `bind_by` BIGINT NULL COMMENT '绑定操作人',
  `remark` VARCHAR(255) NULL COMMENT '备注（冲突说明等）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_client_ext (client_id, ext_user_id),
  KEY idx_user (tenant_id, user_id),
  KEY idx_status (match_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='外部账号映射';

DROP TABLE IF EXISTS `sys_org_sync_log`;
CREATE TABLE `sys_org_sync_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `client_id` BIGINT NOT NULL COMMENT '所属外部系统ID',
  `batch_no` VARCHAR(64) NOT NULL COMMENT '批次号',
  `sync_type` VARCHAR(16) NOT NULL COMMENT '同步类型：full 全量 / incr 增量',
  `sync_direction` VARCHAR(16) NOT NULL COMMENT '方向：inbound 外部→本平台 / outbound 本平台→外部',
  `start_time` DATETIME NOT NULL COMMENT '开始时间',
  `end_time` DATETIME NULL COMMENT '结束时间',
  `total_count` INT NOT NULL COMMENT '处理总数',
  `success_count` INT NOT NULL COMMENT '成功数',
  `fail_count` INT NOT NULL COMMENT '失败数',
  `status` VARCHAR(16) NOT NULL COMMENT '状态：running / success / partial 部分失败 / failed',
  `fail_detail` TEXT NULL COMMENT '失败明细（脱敏后）',
  `operator` VARCHAR(64) NULL COMMENT '触发人（定时任务为 system）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_client_time (client_id, start_time),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='组织架构同步日志';

DROP TABLE IF EXISTS `r_scan_device`;
CREATE TABLE `r_scan_device` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `device_name` VARCHAR(100) NOT NULL COMMENT '设备名称',
  `device_type` VARCHAR(24) NOT NULL COMMENT '类型：twain 扫描仪 / wia 扫描仪 / document_camera 高拍仪',
  `connect_type` VARCHAR(16) NOT NULL COMMENT '连接方式：usb / wifi / lan',
  `device_sn` VARCHAR(64) NULL COMMENT '设备序列号',
  `model` VARCHAR(64) NULL COMMENT '型号',
  `owner_type` VARCHAR(16) NOT NULL COMMENT '归属类型：org 机构 / personal 个人',
  `owner_id` BIGINT NULL COMMENT '归属对象ID（个人设备存用户ID）',
  `dpi` INT NOT NULL COMMENT '默认分辨率（默认 300）',
  `color_mode` VARCHAR(16) NOT NULL COMMENT '色彩模式：color / gray / bw',
  `duplex` TINYINT NOT NULL COMMENT '是否双面：1 是 / 0 否',
  `auto_feed` TINYINT NOT NULL COMMENT '是否自动进纸',
  `last_use_time` DATETIME NULL COMMENT '最近使用时间',
  `use_count` INT NOT NULL COMMENT '累计使用次数',
  `status` VARCHAR(16) NOT NULL COMMENT '状态：online 在线 / offline 离线 / disabled 停用',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_owner (tenant_id, owner_type, owner_id),
  KEY idx_type (device_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='外接扫描设备';

DROP TABLE IF EXISTS `t_doc_layout_style`;
CREATE TABLE `t_doc_layout_style` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `name` VARCHAR(100) NOT NULL COMMENT '样式包名称',
  `doc_type` VARCHAR(16) NOT NULL COMMENT '适用文档类型：plan 教案 / guide 学案 / lecture 讲义 / courseware 课件 / paper 试卷',
  `scope` VARCHAR(16) NOT NULL COMMENT '范围：personal 我的 / org 机构',
  `style_json` JSON NOT NULL COMMENT '样式定义（标题 1~4、正文、引用、表格、行距、段距、页边距、分栏）',
  `source` VARCHAR(16) NOT NULL COMMENT '来源：manual 手工 / ai AI 生成',
  `is_default` TINYINT NOT NULL COMMENT '是否该类型默认样式包',
  `enabled` TINYINT NOT NULL COMMENT '是否启用',
  `use_count` INT NOT NULL COMMENT '使用次数',
  `creator_name` VARCHAR(64) NULL COMMENT '创建人显示名（便于机构内识别）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_scope (tenant_id, scope, doc_type),
  KEY idx_default (tenant_id, doc_type, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='排版样式包';

DROP TABLE IF EXISTS `t_doc_collab_session`;
CREATE TABLE `t_doc_collab_session` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `doc_id` BIGINT NOT NULL COMMENT '文档ID（t_teach_doc.id）',
  `doc_type` VARCHAR(16) NOT NULL COMMENT '文档类型：plan / guide / lecture / courseware',
  `session_no` VARCHAR(64) NOT NULL COMMENT '会话号',
  `owner_id` BIGINT NOT NULL COMMENT '主编辑用户ID',
  `lock_mode` VARCHAR(16) NOT NULL COMMENT '协同模式：exclusive 锁编辑（他人只读）/ coedit 实时协同',
  `status` VARCHAR(16) NOT NULL COMMENT '状态：active 进行中 / archived 已归档 / closed 已关闭',
  `start_time` DATETIME NOT NULL COMMENT '开始时间',
  `end_time` DATETIME NULL COMMENT '结束时间',
  `member_count` INT NOT NULL COMMENT '参与人数',
  `op_count` INT NOT NULL COMMENT '操作总数',
  `snapshot_count` INT NOT NULL COMMENT '快照数',
  `last_active_time` DATETIME NULL COMMENT '最近活跃时间',
  `archive_doc_version` INT NULL COMMENT '归档时对应文档版本号',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_session_no (session_no),
  KEY idx_doc (tenant_id, doc_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='协同编辑会话';

DROP TABLE IF EXISTS `t_doc_collab_member`;
CREATE TABLE `t_doc_collab_member` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '会话ID',
  `user_id` BIGINT NOT NULL COMMENT '成员用户ID',
  `collab_role` VARCHAR(16) NOT NULL COMMENT '角色：owner 主编辑 / editor 协作者 / commenter 评论者',
  `scope_desc` VARCHAR(255) NULL COMMENT '可编辑范围说明（协作者可限章节）',
  `cursor_color` VARCHAR(16) NULL COMMENT '光标颜色（前端分配）',
  `online_flag` TINYINT NOT NULL COMMENT '是否在线',
  `join_time` DATETIME NOT NULL COMMENT '加入时间',
  `leave_time` DATETIME NULL COMMENT '离开时间',
  `last_active_time` DATETIME NULL COMMENT '最近活跃时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_session_user (tenant_id, session_id, user_id),
  KEY idx_user (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='协同成员';

DROP TABLE IF EXISTS `t_doc_collab_op`;
CREATE TABLE `t_doc_collab_op` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `session_id` BIGINT NOT NULL COMMENT '会话ID',
  `seq_no` BIGINT NOT NULL COMMENT '会话内自增序号（重放依据）',
  `user_id` BIGINT NOT NULL COMMENT '操作人',
  `op_type` VARCHAR(24) NOT NULL COMMENT '操作类型：insert / delete / format / move / comment / snapshot',
  `block_id` VARCHAR(64) NULL COMMENT '块ID（块级操作时必填）',
  `target_version` INT NULL COMMENT '基于的文档版本',
  `op_payload` JSON NULL COMMENT '操作载荷（差异内容、前后值）',
  `client_ts` DATETIME NULL COMMENT '客户端时间（冲突判断用）',
  `server_ts` DATETIME NOT NULL COMMENT '服务端落库时间',
  `conflict_flag` TINYINT NOT NULL COMMENT '是否命中冲突',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_session_seq (tenant_id, session_id, seq_no),
  KEY idx_user_time (tenant_id, user_id, server_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='协同操作流水';

DROP TABLE IF EXISTS `e_answer_sheet`;
CREATE TABLE `e_answer_sheet` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `exam_session_id` BIGINT NOT NULL COMMENT '考试场次ID',
  `student_id` BIGINT NOT NULL COMMENT '学生ID',
  `class_id` BIGINT NULL COMMENT '班级ID',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `source` VARCHAR(24) NOT NULL COMMENT '来源：parent_upload 家长上传 / teacher_scan 教师扫描 / teacher_manual 教师代传',
  `upload_by_type` VARCHAR(16) NOT NULL COMMENT '上传人类型：parent / teacher',
  `upload_by_id` BIGINT NOT NULL COMMENT '上传人ID',
  `page_count` INT NOT NULL COMMENT '页数',
  `recognize_status` VARCHAR(16) NOT NULL COMMENT '识别状态：uploaded / processing / success / failed',
  `match_type` VARCHAR(16) NULL COMMENT '身份匹配方式：qrcode 二维码 / ocr 识别 / manual 人工',
  `match_confidence` DECIMAL(5,2) NULL COMMENT '匹配置信度 0~100',
  `claim_status` VARCHAR(16) NOT NULL COMMENT '归属状态：matched 已匹配 / unclaimed 待认领 / claimed 已认领',
  `score` DECIMAL(6,2) NULL COMMENT '答卷总分',
  `score_status` VARCHAR(16) NOT NULL COMMENT '判分状态：pending / scored / confirmed',
  `recall_status` VARCHAR(16) NOT NULL COMMENT '回传状态：pending / success / retry / failed',
  `late_flag` TINYINT NOT NULL COMMENT '是否迟交',
  `upload_time` DATETIME NOT NULL COMMENT '上传时间',
  `fail_reason` VARCHAR(255) NULL COMMENT '失败原因',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_session_student (tenant_id, exam_session_id, student_id),
  KEY idx_claim (tenant_id, claim_status),
  KEY idx_recall (tenant_id, recall_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='答卷影像';

DROP TABLE IF EXISTS `e_answer_sheet_page`;
CREATE TABLE `e_answer_sheet_page` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `sheet_id` BIGINT NOT NULL COMMENT '答卷ID（e_answer_sheet.id）',
  `page_no` INT NOT NULL COMMENT '页码（从 1 开始）',
  `file_id` BIGINT NULL COMMENT '文件ID（r_file.id）',
  `image_url` VARCHAR(500) NULL COMMENT '影像地址（私有桶 Key，不存公网直链）',
  `width` INT NULL COMMENT '像素宽',
  `height` INT NULL COMMENT '像素高',
  `quality_score` DECIMAL(5,2) NULL COMMENT '质量分 0~100（模糊/缺角/反光检测）',
  `quality_issue` VARCHAR(255) NULL COMMENT '质量问题说明',
  `question_map` JSON NULL COMMENT '题号与作答区域坐标映射',
  `ocr_text` LONGTEXT NULL COMMENT '整页 OCR 文本（脱敏后，仅供检索与复核）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_sheet_page (tenant_id, sheet_id, page_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='答卷页';

DROP TABLE IF EXISTS `e_score_recall`;
CREATE TABLE `e_score_recall` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `exam_session_id` BIGINT NOT NULL COMMENT '考试场次ID',
  `student_id` BIGINT NOT NULL COMMENT '学生ID',
  `subject` VARCHAR(32) NOT NULL COMMENT '学科',
  `sheet_id` BIGINT NULL COMMENT '关联答卷ID',
  `score` DECIMAL(6,2) NOT NULL COMMENT '本次回传分数',
  `full_score` DECIMAL(6,2) NOT NULL COMMENT '该科满分',
  `idem_key` VARCHAR(128) NOT NULL COMMENT '幂等键：场次ID+学生ID+学科+版本号',
  `recall_status` VARCHAR(16) NOT NULL COMMENT '状态：pending / success / retry / failed',
  `recall_times` INT NOT NULL COMMENT '回传尝试次数',
  `recall_time` DATETIME NULL COMMENT '最近回传时间',
  `ext_exam_id` VARCHAR(64) NULL COMMENT '教务系统考试ID',
  `ext_student_id` VARCHAR(64) NULL COMMENT '教务系统学生ID',
  `ext_score_id` VARCHAR(64) NULL COMMENT '教务系统成绩记录ID',
  `diff_flag` TINYINT NOT NULL COMMENT '是否与已回传分数存在差异（>10 分）',
  `confirm_required` TINYINT NOT NULL COMMENT '是否需要二次确认',
  `operator` VARCHAR(64) NULL COMMENT '确认人',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_idem (tenant_id, idem_key),
  KEY idx_session_subject (tenant_id, exam_session_id, subject),
  KEY idx_status (recall_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='成绩回传';

DROP TABLE IF EXISTS `e_score_recall_log`;
CREATE TABLE `e_score_recall_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `recall_id` BIGINT NOT NULL COMMENT '回传记录ID',
  `action` VARCHAR(24) NOT NULL COMMENT '动作：submit 提交 / retry 重试 / manual 手动重推',
  `request_body` TEXT NULL COMMENT '请求报文（脱敏）',
  `response_body` TEXT NULL COMMENT '响应报文',
  `http_status` INT NULL COMMENT 'HTTP 状态码',
  `cost_ms` INT NULL COMMENT '耗时（毫秒）',
  `result` VARCHAR(16) NOT NULL COMMENT '结果：success / fail',
  `error_code` VARCHAR(64) NULL COMMENT '错误码',
  `error_msg` VARCHAR(500) NULL COMMENT '错误信息',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_recall (tenant_id, recall_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='成绩回传日志';

DROP TABLE IF EXISTS `g_parent_account`;
CREATE TABLE `g_parent_account` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `phone_cipher` VARCHAR(255) NOT NULL COMMENT '手机号（加密存储）',
  `phone_hash` VARCHAR(64) NOT NULL COMMENT '手机号哈希（用于唯一索引与查询，避免明文索引）',
  `phone_mask` VARCHAR(20) NOT NULL COMMENT '脱敏手机号（138****8888，列表展示用）',
  `nickname` VARCHAR(50) NULL COMMENT '昵称',
  `avatar` VARCHAR(255) NULL COMMENT '头像地址',
  `wx_openid` VARCHAR(64) NULL COMMENT '微信 openid（小程序/H5 内）',
  `wx_unionid` VARCHAR(64) NULL COMMENT '微信 unionid',
  `status` VARCHAR(16) NOT NULL COMMENT '状态：active 正常 / disabled 停用 / cancelled 已注销',
  `register_source` VARCHAR(16) NOT NULL COMMENT '注册来源：h5 / miniprogram',
  `last_login_time` DATETIME NULL COMMENT '最近登录时间',
  `last_login_ip` VARCHAR(64) NULL COMMENT '最近登录 IP',
  `last_login_region` VARCHAR(64) NULL COMMENT '最近登录归属地',
  `fail_count` INT NOT NULL COMMENT '连续验证码失败次数',
  `lock_until` DATETIME NULL COMMENT '锁定到期时间',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_phone_hash (phone_hash),
  KEY idx_wx (wx_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='家长账号';

DROP TABLE IF EXISTS `g_parent_student`;
CREATE TABLE `g_parent_student` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NOT NULL COMMENT '家长账号ID',
  `student_id` BIGINT NOT NULL COMMENT '学生ID（e_student.id）',
  `class_id` BIGINT NULL COMMENT '班级ID（冗余，便于按班统计）',
  `relation` VARCHAR(16) NOT NULL COMMENT '关系：father 父 / mother 母 / grandparent 祖辈 / other 其他',
  `bind_status` VARCHAR(16) NOT NULL COMMENT '状态：pending 待审核 / granted 已通过 / rejected 已驳回 / revoked 已解除',
  `bind_code` VARCHAR(16) NULL COMMENT '绑定码（6 位，用后失效）',
  `apply_time` DATETIME NOT NULL COMMENT '申请时间',
  `audit_by` BIGINT NULL COMMENT '审核人',
  `audit_time` DATETIME NULL COMMENT '审核时间',
  `audit_remark` VARCHAR(255) NULL COMMENT '审核意见（驳回必填）',
  `consent_status` VARCHAR(16) NOT NULL COMMENT '监护人同意：none 未同意 / granted 已同意 / revoked 已撤回',
  `consent_time` DATETIME NULL COMMENT '同意时间',
  `is_primary` TINYINT NOT NULL COMMENT '是否主监护人',
  `revoke_reason` VARCHAR(255) NULL COMMENT '解除原因',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_parent_student (tenant_id, parent_id, student_id),
  KEY idx_student (tenant_id, student_id, bind_status),
  KEY idx_parent (parent_id, bind_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='监护关系';

DROP TABLE IF EXISTS `g_parent_login_log`;
CREATE TABLE `g_parent_login_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NULL COMMENT '家长账号ID（未注册成功时为空）',
  `login_type` VARCHAR(16) NOT NULL COMMENT '登录方式：sms 验证码 / wechat 微信 / password 密码',
  `phone_mask` VARCHAR(20) NULL COMMENT '脱敏手机号',
  `ip` VARCHAR(64) NULL COMMENT 'IP',
  `region` VARCHAR(64) NULL COMMENT '归属地',
  `device` VARCHAR(64) NULL COMMENT '设备型号',
  `ua` VARCHAR(255) NULL COMMENT 'User-Agent',
  `result` VARCHAR(16) NOT NULL COMMENT '结果：success / fail',
  `fail_reason` VARCHAR(255) NULL COMMENT '失败原因',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_parent_time (parent_id, create_time),
  KEY idx_result (result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='家长登录日志';

DROP TABLE IF EXISTS `g_share_link`;
CREATE TABLE `g_share_link` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `share_token` VARCHAR(64) NOT NULL COMMENT '随机令牌（≥32 位，不可枚举）',
  `target_type` VARCHAR(16) NOT NULL COMMENT '分享对象：paper 试卷 / report 学情报告 / homework 作业',
  `target_id` BIGINT NOT NULL COMMENT '对象ID',
  `target_version` VARCHAR(32) NULL COMMENT '对象版本（改版后旧分享失效）',
  `share_type` VARCHAR(16) NOT NULL COMMENT '形态：online 在线页 / image 图片 / pdf 文档 / print 打印件',
  `parent_id` BIGINT NOT NULL COMMENT '接收家长ID',
  `student_id` BIGINT NOT NULL COMMENT '接收学生ID',
  `class_id` BIGINT NULL COMMENT '班级ID',
  `file_id` BIGINT NULL COMMENT '生成物文件ID（图片/PDF）',
  `expire_time` DATETIME NOT NULL COMMENT '失效时间',
  `allow_answer` TINYINT NOT NULL COMMENT '是否对家长可见答案与解析',
  `watermark_text` VARCHAR(255) NULL COMMENT '水印文案（机构名+学生姓名+用途）',
  `access_count` INT NOT NULL COMMENT '访问次数',
  `last_access_time` DATETIME NULL COMMENT '最近访问时间',
  `status` VARCHAR(16) NOT NULL COMMENT '状态：valid 有效 / expired 已过期 / revoked 已撤销',
  `remark` VARCHAR(255) NULL COMMENT '备注',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_token (share_token),
  KEY idx_target (tenant_id, target_type, target_id),
  KEY idx_parent (tenant_id, parent_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='分享链接';

DROP TABLE IF EXISTS `g_share_access_log`;
CREATE TABLE `g_share_access_log` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `share_id` BIGINT NOT NULL COMMENT '分享记录ID',
  `parent_id` BIGINT NOT NULL COMMENT '家长账号ID',
  `action` VARCHAR(16) NOT NULL COMMENT '动作：view 查看 / save 保存 / print 打印 / download 下载',
  `ip` VARCHAR(64) NULL COMMENT 'IP',
  `region` VARCHAR(64) NULL COMMENT '归属地',
  `ua` VARCHAR(255) NULL COMMENT 'User-Agent',
  `duration_ms` INT NULL COMMENT '停留时长（毫秒）',
  `result` VARCHAR(16) NOT NULL COMMENT '结果：success / blocked 被拦截',
  `block_reason` VARCHAR(255) NULL COMMENT '拦截原因（如访问过于频繁）',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_share_time (tenant_id, share_id, create_time),
  KEY idx_parent_time (tenant_id, parent_id, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='分享访问日志';

DROP TABLE IF EXISTS `g_notify_setting`;
CREATE TABLE `g_notify_setting` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `parent_id` BIGINT NOT NULL COMMENT '家长账号ID',
  `notify_type` VARCHAR(24) NOT NULL COMMENT '类型：homework 作业提醒 / report 报告送达 / score 成绩更新 / notice 系统公告 / security 账号安全',
  `inapp_enabled` TINYINT NOT NULL COMMENT '站内是否接收（公告与安全类强制开启）',
  `push_enabled` TINYINT NOT NULL COMMENT 'App 推送是否接收',
  `sms_enabled` TINYINT NOT NULL COMMENT '短信是否接收',
  `wechat_enabled` TINYINT NOT NULL COMMENT '微信模板消息是否接收',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY uk_parent_type (parent_id, notify_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='家长通知偏好';

DROP TABLE IF EXISTS `g_report_push`;
CREATE TABLE `g_report_push` (
  `id` BIGINT NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id` BIGINT NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为0',
  `report_no` VARCHAR(64) NOT NULL COMMENT '报告编号',
  `report_type` VARCHAR(16) NOT NULL COMMENT '类型：enrollment 入学 / midterm 期中 / final 期末 / custom 自定义周期',
  `student_id` BIGINT NOT NULL COMMENT '学生ID',
  `parent_id` BIGINT NULL COMMENT '接收家长ID（未绑定时为空）',
  `class_id` BIGINT NULL COMMENT '班级ID',
  `period` VARCHAR(32) NOT NULL COMMENT '报告周期（如 2026 学年第一学期）',
  `batch_no` VARCHAR(64) NULL COMMENT '生成批次号',
  `pdf_file_id` BIGINT NULL COMMENT 'PDF 文件ID',
  `image_file_id` BIGINT NULL COMMENT '长图文件ID',
  `push_status` VARCHAR(16) NOT NULL COMMENT '推送状态：pending 待推送 / sent 已发送 / delivered 已送达 / read 已读 / failed 失败',
  `push_time` DATETIME NULL COMMENT '推送时间',
  `read_time` DATETIME NULL COMMENT '首次打开时间',
  `fail_reason` VARCHAR(255) NULL COMMENT '失败原因（如未绑定家长）',
  `gen_by` BIGINT NULL COMMENT '生成人',
  `create_by` BIGINT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by` BIGINT NULL COMMENT '修改人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标识：0正常 1已删除',
  PRIMARY KEY (`id`),
  KEY idx_student_type (tenant_id, student_id, report_type),
  KEY idx_batch (tenant_id, batch_no),
  KEY idx_status (push_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学情报告推送';

SET FOREIGN_KEY_CHECKS = 1;