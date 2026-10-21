package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 仅含到期时间的操作结果（延长试用 / 试用转正式共用）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "到期时间结果")
public class EduTenantExpireResultVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "新到期时间")
    private String expireTime;
}
