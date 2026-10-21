package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;

/**
 * 资质材料（前端 CertFile）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "资质材料")
public class CertFileVo implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "文件名")
    private String name;

    /** pdf / img */
    @Schema(description = "文件类型：pdf|img")
    private String type;

    /** license 营业执照 / permit 许可证 / legal 法人信息 */
    @Schema(description = "分类：license|permit|legal")
    private String category;
}
