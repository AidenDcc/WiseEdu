-- =============================================================
-- jiaoyu-ai 单库接管：冲突表数据迁移（从 jeecg-boot → jiaoyu-ai）
-- -------------------------------------------------------------
-- 前置：已执行 01_merge_conflict_tables.sql（6 张冲突表已建好）
-- 说明：重复字段一律以框架列为准，业务列已不再存在，故单列搬运；
--       框架没有的业务列按 01 的默认值补齐。跨库用 `库名`.`表名`。
-- 幂等性：先 TRUNCATE 目标表再插入
--
-- ⚠️ 本脚本会 TRUNCATE 目标表，只在「全新构建」时使用。
--    已有业务数据的库请勿执行（会清空 mock 数据）。
-- =============================================================
SET NAMES utf8mb4;

-- -------------------------------------------------------------
-- 1. sys_user
--    重复字段以框架为准，原样搬运框架列；
--    仅补 tenant_id / user_type 两个业务独有列
--    （account/password_hash/real_name/intro/deleted/pwd_update_time 已删）
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_user`;
INSERT INTO `sys_user`
(`id`,`tenant_id`,`user_type`,`username`,`realname`,`password`,`salt`,`avatar`,`phone`,`email`,
 `sign`,`status`,`del_flag`,`org_code`,`birthday`,`sex`,`third_id`,`third_type`,
 `activiti_sync`,`work_no`,`telephone`,`user_identity`,`depart_ids`,`client_id`,`login_tenant_id`,
 `bpm_status`,`sign_enable`,`main_dep_post_id`,`position_type`,`last_pwd_update_time`,`sort`,
 `iz_hide_contact`,`create_by`,`create_time`,`update_by`,`update_time`)
SELECT
  s.`id`,
  CASE WHEN s.`username` = 'cdqz_admin' THEN 1002 ELSE 0 END            AS tenant_id,
  CASE WHEN s.`username` = 'cdqz_admin' THEN 1 ELSE 0 END              AS user_type,
  s.`username`, s.`realname`, s.`password`, s.`salt`, s.`avatar`, s.`phone`, s.`email`,
  s.`sign`, IFNULL(s.`status`, 1), IFNULL(s.`del_flag`, 0),
  s.`org_code`, s.`birthday`, s.`sex`, s.`third_id`, s.`third_type`,
  s.`activiti_sync`, s.`work_no`, s.`telephone`, s.`user_identity`,
  s.`depart_ids`, s.`client_id`, s.`login_tenant_id`, s.`bpm_status`, s.`sign_enable`,
  s.`main_dep_post_id`, s.`position_type`, s.`last_pwd_update_time`, s.`sort`, s.`iz_hide_contact`,
  s.`create_by`, IFNULL(s.`create_time`, NOW()), s.`update_by`, IFNULL(s.`update_time`, NOW())
FROM `jeecg-boot`.`sys_user` s;

-- -------------------------------------------------------------
-- 2. sys_tenant
--    框架列原样搬运（name / end_date / company_logo / del_flag）；
--    业务独有列补默认值。
--    status 语义映射：框架 1正常→业务 2正式；0冻结→4已禁用
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_tenant`;
INSERT INTO `sys_tenant`
(`id`,`tenant_id`,`tenant_code`,`short_name`,`logo_hue`,`tenant_type`,`stage_scope`,`status`,`package_id`,
 `trial_end_time`,`contact_name`,`contact_phone`,`contact_email`,`province`,`city`,`address`,`intro`,
 `isolation_type`,`storage_region`,`ai_used`,`storage_used_gb`,`disable_reason`,`open_time`,
 `create_by`,`create_time`,`update_by`,`update_time`,
 `name`,`begin_date`,`end_date`,`trade`,`company_size`,`company_address`,`company_logo`,
 `house_number`,`work_place`,`secondary_domain`,`login_bkgd_img`,`position`,`department`,
 `del_flag`,`apply_status`)
SELECT
  t.`id`,
  0                                                                     AS tenant_id,
  CONCAT('T', t.`id`)                                                   AS tenant_code,
  NULL                                                                  AS short_name,
  NULL                                                                  AS logo_hue,
  '学校'                                                                AS tenant_type,
  NULL                                                                  AS stage_scope,
  CASE WHEN IFNULL(t.`status`, 1) = 1 THEN 2 ELSE 4 END                  AS status,
  0                                                                     AS package_id,
  NULL                                                                  AS trial_end_time,
  ''                                                                    AS contact_name,
  ''                                                                    AS contact_phone,
  NULL                                                                  AS contact_email,
  NULL                                                                  AS province,
  NULL                                                                  AS city,
  NULL                                                                  AS address,
  NULL                                                                  AS intro,
  1                                                                     AS isolation_type,
  NULL                                                                  AS storage_region,
  0                                                                     AS ai_used,
  0                                                                     AS storage_used_gb,
  NULL                                                                  AS disable_reason,
  NULL                                                                  AS open_time,
  t.`create_by`, IFNULL(t.`create_time`, NOW()), t.`update_by`, IFNULL(t.`update_time`, NOW()),
  t.`name`, t.`begin_date`, t.`end_date`, t.`trade`, t.`company_size`, t.`company_address`, t.`company_logo`,
  t.`house_number`, t.`work_place`, t.`secondary_domain`, t.`login_bkgd_img`, t.`position`, t.`department`,
  IFNULL(t.`del_flag`, 0), t.`apply_status`
