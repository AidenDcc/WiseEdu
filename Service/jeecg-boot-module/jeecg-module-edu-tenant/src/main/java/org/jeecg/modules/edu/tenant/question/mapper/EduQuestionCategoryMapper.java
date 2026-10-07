package org.jeecg.modules.edu.tenant.question.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.jeecg.modules.edu.tenant.question.entity.EduQuestionCategory;

/**
 * 题库分类 Mapper。
 *
 * <p>没有任何自定义 SQL —— 这是有意的。所有查询都走 BaseMapper，租户条件由
 * TenantLineInnerInterceptor 在 SQL 层追加，一旦这里手写 SQL 忘了带 tenant_id，
 * 就等于在隔离上开了个后门。确实需要自定义 SQL 时，必须显式带 {@code tenant_id = #{...}}。
 *
 * @author 教学云
 */
@Mapper
public interface EduQuestionCategoryMapper extends BaseMapper<EduQuestionCategory> {
}
