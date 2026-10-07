package org.jeecg.modules.edu.tenant.question.service;

import com.baomidou.mybatisplus.extension.service.IService;
import org.jeecg.modules.edu.tenant.question.entity.EduQuestionCategory;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategorySaveModel;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategoryVo;

import java.util.List;

/**
 * 题库分类（FR-TM-001）。
 *
 * @author 教学云
 */
public interface IEduQuestionCategoryService extends IService<EduQuestionCategory> {

    /** 当前租户下的全部分类，按父级 + 排序号排列，前端自行组树 */
    List<EduQuestionCategoryVo> listAll();

    /** 新增或修改。有 id 为改，无 id 为增 */
    EduQuestionCategoryVo saveCategory(EduQuestionCategorySaveModel model);

    /** 删除。仍有子分类时拒绝 */
    void deleteCategory(Long id);
}
