package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 机构租户列表查询入参（FR-PT-008）。全部以字符串接收，服务层再按需转型。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构租户查询入参")
public class EduTenantQueryModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "状态（1试用 2正式 3到期 4禁用）")
    private String status;

    @Schema(description = "套餐ID")
    private String packageId;

    @Schema(description = "机构类型")
    private String orgType;

    @Schema(description = "关键字（机构名/机构编号）")
    private String keyword;

    @Schema(description = "到期起始日（yyyy-MM-dd）")
    private String expireFrom;

    @Schema(description = "到期截止日（yyyy-MM-dd）")
    private String expireTo;

    @Schema(description = "本月 AI 用量下限")
    private String aiMin;

    @Schema(description = "本月 AI 用量上限")
    private String aiMax;

    @Schema(description = "页码")
    private Integer page = 1;

    @Schema(description = "每页条数")
    private Integer pageSize = 10;
}
