package org.jeecg.modules.edu.tenant.question.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.SecurityUtils;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.system.vo.LoginUser;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.modules.edu.tenant.question.entity.EduQuestionCategory;
import org.jeecg.modules.edu.tenant.question.mapper.EduQuestionCategoryMapper;
import org.jeecg.modules.edu.tenant.question.service.IEduQuestionCategoryService;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategorySaveModel;
import org.jeecg.modules.edu.tenant.question.vo.EduQuestionCategoryVo;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 题库分类实现。
 *
 * <p>三条业务规则照搬前端 Mock（org-store.ts）的既有行为，保证灰度切换后前端表现一致：
 * 同级不可重名、子分类继承父级题库归属、有子分类时不可删除。
 *
 * <p><b>每个方法里的查询都没有写 tenant_id 条件</b> —— 这是对的。
 * 本表已登记进 TENANT_TABLE，TenantLineInnerInterceptor 会在生成的 SQL 上追加 {@code AND tenant_id = ?}，
 * 手写反而会与拦截器叠加成两遍条件（且值可能不一致）。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduQuestionCategoryServiceImpl
        extends ServiceImpl<EduQuestionCategoryMapper, EduQuestionCategory>
        implements IEduQuestionCategoryService {

    private static final String LIBRARY_PERSONAL = "personal";

    @Override
    public List<EduQuestionCategoryVo> listAll() {
        LambdaQueryWrapper<EduQuestionCategory> query = new LambdaQueryWrapper<>();
        // 顶层在前、同级按 sort_no，前端据此组树；这里不做树化，保持接口返回扁平数组与 Mock 一致
        query.orderByAsc(EduQuestionCategory::getParentId)
                .orderByAsc(EduQuestionCategory::getSortNo)
                .orderByAsc(EduQuestionCategory::getId);
        List<EduQuestionCategory> rows = this.list(query);
        List<EduQuestionCategoryVo> result = new ArrayList<>(rows.size());
        for (EduQuestionCategory row : rows) {
            result.add(toVo(row));
        }
        return result;
    }

    @Override
    public EduQuestionCategoryVo saveCategory(EduQuestionCategorySaveModel model) {
        if (oConvertUtils.isEmpty(model.getName())) {
            throw new JeecgBootBizTipException("分类名称不能为空");
        }
        String name = model.getName().trim();

        if (model.getId() != null) {
            return toVo(rename(model.getId(), name, model));
        }
        return toVo(create(name, model));
    }

    /** 改名 / 换父级。同级重名校验要排除自己，否则「不改名字只点保存」会被自己挡住 */
    private EduQuestionCategory rename(Long id, String name, EduQuestionCategorySaveModel model) {
        EduQuestionCategory existing = this.getById(id);
        if (existing == null) {
            throw new JeecgBootBizTipException("分类不存在");
        }
        Long targetParent = model.getParentId();
        if (id.equals(targetParent)) {
            throw new JeecgBootBizTipException("不能把分类挂到自己下面");
        }
        assertNoSiblingWithSameName(targetParent, name, id);

        EduQuestionCategory update = new EduQuestionCategory()
                .setId(id)
                .setName(name)
                .setParentId(targetParent)
                .setUpdateBy(currentUsername())
                .setUpdateTime(new Date());
        // library 只在顶层分类上有意义：挂到父级下时跟随父级，顶层时允许显式指定
        if (targetParent == null) {
            update.setLibrary(oConvertUtils.isEmpty(model.getLibrary()) ? existing.getLibrary() : model.getLibrary());
        } else {
            EduQuestionCategory parent = this.getById(targetParent);
            if (parent == null) {
                throw new JeecgBootBizTipException("父分类不存在");
            }
            update.setLibrary(parent.getLibrary());
        }
        this.updateById(update);
        return this.getById(id);
    }

    private EduQuestionCategory create(String name, EduQuestionCategorySaveModel model) {
        Long parentId = model.getParentId();
        assertNoSiblingWithSameName(parentId, name, null);

        String library;
        if (parentId != null) {
            // 子分类的归属继承父级，忽略入参里的 library —— 与前端 Mock 一致：
            // 否则「机构公共题库」下会挂出一个 personal 的子节点
            EduQuestionCategory parent = this.getById(parentId);
            if (parent == null) {
                throw new JeecgBootBizTipException("父分类不存在");
            }
            library = parent.getLibrary();
        } else {
            library = oConvertUtils.isEmpty(model.getLibrary()) ? LIBRARY_PERSONAL : model.getLibrary();
        }

        EduQuestionCategory entity = new EduQuestionCategory()
                .setName(name)
                .setLibrary(library)
                .setParentId(parentId)
                .setOwnerId(currentUserId())
                .setSortNo(nextSortNo(parentId))
                .setDelFlag(0);
        // tenantId / createBy / createTime 由 MybatisInterceptor 注入，此处不设
        this.save(entity);
        return entity;
    }

    @Override
    public void deleteCategory(Long id) {
        if (id == null) {
            throw new JeecgBootBizTipException("分类ID不能为空");
        }
        EduQuestionCategory existing = this.getById(id);
        if (existing == null) {
            throw new JeecgBootBizTipException("分类不存在");
        }
        LambdaQueryWrapper<EduQuestionCategory> children = new LambdaQueryWrapper<>();
        children.eq(EduQuestionCategory::getParentId, id);
        if (this.count(children) > 0) {
            throw new JeecgBootBizTipException("请先删除子分类");
        }
        // 题目表尚未落地（机构端其余接口属后续期次），「该分类下仍有题目」的校验待题目表就绪后补上
        this.removeById(id);
    }

    /* ------------------------------------------------------------------ */

    private void assertNoSiblingWithSameName(Long parentId, String name, Long excludeId) {
        LambdaQueryWrapper<EduQuestionCategory> query = new LambdaQueryWrapper<>();
        query.eq(EduQuestionCategory::getName, name);
        if (parentId == null) {
            query.isNull(EduQuestionCategory::getParentId);
        } else {
            query.eq(EduQuestionCategory::getParentId, parentId);
        }
        if (excludeId != null) {
            query.ne(EduQuestionCategory::getId, excludeId);
        }
        if (this.count(query) > 0) {
            throw new JeecgBootBizTipException("同级下已存在同名分类");
        }
    }

    private Integer nextSortNo(Long parentId) {
        LambdaQueryWrapper<EduQuestionCategory> query = new LambdaQueryWrapper<>();
        if (parentId == null) {
            query.isNull(EduQuestionCategory::getParentId);
        } else {
            query.eq(EduQuestionCategory::getParentId, parentId);
        }
        return Math.toIntExact(this.count(query) + 1);
    }

    private static EduQuestionCategoryVo toVo(EduQuestionCategory entity) {
        EduQuestionCategoryVo vo = new EduQuestionCategoryVo();
        vo.setId(entity.getId());
        vo.setName(entity.getName());
        vo.setLibrary(entity.getLibrary());
        vo.setParentId(entity.getParentId());
        vo.setOwnerId(entity.getOwnerId());
        return vo;
    }

    private static LoginUser currentLoginUser() {
        Object principal = SecurityUtils.getSubject().getPrincipal();
        return principal instanceof LoginUser ? (LoginUser) principal : null;
    }

    private static String currentUserId() {
        LoginUser user = currentLoginUser();
        return user == null ? null : user.getId();
    }

    private static String currentUsername() {
        LoginUser user = currentLoginUser();
        return user == null ? null : user.getUsername();
    }
}
