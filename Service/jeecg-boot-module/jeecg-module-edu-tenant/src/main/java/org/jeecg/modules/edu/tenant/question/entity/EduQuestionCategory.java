package org.jeecg.modules.edu.tenant.question.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.Date;

/**
 * 题库分类（机构端）。
 *
 * <p><b>为什么不继承 JeecgEntity</b>：基类把主键定义成 {@code String id} + {@code IdType.ASSIGN_ID}（雪花串），
 * 而前端 OrgCategory.id 是 number —— 19 位雪花串超出 JS Number.MAX_SAFE_INTEGER，传过去会静默丢精度。
 * 本表改用 bigint AUTO_INCREMENT，Java 侧是 Long，与前端对得上。Java 不允许子类把父类字段改成别的类型，
 * 所以这里显式声明审计字段，而不是继承后再覆盖。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_question_category")
@Schema(description = "题库分类")
public class EduQuestionCategory implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.AUTO)
    @Schema(description = "主键")
    private Long id;

    @Schema(description = "分类名称")
    private String name;

    /** 取值 personal / org / wrong，与前端 QuestionLibrary 一致 */
    @Schema(description = "题库归属：personal|org|wrong")
    private String library;

    @Schema(description = "父分类ID，顶层为 null")
    private Long parentId;

    /** sys_user.id 是雪花串，这里按字符串存 */
    @Schema(description = "创建者用户ID（雪花串）")
    private String ownerId;

    @Schema(description = "排序号")
    private Integer sortNo;

    /**
     * 租户ID。
     *
     * <p><b>业务代码不要给它赋值</b>：MybatisInterceptor 在 INSERT 时发现该字段为 null，
     * 会自动填入当前登录租户（见 MybatisInterceptor 的注入租户ID 段）；查询侧由
     * TenantLineInnerInterceptor 自动追加 {@code tenant_id = ?} 条件（本表已登记进 TENANT_TABLE）。
     * 手工赋值会写坏隔离。
     */
    @Schema(description = "租户ID，由框架自动维护")
    private Integer tenantId;

    @Schema(description = "创建人")
    private String createBy;

    @Schema(description = "创建时间")
    private Date createTime;

    @Schema(description = "更新人")
    private String updateBy;

    @Schema(description = "更新时间")
    private Date updateTime;

    @TableLogic
    @Schema(description = "删除状态(0-正常,1-已删除)")
    private Integer delFlag;
}
