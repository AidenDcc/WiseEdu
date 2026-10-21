package org.jeecg.modules.system.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.common.system.util.JwtUtil;
import org.jeecg.modules.system.service.IEduProfileService;
import org.jeecg.modules.system.vo.EduLoginLogVo;
import org.jeecg.modules.system.vo.EduProfileAvatarModel;
import org.jeecg.modules.system.vo.EduProfileBaseModel;
import org.jeecg.modules.system.vo.EduProfileNotifyVo;
import org.jeecg.modules.system.vo.EduProfilePasswordModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 管理端个人中心接口（P-08-01）。
 *
 * <p>与前端 {@code apps/admin/src/api/profile.ts} 一一对应：
 * <pre>
 *   GET  /admin/profile/notify     读取消息偏好
 *   POST /admin/profile/notify     保存消息偏好
 *   POST /admin/profile/base       保存个人资料
 *   POST /admin/profile/avatar     保存头像（null = 恢复默认）
 *   POST /admin/profile/password   修改密码
 *   GET  /admin/logs/login         本人登录记录
 * </pre>
 *
 * <p><b>为什么类级映射写 {@code /admin} 而不是 {@code /admin/profile}</b>：
 * 登录记录的自然位置是 {@code /admin/logs/login}（与平台日志页同一前缀），
 * 硬塞到 {@code /admin/profile/logs} 会让「日志」这个概念散在两处。
 *
 * <p>当前登录人一律由 token 解析（{@link JwtUtil#getUserNameByToken}），
 * 不接受前端传 userId —— 否则任何登录用户都能改别人的资料。
 *
 * @author 教学云
 */
@Slf4j
@Tag(name = "教学云-个人中心")
@RestController
@RequestMapping("/admin")
public class EduProfileController {

    /** 个人中心登录记录只展示最近若干条，与页面上的列表长度一致 */
    private static final int LOGIN_LOG_LIMIT = 20;

    @Autowired
    private IEduProfileService profileService;

    @Operation(summary = "读取消息偏好")
    @GetMapping("/profile/notify")
    public ApiResult<EduProfileNotifyVo> getNotify(HttpServletRequest request) {
        return ApiResult.ok(profileService.getNotify(currentUser(request)));
    }

    @Operation(summary = "保存消息偏好")
    @PostMapping("/profile/notify")
    public ApiResult<Void> updateNotify(HttpServletRequest request, @RequestBody EduProfileNotifyVo model) {
        profileService.updateNotify(currentUser(request), model);
        return ApiResult.ok();
    }

    @Operation(summary = "保存个人资料")
    @PostMapping("/profile/base")
    public ApiResult<Void> updateBase(HttpServletRequest request, @RequestBody EduProfileBaseModel model) {
        profileService.updateBase(currentUser(request), model);
        return ApiResult.ok();
    }

    @Operation(summary = "保存头像")
    @PostMapping("/profile/avatar")
    public ApiResult<Void> updateAvatar(HttpServletRequest request, @RequestBody EduProfileAvatarModel model) {
        profileService.updateAvatar(currentUser(request), model.getAvatar());
        return ApiResult.ok();
    }

    @Operation(summary = "修改密码")
    @PostMapping("/profile/password")
    public ApiResult<Void> changePassword(HttpServletRequest request, @RequestBody EduProfilePasswordModel model) {
        profileService.changePassword(currentUser(request), model);
        // 返回值类型是 Void，提示语只能走 message 重载（ok(T data) 会把 T 推成 String 而编译失败）
        return ApiResult.ok("密码已修改，请重新登录", null);
    }

    @Operation(summary = "本人登录记录")
    @GetMapping("/logs/login")
    public ApiResult<List<EduLoginLogVo>> loginLogs(HttpServletRequest request) {
        return ApiResult.ok(profileService.listLoginLogs(currentUser(request), LOGIN_LOG_LIMIT));
    }

    /* ------------------------------------------------------------------ */

    /**
     * 从 token 取当前登录账号。
     *
     * <p>正常流程下 Shiro 已拦截未带 token 的请求，这里取不到值只会发生在
     * 「token 合法但用户已被删除」的极端情形，抛业务提示比返回 null 更直观。
     */
    private String currentUser(HttpServletRequest request) {
        String username = JwtUtil.getUserNameByToken(request);
        if (username == null || username.isEmpty()) {
            throw new org.jeecg.common.exception.JeecgBootBizTipException("登录已失效，请重新登录");
        }
        return username;
    }
}
