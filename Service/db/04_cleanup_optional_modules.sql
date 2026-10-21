-- =============================================================
-- 04_cleanup_optional_modules.sql
-- 下线 JeecgBoot 自带示例数据与 4 个可选模块（onl / jimu / airag / chat2bi）
--
-- 背景：jiaoyu-ai 单库接管时从 jeecg-boot 复制了 136 张框架表，
--       其中大量是框架自带的演示数据与可选模块，与教学云业务无关。
--       本脚本把它们连同对应菜单一起清掉，只保留框架运行底线。
--
-- 备份（执行前务必确认存在）：
--   db/backup/20261021_drop_82_tables.sql   —— 82 张表的结构 + 数据
--   db/backup/20261021_drop_menus.sql       —— sys_permission / sys_role_permission / sys_table_white_list
--
-- 回滚：
--   mysql -uroot -p jiaoyu-ai < db/backup/20261021_drop_82_tables.sql
--   mysql -uroot -p jiaoyu-ai < db/backup/20261021_drop_menus.sql
--
-- 保留不动的框架表（见 doc/05 第 6.0 节）：sys_* 核心 37 张 + qrtz_* 11 张
--   + open_api* 4 张 + Flyway + oss_file + oauth2_registered_client
-- =============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;


-- ---------- JeecgBoot 官方示例 / 演示数据：24 张 ----------
DROP TABLE IF EXISTS
  `aigc_word_template`, `demo`, `ins_claim`, `ins_customer`,
  `ins_policy`, `jeecg_order_customer`, `jeecg_order_main`, `jeecg_order_ticket`,
  `joa_demo`, `rep_demo_dxtj`, `rep_demo_employee`, `rep_demo_gongsi`,
  `rep_demo_jianpiao`, `rep_demo_order_main`, `rep_demo_order_product`, `test_demo`,
  `test_enhance_select`, `test_note`, `test_online_link`, `test_order_customer`,
  `test_order_main`, `test_order_product`, `test_person`, `test_shoptype_tree`;

-- ---------- 在线开发 Online（代码生成器）：26 张 ----------
DROP TABLE IF EXISTS
  `onl_auth_data`, `onl_auth_page`, `onl_auth_relation`, `onl_cgform_button`,
  `onl_cgform_enhance_java`, `onl_cgform_enhance_js`, `onl_cgform_enhance_sql`, `onl_cgform_field`,
  `onl_cgform_head`, `onl_cgform_index`, `onl_cgreport_head`, `onl_cgreport_item`,
  `onl_cgreport_param`, `onl_drag_comp`, `onl_drag_dataset_head`, `onl_drag_dataset_item`,
  `onl_drag_dataset_param`, `onl_drag_page`, `onl_drag_page_comp`, `onl_drag_share`,
  `onl_drag_table_relation`, `onl_graphreport_head`, `onl_graphreport_item`, `onl_graphreport_params`,
  `onl_graphreport_templet`, `onl_graphreport_templet_item`;

-- ---------- 积木报表 JimuReport：16 张 ----------
DROP TABLE IF EXISTS
  `jimu_dict`, `jimu_dict_item`, `jimu_report`, `jimu_report_category`,
  `jimu_report_data_source`, `jimu_report_db`, `jimu_report_db_field`, `jimu_report_db_param`,
  `jimu_report_export_job`, `jimu_report_export_log`, `jimu_report_ext_data`, `jimu_report_icon_lib`,
  `jimu_report_link`, `jimu_report_map`, `jimu_report_share`, `jimu_report_sheet`;

-- ---------- AI 知识库 / RAG（airag）：7 张（airag_flow 必须保留，见文末说明） ----------
-- airag_flow 是 LiteFlow 的流程规则表：框架的 jeecg-aiflow-boot4 通过
-- config/application-liteflow.yml 配置 chainTableName=airag_flow，
-- 且 airag 的 flow service 强依赖 FlowExecutor（@Autowired required=true），
-- 删表或 liteflow.enable=false 都会导致 "APPLICATION FAILED TO START"。
-- 因此保留该表结构、清空数据即可（0 条 rule 时 LiteFlow 正常空跑）。
DROP TABLE IF EXISTS
  `airag_app`, `airag_ext_data`, `airag_knowledge`,
  `airag_knowledge_doc`, `airag_mcp`, `airag_model`, `airag_prompts`;
TRUNCATE TABLE `airag_flow`;

-- ---------- Chat2BI 对话式 BI：8 张 ----------
DROP TABLE IF EXISTS
  `chat2bi_assistant`, `chat2bi_conversation`, `chat2bi_domain`, `chat2bi_message`,
  `chat2bi_table`, `chat2bi_table_meta`, `chat2bi_term`, `chat2bi_topic`;

-- 合计删除 81 张表 + 清空 airag_flow（LiteFlow 规则表，结构必须保留）

-- ---------- 软删除对应菜单（del_flag=1，可回滚） ----------
-- 两条整分支：「低代码开发」（含 Online 全套页面与按钮级权限）
--             「AI应用平台」（含 AI工具箱 / 提示词管理 / 积木 ChatBI）
DROP TEMPORARY TABLE IF EXISTS `tmp_menu_del`;
CREATE TEMPORARY TABLE `tmp_menu_del` (`id` VARCHAR(32) PRIMARY KEY);

INSERT IGNORE INTO `tmp_menu_del`
WITH RECURSIVE `t` AS (
    SELECT `id` FROM `sys_permission`
     WHERE `id` IN ('1455100420297859074', '1892553163993931777') AND `del_flag` = 0
    UNION ALL
    SELECT p.`id` FROM `sys_permission` p JOIN `t` ON p.`parent_id` = `t`.`id`
     WHERE p.`del_flag` = 0
)
SELECT `id` FROM `t`;

-- 「统计报表」下依赖 onl_/jimu_/onl_drag_ 的示例页（该父菜单还有别的子项，只摘这几个）
INSERT IGNORE INTO `tmp_menu_del` (`id`) VALUES
  ('1580833876002627585'),   -- Online报表例子
  ('1580834045490257922'),   -- Online表单例子
  ('1580835899477483522'),   -- 积木报表例子
  ('1580878668472504321'),   -- 积木大屏案例
  ('1590154870697734146'),   -- 带参数报表
  ('1804046424930480129'),   -- 仪表盘集成示例
  ('ca784c27782b4bd1b1fe98627f8afcaf');  -- Online图表示例

UPDATE `sys_permission` SET `del_flag` = 1 WHERE `id` IN (SELECT `id` FROM `tmp_menu_del`);

-- 清掉这些菜单的角色授权，避免残留孤儿授权
DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM `tmp_menu_del`);

-- ---------- 清多租户表白名单里的已删表 ----------
DELETE FROM `sys_table_white_list` WHERE `table_name` IN (
  'airag_flow','airag_knowledge','airag_model','airag_prompts','demo',
  'onl_cgform_head','onl_cgreport_head','onl_drag_comp','onl_graphreport_head','test_shoptype_tree'
);

DROP TEMPORARY TABLE IF EXISTS `tmp_menu_del`;
SET FOREIGN_KEY_CHECKS = 1;
