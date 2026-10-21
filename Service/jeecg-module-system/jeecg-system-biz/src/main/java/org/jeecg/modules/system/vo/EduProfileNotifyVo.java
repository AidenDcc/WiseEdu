package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 个人中心-消息偏好（读写共用）。
 *
 * <p>字段名与前端 {@code notify} 对象一致：inApp / sms / email / digest。
 *
 * @author 教学云
 */
@Data
@Schema(description = "消息偏好")
public class EduProfileNotifyVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "站内信提醒")
    private Boolean inApp;

    @Schema(description = "短信提醒")
    private Boolean sms;

    @Schema(description = "邮件提醒")
    private Boolean email;

    @Schema(description = "周报摘要")
    private Boolean digest;
}
