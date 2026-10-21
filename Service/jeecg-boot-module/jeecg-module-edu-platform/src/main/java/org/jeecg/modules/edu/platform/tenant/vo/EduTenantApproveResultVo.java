package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 通过入驻申请结果（FR-PT-006）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "通过入驻申请结果")
public class EduTenantApproveResultVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "机构名称")
    private String tenantName;

    @Schema(description = "服务到期时间")
    private String expireTime;

    @Schema(description = "初始管理员账号")
    private String adminAccount;
}
