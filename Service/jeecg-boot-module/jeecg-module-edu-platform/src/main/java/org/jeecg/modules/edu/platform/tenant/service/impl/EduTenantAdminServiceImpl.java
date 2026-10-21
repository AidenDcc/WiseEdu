package org.jeecg.modules.edu.platform.tenant.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.SecurityUtils;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.system.vo.LoginUser;
import org.jeecg.modules.edu.platform.tenant.entity.EduPackage;
import org.jeecg.modules.edu.platform.tenant.entity.EduTenantExt;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantAdminMapper;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantExtMapper;
import org.jeecg.modules.edu.platform.tenant.mapper.EduTenantOpenMapper;
import org.jeecg.modules.edu.platform.tenant.service.IEduPackageService;
import org.jeecg.modules.edu.platform.tenant.service.IEduTenantAdminService;
import org.jeecg.modules.edu.platform.tenant.util.TenantJson;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantActivateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantBaseUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantDetailVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantDisableModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantExpireResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantFeatureUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantIsolationUpdateModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantQueryModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRecordVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRenewModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantRenewResultVo;
import org.jeecg.modules.edu.platform.tenant.vo.EduTenantTrialExtendModel;
import org.jeecg.modules.edu.platform.tenant.vo.PageResultVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 机构租户管理服务实现（FR-PT-008 ~ 014）。
 *
 * <p>状态单一事实源是 {@code edu_tenant_ext.biz_status}（1试用/2正式/3到期/4禁用），
 * 与前端 TenantStatus 对齐；{@code sys_tenant.end_date} 存服务到期时间，
 * {@code sys_tenant.status} 仅在禁用/启用时联动冻结/解冻，用于「下线机构端登录」。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduTenantAdminServiceImpl implements IEduTenantAdminService {

    /** 试用转正式默认服务期：1 年 */
    private static final int ACTIVATE_DAYS = 365;

    @Autowired
    private EduTenantAdminMapper adminMapper;

    @Autowired
    private EduTenantOpenMapper openMapper;

    @Autowired
    private EduTenantExtMapper extMapper;

    @Autowired
    private IEduPackageService packageService;

    @Override
    public PageResultVo<EduTenantRecordVo> listTenants(EduTenantQueryModel query) {
        int page = query.getPage() == null || query.getPage() < 1 ? 1 : query.getPage();
        int pageSize = query.getPageSize() == null || query.getPageSize() < 1 ? 10 : query.getPageSize();

        Integer status = parseInt(query.getStatus());
        Long packageId = parseLong(query.getPackageId());
        Integer aiMin = parseInt(query.getAiMin());
        Integer aiMax = parseInt(query.getAiMax());

        long total = adminMapper.countTenants(status, packageId, blankToNull(query.getOrgType()),
                blankToNull(query.getKeyword()), blankToNull(query.getExpireFrom()), blankToNull(query.getExpireTo()),
                aiMin, aiMax);
        List<Map<String, Object>> rows = adminMapper.listTenants(status, packageId, blankToNull(query.getOrgType()),
                blankToNull(query.getKeyword()), blankToNull(query.getExpireFrom()), blankToNull(query.getExpireTo()),
                aiMin, aiMax, (long) (page - 1) * pageSize, (long) pageSize);

        List<EduTenantRecordVo> list = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            list.add(toRecordVo(row));
        }
        return new PageResultVo<>(list, total);
    }

    @Override
    public EduTenantDetailVo getTenantDetail(Integer id) {
        Map<String, Object> row = requireRecord(id);
        EduTenantDetailVo vo = new EduTenantDetailVo();
        vo.setTenant(toRecordVo(row));

        Long packageId = asLong(row.get("packageId"));
        EduPackage pkg = packageId == null || packageId == 0 ? null : packageService.getById(packageId);
        vo.setPkg(packageService.toVo(pkg));

        // 题目/试卷/教辅三张业务表尚未落地（Wave 3+），先置 0 不编造；员工数取 sys_user_tenant 真实计数。
        EduTenantDetailVo.Stats stats = new EduTenantDetailVo.Stats();
        stats.setQuestionCount(0);
        stats.setPaperCount(0);
        stats.setMaterialCount(0);
        stats.setStaffCount(adminMapper.countStaffOfTenant(id));
        vo.setStats(stats);

        // AI 调用明细依赖 edu_ai_call_log（Wave 4），落地前空占位。
        EduTenantDetailVo.AiMonthly aiMonthly = new EduTenantDetailVo.AiMonthly();
        aiMonthly.setMonths(new ArrayList<>());
        aiMonthly.setCalls(new ArrayList<>());
        vo.setAiMonthly(aiMonthly);
        vo.setAiDaily(new ArrayList<>());
        return vo;
    }

    @Override
    public void disableTenant(Integer id, EduTenantDisableModel model) {
        String reason = model.getReason() == null ? "" : model.getReason().trim();
        if (reason.length() < 5) {
            throw new JeecgBootBizTipException("请填写至少 5 个字的禁用原因");
        }
        EduTenantExt ext = requireExt(id);
        if (ext.getBizStatus() != null && ext.getBizStatus() == EduTenantExt.BIZ_DISABLED) {
            throw new JeecgBootBizTipException("该机构已处于禁用状态");
        }
        Date now = new Date();
        ext.setBizStatus(EduTenantExt.BIZ_DISABLED);
        ext.setDisableReason(reason);
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
        // 立即下线机构端登录：框架侧冻结租户。
        openMapper.updateSysTenantStatus(id, 0, now);
    }

    @Override
    public void enableTenant(Integer id) {
        Map<String, Object> row = requireRecord(id);
        EduTenantExt ext = requireExt(id);
        if (ext.getBizStatus() == null || ext.getBizStatus() != EduTenantExt.BIZ_DISABLED) {
            throw new JeecgBootBizTipException("该机构未处于禁用状态");
        }
        Date now = new Date();
        Date endDate = asDate(row.get("expireTime"));
        Date trialEnd = ext.getTrialEndTime();
        int restore = (endDate != null && endDate.before(now)) ? EduTenantExt.BIZ_EXPIRED
                : (trialEnd != null ? EduTenantExt.BIZ_TRIAL : EduTenantExt.BIZ_FORMAL);
        ext.setBizStatus(restore);
        ext.setDisableReason(null);
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
        openMapper.updateSysTenantStatus(id, 1, now);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public EduTenantRenewResultVo renewTenant(Integer id, EduTenantRenewModel model) {
        Map<String, Object> row = requireRecord(id);
        EduTenantExt ext = requireExt(id);
        EduPackage pkg = packageService.getById(model.getPackageId());
        if (pkg == null) {
            throw new JeecgBootBizTipException("套餐不存在");
        }
        int months = renewMonths(model.getDuration());
        double discount = renewDiscount(model.getDuration());

        Date now = new Date();
        Date endDate = asDate(row.get("expireTime"));
        Date base = (endDate != null && endDate.after(now)) ? endDate : now;
        Date newEnd = plusMonths(base, months);

        ext.setPackageId(pkg.getId());
        ext.setBizStatus(EduTenantExt.BIZ_FORMAL);
        ext.setTrialEndTime(null);
        ext.setSwitches(pkg.getFeatures());
        ext.setQuotas(TenantJson.toJson(buildQuotas(pkg)));
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
        openMapper.updateSysTenantEndDate(id, newEnd, now);

        EduTenantRenewResultVo result = new EduTenantRenewResultVo();
        result.setExpireTime(TenantJson.fmt(newEnd));
        result.setAmount(Math.round(pkg.getMonthlyPrice().doubleValue() * months * discount));
        return result;
    }

    @Override
    public EduTenantExpireResultVo extendTrial(Integer id, EduTenantTrialExtendModel model) {
        int days = model.getDays() == null ? 0 : model.getDays();
        if (days < 1 || days > 90) {
            throw new JeecgBootBizTipException("延长天数须为 1-90 的整数");
        }
        Map<String, Object> row = requireRecord(id);
        EduTenantExt ext = requireExt(id);
        if (ext.getBizStatus() == null || ext.getBizStatus() != EduTenantExt.BIZ_TRIAL) {
            throw new JeecgBootBizTipException("仅试用中的机构可延长试用");
        }
        Date now = new Date();
        Date endDate = asDate(row.get("expireTime"));
        Date trialEnd = ext.getTrialEndTime();
        Date base = trialEnd != null ? trialEnd : (endDate != null ? endDate : now);
        if (base.before(now)) {
            base = now;
        }
        Date newEnd = plusDays(base, days);

        ext.setTrialEndTime(newEnd);
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
        openMapper.updateSysTenantEndDate(id, newEnd, now);

        EduTenantExpireResultVo result = new EduTenantExpireResultVo();
        result.setExpireTime(TenantJson.fmt(newEnd));
        return result;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public EduTenantExpireResultVo activateTenant(Integer id, EduTenantActivateModel model) {
        EduTenantExt ext = requireExt(id);
        if (ext.getBizStatus() == null || ext.getBizStatus() != EduTenantExt.BIZ_TRIAL) {
            throw new JeecgBootBizTipException("仅试用中的机构可转正式");
        }
        EduPackage pkg = packageService.getById(model.getPackageId());
        if (pkg == null) {
            throw new JeecgBootBizTipException("套餐不存在");
        }
        Date now = new Date();
        Date newEnd = plusDays(now, ACTIVATE_DAYS);

        ext.setBizStatus(EduTenantExt.BIZ_FORMAL);
        ext.setPackageId(pkg.getId());
        ext.setTrialEndTime(null);
        ext.setSwitches(pkg.getFeatures());
        ext.setQuotas(TenantJson.toJson(buildQuotas(pkg)));
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
        openMapper.updateSysTenantEndDate(id, newEnd, now);

        EduTenantExpireResultVo result = new EduTenantExpireResultVo();
        result.setExpireTime(TenantJson.fmt(newEnd));
        return result;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateTenantBase(Integer id, EduTenantBaseUpdateModel model) {
        requireRecord(id);
        EduTenantExt ext = requireExt(id);
        Date now = new Date();

        String name = model.getName() == null ? "" : model.getName().trim();
        if (!name.isEmpty()) {
            openMapper.updateSysTenantName(id, name, now);
        }
        ext.setContact(model.getContact());
        ext.setPhone(model.getPhone());
        ext.setCity(model.getCity());
        ext.setAddress(model.getAddress());
        ext.setIntro(model.getIntro());
        ext.setStages(TenantJson.toJson(model.getStages()));
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
    }

    @Override
    public void updateTenantFeature(Integer id, EduTenantFeatureUpdateModel model) {
        EduTenantExt ext = requireExt(id);
        Date now = new Date();
        ext.setSwitches(TenantJson.toJson(model.getSwitches()));
        ext.setQuotas(TenantJson.toJson(model.getQuotas()));
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
    }

    @Override
    public void updateTenantIsolation(Integer id, EduTenantIsolationUpdateModel model) {
        Map<String, Object> row = requireRecord(id);
        Date createdAt = asDate(row.get("createdAt"));
        if (createdAt != null && System.currentTimeMillis() - createdAt.getTime() > 24 * 3600_000L) {
            throw new JeecgBootBizTipException("机构创建超过 24 小时，隔离策略变更请联系平台技术支持执行");
        }
        EduTenantExt ext = requireExt(id);
        Date now = new Date();
        ext.setIsolationType(model.getIsolationType() != null && model.getIsolationType() == 2 ? "dedicated" : "shared");
        ext.setStorageRegion(model.getStorageRegion());
        ext.setUpdateBy(currentUsername());
        ext.setUpdateTime(now);
        extMapper.updateById(ext);
    }

    /* ---------------- 转换与工具 ---------------- */

    private EduTenantRecordVo toRecordVo(Map<String, Object> row) {
        EduTenantRecordVo vo = new EduTenantRecordVo();
        vo.setId(asInt(row.get("id")));
        vo.setCode(asStr(row.get("code")));
        vo.setName(asStr(row.get("name")));
        vo.setLogoHue(asInt(row.get("logoHue")));
        vo.setOrgType(asStr(row.get("orgType")));
        vo.setStages(TenantJson.strArray(asStr(row.get("stages"))));
        vo.setPackageId(asLong(row.get("packageId")));
        vo.setStatus(asInt(row.get("status")));
        vo.setExpireTime(TenantJson.fmt(asDate(row.get("expireTime"))));
        vo.setTrialEndTime(TenantJson.fmt(asDate(row.get("trialEndTime"))));
        vo.setAiUsed(asInt(row.get("aiUsed")));
        vo.setStorageUsedGb(asBigDecimal(row.get("storageUsedGb")));
        vo.setCreatedAt(TenantJson.fmt(asDate(row.get("createdAt"))));
        vo.setContact(asStr(row.get("contact")));
        vo.setPhone(asStr(row.get("phone")));
        vo.setCity(asStr(row.get("city")));
        vo.setAddress(asStr(row.get("address")));
        vo.setIntro(asStr(row.get("intro")));
        vo.setCertFiles(TenantJson.certFiles(asStr(row.get("certFiles"))));
        vo.setIsolationType(asInt(row.get("isolationType")));
        vo.setStorageRegion(asStr(row.get("storageRegion")));
        vo.setDisableReason(asStr(row.get("disableReason")));
        vo.setSwitches(TenantJson.obj(asStr(row.get("switches"))));
        vo.setQuotas(TenantJson.obj(asStr(row.get("quotas"))));
        return vo;
    }

    private Map<String, Object> requireRecord(Integer id) {
        Map<String, Object> row = adminMapper.getTenantById(id);
        if (row == null) {
            throw new JeecgBootBizTipException("机构不存在");
        }
        return row;
    }

    private EduTenantExt requireExt(Integer tenantId) {
        EduTenantExt ext = extMapper.selectOne(new LambdaQueryWrapper<EduTenantExt>()
                .eq(EduTenantExt::getOrgTenantId, tenantId));
        if (ext == null) {
            throw new JeecgBootBizTipException("机构不存在");
        }
        return ext;
    }

    private static Map<String, Object> buildQuotas(EduPackage pkg) {
        Map<String, Object> quotas = new LinkedHashMap<>();
        quotas.put("aiQuota", pkg.getAiQuota() == null ? 0 : pkg.getAiQuota());
        quotas.put("storageGb", pkg.getStorageGb() == null ? 0 : pkg.getStorageGb());
        quotas.put("maxStaff", pkg.getMaxStaff() == null ? 0 : pkg.getMaxStaff());
        quotas.put("maxConcurrent", pkg.getMaxConcurrent() == null ? 0 : pkg.getMaxConcurrent());
        return quotas;
    }

    private static int renewMonths(String duration) {
        if ("quarter".equals(duration)) {
            return 3;
        }
        if ("year".equals(duration)) {
            return 12;
        }
        return 1;
    }

    private static double renewDiscount(String duration) {
        return "year".equals(duration) ? 0.9 : 1.0;
    }

    private static Date plusDays(Date base, int days) {
        Calendar cal = Calendar.getInstance();
        cal.setTime(base);
        cal.add(Calendar.DAY_OF_MONTH, days);
        return cal.getTime();
    }

    private static Date plusMonths(Date base, int months) {
        Calendar cal = Calendar.getInstance();
        cal.setTime(base);
        cal.add(Calendar.MONTH, months);
        return cal.getTime();
    }

    private static Integer parseInt(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Long parseLong(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
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

    private static BigDecimal asBigDecimal(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal) {
            return (BigDecimal) value;
        }
        if (value instanceof Number) {
            return BigDecimal.valueOf(((Number) value).doubleValue());
        }
        try {
            return new BigDecimal(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String currentUsername() {
        Object principal = SecurityUtils.getSubject().getPrincipal();
        return principal instanceof LoginUser ? ((LoginUser) principal).getUsername() : null;
    }
}
