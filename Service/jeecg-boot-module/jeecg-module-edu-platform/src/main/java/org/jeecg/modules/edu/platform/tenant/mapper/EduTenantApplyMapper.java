package org.jeecg.modules.edu.platform.tenant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.jeecg.modules.edu.platform.tenant.entity.EduTenantApply;

import java.util.List;
import java.util.Map;

/**
 * 入驻申请 Mapper。
 *
 * @author 教学云
 */
public interface EduTenantApplyMapper extends BaseMapper<EduTenantApply> {

    /**
     * 分页查询入驻申请。返回原始列（JSON 列原样字符串，日期为 Timestamp），由服务层转成 VO。
     * 排序：待审核优先，其余按提交时间倒序（与前端 Mock 同口径）。
     */
    List<Map<String, Object>> listApplies(@Param("status") Integer status,
                                          @Param("orgType") String orgType,
                                          @Param("keyword") String keyword,
                                          @Param("stages") List<String> stages,
                                          @Param("contact") String contact,
                                          @Param("offset") long offset,
                                          @Param("limit") long limit);

    /** 统计入驻申请总数（含筛选条件） */
    long countApplies(@Param("status") Integer status,
                      @Param("orgType") String orgType,
                      @Param("keyword") String keyword,
                      @Param("stages") List<String> stages,
                      @Param("contact") String contact);
}
