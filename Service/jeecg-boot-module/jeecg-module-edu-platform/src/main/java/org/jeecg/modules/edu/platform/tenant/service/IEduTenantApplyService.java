package org.jeecg.modules.edu.platform.tenant.service;

import com.baomidou.mybatisplus.extension.service.IService;
import org.jeecg.modules.edu.platform.tenant.entity.EduTenantApply;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyApproveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyCreateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyQueryModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyRejectModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApproveResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.PageResultVo;

/**
 * 入驻申请服务（FR-PT-005 ~ 007）。
 *
 * @author 教学云
 */
public interface IEduTenantApplyService extends IService<EduTenantApply> {

    /** 分页查询入驻申请 */
    PageResultVo<EduTenantApplyVo> listApplies(EduTenantApplyQueryModel query);

    /** 新增机构：生成一条待审核的入驻申请 */
    EduTenantApplyVo createApply(EduTenantApplyCreateModel model);

    /** 通过申请：开户（租户 + 初始管理员 + 试用期） */
    EduTenantApproveResultVo approveApply(Long id, EduTenantApplyApproveModel model);

    /** 驳回申请 */
    void rejectApply(Long id, EduTenantApplyRejectModel model);
}
