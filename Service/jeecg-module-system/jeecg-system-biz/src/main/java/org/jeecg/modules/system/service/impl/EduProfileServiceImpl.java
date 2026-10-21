package org.jeecg.modules.system.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import lombok.extern.slf4j.Slf4j;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.util.PasswordUtil;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.modules.system.entity.EduUserProfile;
import org.jeecg.modules.system.entity.SysLog;
import org.jeecg.modules.system.entity.SysUser;
import org.jeecg.modules.system.mapper.EduUserProfileMapper;
import org.jeecg.modules.system.service.IEduProfileService;
import org.jeecg.modules.system.service.ISysLogService;
import org.jeecg.modules.system.service.ISysUserService;
import org.jeecg.modules.system.vo.EduLoginLogVo;
import org.jeecg.modules.system.vo.EduProfileBaseModel;
import org.jeecg.modules.system.vo.EduProfileNotifyVo;
import org.jeecg.modules.system.vo.EduProfilePasswordModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 个人中心实现。
 *
 * <p><b>字段落位</b>：姓名/手机/邮箱/简介 → {@code sys_user}（realname/phone/email/sign）；
 * 头像/消息偏好 → {@code edu_user_profile}。之所以拆两处，见 {@link EduUserProfile} 的类注释。
 *
 * <p><b>为什么用 LambdaUpdateWrapper 而不是 updateById</b>：MyBatis-Plus 的
 * {@code updateById} 默认忽略 null 字段，用户「清空手机号」就永远写不进去；
 * 用 wrapper 显式 set 才能把列更新成 NULL。注意手机号、邮箱在 sys_user 上有唯一索引，
 * 空值必须写 NULL 而不是空串，否则第二个空串会撞唯一键。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduProfileServiceImpl implements IEduProfileService {

    /** sys_log.log_type = 1 → 登录日志（CommonConstant.LOG_TYPE_1） */
    private static final int LOG_TYPE_LOGIN = 1;

    /** 头像 dataURL 上限 2MB：longtext 虽能存更大，但一次 HTTP 请求体过大没有意义 */
    private static final int AVATAR_MAX_BYTES = 2 * 1024 * 1024;

    @Autowired
    private ISysUserService sysUserService;
    @Autowired
    private ISysLogService sysLogService;
    @Autowired
    private EduUserProfileMapper profileMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateBase(String username, EduProfileBaseModel model) {
        SysUser user = requireUser(username);

        String name = trim(model.getName());
        if (name == null || name.length() < 2) {
            throw new JeecgBootBizTipException("姓名至少 2 个字");
        }
        if (name.length() > 50) {
            throw new JeecgBootBizTipException("姓名不能超过 50 个字");
        }

        String phone = emptyToNull(trim(model.getPhone()));
        if (phone != null && !phone.matches("^1\\d{10}$")) {
            throw new JeecgBootBizTipException("请输入 11 位手机号");
        }
        String email = emptyToNull(trim(model.getEmail()));
        if (email != null && !email.matches("^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$")) {
            throw new JeecgBootBizTipException("邮箱格式不正确");
        }
        if (email != null && email.length() > 45) {
            throw new JeecgBootBizTipException("邮箱长度不能超过 45 个字符");
        }
        String intro = trim(model.getIntro());
        if (intro != null && intro.length() > 200) {
            throw new JeecgBootBizTipException("个人简介不能超过 200 个字");
        }

        // 唯一性：手机号/邮箱在 sys_user 上是唯一索引，先给出可读提示而不是让 SQL 报 1062
        if (phone != null && existsOther(user.getId(), SysUser::getPhone, phone)) {
            throw new JeecgBootBizTipException("该手机号已被其他账号使用");
        }
        if (email != null && existsOther(user.getId(), SysUser::getEmail, email)) {
            throw new JeecgBootBizTipException("该邮箱已被其他账号使用");
        }

        LambdaUpdateWrapper<SysUser> update = new LambdaUpdateWrapper<>();
        update.eq(SysUser::getId, user.getId())
            .set(SysUser::getRealname, name)
            .set(SysUser::getPhone, phone)
            .set(SysUser::getEmail, email)
            .set(SysUser::getSign, emptyToNull(intro));
        sysUserService.update(update);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateAvatar(String username, String avatar) {
        SysUser user = requireUser(username);
        String next = emptyToNull(avatar);
        if (next != null && next.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > AVATAR_MAX_BYTES) {
            throw new JeecgBootBizTipException("头像文件过大，请换一张小于 2MB 的图片");
        }
        EduUserProfile row = getOrCreate(user.getId());
        row.setAvatar(next);
        profileMapper.updateById(row);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void changePassword(String username, EduProfilePasswordModel model) {
        SysUser user = requireUser(username);
        if (oConvertUtils.isEmpty(model.getOldPassword())) {
            throw new JeecgBootBizTipException("请输入当前密码");
        }
        String oldEncrypted = PasswordUtil.encrypt(username, model.getOldPassword(), user.getSalt());
        if (!oldEncrypted.equals(user.getPassword())) {
            throw new JeecgBootBizTipException("当前密码不正确");
        }

        String newPwd = model.getNewPassword();
        if (newPwd == null || newPwd.length() < 8) {
            throw new JeecgBootBizTipException("新密码至少 8 位，须含字母与数字");
        }
        if (!newPwd.matches(".*[a-zA-Z].*") || !newPwd.matches(".*\\d.*")) {
            throw new JeecgBootBizTipException("新密码须同时包含字母与数字");
        }
        if (newPwd.equals(model.getOldPassword())) {
            throw new JeecgBootBizTipException("新密码不能与当前密码相同");
        }

        // 沿用原盐：改密码只换哈希，不换盐，历史上签发的 token 会因密码变化而验签失败，
        // 从而自然失效（符合前端「改完需重新登录」的提示）
        SysUser patch = new SysUser();
        patch.setId(user.getId());
        patch.setPassword(PasswordUtil.encrypt(username, newPwd, user.getSalt()));
        sysUserService.updateById(patch);
        log.info("用户 {} 修改密码成功", username);
    }

    @Override
    public EduProfileNotifyVo getNotify(String username) {
        SysUser user = requireUser(username);
        EduUserProfile row = find(user.getId());
        EduProfileNotifyVo vo = new EduProfileNotifyVo();
        // 从未设置过时给一套合理默认（与前端 mock 的初值一致）
        vo.setInApp(row == null || row.getNotifyInApp() == null || row.getNotifyInApp());
        vo.setSms(row == null || row.getNotifySms() == null || row.getNotifySms());
        vo.setEmail(row != null && Boolean.TRUE.equals(row.getNotifyEmail()));
        vo.setDigest(row == null || row.getNotifyDigest() == null || row.getNotifyDigest());
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateNotify(String username, EduProfileNotifyVo vo) {
        SysUser user = requireUser(username);
        EduUserProfile row = getOrCreate(user.getId());
        row.setNotifyInApp(bool(vo.getInApp()));
        row.setNotifySms(bool(vo.getSms()));
        row.setNotifyEmail(bool(vo.getEmail()));
        row.setNotifyDigest(bool(vo.getDigest()));
        profileMapper.updateById(row);
    }

    @Override
    public List<EduLoginLogVo> listLoginLogs(String username, int limit) {
        // jeecg 写 sys_log 时 username 列存的是「姓名」而不是登录账号
        // （admin 的流水里是「管理员」），只按账号过滤会永远查不到，故一并匹配 realname
        SysUser self = oConvertUtils.isEmpty(username) ? null : sysUserService.getUserByName(username);
        String realname = self == null ? null : self.getRealname();

        LambdaQueryWrapper<SysLog> query = new LambdaQueryWrapper<>();
        // 只取「登录」流水：退出登录同样写 log_type=1，不过滤会把退出记录混进登录记录
        query.eq(SysLog::getLogType, LOG_TYPE_LOGIN)
            .and(w -> {
                w.eq(SysLog::getUsername, username);
                if (!oConvertUtils.isEmpty(realname) && !realname.equals(username)) {
                    w.or().eq(SysLog::getUsername, realname);
                }
            })
            .like(SysLog::getLogContent, "登录")
            .orderByDesc(SysLog::getCreateTime)
            .last("limit " + Math.max(1, limit));

        List<SysLog> rows = sysLogService.list(query);
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<EduLoginLogVo> result = new ArrayList<>(rows.size());
        int seq = 1;
        for (SysLog row : rows) {
            EduLoginLogVo vo = new EduLoginLogVo();
            vo.setId(seq++);
            // 流水里的 username 可能是姓名（见上），统一显示登录账号
            vo.setAccount(username);
            vo.setIp(oConvertUtils.isEmpty(row.getIp()) ? "-" : row.getIp());
            vo.setDevice(deviceOf(row.getClientType()));
            // 目前只有「登录成功」会落库（失败不写 sys_log），故默认成功；
            // 若将来补上失败流水，文案里会带「失败」二字，这里按内容判断
            String content = row.getLogContent() == null ? "" : row.getLogContent();
            vo.setOk(!content.contains("失败"));
            vo.setTime(row.getCreateTime() == null ? "" : fmt.format(row.getCreateTime()));
            result.add(vo);
        }
        return result;
    }

    @Override
    public String loadAvatar(String userId) {
        EduUserProfile row = find(userId);
        return row == null ? null : row.getAvatar();
    }

    /* ------------------------------------------------------------------ */

    private SysUser requireUser(String username) {
        SysUser user = oConvertUtils.isEmpty(username) ? null : sysUserService.getUserByName(username);
        if (user == null) {
            throw new JeecgBootBizTipException("登录已失效，请重新登录");
        }
        return user;
    }

    private EduUserProfile find(String userId) {
        LambdaQueryWrapper<EduUserProfile> query = new LambdaQueryWrapper<>();
        query.eq(EduUserProfile::getUserId, userId).last("limit 1");
        return profileMapper.selectOne(query);
    }

    /**
     * 取扩展行，没有则建一行。
     *
     * <p>并发首次写入时两个请求可能同时判定「不存在」，靠 uk_edu_user_profile_user 唯一键兜底：
     * 后插入者会抛 DuplicateKey，此处捕获后重查即可，避免给用户抛 500。
     */
    private EduUserProfile getOrCreate(String userId) {
        EduUserProfile row = find(userId);
        if (row != null) {
            return row;
        }
        EduUserProfile created = new EduUserProfile();
        created.setUserId(userId);
        created.setNotifyInApp(true);
        created.setNotifySms(true);
        created.setNotifyEmail(false);
        created.setNotifyDigest(true);
        created.setCreateTime(new Date());
        created.setUpdateTime(new Date());
        try {
            profileMapper.insert(created);
            return created;
        } catch (org.springframework.dao.DuplicateKeyException dup) {
            EduUserProfile existing = find(userId);
            if (existing == null) {
                throw dup;
            }
            return existing;
        }
    }

    /** 手机号/邮箱是否已被**其他**账号占用 */
    private <T> boolean existsOther(String selfId, com.baomidou.mybatisplus.core.toolkit.support.SFunction<SysUser, T> column, T value) {
        LambdaQueryWrapper<SysUser> query = new LambdaQueryWrapper<>();
        query.eq(column, value).ne(SysUser::getId, selfId);
        return sysUserService.count(query) > 0;
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String emptyToNull(String value) {
        return oConvertUtils.isEmpty(value) ? null : value;
    }

    private static boolean bool(Boolean value) {
        return Boolean.TRUE.equals(value);
    }

    /** 客户端类型 → 可读设备名（sys_log.client_type，写日志时由 JwtUtil 带入） */
    private static String deviceOf(String clientType) {
        if (oConvertUtils.isEmpty(clientType)) {
            return "Web 浏览器";
        }
        switch (clientType.toLowerCase()) {
            case "app":
                return "移动端 App";
            case "phone":
                return "手机浏览器";
            default:
                return "Web 浏览器";
        }
    }
}
