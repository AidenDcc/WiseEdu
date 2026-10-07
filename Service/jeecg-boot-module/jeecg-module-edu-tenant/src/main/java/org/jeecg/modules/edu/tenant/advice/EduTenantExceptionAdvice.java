package org.jeecg.modules.edu.tenant.advice;

import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.authz.AuthorizationException;
import org.apache.shiro.authz.UnauthorizedException;
import org.jeecg.common.api.vo.ApiResult;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.exception.JeecgBootException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 机构端异常适配，与平台端 {@code EduPlatformExceptionAdvice} 结构相同、包名不同。
 *
 * <p>{@code basePackages} 与 {@code @Order} 必须同时写的原因见平台端那份的类注释。
 *
 * @author 教学云
 */
@Slf4j
@RestControllerAdvice(basePackages = "org.jeecg.modules.edu.tenant")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class EduTenantExceptionAdvice {

    @ExceptionHandler(JeecgBootBizTipException.class)
    public ApiResult<Void> handleBizTip(JeecgBootBizTipException e) {
        log.warn("机构端业务异常：{}", e.getMessage());
        return ApiResult.fail(500, e.getMessage());
    }

    @ExceptionHandler(JeecgBootException.class)
    public ApiResult<Void> handleJeecgBoot(JeecgBootException e) {
        log.warn("机构端业务异常：{}", e.getMessage());
        return ApiResult.fail(500, e.getMessage());
    }

    @ExceptionHandler({UnauthorizedException.class, AuthorizationException.class})
    public ApiResult<Void> handleUnauthorized(Exception e) {
        log.warn("机构端权限不足：{}", e.getMessage());
        return ApiResult.fail(403, "没有访问权限，请联系管理员授权");
    }

    @ExceptionHandler(Exception.class)
    public ApiResult<Void> handleAny(Exception e) {
        log.error("机构端未预期异常", e);
        return ApiResult.fail(500, "服务内部错误");
    }
}
