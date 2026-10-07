package org.jeecg.common.api.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 教学云统一响应格式，对应前端 @aiteach/shared 的 ApiResponse<T>。
 *
 * 与框架 {@link Result} 的差异（前端契约要求，勿混用）：
 * <ul>
 *   <li>成功码是 0，而 Result 的成功码是 200</li>
 *   <li>数据字段叫 data，而 Result 叫 result</li>
 * </ul>
 * 教学云业务 Controller 一律返回本类；框架原有 Controller 仍返回 Result，互不影响。
 *
 * @author 教学云
 */
@Data
@Schema(description = "教学云接口返回对象")
public class ApiResult<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 业务状态码，0 表示成功 */
    public static final int CODE_SUCCESS = 0;

    /** 通用业务失败码 */
    public static final int CODE_FAIL = 500;

    @Schema(description = "业务状态码，0 表示成功")
    private int code;

    @Schema(description = "返回处理消息")
    private String message = "";

    @Schema(description = "返回数据对象")
    private T data;

    public ApiResult() {
    }

    public ApiResult(int code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public static <T> ApiResult<T> ok() {
        return new ApiResult<>(CODE_SUCCESS, "", null);
    }

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>(CODE_SUCCESS, "", data);
    }

    public static <T> ApiResult<T> ok(String message, T data) {
        return new ApiResult<>(CODE_SUCCESS, message, data);
    }

    public static <T> ApiResult<T> fail(String message) {
        return new ApiResult<>(CODE_FAIL, message, null);
    }

    public static <T> ApiResult<T> fail(int code, String message) {
        return new ApiResult<>(code, message, null);
    }
}
