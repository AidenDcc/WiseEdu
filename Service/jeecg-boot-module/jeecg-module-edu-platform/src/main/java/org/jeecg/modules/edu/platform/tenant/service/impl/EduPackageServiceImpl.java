package org.jeecg.modules.edu.platform.tenant.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.apache.shiro.SecurityUtils;
import org.jeecg.common.exception.JeecgBootBizTipException;
import org.jeecg.common.system.vo.LoginUser;
import org.jeecg.common.util.oConvertUtils;
import org.jeecg.modules.edu.platform.tenant.entity.EduPackage;
import org.jeecg.modules.edu.platform.tenant.mapper.EduPackageMapper;
import org.jeecg.modules.edu.platform.tenant.service.IEduPackageService;
import org.jeecg.modules.edu.platform.tenant.util.TenantJson;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageSaveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageVo;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 套餐服务实现。
 *
 * @author 教学云
 */
@Slf4j
@Service
public class EduPackageServiceImpl extends ServiceImpl<EduPackageMapper, EduPackage>
        implements IEduPackageService {

    @Override
    public List<EduPackageVo> listAll() {
        LambdaQueryWrapper<EduPackage> query = new LambdaQueryWrapper<>();
        query.orderByAsc(EduPackage::getSortNo).orderByAsc(EduPackage::getId);
        return this.list(query).stream().map(this::toVo).collect(Collectors.toList());
    }

    @Override
    public EduPackageVo savePackage(EduPackageSaveModel model) {
        if (oConvertUtils.isEmpty(model.getName())) {
            throw new JeecgBootBizTipException("套餐名称不能为空");
        }
        EduPackage entity = new EduPackage()
                .setName(model.getName().trim())
                .setMonthlyPrice(model.getMonthlyPrice() == null ? BigDecimal.ZERO : model.getMonthlyPrice())
                .setAiQuota(model.getAiQuota() == null ? 0 : model.getAiQuota())
                .setStorageGb(model.getStorageGb() == null ? 0 : model.getStorageGb())
                .setMaxStaff(model.getMaxStaff() == null ? 0 : model.getMaxStaff())
                .setMaxConcurrent(model.getMaxConcurrent() == null ? 0 : model.getMaxConcurrent())
                .setFeatures(TenantJson.toJson(model.getFeatures()))
                .setSmsEnabled(Boolean.TRUE.equals(model.getSmsEnabled()) ? 1 : 0)
                .setSortNo(model.getSortNo() == null ? 0 : model.getSortNo())
                .setRemark(model.getRemark())
                .setDelFlag(0);

        if (model.getId() != null) {
            EduPackage existing = this.getById(model.getId());
            if (existing == null) {
                throw new JeecgBootBizTipException("套餐不存在");
            }
            entity.setId(model.getId());
            entity.setUpdateBy(currentUsername());
            entity.setUpdateTime(new Date());
            this.updateById(entity);
        } else {
            this.save(entity);
        }
        return toVo(this.getById(entity.getId()));
    }

    @Override
    public EduPackageVo toVo(EduPackage entity) {
        if (entity == null) {
            return null;
        }
        EduPackageVo vo = new EduPackageVo();
        vo.setId(entity.getId());
        vo.setName(entity.getName());
        vo.setMonthlyPrice(entity.getMonthlyPrice());
        vo.setAiQuota(entity.getAiQuota());
        vo.setStorageGb(entity.getStorageGb());
        vo.setMaxStaff(entity.getMaxStaff());
        vo.setMaxConcurrent(entity.getMaxConcurrent());
        vo.setFeatures(TenantJson.obj(entity.getFeatures()));
        vo.setSmsEnabled(Integer.valueOf(1).equals(entity.getSmsEnabled()));
        return vo;
    }

    private static String currentUsername() {
        Object principal = SecurityUtils.getSubject().getPrincipal();
        return principal instanceof LoginUser ? ((LoginUser) principal).getUsername() : null;
    }
}
