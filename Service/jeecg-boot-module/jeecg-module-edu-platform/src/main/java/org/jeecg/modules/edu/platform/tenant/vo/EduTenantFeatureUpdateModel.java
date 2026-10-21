package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.Map;

/**
 * 更新机构套餐权限入参（FR-PT-012）：功能开关 + 配额。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构套餐权限更新入参")
public class EduTenantFeatureUpdateModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "功能开关")
    private Map<String, Object> switches;

    @Schema(description = "配额（aiQuota/storageGb/maxStaff/maxConcurrent）")
    private Map<String, Object> quotas;
}
