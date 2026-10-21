package org.jeecg.modules.system.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.Date;

/**
 * 教学云用户个人中心扩展资料（1:1 框架 sys_user）。
 *
 * <p><b>为什么不把这些字段直接加到 sys_user</b>：
 * <ul>
 *   <li>{@code sys_user.avatar} 是 varchar(255)，而前端上传头像时已裁成方形并以 dataURL 提交，
 *       长度可达数百 KB，写进去会被截断；</li>
 *   <li>消息偏好（站内信/短信/邮件/周报）是教学云自有语义，框架表没有对应列，
 *       ALTER 框架表会波及 QueryGenerator 与代码生成器。</li>
 * </ul>
 * 按「A 框架表不改 / B edu_ 前缀扩展表挂框架表」的约定，单独建表。
 *
 * <p>资料类字段（姓名/手机/邮箱/个性签名）仍写回 {@code sys_user} 的
 * {@code realname / phone / email / sign}，本表只放「框架表放不下」的两类数据。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_user_profile")
@Schema(description = "教学云-用户个人中心扩展资料")
public class EduUserProfile implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.AUTO)
    @Schema(description = "主键")
    private Long id;

    @Schema(description = "sys_user.id（雪花ID字符串）")
    private String userId;

    /** dataURL 形式的自定义头像；null 表示使用前端按账号色相生成的字母头像 */
    @Schema(description = "自定义头像 dataURL")
    private String avatar;

    @Schema(description = "站内信提醒")
    private Boolean notifyInApp;

    @Schema(description = "短信提醒")
    private Boolean notifySms;

    @Schema(description = "邮件提醒")
    private Boolean notifyEmail;

    @Schema(description = "周报摘要")
    private Boolean notifyDigest;

    @Schema(description = "创建时间")
    private Date createTime;

    @Schema(description = "更新时间")
    private Date updateTime;
}
