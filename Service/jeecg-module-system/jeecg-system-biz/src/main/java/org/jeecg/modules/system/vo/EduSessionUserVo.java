package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 教学云会话用户，对应前端 @aiteach/shared 的 SessionUser（脱敏，不含密码）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "教学云会话用户")
public class EduSessionUserVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "用户ID（sys_user 雪花ID，字符串以避免前端 Number 精度丢失）")
    private String id;

    @Schema(description = "姓名")
    private String name;

    @Schema(description = "登录账号")
    private String account;

    /**
     * 前端 UI 角色，取自 {@link EduAuthController} 的 sys_role.role_code 映射约定，
     * 取值 super | orgAdmin | leader | auditor | teacher。
     */
    @Schema(description = "UI 角色：super|orgAdmin|leader|auditor|teacher")
    private String role;

    @Schema(description = "UI 角色显示名")
    private String roleName;

    @Schema(description = "所属机构名（无租户时为空）")
    private String orgName;

    @Schema(description = "头像色相，前端据此生成初始字母头像")
    private int avatarHue;

    /**
     * 登录租户ID。前端把它写入请求头 X-Tenant-Id，机构端数据隔离依赖它。
     * 平台侧用户为 0。
     */
    @Schema(description = "登录租户ID，平台侧为 0")
    private Integer tenantId;
}
