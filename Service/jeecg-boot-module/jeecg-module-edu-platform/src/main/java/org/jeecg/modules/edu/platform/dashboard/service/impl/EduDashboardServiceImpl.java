package org.jeecg.modules.edu.platform.dashboard.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.modules.edu.platform.dashboard.mapper.EduDashboardMapper;
import org.jeecg.modules.edu.platform.dashboard.service.IEduDashboardService;
import org.jeecg.modules.edu.platform.dashboard.vo.AdminOverviewVo;
import org.jeecg.modules.edu.platform.dashboard.vo.PendingApplyRow;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 平台端工作台实现。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduDashboardServiceImpl implements IEduDashboardService {

    /** 趋势窗口天数，与前端 recentDays(30) 对齐 */
    private static final int TREND_DAYS = 30;

    /** 到期预警窗口，前端文案为「30 天内到期」 */
    private static final int EXPIRING_WINDOW_DAYS = 30;

    /** 待审申请在看板上最多展示的条数 */
    private static final int PENDING_APPLY_LIMIT = 5;

    /** 待审超过该小时数算超时（与前端 pendingApplies[].overtime 的口径一致） */
    private static final long OVERTIME_HOURS = 48;

    private static final DateTimeFormatter DAY_LABEL = DateTimeFormatter.ofPattern("MM-dd");
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    @Autowired
    private EduDashboardMapper dashboardMapper;

    @Override
    public AdminOverviewVo overview() {
        AdminOverviewVo vo = new AdminOverviewVo();

        vo.setTotalTenants(dashboardMapper.countTenants());
        vo.setTrialTenants(dashboardMapper.countTrialTenants());
        vo.setExpiringSoon(dashboardMapper.countExpiringTenants(EXPIRING_WINDOW_DAYS));
        vo.setNewTenantsToday(dashboardMapper.countTenantsCreatedAfter(startOfToday()));
        vo.setExpiringTenants(dashboardMapper.listExpiringTenants(EXPIRING_WINDOW_DAYS));
        vo.setPendingApplies(toPendingApplies(dashboardMapper.listPendingApplies(PENDING_APPLY_LIMIT)));

        // 趋势：租户曲线用真实建租时间累加；AI 调用曲线在 edu_ai_call_log（Wave 4）落地前没有数据源，
        // 保持全 0，不编造。见 AdminOverviewVo#aiCallsThisMonth 的说明。
        vo.setTrend(buildTrend());

        // 租户环比：本 30 天新增 vs 上一个 30 天新增
        LocalDate today = LocalDate.now();
        long thisWindow = dashboardMapper.countTenantsCreatedAfter(toDate(today.minusDays(TREND_DAYS)));
        long prevWindow = dashboardMapper.countTenantsCreatedAfter(toDate(today.minusDays(TREND_DAYS * 2L)))
                - thisWindow;
        vo.setTenantGrowth(growthRate(thisWindow, prevWindow));
        vo.setAiCallsGrowth(0.0);
        return vo;
    }

    /**
     * 近 30 天累计租户曲线。
     *
     * <p>用「窗口起点已有的租户数」做基数，再按日累加当天新建数，得到的是累计量（前端是面积图口径）。
     */
    private AdminOverviewVo.Trend buildTrend() {
        AdminOverviewVo.Trend trend = new AdminOverviewVo.Trend();
        List<String> days = new ArrayList<>(TREND_DAYS);
        List<Long> tenants = new ArrayList<>(TREND_DAYS);

        LocalDate today = LocalDate.now();
        LocalDate start = today.minusDays(TREND_DAYS - 1L);

        // 按天归集：create_time -> 当天日期
        List<Date> createTimes = dashboardMapper.listTenantCreateTimes();
        long running = dashboardMapper.countTenantsBefore(toDate(start));

        for (int i = 0; i < TREND_DAYS; i++) {
            LocalDate day = start.plusDays(i);
            Date dayStart = toDate(day);
            Date dayEnd = toDate(day.plusDays(1));
            for (Date createTime : createTimes) {
                if (!createTime.before(dayStart) && createTime.before(dayEnd)) {
                    running++;
                }
            }
            days.add(day.format(DAY_LABEL));
            tenants.add(running);
        }

        trend.setDays(days);
        trend.setTenants(tenants);
        // 等长占位，前端三个数组按下标对齐，长度不一致会把曲线画错位
        List<Long> aiCalls = new ArrayList<>(TREND_DAYS);
        for (int i = 0; i < TREND_DAYS; i++) {
            aiCalls.add(0L);
        }
        trend.setAiCalls(aiCalls);
        return trend;
    }

    private List<AdminOverviewVo.PendingApply> toPendingApplies(List<PendingApplyRow> rows) {
        List<AdminOverviewVo.PendingApply> result = new ArrayList<>(rows.size());
        LocalDateTime now = LocalDateTime.now();
        for (PendingApplyRow row : rows) {
            AdminOverviewVo.PendingApply item = new AdminOverviewVo.PendingApply();
            item.setApplyNo(row.getApplyNo());
            item.setOrgName(row.getOrgName());
            item.setOrgType(row.getOrgType());
            item.setStages(joinStages(row.getStages()));
            item.setContact(row.getContact());
            item.setPhone(row.getPhone());
            if (row.getSubmittedAt() != null) {
                LocalDateTime submitted = toLocalDateTime(row.getSubmittedAt());
                item.setSubmittedAt(submitted.format(DATE_TIME));
                long hours = Duration.between(submitted, now).toHours();
                item.setWaitingHours(Math.max(0, hours));
                item.setOvertime(hours > OVERTIME_HOURS);
            } else {
                item.setSubmittedAt("");
                item.setWaitingHours(0);
                item.setOvertime(false);
            }
            result.add(item);
        }
        return result;
    }

    /**
     * 把库里存的 JSON 数组转成前端要的展示串：["小学","初中"] → "小学 / 初中"。
     *
     * <p>解析失败不抛异常：这是看板，一条脏数据不该让整个页面白屏。原样返回并记日志。
     */
    private String joinStages(String stagesJson) {
        if (stagesJson == null || stagesJson.isBlank()) {
            return "";
        }
        try {
            JSONArray array = JSON.parseArray(stagesJson);
            if (array == null || array.isEmpty()) {
                return "";
            }
            List<String> parts = new ArrayList<>(array.size());
            for (int i = 0; i < array.size(); i++) {
                String part = array.getString(i);
                if (part != null && !part.isBlank()) {
                    parts.add(part);
                }
            }
            return String.join(" / ", parts);
        } catch (Exception e) {
            log.warn("入驻申请 stages 不是合法 JSON 数组，原样返回：{}", stagesJson, e);
            return stagesJson;
        }
    }

    /** 环比增长率（%），上期为 0 时返回 0 而不是无穷大 */
    private static double growthRate(long current, long previous) {
        if (previous <= 0) {
            return 0.0;
        }
        double rate = (current - previous) * 100.0 / previous;
        // 保留 1 位小数，与前端展示口径一致
        return Math.round(rate * 10) / 10.0;
    }

    private static Date startOfToday() {
        return toDate(LocalDate.now());
    }

    private static Date toDate(LocalDate date) {
        return Date.from(date.atStartOfDay(ZoneId.systemDefault()).toInstant());
    }

    private static LocalDateTime toLocalDateTime(Date date) {
        return LocalDateTime.ofInstant(date.toInstant(), ZoneId.systemDefault());
    }
}