FROM `jeecg-boot`.`sys_tenant` t;

-- -------------------------------------------------------------
-- 3. sys_role
--    框架 description 原样搬运（原 role_desc 已删）；
--    builtin / locked / data_scope / enabled / sort_no / deleted 为业务补充列
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_role`;
INSERT INTO `sys_role`
(`id`,`tenant_id`,`role_code`,`role_name`,`builtin`,`locked`,`data_scope`,`enabled`,`sort_no`,
 `create_by`,`create_time`,`update_by`,`update_time`,`deleted`,`description`)
SELECT
  r.`id`, IFNULL(r.`tenant_id`, 0), r.`role_code`, r.`role_name`,
  IF(r.`role_code` IN ('admin','zuhuadmin'), 1, 0)                       AS builtin,
  IF(r.`role_code` IN ('admin','zuhuadmin'), 1, 0)                       AS locked,
  1                                                                     AS data_scope,
  1                                                                     AS enabled,
  0                                                                     AS sort_no,
  r.`create_by`, IFNULL(r.`create_time`, NOW()), r.`update_by`, IFNULL(r.`update_time`, NOW()),
  0                                                                     AS deleted,
  r.`description`
FROM `jeecg-boot`.`sys_role` r;

-- -------------------------------------------------------------
-- 4. sys_user_role（结构对等，直接搬运）
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_user_role`;
INSERT INTO `sys_user_role` (`id`,`tenant_id`,`user_id`,`role_id`,`create_time`,`update_time`,`deleted`)
SELECT `id`, IFNULL(`tenant_id`, 0), `user_id`, `role_id`, NOW(), NOW(), 0
FROM `jeecg-boot`.`sys_user_role`;

-- -------------------------------------------------------------
-- 5. sys_dict_item
--    框架 item_text / item_value / sort_order / status 原样搬运；
--    dict_type 由 sys_dict.dict_code 反查补齐（业务侧按字符串键取字典）；
--    其余为业务补充列。
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_dict_item`;
INSERT INTO `sys_dict_item`
(`id`,`tenant_id`,`dict_type`,`parent_id`,`ref_count`,`stage`,`school_year`,`term_half`,`date_from`,
 `date_to`,`answer_type`,`coefficient`,`question_category`,`stages`,`subjects`,`grades`,`paper_category`,
 `ext_json`,`create_by`,`create_time`,`update_by`,`update_time`,`deleted`,
 `dict_id`,`item_text`,`item_value`,`item_color`,`description`,`sort_order`,`status`)
SELECT
  i.`id`,
  0                                                                     AS tenant_id,
  d.`dict_code`                                                         AS dict_type,
  NULL                                                                  AS parent_id,
  0                                                                     AS ref_count,
  NULL                                                                  AS stage,
  NULL                                                                  AS school_year,
  NULL                                                                  AS term_half,
  NULL                                                                  AS date_from,
  NULL                                                                  AS date_to,
  NULL                                                                  AS answer_type,
  NULL                                                                  AS coefficient,
  NULL                                                                  AS question_category,
  NULL                                                                  AS stages,
  NULL                                                                  AS subjects,
  NULL                                                                  AS grades,
  NULL                                                                  AS paper_category,
  NULL                                                                  AS ext_json,
  i.`create_by`, IFNULL(i.`create_time`, NOW()), i.`update_by`, IFNULL(i.`update_time`, NOW()),
  0                                                                     AS deleted,
  i.`dict_id`, i.`item_text`, i.`item_value`, i.`item_color`, i.`description`,
  IFNULL(i.`sort_order`, 0), IFNULL(i.`status`, 1)
FROM `jeecg-boot`.`sys_dict_item` i
LEFT JOIN `jeecg-boot`.`sys_dict` d ON d.`id` = i.`dict_id`;

-- -------------------------------------------------------------
-- 6. sys_role_permission：框架 permission_id 语义原样保留
--    （业务 module_key/op_key 由后续业务数据填充，此处留空）
-- -------------------------------------------------------------
TRUNCATE TABLE `sys_role_permission`;
INSERT INTO `sys_role_permission`
(`id`,`tenant_id`,`role_id`,`module_key`,`op_key`,`create_time`,`update_time`,`deleted`,
 `permission_id`,`data_rule_ids`,`operate_date`,`operate_ip`)
SELECT `id`, 0, `role_id`, NULL, NULL, NOW(), NOW(), 0,
       `permission_id`, `data_rule_ids`, `operate_date`, `operate_ip`
FROM `jeecg-boot`.`sys_role_permission`;

-- -------------------------------------------------------------
-- 校验
-- -------------------------------------------------------------
SELECT 'sys_user' AS t, COUNT(*) AS c FROM `sys_user`
UNION ALL SELECT 'sys_tenant', COUNT(*) FROM `sys_tenant`
UNION ALL SELECT 'sys_role', COUNT(*) FROM `sys_role`
UNION ALL SELECT 'sys_user_role', COUNT(*) FROM `sys_user_role`
UNION ALL SELECT 'sys_dict_item', COUNT(*) FROM `sys_dict_item`
UNION ALL SELECT 'sys_role_permission', COUNT(*) FROM `sys_role_permission`;
