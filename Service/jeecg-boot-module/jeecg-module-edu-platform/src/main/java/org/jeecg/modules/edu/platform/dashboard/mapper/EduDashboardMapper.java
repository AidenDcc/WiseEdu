package org.jeecg.modules.edu.platform.dashboard.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.jeecg.modules.edu.platform.dashboard.vo.AdminOverviewVo;
import org.jeecg.modules.edu.platform.dashboard.vo.PendingApplyRow;

import java.util.Date;
import java.util.List;

/**
 * 平台端工作台聚合查询。
 *
 * <p>为什么直接写 SQL 读 sys_tenant：本模块的依赖里只有 base-core 与 system-cloud-api，
 * 拿不到 jeecg-system-biz 里的 SysTenant 实体与 ISysTenantService。这些是只读聚合，
 * 为它们专门往 ISysBaseAPI 上加一排方法，会让 Feign 接口被看板需求牵着走；
 * 两个服务本来就同库，直接读表更省事。写入（开户）才走 ISysBaseAPI，那是 Wave 2 的事。
 *
 * @author 教学云
 */
@Mapper
public interface EduDashboardMapper {

    /** 有效租户总数 */
    long countTenants();

    /** 指定时刻之前的有效租户数，用于算近 30 天累计曲线的起点 */
    long countTenantsBefore(@Param("time") Date time);

    /** 各有效租户的创建时间，用于在 Java 侧累加出趋势曲线 */
    List<Date> listTenantCreateTimes();

    /** 指定时间之后创建的租户数 */
    long countTenantsCreatedAfter(@Param("time") Date time);

    /** 试用中租户数（edu_tenant_ext.biz_status = 1） */
    long countTrialTenants();

    /** 指定天数内到期的租户数（依据 sys_tenant.end_date） */
    long countExpiringTenants(@Param("days") int days);

    /** 指定天数内到期的租户明细，按到期日升序 */
    List<AdminOverviewVo.ExpiringTenant> listExpiringTenants(@Param("days") int days);

    /** 待审核入驻申请，按提交时间升序（等得最久的排最前）。返回原始行，由 Service 归一化 */
    List<PendingApplyRow> listPendingApplies(@Param("limit") int limit);
}
