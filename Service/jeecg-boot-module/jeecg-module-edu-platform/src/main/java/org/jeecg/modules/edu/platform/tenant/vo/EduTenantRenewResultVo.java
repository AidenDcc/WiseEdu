package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 机构续费结果（FR-PT-009）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构续费结果")
public class EduTenantRenewResultVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "新到期时间")
    private String expireTime;

    @Schema(description = "续费金额（元）")
    private long amount;
}
