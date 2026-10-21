package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 更新机构数据隔离策略入参（FR-PT-013）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构数据隔离策略更新入参")
public class EduTenantIsolationUpdateModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "隔离方式：1 共享库 2 独立库")
    private Integer isolationType;

    @Schema(description = "存储区域")
    private String storageRegion;
}
