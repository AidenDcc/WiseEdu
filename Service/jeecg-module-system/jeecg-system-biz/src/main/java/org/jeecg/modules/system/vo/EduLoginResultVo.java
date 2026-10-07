package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 教学云登录结果，对应前端 @aiteach/shared 的 LoginResult。
 *
 * @author 教学云
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Schema(description = "教学云登录结果")
public class EduLoginResultVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "JWT token，前端存 localStorage 并以 X-Access-Token 请求头发送")
    private String token;

    @Schema(description = "会话用户")
    private EduSessionUserVo user;
}
