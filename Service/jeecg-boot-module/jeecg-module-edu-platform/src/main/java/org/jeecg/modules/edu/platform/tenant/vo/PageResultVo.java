package org.jeecg.modules.edu.platform.tenant.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.List;

/**
 * 分页结果（对齐前端 PageResult）。
 *
 * @author 教学云
 */
@Data
@Schema(description = "分页结果")
public class PageResultVo<T> implements Serializable {

    private static final long serialVersionUID = 1L;

    @Schema(description = "当前页数据")
    private List<T> list;

    @Schema(description = "总数")
    private long total;

    public PageResultVo(List<T> list, long total) {
        this.list = list;
        this.total = total;
    }
}
