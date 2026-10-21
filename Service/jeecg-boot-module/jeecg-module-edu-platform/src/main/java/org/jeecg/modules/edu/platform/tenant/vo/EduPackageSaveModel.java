package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.util.Map;

/**
 * 套餐保存入参（新增或编辑，有 id 为编辑）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "套餐保存入参")
public class EduPackageSaveModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键（编辑时必填）")
    private Long id;

    @Schema(description = "套餐名称")
    private String name;

    @Schema(description = "月费（元）")
    private BigDecimal monthlyPrice;

    @Schema(description = "每月 AI 调用额度（次）")
    private Integer aiQuota;

    @Schema(description = "存储空间（GB）")
    private Integer storageGb;

    @Schema(description = "最大员工数")
    private Integer maxStaff;

    @Schema(description = "最大并发数")
    private Integer maxConcurrent;

    @Schema(description = "功能开关")
    private Map<String, Object> features;

    @Schema(description = "是否含短信服务")
    private Boolean smsEnabled;

    @Schema(description = "排序号")
    private Integer sortNo;

    @Schema(description = "备注")
    private String remark;
}
