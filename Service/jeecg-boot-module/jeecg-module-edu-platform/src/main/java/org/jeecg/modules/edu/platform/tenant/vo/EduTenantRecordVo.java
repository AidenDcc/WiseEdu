package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * 机构租户（响应，对齐前端 TenantRecord）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构租户")
public class EduTenantRecordVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键（sys_tenant.id）")
    private Integer id;

    @Schema(description = "机构编号")
    private String code;

    @Schema(description = "机构名称")
    private String name;

    @Schema(description = "LOGO 占位色相")
    private Integer logoHue;

    @Schema(description = "机构类型")
    private String orgType;

    @Schema(description = "学段")
    private List<String> stages;

    @Schema(description = "套餐ID")
    private Long packageId;

    @Schema(description = "状态：1试用 2正式 3已到期 4已禁用")
    private Integer status;

    @Schema(description = "服务到期时间")
    private String expireTime;

    @Schema(description = "试用结束时间")
    private String trialEndTime;

    @Schema(description = "本月 AI 调用次数")
    private Integer aiUsed;

    @Schema(description = "已用存储（GB）")
    private BigDecimal storageUsedGb;

    @Schema(description = "创建时间")
    private String createdAt;

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

    @Schema(description = "资质材料")
    private List<CertFileVo> certFiles;

    @Schema(description = "数据隔离：1 共享库 2 独立库")
    private Integer isolationType;

    @Schema(description = "存储区域")
    private String storageRegion;

    @Schema(description = "禁用原因")
    private String disableReason;

    @Schema(description = "功能开关")
    private Map<String, Object> switches;

    @Schema(description = "配额")
    private Map<String, Object> quotas;
}
