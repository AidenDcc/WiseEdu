package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.math.BigDecimal;
import java.util.Map;

/**
 * 套餐（响应，对齐前端 PackageRecord）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "套餐")
public class EduPackageVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键")
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

    /** 前端 FeatureSwitches 六键对象 */
    @Schema(description = "功能开关")
    private Map<String, Object> features;

    @Schema(description = "是否含短信服务")
    private Boolean smsEnabled;
}
