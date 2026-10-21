package org.jeecg.modules.system.oss.service;

import org.jeecg.modules.system.oss.entity.EduOssFile;
import org.jeecg.modules.system.oss.vo.EduFileVo;
import org.springframework.web.multipart.MultipartFile;

/**
 * 教学云对象存储业务门面。
 *
 * <p>业务代码只依赖这一层，不直接碰 {@code OssStorageService}（那是「怎么存」），
 * 也不直接碰 Mapper（那是「怎么记账」）。这样将来要换云厂商、加 CDN、加病毒扫描、
 * 加上传审计，都只需要改这一层的实现。
 *
 * @author 教学云
 */
public interface IEduOssFileService {

    /**
     * 上传文件并登记元数据。
     *
     * @param file     文件
     * @param bizType  业务分类（avatar/image/document/video/paper/courseware/import/export/common）
     * @param uploader 上传人账号
     */
    EduFileVo upload(MultipartFile file, String bizType, String uploader);

    /**
     * 登记一个「已经存在于桶里」的对象（如服务端生成的文件、从别处复制过来的对象）。
     *
     * @param storageKey 桶内 Key
     * @param bizType    业务分类
     * @param originName 原始文件名（可为空，空则用 Key 末段）
     * @param uploader   上传人账号
     */
    EduFileVo register(String storageKey, String bizType, String originName, String uploader);

    /** 按 Key 查元数据；不存在返回 null */
    EduOssFile findByKey(String storageKey);

    /**
     * 删除对象（同时软删元数据）。
     * 业务表删除记录时调用；幂等，重复调用不报错。
     */
    void remove(String storageKey);

    /**
     * 把「Key 或任意历史形态的地址」解析成当前可访问的地址。
     * 已经是 {@code data:} / 外部 http 地址时原样返回。
     */
    String resolveUrl(String keyOrUrl);

    /**
     * 同上，但生成有时间限制的临时地址（分享/导出用）。
     *
     * @param expireSeconds 有效期秒数，{@code <= 0} 用配置默认值
     */
    String resolveUrl(String keyOrUrl, long expireSeconds);

    /** 元数据访问，供 Controller 判断是否存在 */
    boolean storageAvailable();
}
