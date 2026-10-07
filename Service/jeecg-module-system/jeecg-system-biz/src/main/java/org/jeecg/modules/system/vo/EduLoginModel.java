package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 教学云登录入参，对应前端 @aiteach/shared 的 LoginPayload。
 *
 * @author 教学云
 */
@Data
@Schema(description = "教学云登录入参")
public class EduLoginModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "登录账号")
    private String account;

    @Schema(description = "登录密码（明文，由前端直接提交）")
    private String password;
}
