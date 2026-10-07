package org.jeecg.modules.system.controller;

import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.SecurityUtils;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.common.api.vo.Result;
import org.jeecg.common.constant.CacheConstant;
import org.jeecg.common.constant.CommonConstant;
import org.jeecg.common.system.util.JwtUtil;
import org.jeecg.common.system.vo.LoginUser;
import org.jeecg.common.util.PasswordUtil;
import org.jeecg.common.util.RedisUtil;
import org.jeecg.common.util.encryption.AesEncryptUtil;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.config.shiro.IgnoreAuth;
import org.jeecg.modules.base.service.BaseCommonService;
import org.jeecg.modules.system.entity.SysTenant;
import org.jeecg.modules.system.entity.SysUser;
import org.jeecg.modules.system.service.ISysTenantService;
import org.jeecg.modules.system.service.ISysUserService;
import org.jeecg.modules.system.service.impl.SysBaseApiImpl;
import org.jeecg.modules.system.vo.EduLoginModel;
import org.jeecg.modules.system.vo.EduLoginResultVo;
import org.jeecg.modules.system.vo.EduSessionUserVo;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;

/**
 * 教学云认证接口，对齐前端 @aiteach/shared 的 /auth/login、/auth/me、/auth/logout。
 *
 * <p>为什么不放在 edu 业务模块：登录依赖的密码校验、JWT 签发、Redis token 缓存、
 * 登录租户判定、失败次数锁定全部是本模块（jeecg-system-biz）的领域，搬过去只会复制粘贴出三处易分叉的实现。
 * 认证是平台级能力，不属于任何一个业务域。故网关把 /auth/** 路由到 jeecg-system。
 *
 * <p>与框架原有 {@link LoginController#login} 的差别：
 * <ul>
 *   <li>入参是 {account, password}（前端契约），不是 {username, password}</li>
 *   <li>不校验图形验证码（教学云前端无验证码流程）</li>
 *   <li>返回 {@link ApiResult}（code=0 成功）而非 Result（code=200 成功）</li>
 *   <li>返回体里直接给出 tenantId，前端据此发 X-Tenant-Id 头</li>
 * </ul>
 *
 * @author 教学云
 */
@Slf4j
@Tag(name = "教学云认证")
@RestController
@RequestMapping("/auth")
public class EduAuthController {

    @Autowired
    private ISysUserService sysUserService;
    @Autowired
    private ISysTenantService sysTenantService;
    @Autowired
    private SysBaseApiImpl sysBaseApi;
    @Autowired
    private RedisUtil redisUtil;
    @Autowired
    private BaseCommonService baseCommonService;

    /** 登录失败锁定阈值，与 LoginController 保持一致（超过 5 次锁 10 分钟） */
    private static final int LOGIN_FAIL_LIMIT = 5;
    private static final int LOGIN_FAIL_EXPIRE_SECONDS = 600;

