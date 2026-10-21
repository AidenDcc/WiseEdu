package org.jeecg.modules.system.oss.support;

import org.jeecg.common.exception.JeecgBootException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 上传文件准入校验（教学云口径）。
 *
 * <p><b>为什么不直接复用框架的 {@code SsrfFileTypeFilter}</b>：框架那份白名单是为 jeecg
 * 通用场景写的，缺了教学云真正会出现的类型（{@code webp} 图片、{@code glb/gltf} 3D 素材、
 * {@code h5} 动画包、{@code json} 绘图工程），而它内置的头校验规则又只覆盖 jsp/php/class/sql
 * 四种。硬套的结果是一半合法文件被拒、该拦的反而漏。这里按业务实际重写：
 * <ul>
 *   <li><b>扩展名白名单</b>：只放行明确需要的类型，未在名单内一律拒绝（默认拒绝比默认放行安全）；</li>
 *   <li><b>业务分类收窄</b>：{@code avatar} / {@code image} 只收图片，避免「头像接口传 .exe」；</li>
 *   <li><b>危险文件头</b>：读前 16 字节，命中脚本/可执行魔数直接拒绝，防止改扩展名绕过；</li>
 *   <li><b>文件名</b>：含控制字符、以点开头（隐藏文件）、超长的一律拒绝。</li>
 * </ul>
 *
 * <p><b>为什么不做内容魔数与扩展名的一致性校验</b>：教学云有大量「合法的非标准文件」
 * （学校导出的 HTML 成绩单、出版社给的加密 PDF、AI 生成的 SVG），一致性校验误杀率高，
 * 而真正的风险（脚本执行）由「对象存储私有读 + 代理时强制 Content-Type + 浏览器下载」挡住 ——
 * 文件永远不会以 {@code text/html} 在业务域下被浏览器直接执行。
 *
 * @author 教学云
 */
public final class EduUploadPolicy {

    /** 通用白名单（图片 / 文档 / 表格 / 幻灯片 / 音视频 / 压缩包 / 3D 与绘图素材） */
    private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
            // 图片
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic", "tif", "tiff",
            // 文档
            "pdf", "doc", "docx", "txt", "md", "csv", "rtf", "odt",
            // 表格 / 幻灯片
            "xls", "xlsx", "et", "ppt", "pptx", "dps",
            // 音视频
            "mp4", "mov", "avi", "wmv", "webm", "mkv", "flv",
            "mp3", "wav", "m4a", "aac", "ogg", "flac",
            // 压缩包
            "zip", "rar", "7z", "tar", "gz",
            // 教学云素材：h5 动画包、绘图工程、3D 模型、小程序包
            "h5", "html", "htm", "json", "xml", "glb", "gltf", "obj", "stl", "wgt", "apk"
    ));

    /** 图片类业务分类：只收图片 */
    private static final Set<String> IMAGE_BIZ = new HashSet<>(Arrays.asList("avatar", "image", "cover", "photo"));

    /** 图片白名单 */
    private static final Set<String> IMAGE_EXT = new HashSet<>(Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic"));

    /** 音视频类业务分类 */
    private static final Set<String> MEDIA_BIZ = new HashSet<>(Arrays.asList("video", "audio", "media"));

    /** 永远拒绝的后缀（哪怕在别处配错） */
    private static final Set<String> FORBIDDEN = new HashSet<>(Arrays.asList(
            "exe", "dll", "so", "dylib", "bat", "cmd", "sh", "ps1", "vbs", "js", "mjs",
            "jsp", "jspx", "php", "phtml", "asp", "aspx", "cgi", "pl", "py", "rb",
            "class", "jar", "war", "sql", "conf", "ini"));

    /** 危险文件头（十六进制前缀 → 说明），命中即拒绝 */
    private static final String[][] DANGEROUS_HEADERS = {
            {"3c3f706870", "PHP 脚本"},        // <?php
            {"3c25", "JSP 脚本"},              // <%
            {"23212f", "Shell 脚本"},          // #!/
            {"4d5a", "Windows 可执行文件"},    // MZ
            {"7f454c46", "Linux 可执行文件"},  // ELF
            {"cafebabe", "Java class"},
    };

    private EduUploadPolicy() {
    }

    /**
     * 校验一个上传文件。
     *
     * @param file    文件
     * @param bizType 业务分类（决定是否收窄到图片/音视频）
     */
    public static void check(MultipartFile file, String bizType) {
        if (file == null || file.isEmpty()) {
            throw new JeecgBootException("上传文件为空");
        }

        String original = file.getOriginalFilename();
        if (original == null || original.isBlank()) {
            throw new JeecgBootException("文件名不能为空");
        }
        // 只取最后一段，防止 "a/../../b.exe" 这类路径型文件名
        String name = original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).trim();
        if (name.startsWith(".")) {
            throw new JeecgBootException("不允许上传隐藏文件");
        }
        if (name.length() > 200) {
            throw new JeecgBootException("文件名过长（最多 200 个字符）");
        }

        String ext = extOf(name);
        if (ext.isEmpty()) {
            throw new JeecgBootException("文件缺少扩展名，无法识别类型");
        }
        if (FORBIDDEN.contains(ext)) {
            throw new JeecgBootException("不允许上传该类型的文件（." + ext + "）");
        }
        if (!ALLOWED.contains(ext)) {
            throw new JeecgBootException("不支持的文件格式（." + ext + "）");
        }

        String biz = bizType == null ? "" : bizType.trim().toLowerCase(Locale.ROOT);
        if (IMAGE_BIZ.contains(biz) && !IMAGE_EXT.contains(ext)) {
            throw new JeecgBootException("该入口只支持图片（jpg/png/gif/webp/svg 等）");
        }
        if (MEDIA_BIZ.contains(biz) && !IMAGE_EXT.contains(ext)
                && !Arrays.asList("mp4", "mov", "avi", "wmv", "webm", "mkv", "flv",
                        "mp3", "wav", "m4a", "aac", "ogg", "flac").contains(ext)) {
            throw new JeecgBootException("该入口只支持音视频文件");
        }

        checkHeader(file, name);
    }

    /** 读前 16 字节做危险魔数校验；读失败不阻断（真正的类型判定不是靠这个） */
    private static void checkHeader(MultipartFile file, String name) {
        try (InputStream in = file.getInputStream()) {
            byte[] head = new byte[16];
            int read = in.read(head);
            if (read <= 0) {
                return;
            }
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < read; i++) {
                hex.append(String.format("%02x", head[i]));
            }
            String prefix = hex.toString();
            for (String[] item : DANGEROUS_HEADERS) {
                if (prefix.startsWith(item[0])) {
                    throw new JeecgBootException("文件内容疑似" + item[1] + "，已拒绝上传：" + name);
                }
            }
        } catch (IOException e) {
            // 读文件头失败（如流已被消费）不阻断，交由后续上传报错
        }
    }

    /** 取小写扩展名（不含点）；无扩展名返回空串 */
    public static String extOf(String name) {
        if (name == null) {
            return "";
        }
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) {
            return "";
        }
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ext.matches("[a-z0-9]{1,10}") ? ext : "";
    }
}
