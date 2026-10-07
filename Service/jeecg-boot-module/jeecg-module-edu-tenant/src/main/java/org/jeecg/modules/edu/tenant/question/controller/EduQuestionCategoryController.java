package org.jeecg.modules.edu.tenant.question.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.modules.edu.tenant.question.service.IEduQuestionCategoryService;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategorySaveModel;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategoryVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 机构端题库分类（FR-TM-001）。
 *
 * <p>机构端 Wave 1 唯一一条完整链路，作用是让「租户隔离真的生效」可被验证：
 * 同一份代码、同一个库里，租户 1000 的 token 只能看到 1000 的分类。
 *
 * <p>路径照抄前端 apps/tenant/src/api/org.ts：{@code GET /tenant/categories}、
 * {@code POST /tenant/categories/save}、{@code POST /tenant/categories/delete}。
 * 前缀必须自带 /tenant —— 网关的 strip_prefix 实际不生效（见 AdminDashboardController 的说明）。
 *
 * @author 教学云
 */
@Slf4j
@Tag(name = "机构端-题库分类")
@RestController
@RequestMapping("/tenant/categories")
public class EduQuestionCategoryController {

    @Autowired
    private IEduQuestionCategoryService categoryService;

    @Operation(summary = "分类列表（扁平数组，前端自行组树）")
    @GetMapping
    public ApiResult<List<EduQuestionCategoryVo>> list() {
        return ApiResult.ok(categoryService.listAll());
    }

    @Operation(summary = "保存分类（有 id 为改，无 id 为增）")
    @PostMapping("/save")
    public ApiResult<EduQuestionCategoryVo> save(@RequestBody EduQuestionCategorySaveModel model) {
        return ApiResult.ok(categoryService.saveCategory(model));
    }

    /**
     * 删除分类。
     *
     * <p>入参是 {@code {id}} 形式的裸对象而不是路径变量，与前端 deleteCategory 的调用方式一致。
     * 用 Map 接而不是定义 DTO：只有一个字段，且这里要区分「没传 id」和「id 为 0」——
     * 交给 Service 判空并给出中文提示，比让 Jackson 反序列化失败更友好。
     */
    @Operation(summary = "删除分类")
    @PostMapping("/delete")
    public ApiResult<Void> delete(@RequestBody Map<String, Object> body) {
        Object raw = body == null ? null : body.get("id");
        Long id = null;
        if (raw instanceof Number) {
            id = ((Number) raw).longValue();
        } else if (raw instanceof String && !((String) raw).isBlank()) {
            id = Long.valueOf(((String) raw).trim());
        }
        categoryService.deleteCategory(id);
        return ApiResult.ok();
    }
}
