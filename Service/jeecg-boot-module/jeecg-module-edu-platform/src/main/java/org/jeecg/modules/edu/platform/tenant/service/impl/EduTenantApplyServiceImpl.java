package org.jeecg.modules.edu.platform.tenant.service.impl;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.SecurityUtils;
import org.jeecg.common.constant.PasswordConstant;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.system.vo.LoginUser;
import org.jeecg.common.util.PasswordUtil;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.modules.edu.platform.tenant.entity.EduPackage;
import org.jeecg.modules.edu.platform.tenant.entity.EduTenantApply;
import org.jeecg.modules.edu.platform.tenant.entity.EduTenantExt;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantApplyMapper;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantExtMapper;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantOpenMapper;
import org.jeecg.modules.edu.platform.tenant.service.IEduPackageService;
import org.jeecg.modules.edu.platform.tenant.service.IEduTenantApplyService;
import org.jeecg.modules.edu.platform.tenant.util.TenantJson;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyApproveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyCreateModel;
import org.jeecg.modules.edu.platform.tenant.vo.CertFileVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyQueryModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyRejectModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApplyVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantApproveResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.PageResultVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 入驻申请服务实现（FR-PT-005 ~ 007）。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduTenantApplyServiceImpl extends ServiceImpl<EduTenantApplyMapper, EduTenantApply>
        implements IEduTenantApplyService {

    /** 审核状态中文 ↔ DB 整数的换算（与前端 ApplyStatus 对齐） */
    private static final Map<String, Integer> STATUS_TO_INT = Map.of(
            "待审核", EduTenantApply.STATUS_PENDING,
            "已通过", EduTenantApply.STATUS_APPROVED,
            "已驳回", EduTenantApply.STATUS_REJECTED);

    private static final Map<Integer, String> INT_TO_STATUS = Map.of(
            EduTenantApply.STATUS_PENDING, "待审核",
            EduTenantApply.STATUS_APPROVED, "已通过",
            EduTenantApply.STATUS_REJECTED, "已驳回");

    /** 默认资质档案（新增机构未传时兜底），与前端 DEFAULT_CERTS 同构 */
    private static final String DEFAULT_CERT_FILES =
            "[{\"name\":\"营业执照.pdf\",\"type\":\"pdf\",\"category\":\"license\"}," +
            "{\"name\":\"办学许可证.jpg\",\"type\":\"img\",\"category\":\"permit\"}," +
            "{\"name\":\"法人身份证.jpg\",\"type\":\"img\",\"category\":\"legal\"}]";

    /** 机构编号前缀：T + yyyyMMdd */
    private static final DateTimeFormatter DATE_PREFIX = DateTimeFormatter.BASIC_ISO_DATE;

    @Autowired
    private EduTenantApplyMapper applyMapper;

    @Autowired
    private EduTenantOpenMapper openMapper;

    @Autowired
    private EduTenantExtMapper extMapper;

    @Autowired
    private IEduPackageService packageService;

    @Override
    public PageResultVo<EduTenantApplyVo> listApplies(EduTenantApplyQueryModel query) {
        int page = query.getPage() == null || query.getPage() < 1 ? 1 : query.getPage();
        int pageSize = query.getPageSize() == null || query.getPageSize() < 1 ? 10 : query.getPageSize();
        List<String> stages = splitStages(query.getStages());

        // status 为空表示“全部”，Map.of() 不允许 null key，须先判空
        Integer status = query.getStatus() == null ? null : STATUS_TO_INT.get(query.getStatus());
        String keyword = blankToNull(query.getKeyword());
        String orgType = blankToNull(query.getOrgType());
        String contact = blankToNull(query.getContact());

        long total = applyMapper.countApplies(status, orgType, keyword, stages, contact);
        List<Map<String, Object>> rows = applyMapper.listApplies(status, orgType, keyword, stages, contact,
                (long) (page - 1) * pageSize, (long) pageSize);

        List<EduTenantApplyVo> list = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            list.add(toVo(row));
        }
        return new PageResultVo<>(list, total);
    }

    @Override
    public EduTenantApplyVo createApply(EduTenantApplyCreateModel model) {
        String orgName = trim(model.getOrgName());
        String orgType = trim(model.getOrgType());
        String contact = trim(model.getContact());
        String phone = trim(model.getPhone());
        if (orgName.isEmpty()) {
            throw new JeecgBootBizTipException("机构名称不能为空");
        }
        if (orgType.isEmpty()) {
            throw new JeecgBootBizTipException("请选择机构类型");
        }
        if (contact.isEmpty()) {
            throw new JeecgBootBizTipException("联系人不能为空");
        }
        if (!phone.matches("^1\\d{10}$")) {
            throw new JeecgBootBizTipException("请输入 11 位手机号");
        }
        List<CertFileVo> certFiles =
                model.getCertFiles() == null ? new ArrayList<>() : model.getCertFiles();
        if (certFiles.isEmpty()) {
            throw new JeecgBootBizTipException("请至少上传一份资质材料");
        }

        String date = LocalDate.now().format(DATE_PREFIX);
        String applyNo = "AP" + date + String.format("%04d", openMapper.maxApplyNoSeq(date) + 1);
        String code = "T" + date + String.format("%03d",
                Math.max(openMapper.maxApplyOrgCodeSeq(date), openMapper.maxExtOrgCodeSeq(date)) + 1);

        Date now = new Date();
        EduTenantApply entity = new EduTenantApply()
                .setApplyNo(applyNo)
                .setCode(code)
                .setOrgName(orgName)
                .setOrgType(orgType)
                .setStages(TenantJson.toJson(model.getStages()))
                .setContact(contact)
                .setPhone(phone)
                .setEmail(trimToNull(model.getEmail()))
                .setCity(trimToNull(model.getCity()))
                .setAddress(trimToNull(model.getAddress()))
                .setIntro(trimToNull(model.getIntro()))
                .setCertFiles(TenantJson.toJson(certFiles))
                .setStatus(EduTenantApply.STATUS_PENDING)
                .setSubmittedAt(now)
                .setCreateBy(currentUsername())
                .setCreateTime(now)
                .setDelFlag(0);
        this.save(entity);
        return toVo(entity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public EduTenantApproveResultVo approveApply(Long id, EduTenantApplyApproveModel model) {
        int trialDays = model.getTrialDays() == null ? 0 : model.getTrialDays();
        if (trialDays < 1 || trialDays > 90) {
            throw new JeecgBootBizTipException("试用天数须为 1-90 的整数");
        }
        String adminAccount = trim(model.getAdminAccount());
        if (adminAccount.isEmpty()) {
            throw new JeecgBootBizTipException("初始管理员账号不能为空");
        }
        EduPackage pkg = packageService.getById(model.getPackageId());
        if (pkg == null) {
            throw new JeecgBootBizTipException("套餐不存在");
        }
        EduTenantApply apply = this.getById(id);
        if (apply == null) {
            throw new JeecgBootBizTipException("申请不存在");
        }
        if (apply.getStatus() == null || apply.getStatus() != EduTenantApply.STATUS_PENDING) {
            throw new JeecgBootBizTipException("该申请已处理，请刷新列表");
        }

        Date now = new Date();
        Date trialEnd = plusDays(now, trialDays);
        String reviewer = blankToNull(model.getReviewer());
        String operator = reviewer != null ? reviewer : currentUsername();

        // 1. 开户：租户（sys_tenant）
        int tenantId = openMapper.maxTenantId() >= 1000 ? openMapper.maxTenantId() + 1 : 1000;
        openMapper.insertSysTenant(tenantId, apply.getOrgName(), operator, now, now, trialEnd, 1);

        // 2. 初始管理员（sys_user）+ 用户租户关系（sys_user_tenant）
        if (openMapper.countUserByUsername(adminAccount) > 0) {
            throw new JeecgBootBizTipException("初始管理员账号已存在");
        }
        String salt = oConvertUtils.randomGen(8);
        String password = PasswordUtil.encrypt(adminAccount, PasswordConstant.DEFAULT_PASSWORD, salt);
        String userId = String.valueOf(IdWorker.getId());
        openMapper.insertSysUser(userId, adminAccount, apply.getContact(), password, salt,
                apply.getPhone(), apply.getEmail(), operator, now);
        openMapper.insertSysUserTenant(String.valueOf(IdWorker.getId()), userId, tenantId, operator, now);

        // 3. 租户扩展（edu_tenant_ext）：业务状态 = 试用
        EduTenantExt ext = new EduTenantExt()
                .setOrgTenantId(tenantId)
                .setTenantCode(apply.getCode())
                .setLogoHue((int) (apply.getId() * 47 % 360))
                .setBizStatus(EduTenantExt.BIZ_TRIAL)
                .setOrgType(apply.getOrgType())
                .setStages(apply.getStages())
                .setPackageId(pkg.getId())
                .setTrialEndTime(trialEnd)
                .setContact(apply.getContact())
                .setPhone(apply.getPhone())
                .setCity(apply.getCity())
                .setAddress(apply.getAddress())
                .setIntro(apply.getIntro())
                .setCertFiles(blankToNull(apply.getCertFiles()) != null ? apply.getCertFiles() : DEFAULT_CERT_FILES)
                .setIsolationType("shared")
                .setStorageRegion("华东 1（杭州）")
                .setStorageUsedGb(BigDecimal.ZERO)
                .setAiUsed(0)
                .setSwitches(pkg.getFeatures())
                .setQuotas(TenantJson.toJson(buildQuotas(pkg)))
                .setCreateBy(operator)
                .setCreateTime(now)
                .setDelFlag(0);
        extMapper.insert(ext);

        // 4. 申请留痕：通过 + 回填开通的租户
        apply.setStatus(EduTenantApply.STATUS_APPROVED);
        apply.setApplyTenantId(tenantId);
        apply.setReviewedAt(now);
        apply.setReviewedBy(operator);
        apply.setUpdateBy(operator);
        apply.setUpdateTime(now);
        this.updateById(apply);

        EduTenantApproveResultVo result = new EduTenantApproveResultVo();
        result.setTenantName(apply.getOrgName());
        result.setExpireTime(TenantJson.fmt(trialEnd));
        result.setAdminAccount(adminAccount);
        return result;
    }

    @Override
    public void rejectApply(Long id, EduTenantApplyRejectModel model) {
        String reason = trim(model.getReason());
        if (reason.length() < 5 || reason.length() > 200) {
            throw new JeecgBootBizTipException("驳回原因须为 5-200 字");
        }
        EduTenantApply apply = this.getById(id);
        if (apply == null) {
            throw new JeecgBootBizTipException("申请不存在");
        }
        if (apply.getStatus() == null || apply.getStatus() != EduTenantApply.STATUS_PENDING) {
            throw new JeecgBootBizTipException("该申请已处理，请刷新列表");
        }
        Date now = new Date();
        String operator = blankToNull(model.getReviewer()) != null ? model.getReviewer() : currentUsername();
        apply.setStatus(EduTenantApply.STATUS_REJECTED);
        apply.setRejectReason(reason);
        apply.setReviewedAt(now);
        apply.setReviewedBy(operator);
        apply.setUpdateBy(operator);
        apply.setUpdateTime(now);
        this.updateById(apply);
    }

    /* ---------------- 转换与工具 ---------------- */

    private EduTenantApplyVo toVo(EduTenantApply entity) {
        EduTenantApplyVo vo = new EduTenantApplyVo();
        vo.setId(entity.getId());
        vo.setApplyNo(entity.getApplyNo());
        vo.setCode(entity.getCode());
        vo.setOrgName(entity.getOrgName());
        vo.setOrgType(entity.getOrgType());
        vo.setStages(TenantJson.strArray(entity.getStages()));
        vo.setContact(entity.getContact());
        vo.setPhone(entity.getPhone());
        vo.setEmail(entity.getEmail());
        vo.setCity(entity.getCity());
        vo.setAddress(entity.getAddress());
        vo.setIntro(entity.getIntro());
        vo.setCertFiles(TenantJson.certFiles(entity.getCertFiles()));
        vo.setSubmittedAt(TenantJson.fmt(entity.getSubmittedAt()));
        vo.setWaitingHours(waitingHours(entity.getSubmittedAt()));
        vo.setStatus(INT_TO_STATUS.getOrDefault(entity.getStatus(), ""));
        vo.setReviewedAt(TenantJson.fmt(entity.getReviewedAt()));
        vo.setReviewer(entity.getReviewedBy());
        vo.setRejectReason(entity.getRejectReason());
        return vo;
    }

    private EduTenantApplyVo toVo(Map<String, Object> row) {
        EduTenantApplyVo vo = new EduTenantApplyVo();
        vo.setId(asLong(row.get("id")));
        vo.setApplyNo(asStr(row.get("applyNo")));
        vo.setCode(asStr(row.get("code")));
        vo.setOrgName(asStr(row.get("orgName")));
        vo.setOrgType(asStr(row.get("orgType")));
        vo.setStages(TenantJson.strArray(asStr(row.get("stages"))));
        vo.setContact(asStr(row.get("contact")));
        vo.setPhone(asStr(row.get("phone")));
        vo.setEmail(asStr(row.get("email")));
        vo.setCity(asStr(row.get("city")));
        vo.setAddress(asStr(row.get("address")));
        vo.setIntro(asStr(row.get("intro")));
        vo.setCertFiles(TenantJson.certFiles(asStr(row.get("certFiles"))));
        Date submittedAt = asDate(row.get("submittedAt"));
        vo.setSubmittedAt(TenantJson.fmt(submittedAt));
        vo.setWaitingHours(waitingHours(submittedAt));
        vo.setStatus(INT_TO_STATUS.getOrDefault(asInt(row.get("status")), ""));
        vo.setReviewedAt(TenantJson.fmt(asDate(row.get("reviewedAt"))));
        vo.setReviewer(asStr(row.get("reviewedBy")));
        vo.setRejectReason(asStr(row.get("rejectReason")));
        return vo;
    }

    private static Map<String, Object> buildQuotas(EduPackage pkg) {
        Map<String, Object> quotas = new LinkedHashMap<>();
        quotas.put("aiQuota", pkg.getAiQuota() == null ? 0 : pkg.getAiQuota());
        quotas.put("storageGb", pkg.getStorageGb() == null ? 0 : pkg.getStorageGb());
        quotas.put("maxStaff", pkg.getMaxStaff() == null ? 0 : pkg.getMaxStaff());
        quotas.put("maxConcurrent", pkg.getMaxConcurrent() == null ? 0 : pkg.getMaxConcurrent());
        return quotas;
    }

    private static List<String> splitStages(String stages) {
        if (stages == null || stages.isBlank()) {
            return null;
        }
        List<String> result = new ArrayList<>();
        for (String part : stages.split(",")) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                result.add(trimmed);
            }
        }
        return result.isEmpty() ? null : result;
    }

    private static long waitingHours(Date submittedAt) {
        if (submittedAt == null) {
            return 0L;
        }
        long ms = System.currentTimeMillis() - submittedAt.getTime();
        return Math.max(0, ms / 3600_000L);
    }

    private static Date plusDays(Date base, int days) {
        return Date.from(base.toInstant().plusSeconds(days * 86400L));
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static String trimToNull(String value) {
        String trimmed = trim(value);
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String asStr(Object value) {
        return value == null ? null : value.toString();
    }

    private static Long asLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        try {
            return Long.parseLong(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer asInt(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Date asDate(Object value) {
        return TenantJson.toDate(value);
    }

    private static String currentUsername() {
        Object principal = SecurityUtils.getSubject().getPrincipal();
        return principal instanceof LoginUser ? ((LoginUser) principal).getUsername() : null;
    }
}
