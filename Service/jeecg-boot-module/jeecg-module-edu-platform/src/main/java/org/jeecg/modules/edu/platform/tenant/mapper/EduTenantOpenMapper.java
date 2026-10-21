package org.jeecg.modules.edu.platform.tenant.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.Date;

/**
 * 管理端租户域「开户」写库 Mapper。
 *
 * <p><b>为什么直接写 sys_tenant / sys_user / sys_user_tenant</b>：本模块依赖里只有
 * base-core 与 system-cloud-api，拿不到 jeecg-system-biz 的 SysTenant/SysUser 实体与
 * Service；而 ISysBaseAPI（Feign）没有「开户 / 建用户」方法。单体部署下两服务同库，
 * 直接写表是当前最省事、也最不容易串改框架语义的做法（与 {@link EduTenantAdminMapper}
 * 直读 sys_tenant 同一口径）。若将来拆微服务，这里应收敛为走 ISysBaseAPI 的跨服务接口。
 *
 * <p>这三张表均未登记进 TENANT_TABLE，不会被租户行级隔离拦截器追加 tenant_id 条件；
 * 密码用 {@code PasswordUtil.encrypt(username, 明文, salt)}（与框架 SysUserServiceImpl 一致）。
 *
 * @author 教学云
 */
public interface EduTenantOpenMapper {

    /** 当前最大租户 id（与框架 tenantIdGenerate 同口径：从 1000 起） */
    @Select("SELECT COALESCE(MAX(id), 0) FROM sys_tenant")
    int maxTenantId();

    /** 判断登录账号是否已存在（未删除） */
    @Select("SELECT COUNT(1) FROM sys_user WHERE username = #{username} AND del_flag = 0")
    long countUserByUsername(@Param("username") String username);

    @Insert("INSERT INTO sys_tenant (id, name, create_by, create_time, begin_date, end_date, status, del_flag) " +
            "VALUES (#{id}, #{name}, #{createBy}, #{createTime}, #{beginDate}, #{endDate}, #{status}, 0)")
    int insertSysTenant(@Param("id") Integer id, @Param("name") String name, @Param("createBy") String createBy,
                        @Param("createTime") Date createTime, @Param("beginDate") Date beginDate,
                        @Param("endDate") Date endDate, @Param("status") Integer status);

    @Insert("INSERT INTO sys_user (id, username, realname, password, salt, phone, email, status, del_flag, create_by, create_time) " +
            "VALUES (#{id}, #{username}, #{realname}, #{password}, #{salt}, #{phone}, #{email}, 1, 0, #{createBy}, #{createTime})")
    int insertSysUser(@Param("id") String id, @Param("username") String username, @Param("realname") String realname,
                      @Param("password") String password, @Param("salt") String salt, @Param("phone") String phone,
                      @Param("email") String email, @Param("createBy") String createBy, @Param("createTime") Date createTime);

    @Insert("INSERT INTO sys_user_tenant (id, user_id, tenant_id, status, create_by, create_time) " +
            "VALUES (#{id}, #{userId}, #{tenantId}, '1', #{createBy}, #{createTime})")
    int insertSysUserTenant(@Param("id") String id, @Param("userId") String userId, @Param("tenantId") Integer tenantId,
                            @Param("createBy") String createBy, @Param("createTime") Date createTime);

    /** 更新机构名称（sys_tenant.name，FR-PT-012 基础信息） */
    @Update("UPDATE sys_tenant SET name = #{name}, update_time = #{updateTime} WHERE id = #{id}")
    int updateSysTenantName(@Param("id") Integer id, @Param("name") String name, @Param("updateTime") Date updateTime);

    /** 更新服务到期时间（sys_tenant.end_date，续费 / 转正式 / 延长试用共用） */
    @Update("UPDATE sys_tenant SET end_date = #{endDate}, update_time = #{updateTime} WHERE id = #{id}")
    int updateSysTenantEndDate(@Param("id") Integer id, @Param("endDate") Date endDate, @Param("updateTime") Date updateTime);

    /** 冻结/解冻租户（sys_tenant.status 1正常 0冻结，禁用机构立即下线登录） */
    @Update("UPDATE sys_tenant SET status = #{status}, update_time = #{updateTime} WHERE id = #{id}")
    int updateSysTenantStatus(@Param("id") Integer id, @Param("status") Integer status, @Param("updateTime") Date updateTime);

    /** 当天机构编号最大序号（申请表，前缀 'T'+yyyyMMdd） */
    @Select("SELECT COALESCE(MAX(CAST(SUBSTRING(code, 10) AS UNSIGNED)), 0) FROM edu_tenant_apply " +
            "WHERE del_flag = 0 AND code LIKE CONCAT('T', #{datePrefix}, '%')")
    int maxApplyOrgCodeSeq(@Param("datePrefix") String datePrefix);

    /** 当天机构编号最大序号（租户扩展表，前缀 'T'+yyyyMMdd） */
    @Select("SELECT COALESCE(MAX(CAST(SUBSTRING(tenant_code, 10) AS UNSIGNED)), 0) FROM edu_tenant_ext " +
            "WHERE del_flag = 0 AND tenant_code LIKE CONCAT('T', #{datePrefix}, '%')")
    int maxExtOrgCodeSeq(@Param("datePrefix") String datePrefix);

    /** 当天申请单号最大序号（前缀 'AP'+yyyyMMdd） */
    @Select("SELECT COALESCE(MAX(CAST(SUBSTRING(apply_no, 11) AS UNSIGNED)), 0) FROM edu_tenant_apply " +
            "WHERE del_flag = 0 AND apply_no LIKE CONCAT('AP', #{datePrefix}, '%')")
    int maxApplyNoSeq(@Param("datePrefix") String datePrefix);
}
