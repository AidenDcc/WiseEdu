-- =============================================================
-- 06_unify_remaining_conflict_tables.sql
-- 继续按「重复字段以框架为准」收敛剩余 3 张冲突表：
--   sys_tenant / sys_role / sys_dict_item
--
-- 前置依据（已核查）：
--   * 这些业务列名在 Java / Mapper 中零引用
--     （`sort_no` 的 10 处均属 sys_permission.sort_no，与本表无关）
--   * 框架实体 SysTenant / SysRole / SysDictItem 全部映射框架列
--     （name / endDate / companyLogo / delFlag；description；
--       itemText / itemValue / sortOrder / status）
--   * 数据量极小，最长值 14 / 38 / 25 字符，远小于目标列宽度
--
-- 收敛映射（框架列 ← 业务列）：
--   sys_tenant      name         ← tenant_name
--                   end_date     ← expire_time
--                   company_logo ← logo_url
--                   del_flag     ← deleted
--   sys_role        description  ← role_desc
--   sys_dict_item   item_text    ← item_name
--                   item_value   ← item_code
--                   sort_order   ← sort_no
--                   status       ← enabled
--
-- 值合并口径（不丢信息）：
--   * 一律「目标列为空才用业务列补」，不覆盖已有框架值
--   * sys_role.description 例外：业务 role_desc 更完整
--     （"机构角色：管理员" vs "管理员"），用 role_desc 覆盖
--   * sys_dict_item.status 例外：2 行 enabled=0 但 status=1，
--     取 enabled，保住"停用"语义
--
-- 执行前备份：db/backup/20261021_unify_rest_before.sql
-- 本脚本幂等，可重复执行。
-- =============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS `sp_unify_rest`;
DELIMITER $$
CREATE PROCEDURE `sp_unify_rest`()
BEGIN
    DECLARE v_db VARCHAR(64) DEFAULT DATABASE();

    -- ---------- 0. 先摘掉三张表的同步触发器 ----------
    DROP TRIGGER IF EXISTS `trg_sys_tenant_bi`;
    DROP TRIGGER IF EXISTS `trg_sys_tenant_bu`;
    DROP TRIGGER IF EXISTS `trg_sys_role_bi`;
    DROP TRIGGER IF EXISTS `trg_sys_role_bu`;
    DROP TRIGGER IF EXISTS `trg_sys_dict_item_bi`;
    DROP TRIGGER IF EXISTS `trg_sys_dict_item_bu`;

    -- ================= 1. sys_tenant =================
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_tenant' AND column_name = 'tenant_name') THEN

        -- 放宽目标列，避免搬值截断（tenant_name 128→name，logo_url 512→company_logo）
        ALTER TABLE `sys_tenant` MODIFY COLUMN `name` VARCHAR(128) NULL
            COMMENT '租户名称（业务 tenant_name 已并入此列）';
        ALTER TABLE `sys_tenant` MODIFY COLUMN `company_logo` VARCHAR(512) NULL
            COMMENT '租户 LOGO（业务 logo_url 已并入此列）';

        UPDATE `sys_tenant` SET
            `name`         = COALESCE(NULLIF(`name`, ''), `tenant_name`),
            `end_date`     = COALESCE(`end_date`, `expire_time`),
            `company_logo` = COALESCE(`company_logo`, `logo_url`),
            `del_flag`     = IF(`deleted` >= 1, 1, `del_flag`);

        -- 索引挂在 expire_time 上，改挂 end_date
        IF EXISTS (SELECT 1 FROM information_schema.statistics
                    WHERE table_schema = v_db AND table_name = 'sys_tenant' AND index_name = 'idx_status') THEN
            ALTER TABLE `sys_tenant` DROP INDEX `idx_status`;
        END IF;
        ALTER TABLE `sys_tenant` ADD KEY `idx_status` (`status`, `end_date`);

        ALTER TABLE `sys_tenant`
            DROP COLUMN `tenant_name`,
            DROP COLUMN `expire_time`,
            DROP COLUMN `logo_url`,
            DROP COLUMN `deleted`;
    END IF;

    -- ================= 2. sys_role =================
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_role' AND column_name = 'role_desc') THEN
        -- role_desc 信息更完整，覆盖 description
        UPDATE `sys_role`
           SET `description` = COALESCE(NULLIF(`role_desc`, ''), `description`);

        ALTER TABLE `sys_role` DROP COLUMN `role_desc`;
    END IF;

    -- ================= 3. sys_dict_item =================
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_dict_item' AND column_name = 'item_name') THEN

        ALTER TABLE `sys_dict_item` MODIFY COLUMN `item_text` VARCHAR(128) NULL
            COMMENT '字典项文本（业务 item_name 已并入此列）';

        UPDATE `sys_dict_item` SET
            `item_text`  = COALESCE(`item_text`, `item_name`),
            `item_value` = COALESCE(`item_value`, `item_code`),
            `sort_order` = COALESCE(`sort_order`, `sort_no`),
            -- enabled 是业务侧权威开关（含 2 行停用），覆盖框架 status
            `status`     = `enabled`;

        IF EXISTS (SELECT 1 FROM information_schema.statistics
                    WHERE table_schema = v_db AND table_name = 'sys_dict_item' AND index_name = 'idx_type_sort') THEN
            ALTER TABLE `sys_dict_item` DROP INDEX `idx_type_sort`;
        END IF;
        ALTER TABLE `sys_dict_item` ADD KEY `idx_type_sort` (`dict_type`, `sort_order`);

        ALTER TABLE `sys_dict_item`
            DROP COLUMN `item_name`,
            DROP COLUMN `item_code`,
            DROP COLUMN `sort_no`,
            DROP COLUMN `enabled`;
    END IF;
END$$
DELIMITER ;

CALL `sp_unify_rest`();
DROP PROCEDURE IF EXISTS `sp_unify_rest`;

SET FOREIGN_KEY_CHECKS = 1;
