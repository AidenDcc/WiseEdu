package org.jeecg.common.util.oss;

import com.aliyun.oss.ClientBuilderConfiguration;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.model.GetObjectRequest;
import com.aliyun.oss.model.OSSObject;
import com.aliyun.oss.model.ObjectMetadata;
import com.aliyun.oss.model.PutObjectRequest;
import com.aliyun.oss.model.PutObjectResult;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.exception.JeecgBootException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;

/**
 * 教学云统一对象存储服务（阿里云 OSS）。
 *
 * <p><b>职责边界</b>：只管「把字节放进桶里 / 从桶里取出来 / 生成可访问地址 / 删除」，
 * 不关心业务表怎么记（那是 {@code sys_oss_file} 与各业务表的事），也不做文件类型白名单
 * （不同业务允许的类型不同，由调用方传入的 {@code bizType} 决定策略）。
 *
 * <p><b>为什么放在 base-core</b>：框架原生上传 {@link OssBootUtil} 也在这一层，
 * 只有放这里才能让「框架接口」和「教学云业务接口」共用同一个 OSS 客户端与同一套签名，
 * 否则会出现两套 Client、两份配置、两种 URL 格式。
 *
 * <p><b>桶是私有的</b>：上传后返回的不是 {@code https://bucket.endpoint/key}，
 * 而是 {@code /api/sys/edu-file/view?key=...&sign=...} 这种「后端签名代理地址」。
 * 字节由后端从 OSS 拉取后回写，浏览器不直接接触 OSS，也不接触 AK/SK。
 * 详见 {@link OssUrlSigner} 的类注释。
 *
 * <p><b>客户端生命周期</b>：{@link OSS} 是线程安全的，全应用一个实例即可；
 * 启动时若配置不完整（{@code edu.oss.enabled=false} 或缺少 AK/SK），
 * 客户端保持为空，{@link #available()} 返回 false，调用方回落到本地存储 —— 这样
 * 没有 OSS 凭据的开发者仍然能起服务。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class OssStorageService {

    /** 私有桶代理接口路径（与 {@code EduFileController} 的映射保持一致） */
    public static final String VIEW_PATH = "/sys/edu-file/view";

    /** 下载接口路径 */
    public static final String DOWNLOAD_PATH = "/sys/edu-file/download";

    @Autowired
    private OssStorageProperties props;

    /** 生效的签名密钥（初始化时定好，避免每次拼接都做空判断） */
    private String signSecret;

    /** OSS 客户端；配置不完整时为 null */
    private volatile OSS client;

    @PostConstruct
    public void init() {
        this.signSecret = OssUrlSigner.effectiveSecret(props.getSignSecret());

        if (!props.isReady()) {
            log.warn("[OSS] 未启用或配置不完整（edu.oss.enabled={}, endpoint={}, bucket={}），"
                            + "上传将回落到本地磁盘存储",
                    props.isEnabled(), props.getEndpoint(), props.getBucketName());
            return;
        }

        ClientBuilderConfiguration conf = new ClientBuilderConfiguration();
        conf.setConnectionTimeout(props.getConnectTimeoutMs());
        conf.setSocketTimeout(props.getSocketTimeoutMs());
        // 私有桶场景全部走「后端拉流」，用不到 CNAME 与 302 跳转，保持默认更可预期
        this.client = new OSSClientBuilder().build(
                props.getEndpoint(), props.getAccessKey(), props.getSecretKey(), conf);

        // 把能力交给框架上传工具：/sys/common/upload 等原生接口也随之走 OSS
        OssBootUtil.setStorage(this);

        log.info("[OSS] 已启用：bucket={} endpoint={} 私有读={} 代理前缀={}",
                props.getBucketName(), props.getEndpoint(), props.isPrivateRead(), props.getProxyBaseUrl());
    }

    @PreDestroy
    public void shutdown() {
        OSS c = this.client;
        if (c != null) {
            try {
                c.shutdown();
            } catch (Exception e) {
                log.warn("[OSS] 关闭客户端异常：{}", e.getMessage());
            }
        }
    }

    /** OSS 是否可用（配置完整且客户端已建好） */
    public boolean available() {
        return client != null;
    }

    public OssStorageProperties getProperties() {
        return props;
    }

    /** 统一 Key 前缀，如 {@code edu} */
    public String keyPrefix() {
        String p = props.getKeyPrefix();
        if (p == null || p.isBlank()) {
            return "edu";
        }
        p = p.trim().replaceAll("^/+|/+$", "");
        return p.isEmpty() ? "edu" : p;
    }

    /* ==================================================================== */
    /*                                 上传                                  */
    /* ==================================================================== */

    /** 上传一个 Spring MVC 文件（业务接口最常见入口） */
    public OssStoredObject put(MultipartFile file, String bizType) throws IOException {
        return put(file, bizType, null);
    }

    /**
     * 上传一个 Spring MVC 文件。
     *
     * @param file           文件
     * @param bizType        业务分类，作为 Key 的第二段目录（avatar/image/document/video...）
     * @param bucketOverride 指定桶（为空用默认桶）。AI 模块等少数场景会往独立桶写
     */
    public OssStoredObject put(MultipartFile file, String bizType, String bucketOverride) throws IOException {
        requireAvailable();
        if (file == null || file.isEmpty()) {
            throw new JeecgBootException("上传文件为空");
        }
        long maxBytes = props.getMaxSizeMb() * 1024L * 1024L;
        if (file.getSize() > maxBytes) {
            throw new JeecgBootException("文件超过 " + props.getMaxSizeMb() + "MB 上限");
        }

        String originalName = cleanName(file.getOriginalFilename());
        String contentType = resolveContentType(file.getContentType(), originalName);
        // 用 try-with-resources 关掉 MultipartFile 的流：容器用的是临时文件，不关会攒句柄
        try (InputStream in = file.getInputStream()) {
            return put(in, file.getSize(), contentType, originalName, bizType, bucketOverride);
        }
    }

    /** 上传字节数组（导出、图片处理等内存态场景） */
    public OssStoredObject put(byte[] bytes, String contentType, String originalName, String bizType) {
        requireAvailable();
        if (bytes == null || bytes.length == 0) {
            throw new JeecgBootException("上传内容为空");
        }
        String name = cleanName(originalName);
        return put(new ByteArrayInputStream(bytes), bytes.length,
                resolveContentType(contentType, name), name, bizType, null);
    }

    /**
     * 上传输入流。
     *
     * @param size 字节数。OSS 的简单上传需要 Content-Length 才能正确设置元数据，
     *             不知道长度时传 -1（SDK 会退化成 chunked，部分场景不推荐）
     */
    public OssStoredObject put(InputStream in, long size, String contentType,
                               String originalName, String bizType, String bucketOverride) {
        requireAvailable();
        String name = cleanName(originalName);
        return doPut(in, size, contentType, name, buildKey(bizType, name),
                isBlank(bucketOverride) ? props.getBucketName() : bucketOverride.trim(), bizType);
    }

    /**
     * 上传到「调用方指定的 Key」。
     *
     * <p>只有框架侧的少数场景需要（如 {@code OssBootUtil.upload(InputStream, relativePath)}，
     * 路径是调用方算好的）。业务接口一律走 {@link #put} 自动生成 Key —— 让调用方自己拼 Key
     * 很容易出现同名覆盖与路径穿越。
     */
    public OssStoredObject putWithKey(InputStream in, long size, String contentType,
                                      String key, String bucketOverride) {
        requireAvailable();
        String safeKey = normalizeKey(key);
        String name = safeKey.substring(safeKey.lastIndexOf('/') + 1);
        return doPut(in, size, contentType, name, safeKey,
                isBlank(bucketOverride) ? props.getBucketName() : bucketOverride.trim(), "common");
    }

    /** 真正的 putObject：上面的两个入口都收敛到这里，避免元数据设置逻辑写两遍 */
    private OssStoredObject doPut(InputStream in, long size, String contentType, String name,
                                  String key, String bucket, String bizType) {
        ObjectMetadata meta = new ObjectMetadata();
        if (size >= 0) {
            meta.setContentLength(size);
        }
        meta.setContentType(isBlank(contentType) ? "application/octet-stream" : contentType);
        // 私有桶不经过 CDN，Cache-Control 只影响「签名直链」这一路，给个保守值
        meta.setCacheControl("private, max-age=86400");
        if (!isBlank(name)) {
            // 中文文件名在 HTTP 头里要 RFC 5987 编码，交给 SDK 处理容易乱码，这里显式编码
            meta.setContentDisposition("inline; filename*=UTF-8''"
                    + java.net.URLEncoder.encode(name, StandardCharsets.UTF_8));
        }

        try {
            PutObjectResult result = client.putObject(new PutObjectRequest(bucket, key, in, meta));
            String etag = result == null ? null : stripQuotes(result.getETag());
            log.info("[OSS] 上传成功 bucket={} key={} size={} type={}", bucket, key, size, contentType);
            return OssStoredObject.builder()
                    .key(key)
                    .url(toPublicUrl(key, bucket))
                    .bucket(bucket)
                    .size(size)
                    .contentType(meta.getContentType())
                    .etag(etag)
                    .originalName(name)
                    .bizType(safeBiz(bizType))
                    .build();
        } catch (Exception e) {
            log.error("[OSS] 上传失败 bucket={} key={}", bucket, key, e);
            throw new JeecgBootException("文件上传失败：" + e.getMessage());
        }
    }

    /* ==================================================================== */
    /*                                 读取                                  */
    /* ==================================================================== */
    /** 打开对象（调用方负责 close）。对象不存在时抛业务异常，避免 Controller 里到处判空 */
    public OSSObject open(String key) {
        return open(key, null, -1, -1);
    }

    /**
     * 打开对象的指定字节区间（视频拖动进度条依赖 Range 请求）。
     *
     * @param start 起始字节（含），-1 表示从头
     * @param end   结束字节（含），-1 表示到末尾
     */
    public OSSObject open(String key, String bucketOverride, long start, long end) {
        requireAvailable();
        String bucket = isBlank(bucketOverride) ? props.getBucketName() : bucketOverride.trim();
        String safeKey = normalizeKey(key);
        try {
            GetObjectRequest req = new GetObjectRequest(bucket, safeKey);
            if (start >= 0 || end >= 0) {
                req.setRange(start, end);
            }
            return client.getObject(req);
        } catch (com.aliyun.oss.OSSException e) {
            if ("NoSuchKey".equals(e.getErrorCode())) {
                throw new JeecgBootException("文件不存在或已被删除");
            }
            throw new JeecgBootException("文件读取失败：" + e.getErrorMessage());
        } catch (Exception e) {
            log.error("[OSS] 读取失败 key={}", safeKey, e);
            throw new JeecgBootException("文件读取失败：" + e.getMessage());
        }
    }

    /** 对象是否存在 */
    public boolean exists(String key) {
        if (!available() || isBlank(key)) {
            return false;
        }
        try {
            return client.doesObjectExist(props.getBucketName(), normalizeKey(key));
        } catch (Exception e) {
            log.warn("[OSS] 判断对象存在性失败 key={}：{}", key, e.getMessage());
            return false;
        }
    }

    /** 对象元数据（大小 / 类型），不存在返回 null */
    public ObjectMetadata metadata(String key) {
        if (!available() || isBlank(key)) {
            return null;
        }
        try {
            return client.getObjectMetadata(props.getBucketName(), normalizeKey(key));
        } catch (Exception e) {
            return null;
        }
    }

    /* ==================================================================== */
    /*                                 删除                                  */
    /* ==================================================================== */

    /** 删除对象（幂等：对象不存在也不报错） */
    public void delete(String key) {
        if (!available() || isBlank(key)) {
            return;
        }
        String safeKey = normalizeKey(key);
        try {
            client.deleteObject(props.getBucketName(), safeKey);
            log.info("[OSS] 已删除 key={}", safeKey);
        } catch (Exception e) {
            log.warn("[OSS] 删除失败 key={}：{}", safeKey, e.getMessage());
        }
    }

    /* ==================================================================== */
    /*                              地址生成                                 */
    /* ==================================================================== */

    /** 生成前端可直接访问的地址（按配置的有效期） */
    public String toPublicUrl(String key) {
        return toPublicUrl(key, props.getBucketName());
    }

    /**
     * 生成前端可直接访问的地址。
     * <ul>
     *   <li>私有桶 → 后端签名代理地址（带 sign，可选 exp）</li>
     *   <li>公读桶 → 自定义域名 / OSS 直链</li>
     * </ul>
     */
    public String toPublicUrl(String key, String bucketOverride) {
        if (isBlank(key)) {
            return "";
        }
        String safeKey = normalizeKey(key);
        if (props.isPrivateRead()) {
            return proxyUrl(safeKey, -1);
        }
        String bucket = isBlank(bucketOverride) ? props.getBucketName() : bucketOverride.trim();
        String domain = props.getPublicDomain();
        if (!isBlank(domain)) {
            String d = domain.trim();
            if (d.endsWith("/")) {
                d = d.substring(0, d.length() - 1);
            }
            return d + "/" + safeKey;
        }
        return "https://" + bucket + "." + props.getEndpoint() + "/" + safeKey;
    }

    /**
     * 生成签名代理地址。
     *
     * @param expireSeconds 有效期秒数；{@code <= 0} 表示用配置值（默认 0 = 长期有效）
     */
    public String proxyUrl(String key, long expireSeconds) {
        if (isBlank(key)) {
            return "";
        }
        long seconds = expireSeconds > 0 ? expireSeconds : props.getSignExpireSeconds();
        long expireAt = seconds > 0 ? System.currentTimeMillis() / 1000 + seconds : 0L;
        return OssUrlSigner.buildProxyUrl(
                props.getProxyBaseUrl(), VIEW_PATH, normalizeKey(key), signSecret, expireAt);
    }

    /** 生成带下载意图的签名地址（Content-Disposition: attachment） */
    public String downloadUrl(String key, long expireSeconds) {
        return proxyUrl(key, expireSeconds) + "&download=1";
    }

    /**
     * 生成 OSS 原生预签名 URL（带过期时间）。
     * 适合「把链接发给外部系统临时下载」——不经过我们后端，省一次转发。
     */
    public String presignedUrl(String key, long expireSeconds) {
        requireAvailable();
        long seconds = expireSeconds > 0 ? expireSeconds : 3600;
        Date expiration = new Date(System.currentTimeMillis() + seconds * 1000);
        URL url = client.generatePresignedUrl(props.getBucketName(), normalizeKey(key), expiration);
        return url == null ? null : url.toString();
    }

    /** 签名密钥（供 Controller 校验代理请求） */
    public String signSecret() {
        return signSecret;
    }

    /**
     * 从任意形态的地址里反解出对象 Key。
     *
     * <p>要兼容四种历史/并存形态：
     * <ol>
     *   <li>本系统的签名代理地址 {@code /api/sys/edu-file/view?key=...}</li>
     *   <li>OSS 直链 {@code https://bucket.endpoint/key}（改造前写进库的旧数据）</li>
     *   <li>自定义域名 {@code https://cdn.domain/key}</li>
     *   <li>本身就是 Key（新业务推荐只存 Key）</li>
     * </ol>
     */
    public String keyFromUrl(String url) {
        if (isBlank(url)) {
            return null;
        }
        String u = url.trim();

        String fromProxy = OssUrlSigner.extractKeyFromProxyUrl(u, VIEW_PATH);
        if (!isBlank(fromProxy)) {
            return fromProxy;
        }

        if (u.startsWith("http://") || u.startsWith("https://")) {
            String bucketPrefix = "https://" + props.getBucketName() + "." + props.getEndpoint() + "/";
            if (u.startsWith(bucketPrefix)) {
                return u.substring(bucketPrefix.length());
            }
            String httpBucketPrefix = "http://" + props.getBucketName() + "." + props.getEndpoint() + "/";
            if (u.startsWith(httpBucketPrefix)) {
                return u.substring(httpBucketPrefix.length());
            }
            String domain = props.getPublicDomain();
            if (!isBlank(domain)) {
                String d = domain.trim().replaceAll("/+$", "") + "/";
                if (u.startsWith(d)) {
                    return u.substring(d.length());
                }
            }
            // 外链（不是我们桶里的东西）：原样返回，调用方按「外部地址」处理
            return u;
        }
        return u;
    }

    /* ==================================================================== */
    /*                               内部工具                                */
    /* ==================================================================== */

    /**
     * 生成对象 Key：{@code {prefix}/{biz}/{yyyy}/{MM}/{dd}/{uuid}{ext}}
     *
     * <p>按日期分目录不是为了好看，而是为了让生命周期规则、按天清理、监控统计都能按前缀做；
     * 文件名用 UUID 而不是原文件名，一是避免中文/空格/特殊字符带来的编码问题，
     * 二是避免同名覆盖（两个人同时上传「作业.docx」不会互相覆盖）。
     */
    public String buildKey(String bizType, String originalName) {
        String biz = safeBiz(bizType);
        String day = new SimpleDateFormat("yyyy/MM/dd").format(new Date());
        String ext = extensionOf(originalName);
        return keyPrefix() + "/" + biz + "/" + day + "/"
                + UUID.randomUUID().toString().replace("-", "") + ext;
    }

    /** 业务分类清洗：只保留小写字母、数字、短横线；空则 common */
    public String safeBiz(String bizType) {
        if (isBlank(bizType)) {
            return "common";
        }
        String biz = bizType.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9-]", "");
        if (biz.isEmpty()) {
            return "common";
        }
        return biz.length() > 32 ? biz.substring(0, 32) : biz;
    }

    /** Key 安全化：去掉开头的斜杠、拒绝 {@code ..}（防路径穿越） */
    private String normalizeKey(String key) {
        String k = key == null ? "" : key.trim();
        while (k.startsWith("/")) {
            k = k.substring(1);
        }
        if (k.contains("..")) {
            throw new JeecgBootException("非法的文件路径");
        }
        return k;
    }

    /** 原始文件名清洗：去掉路径、控制字符，限制长度 */
    public String cleanName(String originalName) {
        if (originalName == null) {
            return "file";
        }
        String name = originalName.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        name = name.replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isEmpty()) {
            return "file";
        }
        return name.length() > 200 ? name.substring(name.length() - 200) : name;
    }

    /** 取扩展名（含点），无扩展名返回空串 */
    public String extensionOf(String name) {
        if (name == null) {
            return "";
        }
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) {
            return "";
        }
        String ext = name.substring(dot).toLowerCase(Locale.ROOT);
        return ext.matches("\\.[a-z0-9]{1,10}") ? ext : "";
    }

    /** Content-Type 兜底推断：优先浏览器给的，缺省/八位字节流时按扩展名查表 */
    private String resolveContentType(String given, String name) {
        if (!isBlank(given) && !"application/octet-stream".equalsIgnoreCase(given)) {
            return given;
        }
        String ext = extensionOf(name);
        String byExt = MIME_BY_EXT.get(ext);
        return byExt != null ? byExt : "application/octet-stream";
    }

    private String stripQuotes(String etag) {
        if (etag == null) {
            return null;
        }
        return etag.replace("\"", "");
    }

    private void requireAvailable() {
        if (client == null) {
            throw new JeecgBootException("对象存储未启用，请检查 edu.oss 配置");
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * 常见扩展名 → MIME。
     * 只覆盖教学云实际会出现的类型：图片、文档、音视频、压缩包、3D/动画素材。
     */
    private static final java.util.Map<String, String> MIME_BY_EXT = new java.util.HashMap<>();

    static {
        MIME_BY_EXT.put(".jpg", "image/jpeg");
        MIME_BY_EXT.put(".jpeg", "image/jpeg");
        MIME_BY_EXT.put(".png", "image/png");
        MIME_BY_EXT.put(".gif", "image/gif");
        MIME_BY_EXT.put(".webp", "image/webp");
        MIME_BY_EXT.put(".bmp", "image/bmp");
        MIME_BY_EXT.put(".svg", "image/svg+xml");
        MIME_BY_EXT.put(".ico", "image/x-icon");
        MIME_BY_EXT.put(".heic", "image/heic");
        MIME_BY_EXT.put(".pdf", "application/pdf");
        MIME_BY_EXT.put(".doc", "application/msword");
        MIME_BY_EXT.put(".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        MIME_BY_EXT.put(".xls", "application/vnd.ms-excel");
        MIME_BY_EXT.put(".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        MIME_BY_EXT.put(".ppt", "application/vnd.ms-powerpoint");
        MIME_BY_EXT.put(".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        MIME_BY_EXT.put(".txt", "text/plain");
        MIME_BY_EXT.put(".csv", "text/csv");
        MIME_BY_EXT.put(".md", "text/markdown");
        MIME_BY_EXT.put(".json", "application/json");
        MIME_BY_EXT.put(".html", "text/html");
        MIME_BY_EXT.put(".mp4", "video/mp4");
        MIME_BY_EXT.put(".mov", "video/quicktime");
        MIME_BY_EXT.put(".avi", "video/x-msvideo");
        MIME_BY_EXT.put(".webm", "video/webm");
        MIME_BY_EXT.put(".mp3", "audio/mpeg");
        MIME_BY_EXT.put(".wav", "audio/wav");
        MIME_BY_EXT.put(".m4a", "audio/mp4");
        MIME_BY_EXT.put(".zip", "application/zip");
        MIME_BY_EXT.put(".rar", "application/vnd.rar");
        MIME_BY_EXT.put(".7z", "application/x-7z-compressed");
        MIME_BY_EXT.put(".glb", "model/gltf-binary");
        MIME_BY_EXT.put(".gltf", "model/gltf+json");
    }
}