    @IgnoreAuth
    @Operation(summary = "教学云登录")
    @PostMapping("/login")
    public ApiResult<EduLoginResultVo> login(@RequestBody EduLoginModel model, HttpServletRequest request) {
        String username = model.getAccount();
        if (oConvertUtils.isEmpty(username) || oConvertUtils.isEmpty(model.getPassword())) {
            return ApiResult.fail(400, "账号和密码不能为空");
        }

        // 1. 失败次数锁定（与 LoginController 同一套 Redis key，两边互相计数）
        if (isLoginFailOvertimes(username)) {
            return ApiResult.fail(429, "该用户登录失败次数过多，请于10分钟后再次登录！");
        }

        // 2. 密码：兼容 AES 加密传输，失败则视为明文
        String password = AesEncryptUtil.resolvePassword(model.getPassword());

        // 3. 用户存在且有效
        LambdaQueryWrapper<SysUser> query = new LambdaQueryWrapper<>();
        query.eq(SysUser::getUsername, username);
        SysUser sysUser = sysUserService.getOne(query);
        Result<?> effective = sysUserService.checkUserIsEffective(sysUser);
        if (!effective.isSuccess()) {
            return ApiResult.fail(500, effective.getMessage());
        }

        // 4. 密码校验
        String encrypted = PasswordUtil.encrypt(username, password, sysUser.getSalt());
        if (!sysUser.getPassword().equals(encrypted)) {
            addLoginFailOvertimes(username);
            return ApiResult.fail(1001, "账号或密码错误");
        }

        // 5. 签发 token（复用框架 JwtUtil + Redis 缓存约定）
        String token = JwtUtil.sign(username, sysUser.getPassword(), CommonConstant.CLIENT_TYPE_PC);
        redisUtil.set(CommonConstant.PREFIX_USER_TOKEN + token, token);
        redisUtil.expire(CommonConstant.PREFIX_USER_TOKEN + token, JwtUtil.EXPIRE_TIME * 2 / 1000);

        // 6. 登录租户判定：复用框架逻辑，它会把结果写进 sysUser.loginTenantId 并同步 TenantContext
        Result<JSONObject> tenantResult = new Result<>();
        JSONObject tenantHolder = new JSONObject();
        Result<JSONObject> tenantError = sysUserService.setLoginTenant(sysUser, tenantHolder, username, tenantResult);
        if (tenantError != null) {
            return ApiResult.fail(500, tenantError.getMessage());
        }

        // 7. 清理失败计数、记录登录日志
        redisUtil.del(CommonConstant.LOGIN_FAIL + username);
        LoginUser loginUser = new LoginUser();
        BeanUtils.copyProperties(sysUser, loginUser);
        baseCommonService.addLog("用户名: " + username + ",教学云登录成功！", CommonConstant.LOG_TYPE_1, null, loginUser);

        return ApiResult.ok("登录成功", new EduLoginResultVo(token, toSessionUser(sysUser)));
    }

    /**
     * 获取当前登录用户。前端在刷新页面后靠它回填 tenantId（否则 X-Tenant-Id 丢失、机构端查不到数据）。
     * 本接口不标 @IgnoreAuth，必须带合法 token 才能访问。
     */
    @Operation(summary = "获取当前登录用户")
    @GetMapping("/me")
    public ApiResult<EduSessionUserVo> me(HttpServletRequest request) {
        String username = JwtUtil.getUserNameByToken(request);
        if (oConvertUtils.isEmpty(username)) {
            return ApiResult.fail(401, "登录已失效，请重新登录");
        }
        SysUser sysUser = sysUserService.getUserByName(username);
        if (sysUser == null) {
            return ApiResult.fail(401, "登录已失效，请重新登录");
        }
        return ApiResult.ok(toSessionUser(sysUser));
    }

    @IgnoreAuth
    @Operation(summary = "教学云退出登录")
    @PostMapping("/logout")
    public ApiResult<Void> logout(HttpServletRequest request) {
        String token = request.getHeader(CommonConstant.X_ACCESS_TOKEN);
        if (oConvertUtils.isEmpty(token)) {
            return ApiResult.ok();
        }
        String username = JwtUtil.getUsername(token);
        LoginUser loginUser = oConvertUtils.isEmpty(username) ? null : sysBaseApi.getUserByName(username);
        if (loginUser != null) {
            // 与 LoginController#asyncClearLogoutCache 清理同一组缓存；教学云退出为低频操作，同步执行即可
            redisUtil.del(CommonConstant.PREFIX_USER_TOKEN + token);
            redisUtil.del(CommonConstant.PREFIX_USER_SHIRO_CACHE + loginUser.getId());
            redisUtil.del(String.format("%s::%s", CacheConstant.SYS_USERS_CACHE, loginUser.getUsername()));
            redisUtil.del(CommonConstant.PREFIX_USER_TOKEN_PC + loginUser.getUsername());
            redisUtil.del(CommonConstant.PREFIX_USER_TOKEN_APP + loginUser.getUsername());
            redisUtil.del(CommonConstant.PREFIX_USER_TOKEN_PHONE + loginUser.getUsername());
            baseCommonService.addLog("用户名: " + loginUser.getRealname() + ",教学云退出成功！", CommonConstant.LOG_TYPE_1, null, loginUser);
        }
        SecurityUtils.getSubject().logout();
        return ApiResult.ok();
    }

