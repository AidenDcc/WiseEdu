package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 入驻申请列表查询入参（FR-PT-005）。
 *
 * <p>status 是前端筛选用的中文串（待审核/已通过/已驳回），由服务层换算成 DB 整数。
 *
 * @author 教学云
 */
@Data
@Schema(description = "入驻申请查询入参")
public class EduTenantApplyQueryModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "审核状态（中文）")
    private String status;

    @Schema(description = "机构类型")
    private String orgType;

    @Schema(description = "关键字（机构名/申请单号/机构编号）")
    private String keyword;

    @Schema(description = "学段，逗号分隔，命中任一即可")
    private String stages;

    @Schema(description = "联系人")
    private String contact;

    @Schema(description = "页码")
    private Integer page = 1;

    @Schema(description = "每页条数")
    private Integer pageSize = 10;
}
