package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 更新机构基础信息入参（FR-PT-012）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构基础信息更新入参")
public class EduTenantBaseUpdateModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "机构名称")
    private String name;

    @Schema(description = "联系人")
    private String contact;

    @Schema(description = "联系电话")
    private String phone;

    @Schema(description = "所在城市")
    private String city;

    @Schema(description = "机构详细地址")
    private String address;

    @Schema(description = "机构简介")
    private String intro;

    @Schema(description = "学段")
    private List<String> stages;
}
