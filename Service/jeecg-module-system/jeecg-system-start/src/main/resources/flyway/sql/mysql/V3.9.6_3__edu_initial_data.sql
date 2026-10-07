-- ---author:教学云---date:20261006-----for:教学云初始数据：默认套餐、存量租户扩展补录、机构端隔离验证样本数据。
--
-- 为什么本文件不含全局字典（subject/grade/term/questionType/difficulty/examType/competition/region/copyright）：
--   这些字典项各自带有类型特有字段 —— 年级的 stage、学期的 year/dateFrom/dateTo、难度的 coefficient、
--   题型的 answerType/subjects、考试类型的 paperCategory。承载这些字段的 edu_dict_item_ext 属于 Wave 2
--   （对应平台端“全局字典”6 个接口）。现在把字典灌进去，这些字段无处安放，等于给 Wave 2 预先制造一次数据迁移。
--   故字典随 Wave 2 的 DDL 一起落地，本文件只管 Wave 1 自洽所需要的数据。
--
-- ID 分配：本文件用 'edu-pkg-00N' / 'edu-qcat-…' 这类可读 ID。教学云表的 id 是 varchar(36)，
--   不参与框架雪花算法，可读 ID 反而让联调时的日志与前端数据一眼能对上。

-- ----------------------------
-- 1. 默认套餐（frontend PackageRecord）。features 用 text 存 JSON。
-- ----------------------------
DELETE FROM `edu_package` WHERE `id` IN ('edu-pkg-001', 'edu-pkg-002', 'edu-pkg-003');

INSERT INTO `edu_package` (`id`, `name`, `monthly_price`, `ai_quota`, `storage_gb`, `max_staff`, `max_concurrent`, `features`, `sms_enabled`, `sort_no`, `remark`, `create_by`, `create_time`, `del_flag`) VALUES
('edu-pkg-001', '标准版', 2980.00, 10000, 100, 50, 10, '{"aiQuestion":true,"aiVariant":true,"aiPaper":false,"aiGrade":false,"docOcr":true,"collab":true,"examAnalysis":false,"apiAccess":false}', 0, 1, '面向中小型机构，含基础 AI 出题与变式', 'admin', '2026-10-06 10:00:00', 0),
('edu-pkg-002', '专业版', 6980.00, 50000, 500, 200, 30, '{"aiQuestion":true,"aiVariant":true,"aiPaper":true,"aiGrade":true,"docOcr":true,"collab":true,"examAnalysis":true,"apiAccess":false}', 1, 2, '含 AI 组卷、AI 批改与学情分析', 'admin', '2026-10-06 10:00:00', 0),
('edu-pkg-003', '旗舰版', 15800.00, 200000, 2048, 1000, 100, '{"aiQuestion":true,"aiVariant":true,"aiPaper":true,"aiGrade":true,"docOcr":true,"collab":true,"examAnalysis":true,"apiAccess":true}', 1, 3, '含开放 API 与独立资源池，支持大规模并发', 'admin', '2026-10-06 10:00:00', 0);

-- ----------------------------
-- 2. 存量租户扩展补录。
--
--    sys_tenant 里已有的 1000/1001 是框架自带演示租户，没有教学云的扩展记录，
--    不补的话机构端登录后读不到套餐/机构类型，列表页出现半条数据。
--
--    用 INSERT ... SELECT 从 sys_tenant 取材，好处是只为库里确实存在的租户建扩展行，
--    不会给不存在的租户造孤儿数据（开发库可能只有其中一个租户）。
--
--    幂等靠 ON DUPLICATE KEY UPDATE 的空更新，而不是 NOT EXISTS 子查询 ——
--    后者会在子查询里引用正在插入的 edu_tenant_ext 自己，MySQL 有报 error 1093
--    ("You can't specify target table for update in FROM clause") 的风险。
--    org_tenant_id 上有唯一键 uk_edu_tenant_ext_org，重复执行时命中该键并走空更新，无副作用。
-- ----------------------------
INSERT INTO `edu_tenant_ext` (`id`, `org_tenant_id`, `tenant_code`, `biz_status`, `org_type`, `stages`, `package_id`, `contact`, `phone`, `city`, `intro`, `isolation_type`, `storage_used_gb`, `ai_used`, `create_by`, `create_time`, `del_flag`)
SELECT CONCAT('edu-text-', t.`id`), t.`id`, CONCAT('T', t.`id`), 2, '培训机构', '["小学","初中","高中"]', 'edu-pkg-002', '管理员', '13800000000', '北京', CONCAT(t.`name`, '（存量租户补录）'), 'shared', 12.50, 3200, 'admin', '2026-10-06 10:00:00', 0
FROM `sys_tenant` t
WHERE t.`id` IN (1000, 1001)
ON DUPLICATE KEY UPDATE `org_tenant_id` = `org_tenant_id`;

-- ----------------------------
-- 3. 机构端隔离验证样本数据。
--
--    两个租户各给一套**名字完全不同**的分类：越权时若返回了对方的分类名，一眼就能看出来。
--    tenant_id 显式写死（1000 / 1001），因为这是初始化数据、不经过 TenantLineInnerInterceptor 的写入路径。
-- ----------------------------
DELETE FROM `edu_question_category`;

INSERT INTO `edu_question_category` (`id`, `name`, `library`, `parent_id`, `owner_id`, `sort_no`, `tenant_id`, `create_by`, `create_time`, `del_flag`) VALUES
-- 租户 1000 的分类
(1001, '国炬-个人题库',   'personal', NULL, 'admin', 1, 1000, 'admin', '2026-10-06 10:00:00', 0),
(1002, '国炬-一元二次方程', 'personal', 1001, 'admin', 1, 1000, 'admin', '2026-10-06 10:00:00', 0),
(1003, '国炬-二次函数',    'personal', 1001, 'admin', 2, 1000, 'admin', '2026-10-06 10:00:00', 0),
(1004, '国炬-机构公共题库', 'org',     NULL, 'admin', 2, 1000, 'admin', '2026-10-06 10:00:00', 0),
(1005, '国炬-高中物理专区', 'org',     1004, 'admin', 1, 1000, 'admin', '2026-10-06 10:00:00', 0),
-- 租户 1001 的分类（名字刻意与 1000 完全不同，越权时一眼能看出串了租户）
(2001, '敲敲-个人题库',   'personal', NULL, 'admin', 1, 1001, 'admin', '2026-10-06 10:00:00', 0),
(2002, '敲敲-古诗词背诵',  'personal', 2001, 'admin', 1, 1001, 'admin', '2026-10-06 10:00:00', 0),
(2003, '敲敲-机构公共题库', 'org',     NULL, 'admin', 2, 1001, 'admin', '2026-10-06 10:00:00', 0),
(2004, '敲敲-错题库',     'wrong',   NULL, 'admin', 3, 1001, 'admin', '2026-10-06 10:00:00', 0);
