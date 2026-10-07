-- ---author:教学云---date:20261006-----for:教学云平台端菜单与按钮权限（Wave 1 部分：工作台）。
--
-- ID 分配约定（后续各期脚本必须遵守，否则 sys_permission.id 会撞车）：
--   '2026' + '1006'（本批日期） + 4 位序号，共 20 位，沿用框架 V3.9.5_1 的 '2026091100000000001' 风格。
--   本文件占用   2026100600000000001 ~ 2026100600000000049
--   Wave 2 预留  2026100600000000050 ~ 2026100600000000099
--   Wave 3 预留  2026100600000000100 ~ 2026100600000000149
--   Wave 4 预留  2026100600000000150 ~ 2026100600000000199
--   sys_role_permission.id 用同段号 + 500，即 2026100600000000501 起。
--
-- 权限点何时该建：与 @RequiresPermissions 注解同批落地。先建权限行、后写 Controller 会留下 gate 不住任何东西的死数据；
-- 先写注解、后建权限行会让非超管的平台账号 403。本文件只覆盖 Wave 1 已上线的接口。
--
-- 说明：教学云前端（apps/admin、apps/tenant）有各自的 src/menu.ts，不读 sys_permission 渲染菜单；
-- 这里的数据是给框架自带管理端展示用，以及给“系统管理·租户菜单”（Wave 2）做权限包分发的基础。

-- 1. 顶级目录：教学云
DELETE FROM `sys_role_permission` WHERE `permission_id` IN ('2026100600000000001', '2026100600000000002', '2026100600000000003');
DELETE FROM `sys_permission` WHERE `id` IN ('2026100600000000001', '2026100600000000002', '2026100600000000003');

INSERT INTO `sys_permission` (`id`, `parent_id`, `name`, `url`, `component`, `is_route`, `component_name`, `redirect`, `menu_type`, `perms`, `perms_type`, `sort_no`, `always_show`, `icon`, `is_leaf`, `keep_alive`, `hidden`, `hide_tab`, `description`, `create_by`, `create_time`, `update_by`, `update_time`, `del_flag`, `rule_flag`, `status`, `internal_or_external`) VALUES ('2026100600000000001', NULL, '教学云', '/edu', 'layouts/RouteView', 1, NULL, NULL, 0, NULL, '1', 10.00, 0, 'ant-design:cloud-outlined', 0, 0, 0, 0, '教学云平台端业务入口', 'admin', '2026-10-06 10:00:00', NULL, NULL, 0, 0, '1', 0);

-- 2. 菜单：工作台
INSERT INTO `sys_permission` (`id`, `parent_id`, `name`, `url`, `component`, `is_route`, `component_name`, `redirect`, `menu_type`, `perms`, `perms_type`, `sort_no`, `always_show`, `icon`, `is_leaf`, `keep_alive`, `hidden`, `hide_tab`, `description`, `create_by`, `create_time`, `update_by`, `update_time`, `del_flag`, `rule_flag`, `status`, `internal_or_external`) VALUES ('2026100600000000002', '2026100600000000001', '工作台', '/edu/dashboard', 'edu/platform/DashboardView', 1, 'EduDashboard', NULL, 1, NULL, '1', 1.00, 1, 'ant-design:dashboard-outlined', 1, 1, 0, 0, '平台端工作台 FR-PT-001~004', 'admin', '2026-10-06 10:00:00', NULL, NULL, 0, 0, '1', 0);

-- 3. 按钮：查看工作台概览
INSERT INTO `sys_permission` (`id`, `parent_id`, `name`, `url`, `component`, `is_route`, `component_name`, `redirect`, `menu_type`, `perms`, `perms_type`, `sort_no`, `always_show`, `icon`, `is_leaf`, `keep_alive`, `hidden`, `hide_tab`, `description`, `create_by`, `create_time`, `update_by`, `update_time`, `del_flag`, `rule_flag`, `status`, `internal_or_external`) VALUES ('2026100600000000003', '2026100600000000002', '查看工作台概览', NULL, NULL, 0, NULL, NULL, 2, 'edu:dashboard:overview', '1', NULL, 0, NULL, 1, 0, 0, 0, NULL, 'admin', '2026-10-06 10:00:00', NULL, NULL, 0, 0, '1', 0);

-- 4. 授权给系统管理员角色（admin 角色的 role_code，与 V3.9.5_1 用同一个 role_id）
INSERT INTO `sys_role_permission` (`id`, `role_id`, `permission_id`, `data_rule_ids`, `operate_date`, `operate_ip`) VALUES ('2026100600000000501', 'f6817f48af4fb3af11b9e8bf182f618b', '2026100600000000001', NULL, '2026-10-06 10:00:00', '127.0.0.1');
INSERT INTO `sys_role_permission` (`id`, `role_id`, `permission_id`, `data_rule_ids`, `operate_date`, `operate_ip`) VALUES ('2026100600000000502', 'f6817f48af4fb3af11b9e8bf182f618b', '2026100600000000002', NULL, '2026-10-06 10:00:00', '127.0.0.1');
INSERT INTO `sys_role_permission` (`id`, `role_id`, `permission_id`, `data_rule_ids`, `operate_date`, `operate_ip`) VALUES ('2026100600000000503', 'f6817f48af4fb3af11b9e8bf182f618b', '2026100600000000003', NULL, '2026-10-06 10:00:00', '127.0.0.1');
