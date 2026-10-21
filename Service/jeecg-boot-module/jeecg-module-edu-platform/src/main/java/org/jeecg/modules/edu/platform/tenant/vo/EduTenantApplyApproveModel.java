package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 通过入驻申请入参（FR-PT-006）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "通过入驻申请入参")
public class EduTenantApplyApproveModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "试用天数（1-90）")
    private Integer trialDays;

    @Schema(description = "套餐ID")
    private Long packageId;

    @Schema(description = "初始管理员账号")
    private String adminAccount;

    @Schema(description = "审核人（当前登录管理员姓名）")
    private String reviewer;
}
