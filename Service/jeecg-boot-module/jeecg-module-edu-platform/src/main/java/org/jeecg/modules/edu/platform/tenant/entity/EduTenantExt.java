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
 * 平台端租户扩展（1:1 框架 sys_tenant，管理端 FR-PT-008 ~ 014）。
 *
 * <p>为什么不 ALTER sys_tenant：框架 SysTenant 实体未继承 JeecgEntity、id 是手工 Integer，
 * 且 SysTenantController 约 60 个端点依赖该表，混入 20+ 业务字段会波及 QueryGenerator。
 * 字段分工：sys_tenant 保留 name/end_date(到期)/status/del_flag，其余进本表。
 *
 * <p>「引用某个租户」的外键列命名 {@code org_tenant_id}，绝不能叫 {@code tenant_id}——
 * 否则 MybatisInterceptor 会把值为 null 的 tenantId 字段静默改写成当前登录租户。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_tenant_ext")
@Schema(description = "教学云-租户扩展")
public class EduTenantExt implements Serializable {

    private static final long serialVersionUID = 1L;

    public static final int BIZ_TRIAL = 1;
    public static final int BIZ_FORMAL = 2;
    public static final int BIZ_EXPIRED = 3;
    public static final int BIZ_DISABLED = 4;

    @TableId(type = IdType.ASSIGN_ID)
    @Schema(description = "主键（雪花串）")
    private String id;

    @Schema(description = "关联 sys_tenant.id")
    private Integer orgTenantId;

    @Schema(description = "租户编码（业务展示用）")
    private String tenantCode;

    @Schema(description = "LOGO 占位色相")
    private Integer logoHue;

    @Schema(description = "业务状态(1试用,2正式,3到期,4禁用)")
    private Integer bizStatus;

    @Schema(description = "机构类型")
    private String orgType;

    /** 学段 JSON 数组 */
    @Schema(description = "学段 JSON 数组")
    private String stages;

    @Schema(description = "套餐ID → edu_package.id")
    private Long packageId;

    @Schema(description = "试用到期时间")
    private Date trialEndTime;

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

    /** 资质文件 JSON 数组 */
    @Schema(description = "资质文件 JSON 数组")
    private String certFiles;

    @Schema(description = "隔离方式：shared-共享库行级隔离 / dedicated-独立库")
    private String isolationType;

    @Schema(description = "存储区域")
    private String storageRegion;

    @Schema(description = "已用存储（GB）")
    private BigDecimal storageUsedGb;

    @Schema(description = "本月已用 AI 调用次数")
    private Integer aiUsed;

    @Schema(description = "禁用原因")
    private String disableReason;

    /** 租户级功能开关 JSON */
    @Schema(description = "租户级功能开关 JSON")
    private String switches;

    /** 租户级配额覆盖 JSON */
    @Schema(description = "租户级配额覆盖 JSON")
    private String quotas;

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
