package org.jeecg.modules.edu.platform.dashboard.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.modules.edu.platform.dashboard.service.IEduDashboardService;
import org.jeecg.modules.edu.platform.dashboard.vo.AdminOverviewVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 平台端工作台（FR-PT-001 ~ 004）。
 *
 * <p><b>@RequestMapping 必须自带 /admin 前缀</b>：网关虽然配了 strip_prefix，但
 * RouteToRequestUrlFilter(order 10000) 会用原始 URI 覆盖它，前缀实际不会被剥掉。
 *
 * @author 教学云
 */
@Slf4j
@Tag(name = "平台端-工作台")
@RestController
@RequestMapping("/admin/dashboard")
public class AdminDashboardController {

    @Autowired
    private IEduDashboardService dashboardService;

    @Operation(summary = "工作台概览")
    @GetMapping("/overview")
    public ApiResult<AdminOverviewVo> overview() {
        return ApiResult.ok(dashboardService.overview());
    }
}
