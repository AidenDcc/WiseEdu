-- ---author:教学云---date:20261021-----for:个人中心（管理端 P-08-01）扩展资料表。
--
-- 为什么需要这张表：个人中心的四项资料里，姓名/手机/邮箱/个性签名在 sys_user 都有现成字段
-- （realname / phone / email / sign），但**自定义头像与消息偏好无处安放**：
--   · sys_user.avatar 是 varchar(255)，而前端把头像裁成方形后以 dataURL 形式提交，
--     体积远超 255，硬塞会截断成乱码；
--   · 消息偏好是教学云自有语义（站内信/短信/邮件/周报），框架表没有对应列。
-- 按「A 框架表不改 / B edu_ 前缀扩展表挂框架表」的约定，这里建一张一对一扩展表挂到 sys_user。
--
-- 幂等性：Flyway 只执行一次；建表用 IF NOT EXISTS，初始化行用 INSERT IGNORE + 唯一键。

CREATE TABLE IF NOT EXISTS `edu_user_profile` (
  `id`             bigint       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`        varchar(36)  NOT NULL COMMENT 'sys_user.id（雪花ID字符串）',
  `avatar`         longtext              COMMENT '自定义头像 dataURL；NULL 表示用字母头像',
  `notify_in_app`  tinyint(1)   NOT NULL DEFAULT 1 COMMENT '站内信提醒',
  `notify_sms`     tinyint(1)   NOT NULL DEFAULT 1 COMMENT '短信提醒',
  `notify_email`   tinyint(1)   NOT NULL DEFAULT 0 COMMENT '邮件提醒',
  `notify_digest`  tinyint(1)   NOT NULL DEFAULT 1 COMMENT '周报摘要',
  `create_time`    datetime              DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time`    datetime              DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_edu_user_profile_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教学云用户个人中心扩展资料';

-- 给平台超管预置一行，避免首次打开个人中心时全是默认值（密码/资料仍以 sys_user 为准）
INSERT IGNORE INTO `edu_user_profile` (`user_id`, `avatar`, `notify_in_app`, `notify_sms`, `notify_email`, `notify_digest`)
SELECT `id`, NULL, 1, 1, 0, 1 FROM `sys_user` WHERE `username` = 'admin' LIMIT 1;
