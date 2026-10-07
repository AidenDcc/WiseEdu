package org.jeecg.modules.edu.tenant.question.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 题库分类出参，对应前端 @aiteach/shared 的 OrgCategory。
 *
 * <p>刻意不复用实体：实体上带着 tenantId / createBy / delFlag，直接序列化出去等于把租户ID暴露给前端，
 * 而前端也不需要。出参只保留契约里有的 5 个字段。
 *
 * @author 教学云
 */
@Data
@Schema(description = "题库分类")
public class EduQuestionCategoryVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键")
    private Long id;

    @Schema(description = "分类名称")
    private String name;

    @Schema(description = "题库归属：personal|org|wrong")
    private String library;

    @Schema(description = "父分类ID，顶层为 null")
    private Long parentId;

    /** 注意：前端 OrgCategory.ownerId 声明为 number，但真实 sys_user.id 是 19 位雪花串，
     *  这里按字符串返回；前端该字段类型需放宽为 string | number。 */
    @Schema(description = "创建者用户ID（雪花串）")
    private String ownerId;
}
