package org.jeecg.modules.edu.platform.tenant.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.modules.edu.platform.tenant.service.IEduTenantAdminService;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 平台端机构租户管理（FR-PT-008 ~ 014）。
 *
 * @author 教学云
 */
@Tag(name = "平台端-机构管理")
@RestController
@RequestMapping("/admin/tenants")
public class EduTenantAdminController {

    @Autowired
    private IEduTenantAdminService tenantAdminService;

    @Operation(summary = "机构列表")
    @GetMapping
    public ApiResult<PageResultVo<EduTenantRecordVo>> list(EduTenantQueryModel query) {
        return ApiResult.ok(tenantAdminService.listTenants(query));
    }

    @Operation(summary = "机构详情")
    @GetMapping("/{id}")
    public ApiResult<EduTenantDetailVo> detail(@PathVariable Integer id) {
        return ApiResult.ok(tenantAdminService.getTenantDetail(id));
    }

    @Operation(summary = "禁用机构")
    @PostMapping("/{id}/disable")
    public ApiResult<Void> disable(@PathVariable Integer id, @RequestBody EduTenantDisableModel model) {
        tenantAdminService.disableTenant(id, model);
        return ApiResult.ok();
    }

    @Operation(summary = "启用机构")
    @PostMapping("/{id}/enable")
    public ApiResult<Void> enable(@PathVariable Integer id) {
        tenantAdminService.enableTenant(id);
        return ApiResult.ok();
    }

    @Operation(summary = "机构续费")
    @PostMapping("/{id}/renew")
    public ApiResult<EduTenantRenewResultVo> renew(@PathVariable Integer id, @RequestBody EduTenantRenewModel model) {
        return ApiResult.ok(tenantAdminService.renewTenant(id, model));
    }

    @Operation(summary = "延长试用")
    @PostMapping("/{id}/trial-extend")
    public ApiResult<EduTenantExpireResultVo> extendTrial(@PathVariable Integer id,
                                                          @RequestBody EduTenantTrialExtendModel model) {
        return ApiResult.ok(tenantAdminService.extendTrial(id, model));
    }

    @Operation(summary = "试用转正式")
    @PostMapping("/{id}/activate")
    public ApiResult<EduTenantExpireResultVo> activate(@PathVariable Integer id,
                                                       @RequestBody EduTenantActivateModel model) {
        return ApiResult.ok(tenantAdminService.activateTenant(id, model));
    }

    @Operation(summary = "更新机构基础信息")
    @PostMapping("/{id}/base")
    public ApiResult<Void> updateBase(@PathVariable Integer id, @RequestBody EduTenantBaseUpdateModel model) {
        tenantAdminService.updateTenantBase(id, model);
        return ApiResult.ok();
    }

    @Operation(summary = "更新机构套餐权限")
    @PostMapping("/{id}/feature")
    public ApiResult<Void> updateFeature(@PathVariable Integer id, @RequestBody EduTenantFeatureUpdateModel model) {
        tenantAdminService.updateTenantFeature(id, model);
        return ApiResult.ok();
    }

    @Operation(summary = "更新机构数据隔离策略")
    @PostMapping("/{id}/isolation")
    public ApiResult<Void> updateIsolation(@PathVariable Integer id, @RequestBody EduTenantIsolationUpdateModel model) {
        tenantAdminService.updateTenantIsolation(id, model);
        return ApiResult.ok();
    }
}
