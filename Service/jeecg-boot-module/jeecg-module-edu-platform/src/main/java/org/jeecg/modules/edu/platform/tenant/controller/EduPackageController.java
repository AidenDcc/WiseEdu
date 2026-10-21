package org.jeecg.modules.edu.platform.tenant.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.modules.edu.platform.tenant.service.IEduPackageService;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageSaveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 平台端套餐管理（FR-PT-014）。
 *
 * @author 教学云
 */
@Tag(name = "平台端-套餐")
@RestController
@RequestMapping("/admin/packages")
public class EduPackageController {

    @Autowired
    private IEduPackageService packageService;

    @Operation(summary = "套餐列表")
    @GetMapping
    public ApiResult<List<EduPackageVo>> list() {
        return ApiResult.ok(packageService.listAll());
    }

    @Operation(summary = "保存套餐（新增或编辑）")
    @PostMapping("/save")
    public ApiResult<EduPackageVo> save(@RequestBody EduPackageSaveModel model) {
        return ApiResult.ok(packageService.savePackage(model));
    }
}
