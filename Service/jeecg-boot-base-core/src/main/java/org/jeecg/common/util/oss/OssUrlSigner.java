package org.jeecg.common.util.oss;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * 私有桶「签名访问地址」生成与校验。
 *
 * <p><b>为什么需要它</b>：本项目的 OSS 桶是私有的（文件不可被公共访问），
 * 前端拿到 {@code https://bucket.endpoint/key} 这种直链只会得到 403。两种解法：
 * <ol>
 *   <li><b>预签名 URL</b>（{@code generatePresignedUrl}）：带过期时间，适合临时下载/分享；</li>
 *   <li><b>后端签名代理</b>（本类）：地址形如
 *       {@code /api/sys/edu-file/view?key=edu/image/...&sign=...}，由后端拉流回写，
 *       可以做到「不暴露 AK/SK、不公开桶、地址可长期写在业务库里」。</li>
 * </ol>
 * 业务库里存的是第 2 种（长期引用），临时分享链接才用第 1 种。
 *
 * <p><b>安全性</b>：签名 = HMAC-SHA256(secret, key[+exp]) 截断 32 位 hex。
 * Key 本身由 UUID + 日期目录构成、不可枚举，再加 HMAC 后即使知道 Key 也无法伪造
 * 别的 Key 的签名；{@code exp} 参与签名，客户端改 exp 会直接校验失败。
 * 校验用 {@link MessageDigest#isEqual} 做恒定时间比较，避免逐字节比较泄露信息。
 *
 * <p>放在 base-core 是因为框架侧 {@link OssBootUtil}（也在 base-core）上传完就要拼这个地址，
 * 而业务侧 Controller（jeecg-system-biz）要校验它 —— 两边必须用同一份实现。
 *
 * @author 教学云
 */
public final class OssUrlSigner {

    /** 签名串长度（hex 字符数）。SHA-256 全长 64，截 32 位已有 128bit 强度，URL 也短一些 */
    public static final int SIGN_LENGTH = 32;

    /** 未配置 secret 时的兜底值。仅用于本地开发，生产必须在配置里覆盖 */
    private static final String FALLBACK_SECRET = "jiaoyu-ai-oss-local-dev";

    private OssUrlSigner() {
    }

    /** 取生效的签名密钥：配置值优先，空则兜底常量 */
    public static String effectiveSecret(String configured) {
        return (configured == null || configured.isBlank()) ? FALLBACK_SECRET : configured;
    }

    /**
     * 生成签名。
     *
     * @param secret   密钥
     * @param key      对象 Key（桶内路径，不含域名）
     * @param expireAt 过期时间戳（秒）；{@code 0} 表示长期有效
     */
    public static String sign(String secret, String key, long expireAt) {
        String payload = expireAt > 0 ? key + "\n" + expireAt : key;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(effectiveSecret(secret).getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] raw = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(raw.length * 2);
            for (byte b : raw) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.substring(0, SIGN_LENGTH);
        } catch (Exception e) {
            // HmacSHA256 是 JDK 必备算法，走到这里说明运行环境异常，直接暴露比静默降级安全
            throw new IllegalStateException("OSS 签名失败", e);
        }
    }

    /** 校验签名（恒定时间比较） */
    public static boolean verify(String secret, String key, long expireAt, String sign) {
        if (key == null || key.isEmpty() || sign == null || sign.isEmpty()) {
            return false;
        }
        if (expireAt > 0 && System.currentTimeMillis() / 1000 > expireAt) {
            return false;
        }
        String expected = sign(secret, key, expireAt);
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                sign.toLowerCase().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 拼一个可长期使用的代理访问地址。
     *
     * @param baseUrl    代理前缀（如 {@code /api}，可为空串）
     * @param viewPath   代理接口路径（如 {@code /sys/edu-file/view}）
     * @param key        对象 Key
     * @param secret     密钥
     * @param expireAt   过期时间戳（秒），0 = 不过期
     */
    public static String buildProxyUrl(String baseUrl, String viewPath, String key, String secret, long expireAt) {
        String base = baseUrl == null ? "" : baseUrl.trim();
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        StringBuilder url = new StringBuilder(base).append(viewPath)
                .append("?key=").append(URLEncoder.encode(key, StandardCharsets.UTF_8))
                .append("&sign=").append(sign(secret, key, expireAt));
        if (expireAt > 0) {
            url.append("&exp=").append(expireAt);
        }
        return url.toString();
    }

    /**
     * 从代理地址里反解出对象 Key；不是本系统的代理地址则返回 null。
     *
     * <p>解析走手工切分而不引入 URL 解析器：这里只会遇到自己生成的地址，
     * 用 {@code java.net.URI} 反而会因为 Key 里的中文/空格抛异常。
     */
    public static String extractKeyFromProxyUrl(String url, String viewPath) {
        if (url == null) {
            return null;
        }
        int idx = url.indexOf(viewPath);
        if (idx < 0) {
            return null;
        }
        int q = url.indexOf("?key=", idx);
        if (q < 0) {
            return null;
        }
        String rest = url.substring(q + "?key=".length());
        int amp = rest.indexOf('&');
        if (amp >= 0) {
            rest = rest.substring(0, amp);
        }
        try {
            return java.net.URLDecoder.decode(rest, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
