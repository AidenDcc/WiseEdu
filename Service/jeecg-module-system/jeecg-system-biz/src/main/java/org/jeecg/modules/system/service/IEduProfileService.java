package org.jeecg.modules.system.service;

import org.jeecg.modules.system.vo.EduLoginLogVo;
import org.jeecg.modules.system.vo.EduProfileBaseModel;
import org.jeecg.modules.system.vo.EduProfileNotifyVo;
import org.jeecg.modules.system.vo.EduProfilePasswordModel;

import java.util.List;

/**
 * 个人中心能力（管理端 P-08-01）。
 *
 * <p>资料类字段落在 {@code sys_user}（realname / phone / email / sign），
 * 头像与消息偏好落在扩展表 {@code edu_user_profile}。
 *
 * @author 教学云
 */
public interface IEduProfileService {

    /** 更新个人资料（姓名/手机号/邮箱/简介） */
    void updateBase(String username, EduProfileBaseModel model);

    /** 更新头像；{@code avatar} 为 null 或空串表示恢复默认字母头像 */
    void updateAvatar(String username, String avatar);

    /** 修改密码：校验当前密码 + 新密码强度 */
    void changePassword(String username, EduProfilePasswordModel model);

    /** 读取消息偏好；从未设置过时返回默认值 */
    EduProfileNotifyVo getNotify(String username);

    /** 保存消息偏好 */
    void updateNotify(String username, EduProfileNotifyVo vo);

    /** 本人登录记录（按时间倒序，最多 limit 条） */
    List<EduLoginLogVo> listLoginLogs(String username, int limit);

    /**
     * 读取自定义头像（dataURL）。
     *
     * <p>给 {@code /auth/login} 与 {@code /auth/me} 复用：会话用户里要带上头像，
     * 否则刷新页面后顶栏会退回字母头像。
     *
     * @param userId sys_user.id
     * @return dataURL；无自定义头像时返回 null
     */
    String loadAvatar(String userId);
}
