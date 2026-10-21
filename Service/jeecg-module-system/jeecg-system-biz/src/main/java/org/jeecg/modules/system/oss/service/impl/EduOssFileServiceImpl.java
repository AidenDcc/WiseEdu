package org.jeecg.modules.system.oss.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.config.TenantContext;
import org.jeecg.common.exception.JeecgBootException;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.common.util.oss.OssStorageService;
import org.jeecg.common.util.oss.OssStoredObject;
import org.jeecg.modules.system.oss.entity.EduOssFile;
import org.jeecg.modules.system.oss.mapper.EduOssFileMapper;
import org.jeecg.modules.system.oss.service.IEduOssFileService;
import org.jeecg.modules.system.oss.support.EduUploadPolicy;
import org.jeecg.modules.system.oss.vo.EduFileVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.Date;

/**
 * 对象存储业务实现。
 *
 * <p><b>一致性问题</b>：上传是「先写桶、再写库」两步，中间没有分布式事务。这里的选择是：
 * <b>以桶为准</b> —— 写库失败就把刚上传的对象删掉并抛出，避免出现「库里有一条指向不存在
 * 对象的记录」。反过来（先写库后上传）会产生「库里有记录但文件是空的」，更难排查。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduOssFileServiceImpl implements IEduOssFileService {

    /** 默认租户（平台级） */
    private static final long PLATFORM_TENANT = 0L;

    @Autowired
    private OssStorageService storage;

    @Autowired
    private EduOssFileMapper fileMapper;

    @Override
    public EduFileVo upload(MultipartFile file, String bizType, String uploader) {
        requireStorage();
        // 准入校验放在最前面：不合规的文件连桶都不该进
        EduUploadPolicy.check(file, bizType);

        OssStoredObject stored;
        try {
            stored = storage.put(file, storage.safeBiz(bizType));
        } catch (Exception e) {
            log.error("[OSS] 业务上传失败 name={} biz={}", file.getOriginalFilename(), bizType, e);
            throw new JeecgBootException("上传失败：" + e.getMessage());
        }

        try {
            EduOssFile row = buildRow(stored, bizType, uploader);
            fileMapper.insert(row);
            return toVo(row, stored.getUrl());
        } catch (Exception e) {
            // 记账失败 → 回收对象，避免桶里留下无主文件
            log.error("[OSS] 元数据落库失败，回收对象 key={}", stored.getKey(), e);
            storage.delete(stored.getKey());
            throw new JeecgBootException("上传失败：文件登记异常");
        }
    }

    @Override
    public EduFileVo register(String storageKey, String bizType, String originName, String uploader) {
        requireStorage();
        if (oConvertUtils.isEmpty(storageKey)) {
            throw new JeecgBootException("storageKey 不能为空");
        }

        EduOssFile exists = findByKey(storageKey);
        if (exists != null) {
            return toVo(exists, storage.toPublicUrl(storageKey));
        }

        String name = oConvertUtils.isEmpty(originName)
                ? storageKey.substring(storageKey.lastIndexOf('/') + 1)
                : originName;
        OssStoredObject probe = OssStoredObject.builder()
                .key(storageKey)
                .bucket(storage.getProperties().getBucketName())
                .size(0)
                .contentType(null)
                .originalName(name)
                .build();
        var meta = storage.metadata(storageKey);
        if (meta != null) {
            probe.setSize(meta.getContentLength());
            probe.setContentType(meta.getContentType());
        }

        EduOssFile row = buildRow(probe, bizType, uploader);
        fileMapper.insert(row);
        return toVo(row, storage.toPublicUrl(storageKey));
    }

    @Override
    public EduOssFile findByKey(String storageKey) {
        if (oConvertUtils.isEmpty(storageKey)) {
            return null;
        }
        LambdaQueryWrapper<EduOssFile> q = new LambdaQueryWrapper<>();
        q.eq(EduOssFile::getStorageKey, storageKey)
                .eq(EduOssFile::getDeleted, 0)
                .last("limit 1");
        return fileMapper.selectOne(q);
    }

    @Override
    public void remove(String storageKey) {
        if (oConvertUtils.isEmpty(storageKey) || !storage.available()) {
            return;
        }
        storage.delete(storageKey);
        EduOssFile row = findByKey(storageKey);
        if (row != null) {
            row.setDeleted(1);
            row.setUpdateTime(new Date());
            fileMapper.updateById(row);
        }
    }

    @Override
    public String resolveUrl(String keyOrUrl) {
        return resolveUrl(keyOrUrl, -1);
    }

    @Override
    public String resolveUrl(String keyOrUrl, long expireSeconds) {
        if (oConvertUtils.isEmpty(keyOrUrl)) {
            return "";
        }
        String value = keyOrUrl.trim();
        // data URL（历史头像）、外部链接（AI 生成的临时图等）都不是桶里的东西，原样返回
        if (value.startsWith("data:") || value.startsWith("blob:")) {
            return value;
        }
        if (!storage.available()) {
            return value;
        }
        String key = storage.keyFromUrl(value);
        if (oConvertUtils.isEmpty(key) || key.startsWith("http")) {
            return value;
        }
        return storage.proxyUrl(key, expireSeconds);
    }

    @Override
    public boolean storageAvailable() {
        return storage.available();
    }

    /* ------------------------------------------------------------------ */

    private void requireStorage() {
        if (!storage.available()) {
            throw new JeecgBootException("对象存储未启用，请联系管理员检查 edu.oss 配置");
        }
    }

    /** 组装元数据行（uploader / tenantId / 扩展名 / 时间都由这里统一决定） */
    private EduOssFile buildRow(OssStoredObject stored, String bizType, String uploader) {
        Date now = new Date();
        String name = stored.getOriginalName() == null ? "" : stored.getOriginalName();
        String ext = EduUploadPolicy.extOf(name);
        int tenant = oConvertUtils.getInt(TenantContext.getTenant(), (int) PLATFORM_TENANT);

        return new EduOssFile()
                .setTenantId((long) tenant)
                .setBizType(storage.safeBiz(bizType))
                .setOriginName(name.isEmpty() ? null : name)
                .setStorageKey(stored.getKey())
                .setBucket(stored.getBucket())
                .setSizeBytes(stored.getSize())
                .setMime(stored.getContentType())
                .setExt(ext.isEmpty() ? null : ext)
                .setUrl(stored.getUrl())
                .setEtag(stored.getEtag())
                .setUploader(uploader)
                .setCreateBy(uploader)
                .setCreateTime(now)
                .setUpdateBy(uploader)
                .setUpdateTime(now)
                .setDeleted(0);
    }

    private EduFileVo toVo(EduOssFile row, String url) {
        EduFileVo vo = new EduFileVo();
        vo.setId(row.getId() == null ? null : String.valueOf(row.getId()));
        vo.setKey(row.getStorageKey());
        vo.setUrl(url);
        vo.setName(row.getOriginName());
        vo.setSize(row.getSizeBytes() == null ? 0 : row.getSizeBytes());
        vo.setMime(row.getMime());
        vo.setExt(row.getExt());
        vo.setBiz(row.getBizType());
        vo.setUploadTime(row.getCreateTime() == null ? 0 : row.getCreateTime().getTime());
        return vo;
    }
}
