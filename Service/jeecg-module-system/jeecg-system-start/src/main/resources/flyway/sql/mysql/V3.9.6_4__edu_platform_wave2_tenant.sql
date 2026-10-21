-- ---author:教学云---date:20261021-----for:管理端 Wave 2（租户管理域：套餐 + 入驻申请 + 机构列表）表结构对齐。
--
-- 背景：前端 @aiteach/shared 的 PackageRecord.id / TenantApply.id 均为 number，而 Wave 1 的
-- edu_package / edu_tenant_apply 主键是 varchar(36) 可读串（'edu-pkg-001'），运行时存在
-- number/string 类型错配。edu_question_category 已确立「前端 id 为 number 的实体用 bigint 自增」样板，
-- 本脚本把两张表主键对齐到该口径，并补全前端数据契约缺失的字段。
--
-- 幂等性：脚本按 Flyway 只执行一次；主键重建采用「临时列 + DROP/CHANGE」通用方案，兼容已有数据。

-- 1. edu_package 主键 varchar(36) -> bigint 自增
ALTER TABLE `edu_package` ADD COLUMN `tmp_id` BIGINT NULL COMMENT '迁移用临时数值主键' AFTER `id`;
SET @rownum := 0;
UPDATE `edu_package` SET `tmp_id` = (@rownum := @rownum + 1) ORDER BY `sort_no` ASC, `id` ASC;

-- 2. edu_tenant_ext.package_id varchar -> bigint（先按旧 package_id 回填数值）
ALTER TABLE `edu_tenant_ext` ADD COLUMN `tmp_pkg` BIGINT NULL COMMENT '迁移用' AFTER `package_id`;
UPDATE `edu_tenant_ext` e
JOIN `edu_package` p ON p.`id` = e.`package_id`
SET e.`tmp_pkg` = p.`tmp_id`;

-- 3. 重建 edu_package 主键
ALTER TABLE `edu_package`
    DROP PRIMARY KEY,
    DROP COLUMN `id`,
    CHANGE COLUMN `tmp_id` `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    ADD PRIMARY KEY (`id`),
    AUTO_INCREMENT = 100;

-- 4. 重建 edu_tenant_ext.package_id
ALTER TABLE `edu_tenant_ext`
    DROP COLUMN `package_id`,
    CHANGE COLUMN `tmp_pkg` `package_id` BIGINT NULL COMMENT '套餐ID → edu_package.id';

-- 5. edu_tenant_apply 主键 varchar(36) -> bigint 自增（临时列方案，兼容已有数据）
ALTER TABLE `edu_tenant_apply` ADD COLUMN `tmp_id` BIGINT NULL COMMENT '迁移用临时数值主键' AFTER `id`;
SET @rownum := 0;
UPDATE `edu_tenant_apply` SET `tmp_id` = (@rownum := @rownum + 1) ORDER BY `id` ASC;
ALTER TABLE `edu_tenant_apply`
    DROP PRIMARY KEY,
    DROP COLUMN `id`,
    CHANGE COLUMN `tmp_id` `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
    ADD PRIMARY KEY (`id`),
    AUTO_INCREMENT = 100;

-- 6. 补字段：edu_tenant_ext 增加 LOGO 色相与详细地址
ALTER TABLE `edu_tenant_ext`
    ADD COLUMN `logo_hue` INT NULL COMMENT 'LOGO 占位色相（无图时生成字母头像）' AFTER `tenant_code`,
    ADD COLUMN `address` VARCHAR(500) NULL COMMENT '机构详细地址（门牌级）' AFTER `city`;

-- 7. 补字段：edu_tenant_apply 增加机构编号、所在地区、详细地址
ALTER TABLE `edu_tenant_apply`
    ADD COLUMN `code` VARCHAR(32) NULL COMMENT '机构编号（T+日期+序号，通过后沿用为租户编码）' AFTER `apply_no`,
    ADD COLUMN `city` VARCHAR(64) NULL COMMENT '所在地区' AFTER `email`,
    ADD COLUMN `address` VARCHAR(500) NULL COMMENT '机构详细地址' AFTER `city`;

-- 8. 修正套餐 features 为前端 FeatureSwitches 六键口径（旧种子用了 aiQuestion/aiPaper 等旧键）
UPDATE `edu_package` SET `features` = '{"aiGenerate":true,"aiVariant":true,"aiPhoto":false,"docImport":true,"collab":true,"customPrompt":false}' WHERE `name` = '标准版';
UPDATE `edu_package` SET `features` = '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":true}'  WHERE `name` = '专业版';
UPDATE `edu_package` SET `features` = '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":true}'  WHERE `name` = '旗舰版';

-- 9. 存量租户扩展补录开关与配额（前端 TenantRecord.switches / quotas，缺省兜底到套餐）
UPDATE `edu_tenant_ext`
SET `switches` = '{"aiGenerate":true,"aiVariant":true,"aiPhoto":true,"docImport":true,"collab":true,"customPrompt":true}',
    `quotas`   = '{"aiQuota":50000,"storageGb":500,"maxStaff":200,"maxConcurrent":30}'
WHERE `switches` IS NULL;
