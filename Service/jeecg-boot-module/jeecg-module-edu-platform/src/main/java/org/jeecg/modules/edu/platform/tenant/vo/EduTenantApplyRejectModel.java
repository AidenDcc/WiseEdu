package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 驳回入驻申请入参（FR-PT-007）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "驳回入驻申请入参")
public class EduTenantApplyRejectModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "驳回原因（5-200 字）")
    private String reason;

    @Schema(description = "审核人")
    private String reviewer;
}
