package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 新增机构入驻申请入参（管理端 FR-PT-005）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "入驻申请新增入参")
public class EduTenantApplyCreateModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "机构名称")
    private String orgName;

    @Schema(description = "机构类型")
    private String orgType;

    @Schema(description = "学段")
    private List<String> stages;

    @Schema(description = "联系人")
    private String contact;

    @Schema(description = "联系电话")
    private String phone;

    @Schema(description = "联系邮箱")
    private String email;

    @Schema(description = "所在地区")
    private String city;

    @Schema(description = "机构详细地址")
    private String address;

    @Schema(description = "机构简介")
    private String intro;

    @Schema(description = "资质材料")
    private List<CertFileVo> certFiles;
}
