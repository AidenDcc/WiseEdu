package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 机构详情（响应，对齐前端 TenantDetailModel）。
 *
 * <p>stats 里 questionCount/paperCount/materialCount 依赖题库/试卷/教辅表，尚未落地，
 * 本期返回 0（不编造）；staffCount 可查 sys_user_tenant 真实计数。aiMonthly/aiDaily 在
 * edu_ai_call_log（Wave 4）落地前为空/零占位。
 *
 * @author 教学云
 */
@Data
@Schema(description = "机构详情")
public class EduTenantDetailVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "机构基本信息")
    private EduTenantRecordVo tenant;

    @Schema(description = "当前套餐")
    private EduPackageVo pkg;

    @Schema(description = "资源统计")
    private Stats stats;

    @Schema(description = "近 6 个月 AI 调用量")
    private AiMonthly aiMonthly;

    @Schema(description = "近 12 个月按天调用量")
    private List<AiDaily> aiDaily;

    @Data
    @Schema(description = "资源统计")
    public static class Stats implements Serializable {
        private static final long serialVersionUID = 1L;

        @Schema(description = "题目数")
        private long questionCount;

        @Schema(description = "试卷数")
        private long paperCount;

        @Schema(description = "教辅数")
        private long materialCount;

        @Schema(description = "员工数")
        private long staffCount;
    }

    @Data
    @Schema(description = "月度调用量")
    public static class AiMonthly implements Serializable {
        private static final long serialVersionUID = 1L;

        @Schema(description = "月份标签")
        private List<String> months;

        @Schema(description = "各月调用量")
        private List<Long> calls;
    }

    @Data
    @Schema(description = "单月按天调用量")
    public static class AiDaily implements Serializable {
        private static final long serialVersionUID = 1L;

        @Schema(description = "月份（yyyy-MM）")
        private String month;

        @Schema(description = "当月每天调用量")
        private List<Long> calls;
    }
}
