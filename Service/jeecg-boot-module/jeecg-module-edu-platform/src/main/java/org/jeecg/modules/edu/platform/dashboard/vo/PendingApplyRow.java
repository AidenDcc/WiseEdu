package org.jeecg.modules.edu.platform.dashboard.vo;

import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * 待审核入驻申请的原始行。
 *
 * <p>存在的理由：数据库里的 stages 是 JSON 数组、submitted_at 是 DATE，而接口要的是
 * 「小学 / 初中」这样的展示串和「已等待 N 小时」。把原始值先落在这个类上、再由 Service 归一化，
 * 好过让 MyBatis 直接往出参 {@link AdminOverviewVo.PendingApply} 里塞未加工的 JSON ——
 * 那样一旦有人把 mapper 结果直接返回，前端就会拿到 ["小学","初中"]。
 *
 * @author 教学云
 */
@Data
public class PendingApplyRow implements Serializable {

    private static final long serialVersionUID = 1L;

    private String applyNo;
    private String orgName;
    private String orgType;

    /** 原始 JSON 数组字符串，如 ["小学","初中"] */
    private String stages;

    private String contact;
    private String phone;
    private Date submittedAt;
}
