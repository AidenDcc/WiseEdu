package org.jeecg.modules.system.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 个人中心-头像入参。
 *
 * <p>{@code avatar} 传 null / 空串表示「恢复默认字母头像」—— 与前端「恢复默认头像」按钮对应。
 *
 * @author 教学云
 */
@Data
@Schema(description = "头像更新入参")
public class EduProfileAvatarModel implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "头像 dataURL；null 表示恢复默认")
    private String avatar;
}