    /* ------------------------------------------------------------------ */

    /**
     * 组装会话用户。
     *
     * <p><b>role 映射约定</b>（待产品确认，见计划文件的开放问题）：
     * 按 sys_role.role_code 映射到前端 UI 角色；未命中时按是否有租户兜底 ——
     * 有租户视作教师、无租户（平台侧）视作超级管理员。
     */
    private EduSessionUserVo toSessionUser(SysUser sysUser) {
        EduSessionUserVo vo = new EduSessionUserVo();
        vo.setId(sysUser.getId());
        vo.setName(sysUser.getRealname());
        vo.setAccount(sysUser.getUsername());
        vo.setAvatarHue(avatarHue(sysUser.getUsername()));
        vo.setTenantId(sysUser.getLoginTenantId());

        Set<String> roleCodes = sysUserService.getUserRolesSet(sysUser.getUsername());
        String uiRole = resolveUiRole(roleCodes, sysUser.getLoginTenantId());
        vo.setRole(uiRole);
        vo.setRoleName(uiRoleDisplayName(uiRole));

        Integer tenantId = sysUser.getLoginTenantId();
        if (tenantId != null && tenantId > 0) {
            SysTenant tenant = sysTenantService.getById(tenantId);
            vo.setOrgName(tenant == null ? "" : tenant.getName());
        } else {
            vo.setOrgName("");
        }
        return vo;
    }

    private static String resolveUiRole(Set<String> roleCodes, Integer tenantId) {
        if (roleCodes != null) {
            if (roleCodes.contains("admin") || roleCodes.contains("superadmin")) {
                return "super";
            }
            if (roleCodes.contains("zuhuadmin")) {
                return "orgAdmin";
            }
            if (roleCodes.contains("leader")) {
                return "leader";
            }
            if (roleCodes.contains("auditor")) {
                return "auditor";
            }
            if (roleCodes.contains("teacher")) {
                return "teacher";
            }
        }
        // 兜底：有租户说明是机构侧用户，无租户是平台侧
        return (tenantId != null && tenantId > 0) ? "teacher" : "super";
    }

    private static String uiRoleDisplayName(String uiRole) {
        switch (uiRole) {
            case "orgAdmin":
                return "机构管理员";
            case "leader":
                return "年级学科组长";
            case "auditor":
                return "审核员";
            case "teacher":
                return "教师";
            case "super":
            default:
                return "超级管理员";
        }
    }

    /** 由账号稳定推导头像色相（0~359），保证同一账号每次登录头像颜色一致 */
    private static int avatarHue(String account) {
        if (account == null) {
            return 0;
        }
        int hash = 0;
        for (char c : account.toCharArray()) {
            hash = (hash * 31 + c) % 360;
        }
        return Math.abs(hash);
    }

    private boolean isLoginFailOvertimes(String username) {
        Object failTime = redisUtil.get(CommonConstant.LOGIN_FAIL + username);
        if (failTime != null) {
            return Integer.parseInt(failTime.toString()) > LOGIN_FAIL_LIMIT;
        }
        return false;
    }

    private void addLoginFailOvertimes(String username) {
        String key = CommonConstant.LOGIN_FAIL + username;
        Object failTime = redisUtil.get(key);
        int val = failTime == null ? 0 : Integer.parseInt(failTime.toString());
        redisUtil.set(key, ++val, LOGIN_FAIL_EXPIRE_SECONDS);
    }
}
