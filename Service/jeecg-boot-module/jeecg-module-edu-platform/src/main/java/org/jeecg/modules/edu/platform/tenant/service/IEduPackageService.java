package org.jeecg.modules.edu.platform.tenant.service;

import com.baomidou.mybatisplus.extension.service.IService;
import org.jeecg.modules.edu.platform.tenant.entity.EduPackage;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageSaveModel;
import org.jeecg.modules.edu.platform.tenant.vo.EduPackageVo;

import java.util.List;

/**
 * 套餐服务。
 *
 * @author 教学云
 */
public interface IEduPackageService extends IService<EduPackage> {

    /** 套餐列表（按排序号升序） */
    List<EduPackageVo> listAll();

    /** 保存套餐（有 id 为编辑，无 id 为新增） */
    EduPackageVo savePackage(EduPackageSaveModel model);

    /** 实体 → VO（机构详情等跨服务复用） */
    EduPackageVo toVo(EduPackage entity);
}
