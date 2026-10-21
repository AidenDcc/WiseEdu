package org.jeecg.config.oss;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.util.oss.OssBootUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;

/**
 * 云存储 配置
 * @author: jeecg-boot
 */
@Slf4j
@Lazy(false)
@Configuration
@ConditionalOnProperty(prefix = "jeecg.oss", name = "endpoint")
public class OssConfiguration {

    @Value("${jeecg.oss.endpoint}")
    private String endpoint;
    @Value("${jeecg.oss.accessKey}")
    private String accessKeyId;
    @Value("${jeecg.oss.secretKey}")
    private String accessKeySecret;
    @Value("${jeecg.oss.bucketName}")
    private String bucketName;
    @Value("${jeecg.oss.staticDomain:}")
    private String staticDomain;


    @PostConstruct
    public void initOssBootConfiguration() {
        // 凭据缺失时不要把空串塞给静态工具类 —— 那样 OSS SDK 会抛出
        // "Access key id should not be null or empty"，用户看不出该去配哪个变量。
        // 打一条 WARN 后保持字段为空，OssBootUtil.initOss() 会转成可读的业务提示
        if (org.jeecg.common.util.oConvertUtils.isEmpty(accessKeyId)
                || org.jeecg.common.util.oConvertUtils.isEmpty(accessKeySecret)) {
            log.warn("[OSS] jeecg.oss.accessKey/secretKey 未配置（环境变量 EDU_OSS_ACCESS_KEY / EDU_OSS_SECRET_KEY），"
                    + "框架原生上传 /sys/common/upload 将返回明确的未启用提示");
            return;
        }
        OssBootUtil.setEndPoint(endpoint);
        OssBootUtil.setAccessKeyId(accessKeyId);
        OssBootUtil.setAccessKeySecret(accessKeySecret);
        OssBootUtil.setBucketName(bucketName);
        OssBootUtil.setStaticDomain(staticDomain);
    }
}