package org.jeecg.modules.system.oss.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 上传结果（前端契约）。
 *
 * <p>刻意同时给出 {@code key} 和 {@code url}：
 * <ul>
 *   <li>{@code key} 是持久化用的唯一标识 —— 业务表应存它，换域名 / 换桶 / 改签名策略都不受影响；</li>
 *   <li>{@code url} 是「现在就能渲染」的地址 —— 私有桶下是后端签名代理地址。</li>
 * </ul>
 *
 * @author 教学云
 */
@Data
@Schema(description = "教学云-文件上传结果")
public class EduFileVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "文件记录ID（edu_oss_file.id）")
    private String id;

    @Schema(description = "对象存储 Key，业务表应存这个")
    private String key;

    @Schema(description = "可直接访问的地址（私有桶为签名代理地址）")
    private String url;

    @Schema(description = "原始文件名")
    private String name;

    @Schema(description = "字节数")
    private long size;

    @Schema(description = "MIME")
    private String mime;

    @Schema(description = "扩展名（不含点）")
    private String ext;

    @Schema(description = "业务分类")
    private String biz;

    @Schema(description = "上传时间（毫秒时间戳）")
    private long uploadTime;
}
