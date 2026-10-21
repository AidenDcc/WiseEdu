package org.jeecg.modules.system.oss.controller;

import com.aliyun.oss.model.ObjectMetadata;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.common.exception.JeecgBootException;
import org.jeecg.common.system.util.JwtUtil;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.common.util.oss.OssStorageService;
import org.jeecg.common.util.oss.OssUrlSigner;
import org.jeecg.modules.system.oss.service.IEduOssFileService;
import org.jeecg.modules.system.oss.vo.EduFileVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 教学云统一文件接口（对象存储）。
 *
 * <pre>
 *   POST /sys/edu-file/upload     上传（multipart：file + biz）
 *   GET  /sys/edu-file/view       私有桶读（签名地址，浏览器 &lt;img&gt; 直接用）
 *   GET  /sys/edu-file/download   下载（Content-Disposition: attachment）
 *   GET  /sys/edu-file/sign       Key → 可访问地址（含临时有效期）
 *   POST /sys/edu-file/delete     删除
 * </pre>
 *
 * <p><b>为什么读接口免登录（Shiro anon）</b>：{@code <img src>} / {@code <video src>} 带不了
 * {@code X-Access-Token} 头，若强制登录，所有图片都会 401。安全性由「签名」承担：
 * 地址里的 {@code sign} 是对 Key 的 HMAC，客户端改一个字就 403，Key 本身又是不可枚举的
 * UUID 路径 —— 等价于「拿到链接即可访问，猜不到就访问不了」，与主流对象存储的预签名模型一致。
 *
 * <p><b>为什么用后端转发而不是 302 到预签名直链</b>：
 * <ol>
 *   <li>预签名直链有有效期，写进业务库的地址几天后就会失效；</li>
 *   <li>直链暴露桶名与地域，迁移桶 / 换 CDN 时库里存量地址全废；</li>
 *   <li>走代理才能在响应上统一加 {@code X-Content-Type-Options} 与 CSP，
 *       避免用户上传的 HTML/SVG 在 API 域下被浏览器执行（存储型 XSS）。</li>
 * </ol>
 * 代价是多一次流量中转；等业务上量后把 {@code edu.oss.public-domain} 指向 CDN 并开回源鉴权，
 * 上传结果就会自动切换成 CDN 直链（见 {@code OssStorageService#toPublicUrl}）。
 *
 * @author 教学云
 */
@Slf4j
@Tag(name = "教学云-文件存储")
@RestController
@RequestMapping("/sys/edu-file")
public class EduFileController {

    /** 流式拷贝缓冲区。8KB 是磁盘块与网络 MTU 的折中，再大对吞吐没有明显收益 */
    private static final int BUFFER_SIZE = 8192;

    @Autowired
    private IEduOssFileService fileService;

    @Autowired
    private OssStorageService storage;

    /* ==================================================================== */
    /*                                 上传                                  */
    /* ==================================================================== */

    @Operation(summary = "上传文件到对象存储")
    @PostMapping("/upload")
    public ApiResult<EduFileVo> upload(@RequestParam("file") MultipartFile file,
                                       @RequestParam(value = "biz", required = false) String biz,
                                       HttpServletRequest request) {
        String uploader = JwtUtil.getUserNameByToken(request);
        try {
            return ApiResult.ok(fileService.upload(file, biz, uploader));
        } catch (JeecgBootException e) {
            // 统一走教学云的 {code,message,data} 契约：前端 uploadFile 只认这个形状。
            // 不接这一层的话，全局异常处理器吐的是框架的 {success,result}，前端拿不到可展示文案
            return ApiResult.fail(e.getMessage());
        }
    }

    /* ==================================================================== */
    /*                                 读取                                  */
    /* ==================================================================== */

    @Operation(summary = "读取文件（私有桶签名代理）")
    @GetMapping("/view")
    public void view(@RequestParam("key") String key,
                     @RequestParam(value = "exp", required = false) Long exp,
                     @RequestParam(value = "sign", required = false) String sign,
                     @RequestParam(value = "download", required = false) String download,
                     @RequestParam(value = "filename", required = false) String filename,
                     HttpServletRequest request,
                     HttpServletResponse response) {
        stream(key, exp, sign, download, filename, false, request, response);
    }

    @Operation(summary = "下载文件")
    @GetMapping("/download")
    public void download(@RequestParam("key") String key,
                         @RequestParam(value = "exp", required = false) Long exp,
                         @RequestParam(value = "sign", required = false) String sign,
                         @RequestParam(value = "filename", required = false) String filename,
                         HttpServletRequest request,
                         HttpServletResponse response) {
        stream(key, exp, sign, "1", filename, true, request, response);
    }

    /* ==================================================================== */
    /*                              地址 / 删除                              */
    /* ==================================================================== */

    @Operation(summary = "Key 转可访问地址")
    @GetMapping("/sign")
    public ApiResult<String> sign(@RequestParam("key") String key,
                                  @RequestParam(value = "expireSeconds", required = false) Long expireSeconds) {
        return ApiResult.ok(fileService.resolveUrl(key, expireSeconds == null ? -1 : expireSeconds));
    }

    @Operation(summary = "删除文件")
    @PostMapping("/delete")
    public ApiResult<Void> delete(@RequestBody Map<String, Object> body) {
        String key = oConvertUtils.getString(body.get("key"));
        if (oConvertUtils.isEmpty(key)) {
            return ApiResult.fail("key 不能为空");
        }
        fileService.remove(storage.keyFromUrl(key));
        return ApiResult.ok();
    }

    /* ==================================================================== */
    /*                                 内部                                  */
    /* ==================================================================== */

    /**
     * 把对象流写回响应。
     *
     * <p>Range 支持不是可选项：课件里的视频要能拖进度条、PDF 预览器要能分段取字节，
     * 少了它浏览器只能整份下载后再播，几十 MB 的课时视频会卡到不可用。
     */
    private void stream(String key, Long exp, String sign, String download, String filename,
                        boolean forceDownload, HttpServletRequest request, HttpServletResponse response) {
        if (oConvertUtils.isEmpty(key)) {
            sendError(response, 400, "缺少 key");
            return;
        }
        String safeKey = storage.keyFromUrl(key);
        long expireAt = exp == null ? 0L : exp;

        if (!OssUrlSigner.verify(storage.signSecret(), safeKey, expireAt, sign)) {
            log.warn("[OSS] 代理访问签名校验失败 key={} exp={}", safeKey, expireAt);
            sendError(response, 403, "文件链接无效或已过期");
            return;
        }
        if (!storage.available()) {
            sendError(response, 503, "对象存储未启用");
            return;
        }

        ObjectMetadata meta;
        try {
            meta = storage.metadata(safeKey);
        } catch (Exception e) {
            log.warn("[OSS] 读取元数据失败 key={}：{}", safeKey, e.getMessage());
            sendError(response, 502, "文件服务暂时不可用");
            return;
        }
        if (meta == null) {
            sendError(response, 404, "文件不存在");
            return;
        }

        long total = meta.getContentLength();
        String etag = meta.getETag();

        // 304：图片/视频被反复请求时省掉整个响应体
        String ifNoneMatch = request.getHeader("If-None-Match");
        if (etag != null && ifNoneMatch != null && ifNoneMatch.contains(etag.replace("\"", ""))) {
            response.setStatus(HttpServletResponse.SC_NOT_MODIFIED);
            return;
        }

        long start = 0;
        long end = total - 1;
        boolean partial = false;
        String rangeHeader = request.getHeader("Range");
        if (rangeHeader != null && rangeHeader.startsWith("bytes=") && !rangeHeader.contains(",")) {
            long[] range = parseRange(rangeHeader, total);
            if (range == null) {
                response.setStatus(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE);
                response.setHeader("Content-Range", "bytes */" + total);
                return;
            }
            start = range[0];
            end = range[1];
            partial = true;
        }

        String contentType = meta.getContentType();
        if (oConvertUtils.isEmpty(contentType)) {
            contentType = "application/octet-stream";
        }

        response.setStatus(partial ? HttpServletResponse.SC_PARTIAL_CONTENT : HttpServletResponse.SC_OK);
        response.setContentType(contentType);
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Cache-Control", "private, max-age=86400");
        // 关键：禁止浏览器「猜」类型。否则一个伪装成图片的 HTML 会被当页面执行
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (etag != null) {
            response.setHeader("ETag", etag.startsWith("\"") ? etag : "\"" + etag + "\"");
        }

        boolean inlineHtml = contentType.contains("text/html") || contentType.contains("svg");
        if (inlineHtml) {
            // 用户上传的 HTML/SVG 可能带脚本：即使被直接打开，也要跑在「无同源权限」的沙箱里
            response.setHeader("Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
        }

        if (partial) {
            response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + total);
            response.setContentLengthLong(end - start + 1);
        } else {
            response.setContentLengthLong(total);
        }

        if (forceDownload || "1".equals(download) || "true".equalsIgnoreCase(download)) {
            String name = oConvertUtils.isEmpty(filename)
                    ? safeKey.substring(safeKey.lastIndexOf('/') + 1)
                    : filename;
            response.setHeader("Content-Disposition",
                    "attachment; filename*=UTF-8''" + URLEncoder.encode(name, StandardCharsets.UTF_8));
        }

        try (InputStream in = storage.open(safeKey, null,
                partial ? start : -1, partial ? end : -1).getObjectContent();
             OutputStream out = response.getOutputStream()) {
            byte[] buf = new byte[BUFFER_SIZE];
            int len;
            while ((len = in.read(buf)) != -1) {
                out.write(buf, 0, len);
            }
            out.flush();
        } catch (JeecgBootException e) {
            log.warn("[OSS] 代理读取失败 key={}：{}", safeKey, e.getMessage());
        } catch (IOException e) {
            // 浏览器中途取消（拖进度条、关页面）会走到这里，属正常现象，不记 error
            log.debug("[OSS] 传输中断 key={}：{}", safeKey, e.getMessage());
        } catch (Exception e) {
            log.error("[OSS] 代理读取异常 key={}", safeKey, e);
        }
    }

    /**
     * 解析单段 Range，返回 {@code [start, end]}（闭区间）。
     * 语法不合法或越界返回 null；{@code bytes=100-} 这种只给起点的按 RFC 7233 补到末尾。
     */
    private long[] parseRange(String header, long total) {
        if (total <= 0) {
            return null;
        }
        String spec = header.substring("bytes=".length()).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) {
            return null;
        }
        String startPart = spec.substring(0, dash).trim();
        String endPart = spec.substring(dash + 1).trim();
        try {
            long start;
            long end;
            if (startPart.isEmpty()) {
                // bytes=-500 表示「最后 500 字节」
                long suffix = Long.parseLong(endPart);
                if (suffix <= 0) {
                    return null;
                }
                start = Math.max(0, total - suffix);
                end = total - 1;
            } else {
                start = Long.parseLong(startPart);
                end = endPart.isEmpty() ? total - 1 : Long.parseLong(endPart);
            }
            if (start < 0 || start >= total || end < start) {
                return null;
            }
            return new long[]{start, Math.min(end, total - 1)};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private void sendError(HttpServletResponse response, int status, String message) {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        try {
            response.getWriter().write("{\"code\":" + status + ",\"message\":\"" + message + "\"}");
        } catch (IOException ignored) {
            // 响应头已发出，无能为力
        }
    }
}
