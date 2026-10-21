package org.jeecg.modules.edu.platform.tenant.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.math.BigDecimal;
import java.util.Date;

/**
 * 平台端套餐（管理端 FR-PT-014）。
 *
 * <p>主键用 bigint 自增：前端 PackageRecord.id 是 number，雪花 19 位串超出
 * JS Number.MAX_SAFE_INTEGER 会静默丢精度（与 edu_question_category 同口径）。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_package")
@Schema(description = "教学云-套餐")
public class EduPackage implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.AUTO)
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

    /** 前端 FeatureSwitches 六键 JSON，服务端只存不解析 */
    @Schema(description = "功能开关 JSON")
    private String features;

    @Schema(description = "是否含短信服务(0-否,1-是)")
    private Integer smsEnabled;

    @Schema(description = "排序号")
    private Integer sortNo;

    @Schema(description = "备注")
    private String remark;

    @Schema(description = "创建人")
    private String createBy;

    @Schema(description = "创建时间")
    private Date createTime;

    @Schema(description = "更新人")
    private String updateBy;

    @Schema(description = "更新时间")
    private Date updateTime;

    @TableLogic
    @Schema(description = "删除状态(0-正常,1-已删除)")
    private Integer delFlag;
}
