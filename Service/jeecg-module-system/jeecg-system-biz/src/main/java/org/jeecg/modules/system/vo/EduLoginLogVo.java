package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 个人中心-登录记录（对齐前端 {@code LoginLog}）。
 *
 * <p><b>id 为什么是 int 而不是 sys_log.id</b>：sys_log.id 是 varchar(32) 的雪花串，
 * 19 位数字超出 JS 的 Number.MAX_SAFE_INTEGER，直接下发会被前端 JSON.parse 成错误的值；
 * 而前端只把它当列表渲染的 key 用，不参与任何查询，故由后端按倒序生成 1..N 的序号下发。
 *
 * @author 教学云
 */
@Data
@Schema(description = "登录记录")
public class EduLoginLogVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "列表序号（渲染 key，不代表数据库主键）")
    private int id;

    @Schema(description = "登录账号")
    private String account;

    @Schema(description = "来源 IP")
    private String ip;

    @Schema(description = "登录设备")
    private String device;

    @Schema(description = "是否成功")
    private boolean ok;

    @Schema(description = "登录时间 yyyy-MM-dd HH:mm:ss")
    private String time;
}
