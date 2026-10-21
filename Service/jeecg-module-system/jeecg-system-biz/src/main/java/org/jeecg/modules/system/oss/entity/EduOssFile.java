package org.jeecg.modules.system.oss.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.Date;

/**
 * 对象存储文件元数据（{@code edu_oss_file}）。
 *
 * <p><b>为什么桶里已经有文件了还要一张表</b>：
 * <ul>
 *   <li><b>可追溯</b>：桶里只有一个 UUID 文件名，出了「这张图是谁传的、属于哪个租户」的问题时，
 *       没有表就只能去翻 OSS 日志；</li>
 *   <li><b>可清理</b>：业务表删除记录后，靠本表能找出变成孤儿的对象做批量回收；</li>
 *   <li><b>可统计</b>：按租户/业务类型算存储用量（套餐配额要用）；</li>
 *   <li><b>可去重</b>：ETag + 大小一致时可以直接复用已有对象，省一次上传。</li>
 * </ul>
 *
 * <p>不把这张表做成「所有业务都必须外键引用」的强约束：各业务表仍然只存
 * {@code storage_key} 字符串。原因是不同业务的生命周期差异很大（题目配图会被复制到试卷、
 * 课件会被克隆到其他租户），硬外键会让「删除一张题」变成一件会失败的事。
 *
 * @author 教学云
 */
@Data
@EqualsAndHashCode(callSuper = false)
@Accessors(chain = true)
@TableName("edu_oss_file")
@Schema(description = "教学云-对象存储文件元数据")
public class EduOssFile implements Serializable {

    private static final long serialVersionUID = 1L;

    @TableId(type = IdType.ASSIGN_ID)
    @Schema(description = "主键（雪花ID）")
    private Long id;

    @Schema(description = "租户ID，平台级为 0")
    private Long tenantId;

    @Schema(description = "业务分类：avatar/image/document/video/audio/paper/courseware/import/export/common")
    private String bizType;

    @Schema(description = "原始文件名")
    private String originName;

    @Schema(description = "桶内对象 Key")
    private String storageKey;

    @Schema(description = "桶名")
    private String bucket;

    @Schema(description = "字节数")
    private Long sizeBytes;

    @Schema(description = "MIME")
    private String mime;

    @Schema(description = "扩展名（不含点）")
    private String ext;

    @Schema(description = "最近一次生成的访问地址（仅作排查线索，业务以 storageKey 为准）")
    private String url;

    @Schema(description = "OSS ETag")
    private String etag;

    @Schema(description = "上传人账号")
    private String uploader;

    @Schema(description = "创建人")
    private String createBy;

    @Schema(description = "创建时间")
    private Date createTime;

    @Schema(description = "修改人")
    private String updateBy;

    @Schema(description = "修改时间")
    private Date updateTime;

    @Schema(description = "删除标记：0 正常 1 已删除")
    private Integer deleted;
}
