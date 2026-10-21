-- ---author:教学云---date:20261021-----for:管理端 Wave 2 演示种子数据。
--
-- 背景：V3.9.6_3 的套餐种子是 Wave 1 早先的占位值（价格/功能键口径与前端 @aiteach/shared 的
-- tenant-store.ts 不一致：少了「轻量版」，月费与 FeatureSwitches 六键都对不上）。本脚本把套餐
-- 对齐到前端 Mock 的 4 档口径，并补一批入驻申请，让管理端「套餐 / 入驻审核」页面有可演示的数据。
--
-- 幂等性：Flyway 只执行一次；DELETE 按固定名称删，INSERT 用固定 apply_no，配合 uk_edu_tenant_apply_no
-- 唯一键，即便手动重放也不会产生脏数据。

-- 1. 套餐对齐前端 4 档（轻量版 / 标准版 / 专业版 / 旗舰版）
DELETE FROM `edu_package` WHERE `name` IN ('标准版', '专业版', '旗舰版', '轻量版');

INSERT INTO `edu_package`
(`name`, `monthly_price`, `ai_quota`, `storage_gb`, `max_staff`, `max_concurrent`, `features`, `sms_enabled`, `sort_no`, `remark`, `create_by`, `create_time`, `del_flag`) VALUES
('轻量版', 299.00,   1000,   50,   5,   10, '{"aiGenerate":true,"aiVariant":true,"aiPhoto":false,"docImport":true,"collab":true,"customPrompt":false}', 0, 1, '入门体验，AI 出题与变式', 'admin', NOW(), 0),
('标准版', 599.00,   3000,  200,  20,   20, '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":false}', 1, 2, '中小型机构，含拍照识题', 'admin', NOW(), 0),
('专业版', 1299.00, 10000,  500,  60,   60, '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":true}',  1, 3, '含自定义提示词', 'admin', NOW(), 0),
('旗舰版', 2999.00, 50000, 2048, 200,  200, '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":true}',  1, 4, '高并发与海量存储', 'admin', NOW(), 0);

-- 2. 入驻申请演示数据（3 待审核 + 1 已驳回）
INSERT INTO `edu_tenant_apply`
(`apply_no`, `code`, `org_name`, `org_type`, `stages`, `contact`, `phone`, `email`, `city`, `address`, `intro`, `cert_files`, `status`, `reject_reason`, `submitted_at`, `reviewed_at`, `reviewed_by`, `create_by`, `create_time`, `del_flag`) VALUES
('AP202609060001', 'T20260906001', '杭州市西湖实验中学', '公立学校', '["初中","高中"]', '陈建国', '13857102266', 'chenjg@xhsy.edu.cn', '浙江省杭州市西湖区', '西湖区文二西路 118 号', '市属重点中学，在校学生 2300 余人，计划在数学、物理学科试点 AI 组卷与个性化练习。', '[{"name":"营业执照.pdf","type":"pdf","category":"license"},{"name":"办学许可证.jpg","type":"img","category":"permit"},{"name":"法人身份证.jpg","type":"img","category":"legal"}]', 1, NULL, NOW() - INTERVAL 3 DAY, NULL, NULL, 'admin', NOW() - INTERVAL 3 DAY, 0),
('AP202609080002', 'T20260908002', '南京启航教育培训中心', '培训机构', '["小学","初中"]', '刘思远', '15950533188', 'service@qihang-edu.com', '江苏省南京市鼓楼区', '鼓楼区中山北路 88 号 5 楼', '专注 K12 课后辅导，在读学员 1200 人，希望通过 AI 出题提升讲义更新效率。', '[{"name":"营业执照.pdf","type":"pdf","category":"license"},{"name":"办学许可证.jpg","type":"img","category":"permit"},{"name":"法人身份证.jpg","type":"img","category":"legal"}]', 1, NULL, NOW() - INTERVAL 2 DAY, NULL, NULL, 'admin', NOW() - INTERVAL 2 DAY, 0),
('AP202609110003', 'T20260911003', '成都七中育才附属小学', '公立学校', '["小学"]', '赵晓梅', '13688045521', 'zhaoxm@qcys.edu.cn', '四川省成都市锦江区', '锦江区滨江东路 66 号', '区属实验小学，开展智慧课堂课题研究，需要文档识别入库与协同组卷能力。', '[{"name":"营业执照.pdf","type":"pdf","category":"license"},{"name":"办学许可证.jpg","type":"img","category":"permit"},{"name":"法人身份证.jpg","type":"img","category":"legal"}]', 1, NULL, NOW() - INTERVAL 1 DAY, NULL, NULL, 'admin', NOW() - INTERVAL 1 DAY, 0),
('AP202609010006', 'T20260901006', '西安领航考研培训学校', '培训机构', '["高中"]', '马腾', '15829217730', 'mateng@lhky.cn', '陕西省西安市雁塔区', '雁塔区小寨东路 168 号', '考研公共课培训机构。', '[{"name":"营业执照.pdf","type":"pdf","category":"license"},{"name":"办学许可证.jpg","type":"img","category":"permit"},{"name":"法人身份证.jpg","type":"img","category":"legal"}]', 3, '资质材料不完整：缺少办学许可证年审页，请补交后重新提交申请。', NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 11 DAY, '平台运营', 'admin', NOW() - INTERVAL 12 DAY, 0);
