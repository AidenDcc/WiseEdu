package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 机构续费入参（FR-PT-009）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构续费入参")
public class EduTenantRenewModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "套餐ID")
    private Long packageId;

    /** month / quarter / year */
    @Schema(description = "续费时长：month|quarter|year")
    private String duration;
}
