package org.jeecg.modules.edu.platform.tenant.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.modules.edu.platform.tenant.service.IEduTenantApplyService;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyApproveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyCreateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyQueryModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyRejectModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApproveResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.PageResultVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 平台端入驻审核（FR-PT-005 ~ 007）。
 *
 * @author 教学云
 */
@Tag(name = "平台端-入驻审核")
@RestController
@RequestMapping("/admin/tenant/applies")
public class EduTenantApplyController {

    @Autowired
    private IEduTenantApplyService applyService;

    @Operation(summary = "入驻申请列表")
    @GetMapping
    public ApiResult<PageResultVo<EduTenantApplyVo>> list(EduTenantApplyQueryModel query) {
        return ApiResult.ok(applyService.listApplies(query));
    }

    @Operation(summary = "新增机构（生成待审核申请）")
    @PostMapping
    public ApiResult<EduTenantApplyVo> create(@RequestBody EduTenantApplyCreateModel model) {
        return ApiResult.ok(applyService.createApply(model));
    }

    @Operation(summary = "通过申请（开户）")
    @PostMapping("/{id}/approve")
    public ApiResult<EduTenantApproveResultVo> approve(@PathVariable Long id,
                                                       @RequestBody EduTenantApplyApproveModel model) {
        return ApiResult.ok(applyService.approveApply(id, model));
    }

    @Operation(summary = "驳回申请")
    @PostMapping("/{id}/reject")
    public ApiResult<Void> reject(@PathVariable Long id, @RequestBody EduTenantApplyRejectModel model) {
        applyService.rejectApply(id, model);
        return ApiResult.ok();
    }
}
