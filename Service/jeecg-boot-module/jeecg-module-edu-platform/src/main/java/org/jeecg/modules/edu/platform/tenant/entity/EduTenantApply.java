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
import java.util.Date;

/**
 * 平台端入驻申请（管理端 FR-PT-005 ~ 007）。
 *
 * <p>机构申请「开通一个租户」。审核状态：1 待审核 / 2 已通过 / 3 已驳回（DB 存整数，
 * 前端展示中文串，转换在 VO 层做）。通过后由 approve 流程开户：sys_tenant + 租户管理员
 * sys_user + sys_user_tenant，并回填 {@link #applyTenantId}。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_tenant_apply")
@Schema(description = "教学云-入驻申请")
public class EduTenantApply implements Serializable {

    private static final long serialVersionUID = 1L;

    public static final int STATUS_PENDING = 1;
    public static final int STATUS_APPROVED = 2;
    public static final int STATUS_REJECTED = 3;

    @TableId(type = IdType.AUTO)
    @Schema(description = "主键")
    private Long id;

    @Schema(description = "申请单号，如 AP202610210001")
    private String applyNo;

    @Schema(description = "机构编号（T+日期+序号，通过后沿用为租户编码）")
    private String code;

    @Schema(description = "机构名称")
    private String orgName;

    @Schema(description = "机构类型")
    private String orgType;

    /** 学段 JSON 数组，如 ["小学","初中"] */
    @Schema(description = "学段 JSON 数组")
    private String stages;

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

    /** 资质材料 JSON 数组 */
    @Schema(description = "资质文件 JSON 数组")
    private String certFiles;

    @Schema(description = "审核状态(1待审核,2已通过,3已驳回)")
    private Integer status;

    @Schema(description = "驳回原因")
    private String rejectReason;

    @Schema(description = "审批通过后开通的 sys_tenant.id")
    private Integer applyTenantId;

    @Schema(description = "提交时间")
    private Date submittedAt;

    @Schema(description = "审核时间")
    private Date reviewedAt;

    @Schema(description = "审核人")
    private String reviewedBy;

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
