package org.jeecg.modules.edu.platform.tenant.mapper;

import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/**
 * 管理端租户域聚合查询（跨 sys_tenant + edu_tenant_ext 联表）。
 *
 * <p>sys_tenant / edu_tenant_ext 是平台侧全局表，未登记进 TENANT_TABLE，不会被
 * TenantLineInnerInterceptor 追加租户条件 —— 平台端要的正是全局口径。
 *
 * @author 教学云
 */
public interface EduTenantAdminMapper {

    /**
     * 统计机构总数（含筛选条件）。
     */
    long countTenants(@Param("status") Integer status,
                      @Param("packageId") Long packageId,
                      @Param("orgType") String orgType,
                      @Param("keyword") String keyword,
                      @Param("expireFrom") String expireFrom,
                      @Param("expireTo") String expireTo,
                      @Param("aiMin") Integer aiMin,
                      @Param("aiMax") Integer aiMax);

    /**
     * 分页查询机构列表。返回原始列（JSON 列原样字符串，日期为 Timestamp），由服务层转成 VO。
     */
    List<Map<String, Object>> listTenants(@Param("status") Integer status,
                                          @Param("packageId") Long packageId,
                                          @Param("orgType") String orgType,
                                          @Param("keyword") String keyword,
                                          @Param("expireFrom") String expireFrom,
                                          @Param("expireTo") String expireTo,
                                          @Param("aiMin") Integer aiMin,
                                          @Param("aiMax") Integer aiMax,
                                          @Param("offset") long offset,
                                          @Param("limit") long limit);

    /**
     * 统计某租户的员工数（sys_user_tenant 真实计数）。
     */
    long countStaffOfTenant(@Param("tenantId") Integer tenantId);

    /**
     * 查询单个机构详情行（与 listTenants 同列），机构不存在返回 null。
     */
    Map<String, Object> getTenantById(@Param("id") Integer id);
}
