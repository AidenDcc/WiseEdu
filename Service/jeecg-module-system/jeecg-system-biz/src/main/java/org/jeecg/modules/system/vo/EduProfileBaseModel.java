package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 个人中心-修改个人资料入参。
 *
 * <p>字段与前端 {@code SessionUser} 的 phone/email/intro 同名，分别落到
 * {@code sys_user.phone / email / sign}（sign = 个性签名，前端叫 intro）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "个人资料修改入参")
public class EduProfileBaseModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "姓名")
    private String name;

    @Schema(description = "手机号")
    private String phone;

    @Schema(description = "邮箱")
    private String email;

    /** 对应 sys_user.sign（个性签名） */
    @Schema(description = "个人简介")
    private String intro;
}
