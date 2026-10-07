package org.jeecg.modules.edu.platform.dashboard.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

/**
 * 平台端工作台概览（FR-PT-001 ~ 004），对应前端 @aiteach/shared 的 AdminOverview。
 *
 * <p>字段与前端 1:1，勿改名 —— 前端直接把这个对象绑到看板上。
 *
 * @author 教学云
 */
@Data
@Schema(description = "平台端工作台概览")
public class AdminOverviewVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "租户总数")
    private long totalTenants;

    @Schema(description = "试用中租户数")
    private long trialTenants;

    @Schema(description = "30 天内到期租户数")
    private long expiringSoon;

    @Schema(description = "今日新增租户数")
    private long newTenantsToday;

    /**
     * 本月 AI 调用次数。
     *
     * <p><b>Wave 1 恒为 0</b>：调用日志表 edu_ai_call_log 属 Wave 4（数据审计）。在它落地之前这里没有数据源，
     * 不要用 sys_log 的条数或任何近似值糊弄 —— 前端看板会把它当真实用量展示给运营。
     */
    @Schema(description = "本月 AI 调用次数（Wave 1 无数据源，恒为 0）")
    private long aiCallsThisMonth;

    @Schema(description = "AI 调用环比增长率（%），无数据源时为 0")
    private double aiCallsGrowth;

    @Schema(description = "租户环比增长率（%）")
    private double tenantGrowth;

    @Schema(description = "近 30 天趋势")
    private Trend trend = new Trend();

    @Schema(description = "待审核入驻申请")
    private List<PendingApply> pendingApplies = new ArrayList<>();

    @Schema(description = "即将到期租户")
    private List<ExpiringTenant> expiringTenants = new ArrayList<>();

    /** 近 30 天趋势。三个数组等长，下标一一对应 */
    @Data
    @Schema(description = "工作台趋势")
    public static class Trend implements Serializable {

        private static final long serialVersionUID = 1L;

        @Schema(description = "日期标签（MM-dd）")
        private List<String> days = new ArrayList<>();

        @Schema(description = "当日累计租户数")
        private List<Long> tenants = new ArrayList<>();

        @Schema(description = "当日 AI 调用次数（Wave 1 恒为 0）")
        private List<Long> aiCalls = new ArrayList<>();
    }

    /** 待审核入驻申请 */
    @Data
    @Schema(description = "待审核入驻申请")
    public static class PendingApply implements Serializable {

        private static final long serialVersionUID = 1L;

        @Schema(description = "申请单号")
        private String applyNo;

        @Schema(description = "机构名称")
        private String orgName;

        @Schema(description = "机构类型")
        private String orgType;

        @Schema(description = "学段，多个以 / 连接，如「小学 / 初中」")
        private String stages;

        @Schema(description = "联系人")
        private String contact;

        @Schema(description = "联系电话")
        private String phone;

        @Schema(description = "提交时间（yyyy-MM-dd HH:mm）")
        private String submittedAt;

        @Schema(description = "已等待小时数")
        private long waitingHours;

        @Schema(description = "是否超时（超过 48 小时未审）")
        private boolean overtime;
    }

    /** 即将到期租户 */
    @Data
    @Schema(description = "即将到期租户")
    public static class ExpiringTenant implements Serializable {

        private static final long serialVersionUID = 1L;

        @Schema(description = "租户名称")
        private String name;

        @Schema(description = "套餐名称")
        private String packageName;

        @Schema(description = "到期日（yyyy-MM-dd）")
        private String expireTime;

        @Schema(description = "剩余天数")
        private long daysLeft;
    }
}
