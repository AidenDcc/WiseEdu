package org.jeecg.modules.edu.tenant.question.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 分类保存入参。有 id 是改，无 id 是新增 —— 与前端 saveCategory 的语义一致。
 *
 * @author 教学云
 */
@Data
@Schema(description = "分类保存入参")
public class EduQuestionCategorySaveModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "主键，为空表示新增")
    private Long id;

    @Schema(description = "分类名称")
    private String name;

    @Schema(description = "父分类ID，顶层传 null")
    private Long parentId;

    /** 仅在顶层分类有意义：子分类的归属继承自父级 */
    @Schema(description = "题库归属：personal|org|wrong，仅顶层分类生效")
    private String library;
}
