package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 个人中心-修改密码入参。
 *
 * @author 教学云
 */
@Data
@Schema(description = "修改密码入参")
public class EduProfilePasswordModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "当前密码")
    private String oldPassword;

    @Schema(description = "新密码（至少 8 位，含字母与数字）")
    private String newPassword;
}
