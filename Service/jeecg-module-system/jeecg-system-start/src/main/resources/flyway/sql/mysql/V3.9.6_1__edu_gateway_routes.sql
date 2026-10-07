-- ---author:教学云---date:20261006-----for:教学云网关路由：/admin/** 转 edu-platform、/tenant/** 转 edu-tenant，并把 /auth/** 并入 jeecg-system 路由。
--
-- 背景（不要改成改 Nacos 配置）：
--   网关当前 data-type: database，DynamicRouteLoader.init() 走的是 loadRoutesByRedis()，路由真实来源是 MySQL 表
--   sys_gateway_route，由 jeecg-system 启动时灌进 Redis（key GATEWAY_ROUTES）。Nacos 上那条 jeecg-gateway-router.json
--   是迁移残留，改它无效。
--
-- predicates 格式必须是字符串数组形式 {"args":["/x/**"],"name":"Path"}，与表中现有行一致；
-- 不要写成 Nacos 那种 {"_genkey_0":"/x/**"} 对象形式，后者路由不生效。
--
-- 生效顺序：先起 jeecg-system（它灌 Redis，但自身不发刷新消息）→ 再起网关；网关若已在跑，重启网关即可。
--
-- 注意 strip_prefix：GlobalAccessTokenFilter 虽写了“剥离首段”，但 RouteToRequestUrlFilter(order 10000) 会用原始 URI
-- 覆盖该属性，实际不剥离。故业务 Controller 的 @RequestMapping 必须自带 /admin、/tenant 前缀。

-- 1. 把 /auth/** 并入 jeecg-system 既有路由（教学云登录/会话接口由 jeecg-system-biz 的 EduAuthController 提供）
UPDATE `sys_gateway_route`
SET `predicates` = '[{"args":["/sys/**","/online/**","/bigscreen/**","/jmreport/**","/druid/**","/generic/**","/actuator/**","/drag/**","/oauth2/**","/defa/**","/demo/**","/jimubi/**","/airag/**","/openapi/**","/auth/**"],"name":"Path"}]'
WHERE `id` = 'jeecg-system';

-- 2. 平台端 / 机构端两条新路由。
--    uri 列 varchar(32)，'lb://edu-platform'(17) 与 'lb://edu-tenant'(15) 都放得下。
--    status=1 才是有效路由：DynamicRouteLoader 会把 status=0 的路由从网关删除。
--    先 DELETE 保证脚本可重复执行。
DELETE FROM `sys_gateway_route` WHERE `id` IN ('edu-platform', 'edu-tenant');

INSERT INTO `sys_gateway_route` (`id`, `router_id`, `name`, `uri`, `predicates`, `filters`, `retryable`, `strip_prefix`, `persistable`, `show_api`, `status`, `create_by`, `create_time`, `update_by`, `update_time`, `sys_org_code`, `del_flag`)
VALUES ('edu-platform', 'edu-platform', 'edu-platform', 'lb://edu-platform', '[{"args":["/admin/**"],"name":"Path"}]', '[]', NULL, NULL, NULL, NULL, 1, 'admin', NOW(), NULL, NULL, NULL, 0);

INSERT INTO `sys_gateway_route` (`id`, `router_id`, `name`, `uri`, `predicates`, `filters`, `retryable`, `strip_prefix`, `persistable`, `show_api`, `status`, `create_by`, `create_time`, `update_by`, `update_time`, `sys_org_code`, `del_flag`)
VALUES ('edu-tenant', 'edu-tenant', 'edu-tenant', 'lb://edu-tenant', '[{"args":["/tenant/**"],"name":"Path"}]', '[]', NULL, NULL, NULL, NULL, 1, 'admin', NOW(), NULL, NULL, NULL, 0);
