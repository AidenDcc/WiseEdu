-- ---author:教学云---date:20261021-----for:对象存储（阿里云 OSS）文件元数据表。
--
-- 为什么在「桶里已经有文件」的前提下还要一张表：
--   1. 可追溯：桶里的对象名是 UUID，出了「这张图谁传的、属于哪个租户」只能靠本表；
--   2. 可回收：业务表删记录后，靠本表找出孤儿对象批量清理，否则桶只涨不降；
--   3. 可统计：按租户 / 业务分类算存储用量（套餐配额、成本分摊都要用）；
--   4. 可排查：记录当时的 ETag 与 MIME，前端显示异常时能判断是文件本身坏了还是类型错了。
--
-- 不建外键：各业务表只存 storage_key 字符串。题目配图会被复制到试卷、课件会被克隆到
-- 其它租户，硬外键会让「删除一道题」变成一件会失败的事。
--
-- 幂等性：Flyway 只执行一次；建表用 IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS `edu_oss_file` (
  `id`          bigint       NOT NULL COMMENT '主键（雪花ID）',
  `tenant_id`   bigint       NOT NULL DEFAULT 0 COMMENT '租户ID，平台级为 0',
  `biz_type`    varchar(32)  NOT NULL DEFAULT 'common'
                COMMENT '业务分类：avatar/image/document/video/audio/paper/courseware/import/export/common',
  `origin_name` varchar(255)          DEFAULT NULL COMMENT '原始文件名',
  `storage_key` varchar(512) NOT NULL COMMENT '桶内对象 Key，业务表引用它而不是 URL',
  `bucket`      varchar(64)           DEFAULT NULL COMMENT '桶名',
  `size_bytes`  bigint                DEFAULT NULL COMMENT '字节数',
  `mime`        varchar(128)          DEFAULT NULL COMMENT 'MIME',
  `ext`         varchar(32)           DEFAULT NULL COMMENT '扩展名（不含点）',
  `url`         varchar(768)          DEFAULT NULL COMMENT '最近一次生成的访问地址（仅排查线索）',
  `etag`        varchar(64)           DEFAULT NULL COMMENT 'OSS ETag',
  `uploader`    varchar(64)           DEFAULT NULL COMMENT '上传人账号',
  `create_by`   varchar(64)           DEFAULT NULL COMMENT '创建人',
  `create_time` datetime              DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`   varchar(64)           DEFAULT NULL COMMENT '修改人',
  `update_time` datetime              DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  `deleted`     tinyint      NOT NULL DEFAULT 0 COMMENT '删除标记：0 正常 1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_oss_file_key` (`storage_key`),
  KEY `idx_edu_oss_file_biz` (`biz_type`, `tenant_id`),
  KEY `idx_edu_oss_file_uploader` (`uploader`),
  KEY `idx_edu_oss_file_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='教学云-对象存储文件元数据';
