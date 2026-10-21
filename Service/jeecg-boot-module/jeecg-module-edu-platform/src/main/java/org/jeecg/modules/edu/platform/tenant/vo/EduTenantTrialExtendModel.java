package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 延长试用入参（FR-PT-011）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "延长试用入参")
public class EduTenantTrialExtendModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "延长天数（1-90）")
    private Integer days;
}
