package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 禁用机构入参（FR-PT-010）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "禁用机构入参")
public class EduTenantDisableModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "禁用原因（至少 5 字）")
    private String reason;
}
