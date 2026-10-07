package org.jeecg.modules.edu.platform.dashboard.service;

import org.jeecg.modules.edu.platform.dashboard.vo.AdminOverviewVo;

/**
 * 平台端工作台（FR-PT-001 ~ 004）。
 *
 * @author 教学云
 */
public interface IEduDashboardService {

    /**
     * 工作台概览。趋势窗口固定 30 天，待审申请最多取 5 条，到期预警窗口 30 天。
     */
    AdminOverviewVo overview();
}
