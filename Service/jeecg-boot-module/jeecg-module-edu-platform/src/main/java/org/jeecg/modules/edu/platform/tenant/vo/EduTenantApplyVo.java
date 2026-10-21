package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 入驻申请（响应，对齐前端 TenantApply）。
 *
 * <p>status 是中文展示串（待审核/已通过/已驳回），由服务层从 DB 整数 1/2/3 转换。
 *
 * @author 教学云
 */
@Data
@Schema(description = "入驻申请")
public class EduTenantApplyVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键")
    private Long id;

    @Schema(description = "申请单号")
    private String applyNo;

    @Schema(description = "机构编号")
    private String code;

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

    @Schema(description = "提交时间")
    private String submittedAt;

    @Schema(description = "已等待小时数")
    private long waitingHours;

    @Schema(description = "审核状态：待审核|已通过|已驳回")
    private String status;

    @Schema(description = "审核时间")
    private String reviewedAt;

    @Schema(description = "审核人")
    private String reviewer;

    @Schema(description = "驳回原因")
    private String rejectReason;
}
