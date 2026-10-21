-- =============================================================
-- jiaoyu-ai 单库接管：冲突表同步触发器（已全部退役）
-- -------------------------------------------------------------
-- 历史背景
--   单库接管初期曾用 8 个 BEFORE INSERT / BEFORE UPDATE 触发器，
--   让框架代码（username/password/realname/del_flag/description）
--   与业务代码（account/password_hash/real_name/deleted/role_desc）
--   各用自己习惯的列名读写同一行 —— 即「双列方案」。
--
-- 2026-10-21 纠偏
--   6 张冲突表已全部改为「重复字段以框架为准 + 补齐业务独有字段」的
--   单列结构，双写前提消失，触发器全部退役：
--
--     sys_user        account / password_hash / real_name / intro /
--                     deleted / pwd_update_time              → 已删
--     sys_tenant      tenant_name / expire_time / logo_url /
--                     deleted                                → 已删
--     sys_role        role_desc                              → 已删
--     sys_dict_item   item_name / item_code / sort_no /
--                     enabled                                → 已删
--     sys_user_role        无重复列（仅结构并集），本来就没有触发器
--     sys_role_permission  同上
--
-- 本脚本保留为「历史清理」用途
--   在旧的 jiaoyu-ai 库上重跑，可确保残留触发器被摘干净。
--   全新构建时 db/01_merge_conflict_tables.sql 直接建出单列结构，
--   跑本脚本只会执行 8 条 DROP IF EXISTS（幂等、无副作用）。
-- =============================================================
SET NAMES utf8mb4;

DROP TRIGGER IF EXISTS `trg_sys_user_bi`;
DROP TRIGGER IF EXISTS `trg_sys_user_bu`;

DROP TRIGGER IF EXISTS `trg_sys_tenant_bi`;
DROP TRIGGER IF EXISTS `trg_sys_tenant_bu`;

DROP TRIGGER IF EXISTS `trg_sys_role_bi`;
DROP TRIGGER IF EXISTS `trg_sys_role_bu`;

DROP TRIGGER IF EXISTS `trg_sys_dict_item_bi`;
DROP TRIGGER IF EXISTS `trg_sys_dict_item_bu`;
