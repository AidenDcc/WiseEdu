package org.jeecg.modules.edu.platform.advice;

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
 * 平台端异常适配：把框架抛出的异常折成前端契约的 {@link ApiResult}。
 *
 * <p><b>为什么 {@code basePackages} 与 {@code @Order} 必须同时写</b>：
 * 框架的 {@code JeecgBootExceptionHandler} 是一个没有 {@code basePackages} 限定的全局 {@code @RestControllerAdvice}，
 * 里面注册了 {@code @ExceptionHandler(Exception.class)}。
 * <ul>
 *   <li>只写 {@code @Order(HIGHEST_PRECEDENCE)}：本类会连框架自己 Controller 的异常一起接管，
 *       把原本返回 {@code Result} 的接口改成返回 {@code ApiResult}，打穿框架既有前端。</li>
 *   <li>只写 {@code basePackages}：Spring 会按 advice 的先后顺序取第一个“能处理该异常”的 advice；
 *       全局那个恰好也声明了 {@code Exception.class}，谁先注册不确定，本类可能永远轮不上。</li>
 * </ul>
 * 两者同时用，才能做到「只接管 edu.platform 包下的 Controller，且优先于全局处理器」。
 *
 * <p>机构端有一份结构相同的 {@code EduTenantExceptionAdvice}。刻意不抽公共父类：
 * 全项目只有这两份，抽出去反而把「哪条 advice 覆盖哪个包」这个关键信息藏进了继承链。
 *
 * @author 教学云
 */
@Slf4j
@RestControllerAdvice(basePackages = "org.jeecg.modules.edu.platform")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class EduPlatformExceptionAdvice {

    /** 业务可提示异常：消息面向最终用户，原样透出 */
    @ExceptionHandler(JeecgBootBizTipException.class)
    public ApiResult<Void> handleBizTip(JeecgBootBizTipException e) {
        log.warn("平台端业务异常：{}", e.getMessage());
        return ApiResult.fail(500, e.getMessage());
    }

    /** 框架通用业务异常 */
    @ExceptionHandler(JeecgBootException.class)
    public ApiResult<Void> handleJeecgBoot(JeecgBootException e) {
        log.warn("平台端业务异常：{}", e.getMessage());
        return ApiResult.fail(500, e.getMessage());
    }

    /**
     * 权限不足。必须单独处理、且返回 403 —— 落到下面的兜底分支会变成 500「服务内部错误」，
     * 前端据此弹「系统异常」而不是「无权限」，排查时会往错误的方向找。
     */
    @ExceptionHandler({UnauthorizedException.class, AuthorizationException.class})
    public ApiResult<Void> handleUnauthorized(Exception e) {
        log.warn("平台端权限不足：{}", e.getMessage());
        return ApiResult.fail(403, "没有访问权限，请联系管理员授权");
    }

    /** 兜底。不把堆栈或原始 message 返回给前端，只留在日志里 */
    @ExceptionHandler(Exception.class)
    public ApiResult<Void> handleAny(Exception e) {
        log.error("平台端未预期异常", e);
        return ApiResult.fail(500, "服务内部错误");
    }
}
