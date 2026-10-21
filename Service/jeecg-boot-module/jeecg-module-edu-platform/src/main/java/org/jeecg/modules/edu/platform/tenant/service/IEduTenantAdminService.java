package org.jeecg.modules.edu.platform.tenant.service;

import org.jeecg.modules.edu.platform.tenant.vo.EduTenantActivateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantBaseUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantDetailVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantDisableModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantExpireResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantFeatureUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantIsolationUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantQueryModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRecordVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRenewModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRenewResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantTrialExtendModel;
import org.jeecg.modules.edu.platform.tenant.vo.PageResultVo;

/**
 * 机构租户管理服务（FR-PT-008 ~ 014）。
 *
 * @author 教学云
 */
public interface IEduTenantAdminService {

    /** 分页查询机构租户 */
    PageResultVo<EduTenantRecordVo> listTenants(EduTenantQueryModel query);

    /** 机构详情（基本信息 + 套餐 + 资源统计 + AI 调用量） */
    EduTenantDetailVo getTenantDetail(Integer id);

    /** 禁用机构（记录原因，立即下线登录） */
    void disableTenant(Integer id, EduTenantDisableModel model);

    /** 启用机构：恢复原状态（到期仍到期、试用仍试用） */
    void enableTenant(Integer id);

    /** 续费：到期时间顺延，返回新到期时间与金额 */
    EduTenantRenewResultVo renewTenant(Integer id, EduTenantRenewModel model);

    /** 延长试用（1-90 天） */
    EduTenantExpireResultVo extendTrial(Integer id, EduTenantTrialExtendModel model);

    /** 试用转正式 */
    EduTenantExpireResultVo activateTenant(Integer id, EduTenantActivateModel model);

    /** 更新基础信息 */
    void updateTenantBase(Integer id, EduTenantBaseUpdateModel model);

    /** 更新套餐权限（功能开关 + 配额） */
    void updateTenantFeature(Integer id, EduTenantFeatureUpdateModel model);

    /** 更新数据隔离策略（创建 24 小时后禁止变更） */
    void updateTenantIsolation(Integer id, EduTenantIsolationUpdateModel model);
}
