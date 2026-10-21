-- =============================================================
-- 05_sys_user_unify_columns.sql
-- 纠正 sys_user 的「双列合并」设计：重复字段一律以框架字段为准，
-- 仅补齐业务设计里框架没有的字段。
--
-- 背景
--   单库接管时，为让框架代码（username/password/realname/del_flag）
--   与业务设计（account/password_hash/real_name/deleted）各用自己
--   的列名读写同一行，曾采用「双列 + 双向同步触发器」方案。
--   经核查：业务侧 Java 代码与 Mapper 实际全部使用框架字段名，
--   双列纯属冗余，且带来数据分叉风险。本脚本予以纠正。
--
-- 处理原则
--   1) 语义重复的列 → 只保留框架列，删掉业务列
--        username   ← account
--        password   ← password_hash
--        realname   ← real_name
--        sign       ← intro
--        del_flag   ← deleted
--        last_pwd_update_time ← pwd_update_time
--   2) 框架没有的业务列 → 全部保留（tenant_id / user_type / nick_name /
--        avatar_hue / campus_id / default_subject / mfa_enabled /
--        last_login_at / last_login_ip）
--   3) status 收敛为框架语义：1 正常，2 冻结
--        业务 0 停用  → 2 冻结
--        业务 1 启用  → 1 正常
--        业务 2 锁定  → 2 冻结
--   4) 删掉两个同步触发器
--
-- 执行前备份：db/backup/20261021_sys_user_before_unify.sql
-- 回滚：mysql -uroot -p jiaoyu-ai < db/backup/20261021_sys_user_before_unify.sql
--
-- 本脚本幂等，可重复执行。
-- =============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS `sp_unify_sys_user`;
DELIMITER $$
CREATE PROCEDURE `sp_unify_sys_user`()
BEGIN
    DECLARE v_db VARCHAR(64) DEFAULT DATABASE();

    -- ---------- 1. 触发器先卸掉，否则删列时会被引用 ----------
    DROP TRIGGER IF EXISTS `trg_sys_user_bi`;
    DROP TRIGGER IF EXISTS `trg_sys_user_bu`;

    -- ---------- 2. 把业务列的值收进框架列（业务列存在才做） ----------
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'account') THEN
        UPDATE `sys_user` SET
            `username`   = COALESCE(`username`, `account`),
            `password`   = COALESCE(`password`, `password_hash`),
            `realname`   = COALESCE(`realname`, `real_name`),
            `sign`       = COALESCE(`sign`, LEFT(`intro`, 500)),
            `last_pwd_update_time` = COALESCE(`last_pwd_update_time`, `pwd_update_time`),
            `del_flag`   = IF(`deleted` >= 1, 1, `del_flag`),
            -- 业务 0停用/2锁定 → 框架 2冻结；业务 1启用 → 框架 1正常
            `status`     = IF(`status` = 1, 1, 2);
    END IF;

    -- ---------- 3. 索引：去掉挂在业务列上的，改挂框架列 ----------
    IF EXISTS (SELECT 1 FROM information_schema.statistics
                WHERE table_schema = v_db AND table_name = 'sys_user' AND index_name = 'idx_account') THEN
        ALTER TABLE `sys_user` DROP INDEX `idx_account`;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.statistics
                WHERE table_schema = v_db AND table_name = 'sys_user' AND index_name = 'uk_tenant_account') THEN
        ALTER TABLE `sys_user` DROP INDEX `uk_tenant_account`;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
                    WHERE table_schema = v_db AND table_name = 'sys_user' AND index_name = 'uk_tenant_username') THEN
        ALTER TABLE `sys_user` ADD UNIQUE KEY `uk_tenant_username` (`tenant_id`, `username`);
    END IF;

    -- ---------- 4. 删除 6 个语义重复的业务列 ----------
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'account') THEN
        ALTER TABLE `sys_user` DROP COLUMN `account`;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'password_hash') THEN
        ALTER TABLE `sys_user` DROP COLUMN `password_hash`;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'real_name') THEN
        ALTER TABLE `sys_user` DROP COLUMN `real_name`;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'intro') THEN
        ALTER TABLE `sys_user` DROP COLUMN `intro`;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'deleted') THEN
        ALTER TABLE `sys_user` DROP COLUMN `deleted`;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = v_db AND table_name = 'sys_user' AND column_name = 'pwd_update_time') THEN
        ALTER TABLE `sys_user` DROP COLUMN `pwd_update_time`;
    END IF;

    -- ---------- 5. 补注释，说明框架语义 ----------
    ALTER TABLE `sys_user` MODIFY COLUMN `status` TINYINT NOT NULL DEFAULT 1
        COMMENT '状态：1正常 2冻结（业务停用/锁定统一收敛为2）';
END$$
DELIMITER ;

CALL `sp_unify_sys_user`();
DROP PROCEDURE IF EXISTS `sp_unify_sys_user`;

SET FOREIGN_KEY_CHECKS = 1;
