package org.jeecg.common.util.oss;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 一次成功上传的结果：对象存储视角的元数据 + 可直接给前端用的访问地址。
 *
 * @author 教学云
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OssStoredObject implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 桶内对象 Key（业务库里应该存这个，而不是拼好的 URL） */
    private String key;

    /** 前端可直接访问的地址（私有桶 = 后端签名代理地址；公读 = OSS 直链） */
    private String url;

    /** 桶名 */
    private String bucket;

    /** 字节数 */
    private long size;

    /** MIME */
    private String contentType;

    /** OSS 返回的 ETag（去掉引号），可用于校验与去重 */
    private String etag;

    /** 原始文件名 */
    private String originalName;

    /** 业务分类（avatar / image / document / video / audio / paper / courseware ...） */
    private String bizType;
}
