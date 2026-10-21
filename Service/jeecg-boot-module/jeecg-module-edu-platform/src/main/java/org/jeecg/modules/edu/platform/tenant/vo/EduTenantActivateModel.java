package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 试用转正式入参（FR-PT-011）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "试用转正式入参")
public class EduTenantActivateModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "套餐ID")
    private Long packageId;
}
