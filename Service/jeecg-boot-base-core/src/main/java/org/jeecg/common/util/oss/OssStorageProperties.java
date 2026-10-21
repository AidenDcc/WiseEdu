package org.jeecg.common.util.oss;

import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 教学云对象存储（阿里云 OSS）配置 —— {@code edu.oss.*}。
 *
 * <p><b>为什么不直接复用框架的 {@code jeecg.oss.*}</b>：
 * 框架那套是「上传即公读」的模型 —— 上传成功返回 {@code https://bucket.endpoint/key}
 * 直链，桶必须是公共读，或者代码里把桶 ACL 改成 PublicRead。生产安全基线不允许
 * （本项目 {@code aiden-dcc} 桶读写权限是「私有」），所以需要一套「私有桶 + 签名代理」
 * 语义的配置。框架的 {@code jeecg.oss.*} 仍然保留，但只作为 {@code /sys/common/upload}
 * 这类框架原生接口的入口，最终也由 {@link OssStorageService} 统一落到同一个桶里。
 *
 * <p><b>凭据一律从环境变量注入</b>，配置文件不落明文：
 * <pre>
 *   EDU_OSS_ACCESS_KEY / EDU_OSS_SECRET_KEY
 *   EDU_OSS_ENDPOINT   / EDU_OSS_BUCKET
 * </pre>
 *
 * @author 教学云
 */
@Slf4j
@Data
@Component
@ConfigurationProperties(prefix = "edu.oss")
public class OssStorageProperties {

    /** 总开关。关闭时上传行为回落到改造前（框架原生逻辑），便于无网 / 未配凭据时启动 */
    private boolean enabled = false;

    /** 地域 Endpoint，如 {@code oss-cn-guangzhou.aliyuncs.com}（不带协议与桶名） */
    private String endpoint;

    /** 访问密钥 ID */
    private String accessKey;

    /** 访问密钥 Secret */
    private String secretKey;

    /** 桶名 */
    private String bucketName;

    /**
     * 对象 Key 前缀（相当于桶内的业务根目录）。
     * 统一前缀便于与同桶内其它系统文件区分，也便于按前缀配生命周期规则。
     */
    private String keyPrefix = "edu";

    /**
     * 私有桶开关。true 时上传返回「后端签名代理地址」而不是 OSS 直链；
     * 私有桶必须置 true，否则前端拿到的直链会 403。
     */
    private boolean privateRead = true;

    /**
     * 代理地址前缀，即浏览器访问后端时的路径前缀。
     * 开发态前端 Vite 把 {@code /api} 转发到 9999，所以默认 {@code /api}；
     * 生产若前后端同域且 Nginx 直接透传，可设为空串。
     */
    private String proxyBaseUrl = "/api";

    /** 签名密钥；留空时回落到 {@code jeecg.signatureSecret}，再空则用内置常量 */
    private String signSecret;

    /**
     * 签名有效期（秒）。{@code 0} = 长期有效。
     *
     * <p>业务库里存的是「长期可用的引用地址」（课件、题目配图要能一直打开），
     * 靠 Key 不可枚举 + HMAC 防篡改保证安全；需要临时分享链接时另调
     * {@link OssStorageService#proxyUrl(String, long)} 传具体秒数。
     */
    private long signExpireSeconds = 0;

    /** 单文件大小上限（MB） */
    private long maxSizeMb = 200;

    /** 连接超时（毫秒） */
    private int connectTimeoutMs = 10_000;

    /** 读写超时（毫秒） */
    private int socketTimeoutMs = 60_000;

    /**
     * 自定义域名（如 {@code https://aiden-dcc.cn-guangzhou.taihangztn.cn}）。
     * 仅在桶开了公共读（或 CDN 回源鉴权）时才有意义，私有桶请留空。
     */
    private String publicDomain;

    /** 配置是否完整到可以真正调用 OSS */
    public boolean isReady() {
        return enabled
                && notBlank(endpoint)
                && notBlank(accessKey)
                && notBlank(secretKey)
                && notBlank(bucketName);
    }

    private boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
