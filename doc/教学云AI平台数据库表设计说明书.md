# 教学云AI 平台　数据库表设计说明书

| 项 | 内容 |
|----|------|
| 文档版本 | v1.2 |
| 编写日期 | 2026-10-17（v1.0）／2026-10-19（v1.1）／2026-10-20（v1.2） |
| 适用范围 | 平台运营端（admin）+ 机构端（tenant）全部菜单对应业务 |
| 表数量 | 145 张业务表（另有 0 张纯中间表），共 2486 字段（含 7 个公共字段） |
| 数据库 | MySQL 8.0 / InnoDB / utf8mb4 |
| 配套脚本 | schema.sql（与本文字段逐字一致，同源生成） |
| v1.2 变更 | 未新增表，仅补 7 个字段与 6 组索引：`q_question.scope`；`p_paper.scope` / `reviewer_id` / `reviewer_name` / `reviewed_at`；`r_resource_approval.submit_note`；`ai_trace.safety_reason`。索引含 `q_question`、`p_paper` 的 `scope` 组合索引，以及 `ai_billing_rule` 的 `(tenant_id, scene, model_key)` 唯一键 —— 用于支撑「全局默认 + 租户专属价」两级计价 |

> 生成方式说明：本文与 `schema.sql` 由同一份表定义生成，字段、类型、索引不允许手工分别维护，避免文档与脚本漂移。

## 一、设计原则与规范

### 1.1 命名规范

| 项 | 规范 |
|----|------|
| 表名 | 小写下划线，按域加前缀：`sys_` 系统与租户、`dc_` 内容字典、`q_` 题目、`p_` 试卷、`t_` 备课、`r_` 资源、`e_` 教学执行、`g_` 家长端、`ai_` AI、`c_` 平台内容运营 |
| 字段名 | 小写下划线，布尔语义字段用 `x_flag` / `enabled` / `is_x` |
| 外键 | 逻辑外键（`xxx_id`），不建物理外键约束，由服务层保证一致性 |
| 枚举 | 统一 `VARCHAR(16)` 存英文码值 + 注释给中文口径，避免枚举值扩容时改表结构 |
| 金额 | `DECIMAL(12,2)`（单价到 `DECIMAL(10,4)`），禁止 FLOAT/DOUBLE |
| 大文本 | 题干、解析、正文用 `LONGTEXT`；结构化可检索字段必须独立成列，不得塞进 JSON |
| JSON | 仅用于非检索的可变扩展（选项、页面设置、快照、统计结果） |

### 1.2 全表统一的 7 个公共字段

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |

约定说明：

1. `tenant_id` 全表必带：平台级数据（字典、公共内容、平台配置）固定写 `0`；机构数据写租户 ID。所有业务查询以 `tenant_id` 为第一过滤条件，禁止跨租户聚合（平台统计走只读汇总视图）。
2. `deleted` 为统一删除标识：业务删除一律软删除并同步写 `sys_recycle_bin`（回收站），彻底删除与超期清理由留存策略任务执行并留痕。
3. `create_by` / `update_by` 存用户 ID；纯日志类表（`sys_operation_log`、`sys_login_log`、`sys_error_log`、`ai_call_log`）的 `update_*` 允许不写。
4. `id` 使用雪花算法 BIGINT；接口层统一序列化为字符串，避免前端 JS 精度丢失（与现有前端 `SessionUser.id: string | number` 的口径一致）。
5. 高频并发更新的表（`ai_quota_account`、`q_question.use_count` 等）由服务层做乐观锁或原子自增，不额外加 `version` 列以免拖慢批量更新。

### 1.3 索引与性能约定

- 每张业务表的索引必含 `tenant_id` 前导列（多租户共享库场景）；唯一索引同样带 `tenant_id`，平台级数据以 `tenant_id = 0` 参与唯一性。
- 列表页默认按 `update_time DESC` 排序，均已建索引；大表分页使用「游标 + 上次最大 ID」而非深翻页 `OFFSET`。
- 检索类字段（题干全文、知识点）走搜索引擎/向量库，MySQL 侧只保留结构化过滤列；`stem` 不建全文索引以免写入放大。
- 日志类表按月分区（`ai_call_log` 按 `create_time` RANGE 分区），保留 180 天，冷数据归档到对象存储。

### 1.4 数据隔离与合规

- 共享库租户：`tenant_id` 行级隔离，服务层统一拦截，禁止手写无 `tenant_id` 条件的 SQL。
- 独立库租户（`sys_tenant.isolation_type = 2`）：复用同一套表结构，差异仅在数据源路由。
- 个人信息字段（手机号、身份证号）以 `_cipher` 或加密列存储，展示层按角色脱敏（列表默认脱敏，详情按权限放行，导出默认脱敏并留痕）。
- 未成年人数据（`e_student`、`e_consent_record`）必须先有监护人同意记录（`consent_status = granted`）才允许进入学情计算与画像推送。

## 二、数据域与表清单

| # | 表名 | 中文名 | 所属域 | 字段数 | 用途 |
|---|------|--------|--------|--------|------|
| 1 | sys_tenant | 租户主表 | 租户与组织域 | 31 | 机构（租户）主数据，多租户隔离的根 |
| 2 | sys_tenant_apply | 机构入驻申请 | 租户与组织域 | 26 | 机构入驻申请单与审核留痕 |
| 3 | sys_tenant_cert | 租户资质材料 | 租户与组织域 | 16 | 营业执照/许可证/法人信息等资质附件 |
| 4 | sys_tenant_package | 套餐定义 | 租户与组织域 | 20 | 套餐价格与配额上限 |
| 5 | sys_tenant_package_feature | 套餐功能权益 | 租户与组织域 | 11 | 套餐包含的功能开关（与租户级开关叠加） |
| 6 | sys_tenant_quota | 租户配额 | 租户与组织域 | 12 | 租户级配额，覆盖套餐默认值 |
| 7 | sys_tenant_subscription | 租户订阅记录 | 租户与组织域 | 17 | 开通/续费/升降级流水，权益按订阅区间生效 |
| 8 | sys_tenant_config | 租户业务配置 | 租户与组织域 | 21 | 机构设置页维护的业务参数 |
| 9 | sys_review_flow | 审核流程配置 | 租户与组织域 | 15 | 题目/试卷/资源审核流程与审核人 |
| 10 | sys_user | 用户账号 | 租户与组织域 | 25 | 平台管理员、机构员工、学生、家长统一账号表 |
| 11 | sys_role | 角色 | 租户与组织域 | 15 | 平台端与机构端角色 |
| 12 | sys_user_role | 用户角色关联 | 租户与组织域 | 9 | 用户与角色多对多 |
| 13 | sys_role_permission | 角色权限 | 租户与组织域 | 10 | 角色在各权限模块上的操作位 |
| 14 | sys_menu | 菜单 | 租户与组织域 | 19 | 平台端与机构端菜单树（菜单管理的唯一事实源） |
| 15 | sys_tenant_menu | 机构菜单开关 | 租户与组织域 | 12 | 平台控制机构端菜单可见性 |
| 16 | sys_dict_type | 字典类型 | 内容字典域 | 12 | 字典分组定义 |
| 17 | sys_dict_item | 字典项 | 内容字典域 | 27 | 字典项明细，承载各类型特有属性 |
| 18 | sys_param | 系统参数 | 租户与组织域 | 15 | 系统级参数配置 |
| 19 | sys_message_template | 消息模板 | 租户与组织域 | 14 | 站内信/短信/邮件/推送模板 |
| 20 | sys_notify_rule | 通知规则 | 租户与组织域 | 14 | 通知配置页的触发规则矩阵 |
| 21 | sys_notification | 消息通知 | 租户与组织域 | 18 | 站内消息与待办聚合 |
| 22 | sys_operation_log | 操作日志 | 审计与日志域 | 20 | 平台端与机构端写操作留痕 |
| 23 | sys_login_log | 登录日志 | 审计与日志域 | 16 | 登录成功与失败记录 |
| 24 | sys_error_log | 异常日志 | 审计与日志域 | 13 | 服务端异常与告警 |
| 25 | sys_audit_log | 审计日志 | 审计与日志域 | 16 | 高危操作与内容审核留痕（不可篡改追加写） |
| 26 | sys_storage_policy | 存储策略 | 系统配置域 | 18 | 对象存储与 CDN 接入策略 |
| 27 | sys_backup_record | 数据备份记录 | 系统配置域 | 16 | 数据库与对象存储备份 |
| 28 | sys_service_health | 服务健康快照 | 系统配置域 | 17 | 监控页各服务健康与水位快照 |
| 29 | sys_export_task | 导入导出任务 | 系统配置域 | 19 | 批量导入导出的异步任务 |
| 30 | sys_campus | 校区 | 租户与组织域 | 15 | 机构校区（组织树的一层） |
| 31 | sys_recycle_bin | 回收站 | 租户与组织域 | 17 | 统一软删除索引，支撑按类型恢复与彻底删除 |
| 32 | dc_textbook_version | 教材版本 | 内容字典域 | 16 | 学段+学科+出版社的版本主数据 |
| 33 | dc_textbook_volume | 教材分册 | 内容字典域 | 17 | 版本下的册次 |
| 34 | dc_textbook_catalog | 教材目录 | 内容字典域 | 14 | 分册目录树（章节，多级） |
| 35 | dc_textbook_catalog_knowledge | 目录知识点关联 | 内容字典域 | 10 | 章节关联知识点（含名称快照） |
| 36 | dc_knowledge_node | 知识点树 | 内容字典域 | 18 | 平台知识点/考点树（最多 5 级） |
| 37 | dc_exam_type_node | 考试类型树 | 内容字典域 | 17 | 考试类型与杯赛合并树（最多 5 级） |
| 38 | q_question | 题目主表 | 题目域 | 44 | 校本题库、个人题库与错题本统一题目模型，按 scope 区分业务归属（与库位 library 不是一个维度） |
| 39 | q_question_sub | 材料组合题子题 | 题目域 | 18 | 组合题的作答单位 |
| 40 | q_question_knowledge | 题目知识点关联 | 题目域 | 11 | 支撑按知识点检索与统计 |
| 41 | q_question_category | 题库分类目录 | 题目域 | 13 | 题库/个人题库的自定义目录树 |
| 42 | q_question_favorite | 题目收藏夹 | 题目域 | 13 | 个人与备课组共享收藏夹 |
| 43 | q_question_favorite_item | 收藏夹条目 | 题目域 | 11 | 收藏夹内的题目 |
| 44 | q_question_correction | 题目纠错记录 | 题目域 | 16 | 组卷工作台/题库提交的问题反馈 |
| 45 | q_question_version | 题目版本 | 题目域 | 14 | 题目修改留痕，支持对比与回滚 |
| 46 | q_question_check | 题目 AI 质检结果 | 题目域 | 15 | 逐题质检项结果与修正建议 |
| 47 | q_basket_item | 试题篮条目 | 题目域 | 12 | 选题到组卷的中间态（会话级/草稿） |
| 48 | p_paper | 试卷主表 | 试卷域 | 42 | 试卷元数据、卷面设置与统计 |
| 49 | p_paper_section | 试卷大题 | 试卷域 | 14 | 大题结构与材料 |
| 50 | p_paper_section_question | 大题题目 | 试卷域 | 13 | 大题内题目顺序、分值与快照 |
| 51 | p_paper_version | 试卷版本 | 试卷域 | 17 | 完整卷面快照，支持撤销与替换 |
| 52 | p_paper_comment | 卷面评论 | 试卷域 | 15 | 卷头/大题/题目三级评论与 AI 检测意见 |
| 53 | p_paper_collab_task | 协同组卷任务 | 试卷域 | 21 | 任务壳：分工要求 + 版本 + 状态 |
| 54 | p_paper_collab_member | 协同组卷成员 | 试卷域 | 16 | 成员分工、权限与验收状态 |
| 55 | p_paper_blueprint | 双向细目表 | 试卷域 | 16 | 知识点 × 难度/能力层级的组卷蓝图 |
| 56 | p_paper_blueprint_cell | 细目表单元格 | 试卷域 | 15 | 单元格题量与分值约束 |
| 57 | p_paper_template | 模板试卷 | 试卷域 | 15 | 空白试卷结构模板（不含题目） |
| 58 | p_ai_compose_template | 智能组卷参数模板 | 试卷域 | 19 | 每次智能组卷成功后自动留档的参数集 |
| 59 | p_paper_ref | 试卷引用关系 | 试卷域 | 12 | 删除保护与引用统计 |
| 60 | t_teach_doc | 备课文档 | 备课域 | 24 | 教案/学案/讲义/课件统一模型 |
| 61 | t_teach_plan | 教案教学设计 | 备课域 | 18 | 教案专属结构化字段 |
| 62 | t_teach_plan_step | 教案教学过程环节 | 备课域 | 16 | 按环节记录教师活动/学生活动/设计意图 |
| 63 | t_teach_doc_block | 文档块 | 备课域 | 16 | 讲义/学案的段落流（含分页与教师备注） |
| 64 | t_teach_doc_slide | 课件页面 | 备课域 | 16 | 课件分页内容与版式 |
| 65 | t_teach_doc_version | 备课文档版本 | 备课域 | 13 | 版本快照与对比 |
| 66 | t_teach_template | 备课模板 | 备课域 | 21 | 教案/学案/讲义模板 |
| 67 | t_prep_task | 集体备课任务 | 备课域 | 22 | 共备一份教案/课件的过程管理 |
| 68 | t_prep_member | 集体备课成员 | 备课域 | 13 | 分工与提交状态 |
| 69 | t_prep_comment | 集体备课研讨记录 | 备课域 | 12 | 针对版本或环节的评论 |
| 70 | t_prep_version | 集体备课版本 | 备课域 | 13 | 成果快照与定稿留痕 |
| 71 | r_file_folder | 我的文件目录 | 资源域 | 13 | 个人与机构文件目录树 |
| 72 | r_file | 我的文件 | 资源域 | 24 | 上传文件与平台产出文件统一登记 |
| 73 | r_material | 教辅资料 | 资源域 | 18 | 机构订购与校本教辅的结构化书籍 |
| 74 | r_material_chapter | 教辅章节 | 资源域 | 11 | 教辅的章节结构 |
| 75 | r_material_example | 教辅条目 | 资源域 | 14 | 章节下的可引用题目/文段 |
| 76 | r_media | 媒体资源 | 资源域 | 22 | 图片/视频/动画与理科绘图工程 |
| 77 | r_video_clip | 微课切片 | 资源域 | 17 | 视频按时间打点切出的教学片段 |
| 78 | r_formula_standard | 标准公式库 | 资源域 | 14 | 平台标准公式（只读，可收藏） |
| 79 | r_formula_org | 机构与个人公式 | 资源域 | 16 | 我的公式与机构共享公式 |
| 80 | r_resource_ref | 资源引用关系 | 资源域 | 13 | 题目/媒体/公式被文档与试卷引用的双向台账 |
| 81 | r_resource_approval | 资源审批单 | 资源域 | 22 | 校本资源上行共享审批 |
| 82 | r_resource_approval_log | 审批流转日志 | 资源域 | 12 | 审批动作留痕 |
| 83 | r_square_resource | 知识广场资源 | 资源域 | 19 | 机构内共享的优质资源 |
| 84 | r_square_interaction | 广场互动 | 资源域 | 10 | 收藏/下载/点赞行为 |
| 85 | r_prompt_org | 机构提示词模板 | AI 域 | 17 | 机构基于平台模板派生的提示词 |
| 86 | e_class | 班级 | 教学执行域 | 17 | 教学班（校区→年级→班级） |
| 87 | e_student | 学生档案 | 教学执行域 | 24 | 学生主数据（敏感字段加密） |
| 88 | e_guardian_binding | 家长绑定关系 | 教学执行域 | 16 | 家长账号与学生绑定 |
| 89 | e_consent_record | 监护人知情同意 | 教学执行域 | 17 | K12 合规红线：信息采集前需确认同意 |
| 90 | e_homework | 作业 | 教学执行域 | 24 | 作业布置与完成进度 |
| 91 | e_homework_question | 作业题目 | 教学执行域 | 11 | 作业包含的题目与分值 |
| 92 | e_homework_submission | 作业提交 | 教学执行域 | 19 | 学生提交与批改结果 |
| 93 | e_exam_session | 考试场次 | 教学执行域 | 18 | 一次考试（试卷下发到班级） |
| 94 | e_exam_answer | 答卷 | 教学执行域 | 16 | 一份学生答卷 |
| 95 | e_exam_answer_item | 答题明细 | 教学执行域 | 21 | 单题作答、AI 分数与人工分数 |
| 96 | e_grading_duty | 阅卷分工 | 教学执行域 | 15 | 按大题分派阅卷人与单双评 |
| 97 | e_grading_record | 评卷记录 | 教学执行域 | 16 | 单次评分留痕（支持双评仲裁） |
| 98 | e_paper_analysis | 试卷分析快照 | 教学执行域 | 24 | 整卷统计结果 |
| 99 | e_question_analysis | 题目分析明细 | 教学执行域 | 19 | 逐题得分率、难度与区分度 |
| 100 | e_mistake | 错题 | 教学执行域 | 19 | 班级/个人错题本条目 |
| 101 | e_mastery | 知识点掌握度 | 教学执行域 | 16 | 学生×知识点掌握度（画像底座） |
| 102 | e_student_profile | 学生学情画像 | 教学执行域 | 13 | 画像汇总与 AI 归因建议 |
| 103 | e_class_profile | 班级学情报告 | 教学执行域 | 14 | 班级维度掌握度与建议 |
| 104 | e_practice_push | 个性化练习推送 | 教学执行域 | 15 | 基于薄弱点的练习下发记录 |
| 105 | ai_model | 模型接入 | AI 域 | 20 | 大模型/多模态/OCR 接入配置 |
| 106 | ai_agent_config | 智能体编排配置 | AI 域 | 16 | 质检/出题等智能体的编排与策略 |
| 107 | ai_agent_check_item | 智能体检查项 | AI 域 | 16 | 编排节点（检查项）配置 |
| 108 | ai_prompt_template | Prompt 模板 | AI 域 | 15 | 平台与机构 Prompt 模板 |
| 109 | ai_prompt_version | Prompt 版本 | AI 域 | 12 | Prompt 版本化与回滚 |
| 110 | ai_call_log | AI 调用日志 | AI 域 | 22 | 每次模型调用的明细（计量与排障） |
| 111 | ai_task | AI 任务 | AI 域 | 23 | 异步 AI 任务中心 |
| 112 | ai_artifact_review | AI 产物复核 | AI 域 | 20 | AI 生成内容的教师复核（合规强制） |
| 113 | ai_quality_eval | AI 质量评测 | AI 域 | 18 | 评测集抽样与多维度得分 |
| 114 | ai_trace | AI 生成留痕 | AI 域 | 18 | 生成内容溯源（模型/Prompt/知识库版本） |
| 115 | ai_billing_rule | AI 计费规则 | AI 域 | 14 | 两级计价：tenant_id=0 为全局默认价，tenant_id>0 为该租户专属覆盖价 |
| 116 | ai_quota_account | AI 额度账户 | AI 域 | 13 | 租户额度账户（充值/赠送/月度） |
| 117 | ai_quota_flow | AI 额度流水 | AI 域 | 15 | 额度变动台账（禁止直接改余额） |
| 118 | ai_tenant_switch | 租户 AI 能力开关 | AI 域 | 13 | 按租户控制各 AI 能力 |
| 119 | ai_sensitive_policy | 内容安全策略 | AI 域 | 13 | 敏感词与内容安全策略分组 |
| 120 | ai_knowledge_doc | AI 知识库文档 | AI 域 | 15 | RAG 知识库文档与切片状态 |
| 121 | c_public_question | 公共题库题目 | 平台内容运营域 | 20 | 平台侧题目内容运营 |
| 122 | c_public_paper | 公共试卷 | 平台内容运营域 | 15 | 平台公共试卷库 |
| 123 | c_content_distribution | 内容分发授权 | 平台内容运营域 | 15 | 按套餐/租户授权公共内容 |
| 124 | c_compliance_check | 内容合规抽检 | 平台内容运营域 | 15 | 抽检任务与命中结果 |
| 125 | c_feedback_ticket | 内容问题反馈工单 | 平台内容运营域 | 19 | 机构教师反馈公共内容问题 |
| 126 | c_review_record | 内容审核记录 | 平台内容运营域 | 18 | 平台内容审核与 AI 预审留痕 |
| 127 | sys_sso_client | 外部系统接入（SSO） | 租户与组织域 | 21 | 登记外部 AI 教研/教务系统的单点登录接入方式与凭据；平台作为统一身份源 |
| 128 | sys_user_ext_map | 外部账号映射 | 租户与组织域 | 17 | 外部系统账号与本平台用户的绑定关系；首次登录自动匹配需人工确认 |
| 129 | sys_org_sync_log | 组织架构同步日志 | 租户与组织域 | 19 | 外部系统组织与员工同步批次记录，含成功/失败条数与失败明细 |
| 130 | r_scan_device | 外接扫描设备 | 资源域 | 22 | 扫描仪/高拍仪注册信息与上次使用参数，用于 OCR 识题与答卷采集 |
| 131 | t_doc_layout_style | 排版样式包 | 备课域 | 16 | 一套可复用的标题/正文/引用样式集合，支撑 Word 级排版与 AI 美化排版 |
| 132 | t_doc_collab_session | 协同编辑会话 | 备课域 | 20 | 同一文档同一时刻只允许一个活动会话，避免版本分叉 |
| 133 | t_doc_collab_member | 协同成员 | 备课域 | 16 | 会话内成员、角色、在线状态与光标颜色 |
| 134 | t_doc_collab_op | 协同操作流水 | 备课域 | 17 | 实时协同的操作日志，用于重放、冲突对比与审计 |
| 135 | e_answer_sheet | 答卷影像 | 教学执行域 | 25 | 一份学生答卷（可多页）的归集与判分/回传状态主记录 |
| 136 | e_answer_sheet_page | 答卷页 | 教学执行域 | 17 | 答卷的每一页影像与切题区域映射 |
| 137 | e_score_recall | 成绩回传 | 教学执行域 | 24 | 按「场次+学生+学科」向教务系统回传成绩的主记录，幂等键保证不重复入账 |
| 138 | e_score_recall_log | 成绩回传日志 | 教学执行域 | 16 | 每次回传请求的完整记录，用于排障与对账 |
| 139 | g_parent_account | 家长账号 | 家长端域 | 21 | 家长端登录账号；全局账号（tenant_id 固定 0），与机构端员工账号互不影响 |
| 140 | g_parent_student | 监护关系 | 家长端域 | 21 | 家长与学生绑定关系，是家长端全部数据权限的唯一依据；按租户隔离 |
| 141 | g_parent_login_log | 家长登录日志 | 家长端域 | 16 | 家长端登录与安全事件记录 |
| 142 | g_share_link | 分享链接 | 家长端域 | 23 | 试卷/学情报告/作业的定向分享；带随机令牌、绑定接收人、有有效期、访问留痕 |
| 143 | g_share_access_log | 分享访问日志 | 家长端域 | 16 | 家长对分享内容的访问、保存、打印记录，用于风控与纠纷核查 |
| 144 | g_notify_setting | 家长通知偏好 | 家长端域 | 13 | 按通知类型控制站内/推送/短信/微信渠道开关 |
| 145 | g_report_push | 学情报告推送 | 家长端域 | 21 | 学情报告的生成物、推送状态与查收状态 |

## 三、核心表关系（逻辑外键）

```
sys_tenant 1─N sys_user / sys_role / sys_campus / sys_tenant_menu / sys_tenant_quota
sys_tenant 1─N sys_tenant_apply（审核通过后 tenant_code 沿用）
sys_tenant 1─N sys_tenant_subscription 1─N sys_tenant_package
sys_role 1─N sys_role_permission；sys_user N─N sys_role（sys_user_role）
dc_textbook_version 1─N dc_textbook_volume 1─N dc_textbook_catalog 1─N dc_textbook_catalog_knowledge
dc_knowledge_node 1─N dc_textbook_catalog_knowledge；q_question N─N dc_knowledge_node（q_question_knowledge）
q_question 1─N q_question_sub（材料组合题子题）；q_question 1─N q_question_check / q_question_version / q_question_correction
p_paper 1─N p_paper_section 1─N p_paper_section_question N─1 q_question（含 question_snapshot 快照）
p_paper 1─N p_paper_version / p_paper_comment；p_paper 1─1 p_paper_collab_task 1─N p_paper_collab_member
p_paper 1─N p_paper_ref（作业/考试/备课引用）；p_paper 1─N e_homework / e_exam_session
t_teach_doc 1─N t_teach_doc_block / t_teach_doc_slide / t_teach_plan_step / t_teach_doc_version
t_prep_task 1─N t_prep_member / t_prep_comment / t_prep_version；t_teach_template 1─N t_teach_doc（来源模板）
r_file 1─N r_file（folder_id 自关联）；r_file 1─0..1 p_paper（paper_id）/ t_teach_doc（teach_doc_id）
r_material 1─N r_material_chapter 1─N r_material_example；r_media 1─N r_video_clip
r_resource_ref 记录「资源 → 引用方」的双向台账（题目/媒体/公式 → 试卷/文档/作业）
e_class 1─N e_student 1─N e_mastery / e_student_profile / e_mistake / e_practice_push
e_student 1─N e_consent_record / e_guardian_binding
e_homework 1─N e_homework_question / e_homework_submission 1─N e_mistake
e_exam_session 1─N e_exam_answer 1─N e_exam_answer_item / e_grading_record；e_exam_session 1─1 e_paper_analysis 1─N e_question_analysis
ai_model 1─N ai_agent_check_item；ai_prompt_template 1─N ai_prompt_version；ai_task 1─N ai_call_log（trace_id 关联）
ai_quota_account 1─N ai_quota_flow；ai_artifact_review / ai_trace 按 artifact_id + artifact_kind 关联业务产物
c_public_question / c_public_paper 1─N c_content_distribution / c_feedback_ticket / c_review_record
```

## 四、分域表结构明细

### 4.1 租户与组织域（24 张）

#### sys_tenant　租户主表

机构（租户）主数据，多租户隔离的根。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| tenant_code | VARCHAR(64) | 否 | 租户编码，全局唯一（入驻申请编号沿用） |
| tenant_name | VARCHAR(128) | 否 | 机构名称 |
| short_name | VARCHAR(64) | 是 | 机构简称 |
| logo_url | VARCHAR(512) | 是 | 机构 LOGO 地址 |
| logo_hue | INT | 是 | LOGO 占位色相（无图时生成字母头像） |
| tenant_type | VARCHAR(32) | 否 | 机构类型：学校/教育集团/培训机构 |
| stage_scope | JSON | 是 | 办学学段范围（小学/初中/高中） |
| status | TINYINT | 否 | 状态：1 试用 2 正式 3 已到期 4 已禁用 |
| package_id | BIGINT | 否 | 当前套餐 ID |
| expire_time | DATETIME | 否 | 服务到期时间 |
| trial_end_time | DATETIME | 是 | 试用结束时间 |
| contact_name | VARCHAR(64) | 否 | 联系人姓名 |
| contact_phone | VARCHAR(128) | 否 | 联系人手机（加密存储） |
| contact_email | VARCHAR(128) | 是 | 联系邮箱 |
| province | VARCHAR(32) | 是 | 省 |
| city | VARCHAR(64) | 是 | 市（含区县，展示用） |
| address | VARCHAR(255) | 是 | 详细地址 |
| intro | VARCHAR(1024) | 是 | 机构简介 |
| isolation_type | TINYINT | 否 | 数据隔离：1 共享库（tenant_id 隔离）2 独立库 |
| storage_region | VARCHAR(64) | 是 | 数据存储区域 |
| ai_used | BIGINT | 否 | 本月 AI 调用次数（快照） |
| storage_used_gb | DECIMAL(12,2) | 否 | 已用存储（GB，快照） |
| disable_reason | VARCHAR(255) | 是 | 禁用/冻结原因 |
| open_time | DATETIME | 是 | 正式开通时间 |

索引：

- `UNIQUE KEY uk_tenant_code (tenant_code)`
- `KEY idx_status (status, expire_time)`
- `KEY idx_package (package_id)`


#### sys_tenant_apply　机构入驻申请

机构入驻申请单与审核留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| apply_no | VARCHAR(64) | 否 | 申请单号 |
| tenant_code | VARCHAR(64) | 否 | 预生成机构编号（通过后沿用为租户编码） |
| org_name | VARCHAR(128) | 否 | 机构名称 |
| org_type | VARCHAR(32) | 否 | 机构类型 |
| stage_scope | JSON | 是 | 办学学段 |
| contact_name | VARCHAR(64) | 否 | 联系人 |
| contact_phone | VARCHAR(128) | 否 | 联系电话（加密） |
| contact_email | VARCHAR(128) | 是 | 联系邮箱 |
| province | VARCHAR(32) | 是 | 省 |
| city | VARCHAR(64) | 是 | 市 |
| address | VARCHAR(255) | 是 | 详细地址 |
| intro | VARCHAR(1024) | 是 | 机构简介 |
| apply_status | TINYINT | 否 | 0 待审核 1 已通过 2 已驳回 |
| submitted_at | DATETIME | 否 | 提交时间 |
| reviewer_id | BIGINT | 是 | 审核人 ID |
| reviewer_name | VARCHAR(64) | 是 | 审核人姓名 |
| reviewed_at | DATETIME | 是 | 审核时间 |
| reject_reason | VARCHAR(512) | 是 | 驳回原因 |
| tenant_id_created | BIGINT | 是 | 审核通过后生成的租户 ID |

索引：

- `UNIQUE KEY uk_apply_no (apply_no)`
- `KEY idx_status_time (apply_status, submitted_at)`


#### sys_tenant_cert　租户资质材料

营业执照/许可证/法人信息等资质附件。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| apply_id | BIGINT | 是 | 所属申请单 ID |
| tenant_id_ref | BIGINT | 是 | 所属租户 ID（入驻通过后回填） |
| cert_category | VARCHAR(16) | 否 | 分类：license 营业执照/permit 许可证/legal 法人信息 |
| file_name | VARCHAR(255) | 否 | 文件名称 |
| file_type | VARCHAR(16) | 否 | pdf / img |
| file_url | VARCHAR(512) | 否 | 文件访问地址（签名 URL 由服务端生成） |
| file_size_kb | BIGINT | 是 | 文件大小（KB） |
| verify_status | TINYINT | 否 | 0 待核验 1 已核验 2 存疑 |
| verify_note | VARCHAR(512) | 是 | 核验意见 |

索引：

- `KEY idx_apply (apply_id)`
- `KEY idx_tenant_ref (tenant_id_ref)`


#### sys_tenant_package　套餐定义

套餐价格与配额上限。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| package_code | VARCHAR(32) | 否 | 套餐编码 |
| package_name | VARCHAR(64) | 否 | 套餐名称 |
| monthly_price | DECIMAL(12,2) | 否 | 月费（元） |
| year_price | DECIMAL(12,2) | 是 | 年费（元） |
| max_staff | INT | 否 | 员工账号数上限 |
| max_student | INT | 是 | 学生账号数上限 |
| max_concurrent | INT | 否 | 并发上限 |
| ai_quota | BIGINT | 否 | 月 AI 调用额度 |
| storage_gb | INT | 否 | 存储上限（GB） |
| sms_enabled | TINYINT | 否 | 是否含短信 |
| status | TINYINT | 否 | 0 下架 1 上架 2 内部测试 |
| sort_no | INT | 否 | 排序 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `UNIQUE KEY uk_package_code (package_code)`


#### sys_tenant_package_feature　套餐功能权益

套餐包含的功能开关（与租户级开关叠加）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| package_id | BIGINT | 否 | 套餐 ID |
| feature_key | VARCHAR(64) | 否 | 功能键：aiGenerate/aiVariant/aiPhoto/docImport/collab/customPrompt 等 |
| feature_name | VARCHAR(64) | 否 | 功能名称 |
| enabled | TINYINT | 否 | 是否包含 |

索引：

- `UNIQUE KEY uk_pkg_feature (package_id, feature_key)`


#### sys_tenant_quota　租户配额

租户级配额，覆盖套餐默认值。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| quota_key | VARCHAR(64) | 否 | 配额项：staff/student/storage/ai/monthConcurrent |
| quota_value | BIGINT | 否 | 配额值 |
| used_value | BIGINT | 否 | 已用值（快照，用于预警） |
| quota_source | VARCHAR(16) | 否 | 来源：package 套餐默认 / tenant 单独配置 / gift 赠送 |
| warn_threshold | INT | 是 | 预警阈值（百分比，默认 80） |

索引：

- `UNIQUE KEY uk_tenant_quota (tenant_id, quota_key)`


#### sys_tenant_subscription　租户订阅记录

开通/续费/升降级流水，权益按订阅区间生效。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| tenant_id | BIGINT | 否 | 租户 ID |
| package_id | BIGINT | 否 | 套餐 ID |
| start_time | DATETIME | 否 | 生效开始 |
| end_time | DATETIME | 否 | 生效结束 |
| sub_status | VARCHAR(16) | 否 | active 生效中/expired 已过期/grace 宽限期/canceled 已取消 |
| change_type | VARCHAR(16) | 否 | open 开通/renew 续费/upgrade 升级/downgrade 降级/trial 试用/compensate 补偿 |
| amount | DECIMAL(12,2) | 是 | 成交金额（元，含赠送折算 0） |
| order_no | VARCHAR(64) | 是 | 关联订单号 |
| operator_id | BIGINT | 是 | 操作人 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `KEY idx_tenant_status (tenant_id, sub_status)`
- `KEY idx_end_time (end_time)`


#### sys_tenant_config　租户业务配置

机构设置页维护的业务参数。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| tenant_id | BIGINT | 否 | 租户 ID |
| org_name | VARCHAR(128) | 否 | 机构名称（展示名） |
| short_name | VARCHAR(64) | 是 | 简称 |
| contact_name | VARCHAR(64) | 是 | 联系人 |
| contact_phone | VARCHAR(128) | 是 | 联系电话（加密） |
| address | VARCHAR(255) | 是 | 地址 |
| intro | VARCHAR(1024) | 是 | 简介 |
| subjects | JSON | 是 | 开设学科 |
| grades | JSON | 是 | 开设年级 |
| preferred_textbooks | JSON | 是 | 教材版本偏好 |
| export_header | VARCHAR(255) | 是 | 导出抬头 |
| export_template | VARCHAR(64) | 是 | 默认导出模板 |
| data_retention_month | INT | 是 | 数据留存月数 |
| config_json | JSON | 是 | 其他扩展配置 |

索引：

- `UNIQUE KEY uk_tenant_cfg (tenant_id)`


#### sys_review_flow　审核流程配置

题目/试卷/资源审核流程与审核人。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| flow_key | VARCHAR(32) | 否 | 流程键：question/paper/resource |
| flow_label | VARCHAR(64) | 否 | 流程名称 |
| enabled | TINYINT | 否 | 是否启用审核 |
| levels | TINYINT | 否 | 审核级数 1 或 2 |
| level1_reviewers | JSON | 是 | 一级审核人 ID 列表 |
| level2_reviewers | JSON | 是 | 二级审核人 ID 列表 |
| ai_precheck | TINYINT | 否 | 是否启用 AI 预审 |
| subject_scope | JSON | 是 | 适用学科（空为全部） |

索引：

- `UNIQUE KEY uk_flow (tenant_id, flow_key)`


#### sys_user　用户账号

平台管理员、机构员工、学生、家长统一账号表。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| user_type | TINYINT | 否 | 0 平台管理员 1 机构员工 2 学生 3 家长 |
| account | VARCHAR(64) | 否 | 登录账号 |
| password_hash | VARCHAR(128) | 是 | 密码哈希（学生/家长可免密登录时为空） |
| salt | VARCHAR(32) | 是 | 密码盐 |
| real_name | VARCHAR(64) | 否 | 姓名 |
| nick_name | VARCHAR(64) | 是 | 昵称 |
| avatar | VARCHAR(512) | 是 | 头像地址 |
| avatar_hue | INT | 是 | 头像色相 |
| phone | VARCHAR(128) | 是 | 手机号（加密） |
| email | VARCHAR(128) | 是 | 邮箱 |
| intro | VARCHAR(512) | 是 | 个人简介 |
| campus_id | BIGINT | 是 | 所属校区 |
| default_subject | VARCHAR(32) | 是 | 默认学科 |
| status | TINYINT | 否 | 0 停用 1 启用 2 锁定 |
| mfa_enabled | TINYINT | 否 | 是否绑定 MFA |
| last_login_at | DATETIME | 是 | 最后登录时间 |
| last_login_ip | VARCHAR(64) | 是 | 最后登录 IP |
| pwd_update_time | DATETIME | 是 | 密码最后修改时间 |

索引：

- `UNIQUE KEY uk_tenant_account (tenant_id, account)`
- `KEY idx_phone (phone)`
- `KEY idx_type_status (user_type, status)`


#### sys_role　角色

平台端与机构端角色。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| role_code | VARCHAR(64) | 否 | 角色编码，租户内唯一 |
| role_name | VARCHAR(64) | 否 | 角色名称 |
| role_desc | VARCHAR(255) | 是 | 角色说明 |
| builtin | TINYINT | 否 | 是否内置（内置不可删除） |
| locked | TINYINT | 否 | 是否锁定（机构管理员角色锁定） |
| data_scope | TINYINT | 否 | 数据范围：1 全部 2 本校区 3 本部门 4 本人 |
| enabled | TINYINT | 否 | 是否启用 |
| sort_no | INT | 否 | 排序 |

索引：

- `UNIQUE KEY uk_role_code (tenant_id, role_code)`


#### sys_user_role　用户角色关联

用户与角色多对多。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| user_id | BIGINT | 否 | 用户 ID |
| role_id | BIGINT | 否 | 角色 ID |

索引：

- `UNIQUE KEY uk_user_role (user_id, role_id)`


#### sys_role_permission　角色权限

角色在各权限模块上的操作位。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| role_id | BIGINT | 否 | 角色 ID |
| module_key | VARCHAR(64) | 否 | 权限模块键（question/paper/teach…） |
| op_key | VARCHAR(32) | 否 | 操作位：查看/新增/编辑/删除/审核/导出/配置… |

索引：

- `UNIQUE KEY uk_role_module_op (role_id, module_key, op_key)`


#### sys_menu　菜单

平台端与机构端菜单树（菜单管理的唯一事实源）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| menu_scope | TINYINT | 否 | 0 平台端 1 机构端 |
| parent_id | BIGINT | 是 | 父节点 ID（空为顶级） |
| menu_title | VARCHAR(64) | 否 | 菜单名称 |
| menu_path | VARCHAR(255) | 否 | 路由路径（叶子唯一） |
| menu_icon | VARCHAR(64) | 是 | 图标名 |
| menu_type | TINYINT | 否 | 0 分组 1 页面 2 按钮 |
| module_key | VARCHAR(64) | 是 | 所属权限模块 |
| op_key | VARCHAR(32) | 是 | 叶子额外要求的操作权限 |
| edition | VARCHAR(32) | 是 | 所属版本（标准版/专业版） |
| sort_no | INT | 否 | 同级排序 |
| visible | TINYINT | 否 | 是否显示 |
| builtin | TINYINT | 否 | 是否内置 |

索引：

- `KEY idx_scope_parent (menu_scope, parent_id)`
- `UNIQUE KEY uk_scope_path (menu_scope, menu_path)`


#### sys_tenant_menu　机构菜单开关

平台控制机构端菜单可见性。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| tenant_id | BIGINT | 否 | 租户 ID |
| menu_id | BIGINT | 否 | 菜单 ID |
| menu_key | VARCHAR(128) | 否 | 菜单路径键（与前端菜单 key 一致） |
| enabled | TINYINT | 否 | 是否开放 |
| sort_no | INT | 是 | 排序覆盖 |

索引：

- `UNIQUE KEY uk_tenant_menu (tenant_id, menu_key)`


#### sys_param　系统参数

系统级参数配置。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| param_key | VARCHAR(128) | 否 | 参数键 |
| param_name | VARCHAR(128) | 否 | 参数名称 |
| param_value | VARCHAR(2048) | 是 | 参数值 |
| param_group | VARCHAR(64) | 否 | 参数分组 |
| value_type | VARCHAR(16) | 否 | string/number/boolean/json |
| editable | TINYINT | 否 | 是否允许在线修改 |
| hot_effect | TINYINT | 否 | 是否热生效 |
| remark | VARCHAR(255) | 是 | 说明 |

索引：

- `UNIQUE KEY uk_param_key (param_key)`


#### sys_message_template　消息模板

站内信/短信/邮件/推送模板。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| tpl_code | VARCHAR(64) | 否 | 模板编码 |
| tpl_name | VARCHAR(128) | 否 | 模板名称 |
| scene | VARCHAR(64) | 否 | 业务场景 |
| channels | JSON | 否 | 渠道：inApp/sms/email/push |
| content | TEXT | 否 | 模板正文（支持 ${变量}） |
| variables | JSON | 是 | 变量定义 |
| enabled | TINYINT | 否 | 是否启用 |

索引：

- `UNIQUE KEY uk_tpl_code (tpl_code)`


#### sys_notify_rule　通知规则

通知配置页的触发规则矩阵。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| biz_key | VARCHAR(64) | 否 | 业务键：homeworkRemind/auditRemind/warningNotify… |
| biz_label | VARCHAR(64) | 否 | 业务名称 |
| in_app | TINYINT | 否 | 站内信 |
| sms | TINYINT | 否 | 短信 |
| email | TINYINT | 否 | 邮件 |
| receivers | JSON | 是 | 接收角色/接收人 |
| enabled | TINYINT | 否 | 是否启用 |

索引：

- `UNIQUE KEY uk_biz_key (tenant_id, biz_key)`


#### sys_notification　消息通知

站内消息与待办聚合。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| receiver_id | BIGINT | 否 | 接收人 ID |
| msg_type | VARCHAR(16) | 否 | apply 入驻/quota 配额/system 系统/todo 待办/review 审核/collab 协作 |
| msg_tab | VARCHAR(16) | 是 | 前端分页签：todo/review/collab/system |
| title | VARCHAR(255) | 否 | 标题 |
| content | VARCHAR(2048) | 是 | 摘要内容 |
| biz_module | VARCHAR(64) | 是 | 业务模块 |
| biz_id | BIGINT | 是 | 业务 ID |
| link | VARCHAR(512) | 是 | 跳转路径 |
| read_flag | TINYINT | 否 | 是否已读 |
| read_at | DATETIME | 是 | 阅读时间 |
| sender_id | BIGINT | 是 | 发送人（系统为空） |

索引：

- `KEY idx_receiver (receiver_id, read_flag)`
- `KEY idx_type_time (msg_type, create_time)`


#### sys_campus　校区

机构校区（组织树的一层）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| campus_name | VARCHAR(64) | 否 | 校区名称 |
| campus_code | VARCHAR(32) | 否 | 校区编码 |
| address | VARCHAR(255) | 是 | 地址 |
| manager_id | BIGINT | 是 | 负责人 ID |
| manager_name | VARCHAR(64) | 是 | 负责人姓名 |
| staff_count | INT | 否 | 员工数（快照） |
| enabled | TINYINT | 否 | 是否启用 |
| sort_no | INT | 否 | 排序 |

索引：

- `UNIQUE KEY uk_campus_code (tenant_id, campus_code)`


#### sys_recycle_bin　回收站

统一软删除索引，支撑按类型恢复与彻底删除。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| biz_kind | VARCHAR(32) | 否 | 类型：题目/试卷/教辅/文件/讲义/课件/教案/学案/协同组卷任务/集体备课/作业 |
| biz_id | BIGINT | 否 | 业务对象 ID |
| biz_name | VARCHAR(255) | 否 | 对象名称 |
| owner_id | BIGINT | 是 | 归属人 |
| owner_name | VARCHAR(64) | 是 | 归属人姓名 |
| deleted_by | BIGINT | 是 | 删除人 |
| deleted_by_name | VARCHAR(64) | 是 | 删除人姓名 |
| deleted_at | DATETIME | 否 | 删除时间 |
| expire_at | DATETIME | 是 | 自动清理时间 |
| restored_flag | TINYINT | 否 | 是否已恢复 |

索引：

- `KEY idx_kind_owner (biz_kind, owner_id)`
- `KEY idx_expire (expire_at)`


#### sys_sso_client　外部系统接入（SSO）

登记外部 AI 教研/教务系统的单点登录接入方式与凭据；平台作为统一身份源。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| name | VARCHAR(64) | 否 | 系统编码（全局唯一，大写） |
| cn_name | VARCHAR(100) | 否 | 系统名称 |
| sys_type | VARCHAR(16) | 否 | 类型：research 教研 / academic 教务 / third 第三方 |
| sso_type | VARCHAR(16) | 否 | 接入方式：oauth2 / cas / saml / custom |
| auth_url | VARCHAR(500) | 是 | 授权地址 |
| token_url | VARCHAR(500) | 是 | 换取令牌地址 |
| userinfo_url | VARCHAR(500) | 是 | 获取用户信息地址 |
| redirect_uri | VARCHAR(500) | 否 | 回调地址（白名单校验） |
| app_key | VARCHAR(64) | 是 | 应用标识 |
| app_secret_cipher | VARCHAR(255) | 是 | 应用密钥（加密存储，展示仅末 4 位） |
| secret_update_time | DATETIME | 是 | 密钥最近轮换时间 |
| ticket_ttl | INT | 否 | 一次性票据有效期（秒），默认 60 |
| enabled | TINYINT | 否 | 是否启用：1 启用 / 0 停用 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `UNIQUE KEY uk_name (name)`
- `KEY idx_type (sys_type, enabled)`


#### sys_user_ext_map　外部账号映射

外部系统账号与本平台用户的绑定关系；首次登录自动匹配需人工确认。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| client_id | BIGINT | 否 | 所属外部系统ID（sys_sso_client.id） |
| ext_user_id | VARCHAR(128) | 否 | 外部系统用户唯一标识 |
| ext_user_name | VARCHAR(100) | 是 | 外部系统用户显示名 |
| ext_dept_id | VARCHAR(128) | 是 | 外部系统部门ID |
| user_id | BIGINT | 是 | 本平台用户ID（未确认时为空） |
| match_status | VARCHAR(16) | 否 | 匹配状态：auto 自动 / manual 人工绑定 / pending 待确认 / conflict 冲突 |
| match_type | VARCHAR(16) | 是 | 匹配依据：phone 手机号 / name 姓名 / manual 人工 |
| bind_time | DATETIME | 是 | 绑定时间 |
| bind_by | BIGINT | 是 | 绑定操作人 |
| remark | VARCHAR(255) | 是 | 备注（冲突说明等） |

索引：

- `UNIQUE KEY uk_client_ext (client_id, ext_user_id)`
- `KEY idx_user (tenant_id, user_id)`
- `KEY idx_status (match_status)`


#### sys_org_sync_log　组织架构同步日志

外部系统组织与员工同步批次记录，含成功/失败条数与失败明细。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| client_id | BIGINT | 否 | 所属外部系统ID |
| batch_no | VARCHAR(64) | 否 | 批次号 |
| sync_type | VARCHAR(16) | 否 | 同步类型：full 全量 / incr 增量 |
| sync_direction | VARCHAR(16) | 否 | 方向：inbound 外部→本平台 / outbound 本平台→外部 |
| start_time | DATETIME | 否 | 开始时间 |
| end_time | DATETIME | 是 | 结束时间 |
| total_count | INT | 否 | 处理总数 |
| success_count | INT | 否 | 成功数 |
| fail_count | INT | 否 | 失败数 |
| status | VARCHAR(16) | 否 | 状态：running / success / partial 部分失败 / failed |
| fail_detail | TEXT | 是 | 失败明细（脱敏后） |
| operator | VARCHAR(64) | 是 | 触发人（定时任务为 system） |

索引：

- `KEY idx_client_time (client_id, start_time)`
- `KEY idx_status (status)`


### 4.2 内容字典域（8 张）

#### sys_dict_type　字典类型

字典分组定义。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| dict_type | VARCHAR(64) | 否 | 类型键：subject/grade/term/questionType/difficulty/examType/competition/region/copyright |
| dict_name | VARCHAR(64) | 否 | 类型名称 |
| dict_group | VARCHAR(16) | 否 | 分组：base 基础字典 / system 系统数据字典 |
| editable | TINYINT | 否 | 是否允许机构维护 |
| remark | VARCHAR(255) | 是 | 说明 |

索引：

- `UNIQUE KEY uk_dict_type (dict_type)`


#### sys_dict_item　字典项

字典项明细，承载各类型特有属性。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| dict_type | VARCHAR(64) | 否 | 字典类型键 |
| item_name | VARCHAR(128) | 否 | 名称 |
| item_code | VARCHAR(64) | 是 | 编码（学科/年级/题型/地区必填） |
| parent_id | BIGINT | 是 | 父级项（无层级时为空） |
| sort_no | INT | 否 | 排序 |
| enabled | TINYINT | 否 | 是否启用 |
| ref_count | INT | 否 | 被引用数（大于 0 时仅可停用不可删除） |
| stage | VARCHAR(32) | 是 | 学段（年级挂靠学段等单值场景） |
| school_year | VARCHAR(32) | 是 | 学年（学期类字典） |
| term_half | VARCHAR(16) | 是 | 上/下学期 |
| date_from | DATE | 是 | 学期开始日期 |
| date_to | DATE | 是 | 学期结束日期 |
| answer_type | VARCHAR(32) | 是 | 作答类型（题型字典） |
| coefficient | DECIMAL(5,2) | 是 | 难度系数（难度字典） |
| question_category | VARCHAR(16) | 是 | 题目类别：独立单题/材料组合题 |
| stages | JSON | 是 | 适配学段（多选） |
| subjects | JSON | 是 | 适用学科 |
| grades | JSON | 是 | 适配年级 |
| paper_category | VARCHAR(64) | 是 | 试卷分类（考试类型投影） |
| ext_json | JSON | 是 | 扩展属性 |

索引：

- `KEY idx_type_sort (dict_type, sort_no)`
- `UNIQUE KEY uk_type_code (dict_type, item_code)`


#### dc_textbook_version　教材版本

学段+学科+出版社的版本主数据。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| stage | VARCHAR(32) | 否 | 学段 |
| subject | VARCHAR(32) | 否 | 学科 |
| version_name | VARCHAR(64) | 否 | 版本名称（如人教版） |
| publisher | VARCHAR(64) | 否 | 出版社 |
| hue | INT | 是 | 封面色相 |
| region | JSON | 是 | 适用地区（多选） |
| years | JSON | 是 | 修订年份（多选） |
| enabled | TINYINT | 否 | 是否启用 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_stage_subject (stage, subject)`


#### dc_textbook_volume　教材分册

版本下的册次。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| textbook_id | BIGINT | 否 | 教材版本 ID |
| volume_alias | VARCHAR(64) | 否 | 册别名（必修第一册/上册） |
| grade | VARCHAR(32) | 否 | 年级 |
| term | VARCHAR(16) | 否 | 学期：上学期/下学期 |
| school_year | VARCHAR(32) | 是 | 适配学年 |
| cover_url | VARCHAR(512) | 是 | 封面图 |
| file_url | VARCHAR(512) | 是 | 教材电子版地址 |
| file_name | VARCHAR(255) | 是 | 电子版文件名 |
| enabled | TINYINT | 否 | 是否启用 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_textbook (textbook_id)`


#### dc_textbook_catalog　教材目录

分册目录树（章节，多级）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| volume_id | BIGINT | 否 | 分册 ID |
| parent_id | BIGINT | 是 | 父章节 |
| chapter_title | VARCHAR(255) | 否 | 章节标题 |
| chapter_level | TINYINT | 否 | 层级 1-5 |
| chapter_path | VARCHAR(512) | 是 | 路径（/根/章/节） |
| enabled | TINYINT | 否 | 是否启用 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_volume_parent (volume_id, parent_id)`


#### dc_textbook_catalog_knowledge　目录知识点关联

章节关联知识点（含名称快照）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| catalog_id | BIGINT | 否 | 章节 ID |
| knowledge_id | BIGINT | 否 | 知识点 ID |
| knowledge_name | VARCHAR(255) | 否 | 知识点名称快照 |

索引：

- `UNIQUE KEY uk_catalog_kp (catalog_id, knowledge_id)`


#### dc_knowledge_node　知识点树

平台知识点/考点树（最多 5 级）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 是 | 父节点 |
| node_name | VARCHAR(255) | 否 | 知识点名称 |
| node_code | VARCHAR(64) | 否 | 知识点编码（平台唯一） |
| stage | VARCHAR(32) | 否 | 学段 |
| subject | VARCHAR(32) | 否 | 学科 |
| node_level | TINYINT | 否 | 层级 1-5 |
| node_path | VARCHAR(512) | 是 | 路径 |
| sort_no | INT | 否 | 同级排序 |
| enabled | TINYINT | 否 | 是否启用 |
| ref_count | INT | 否 | 被引用数 |
| is_leaf | TINYINT | 否 | 是否叶子（叶子标签与题目 knowledge 匹配） |

索引：

- `UNIQUE KEY uk_node_code (node_code)`
- `KEY idx_parent (parent_id)`
- `KEY idx_subject (stage, subject)`


#### dc_exam_type_node　考试类型树

考试类型与杯赛合并树（最多 5 级）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 是 | 父节点（空为一级分组） |
| node_name | VARCHAR(128) | 否 | 节点名称 |
| node_code | VARCHAR(64) | 否 | 节点编码（平台唯一） |
| node_kind | VARCHAR(16) | 否 | examType 考试类型 / competition 杯赛 |
| stages | JSON | 是 | 适配学段 |
| subjects | JSON | 是 | 适配学科 |
| node_path | VARCHAR(512) | 是 | 路径 |
| sort_no | INT | 否 | 排序 |
| enabled | TINYINT | 否 | 是否启用 |
| ref_count | INT | 否 | 被题目引用数 |

索引：

- `UNIQUE KEY uk_exam_code (node_code)`
- `KEY idx_parent (parent_id)`


### 4.3 题目域（10 张）

#### q_question　题目主表

校本题库、个人题库与错题本统一题目模型，按 scope 区分业务归属（与库位 library 不是一个维度）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| library | VARCHAR(16) | 否 | 库位：personal 个人 / org 校本 / wrong 错题（存在哪） |
| scope | VARCHAR(16) | 否 | 所属对象（业务归属，决定可见性）：platform 平台 / school 校本 / personal 个人；存量按 library 兜底推导 |
| category_id | BIGINT | 是 | 题库分类目录 ID |
| question_category | VARCHAR(16) | 否 | 题目类别：独立单题 / 材料组合题（组合题 stem 存共用材料） |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| question_type | VARCHAR(32) | 否 | 题型（字典 questionType） |
| difficulty | VARCHAR(16) | 否 | 难度（字典 difficulty） |
| textbook_version | VARCHAR(64) | 是 | 教材版本 |
| term | VARCHAR(16) | 是 | 学期 |
| exam_type | VARCHAR(64) | 是 | 考试类型（字典 examType） |
| competition | VARCHAR(64) | 是 | 杯赛名称（字典 competition） |
| region | VARCHAR(64) | 是 | 来源地区（字典 region） |
| source | VARCHAR(32) | 否 | 来源：手动录入/AI 出题/AI 变式/拍照识别/文档导入/教辅导入/名校考试 |
| source_remark | VARCHAR(255) | 是 | 来源备注 |
| stem | LONGTEXT | 否 | 题干（富文本，可含公式与图片） |
| options_json | JSON | 是 | 选项数组（选择题/多选题） |
| option_columns | TINYINT | 是 | 选项排布：1/2/4 列 |
| answer | LONGTEXT | 是 | 答案（选择题字母串、判断对错、填空以｜相连、解答富文本） |
| fill_answers_json | JSON | 是 | 填空题各空答案与等价写法 |
| analysis | LONGTEXT | 是 | 解析（富文本） |
| knowledge_json | JSON | 是 | 知识点名称数组（冗余，供列表渲染） |
| owner_id | BIGINT | 否 | 归属人 ID |
| owner_name | VARCHAR(64) | 否 | 归属人姓名 |
| status | VARCHAR(16) | 否 | draft 草稿/checking 机审中/pending 待审核/approved 已通过/rejected 已驳回/offline 已下架；个人题免审，保存即 approved |
| variant_of | BIGINT | 是 | 母题 ID（变式题回溯） |
| use_count | INT | 否 | 被组卷/引用次数 |
| ai_flag | TINYINT | 否 | 是否 AI 生成（合规标识） |
| ai_model_key | VARCHAR(64) | 是 | 生成所用模型 |
| ai_checks_json | JSON | 是 | AI 质检项结果 |
| ai_suspects_json | JSON | 是 | AI 疑点列表 |
| review_opinion | VARCHAR(1024) | 是 | 审核意见 |
| reviewer_id | BIGINT | 是 | 终审人 ID |
| reviewer_name | VARCHAR(64) | 是 | 终审人姓名 |
| reviewed_at | DATETIME | 是 | 终审时间 |
| published_at | DATETIME | 是 | 入库（通过）时间 |
| temp_flag | TINYINT | 否 | 是否临时题（AI 草稿直接进试题篮，不占配额不参与检索） |

索引：

- `KEY idx_lib_status (library, status)`
- `KEY idx_scope_status (scope, status)`
- `KEY idx_scope_owner (scope, owner_id)`
- `KEY idx_subject_grade (subject, grade)`
- `KEY idx_owner (owner_id)`
- `KEY idx_type_diff (question_type, difficulty)`
- `KEY idx_updated (update_time)`


#### q_question_sub　材料组合题子题

组合题的作答单位。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 母题 ID |
| sort_no | INT | 否 | 子题序号（卷面 (1)(2)(3) 按顺序现算） |
| question_type | VARCHAR(32) | 否 | 子题题型（仅独立单题类题型） |
| difficulty | VARCHAR(16) | 否 | 难度 |
| stem | LONGTEXT | 否 | 子题题干 |
| options_json | JSON | 是 | 选项 |
| option_columns | TINYINT | 是 | 选项排布 |
| answer | LONGTEXT | 是 | 答案 |
| fill_answers_json | JSON | 是 | 填空答案 |
| analysis | LONGTEXT | 是 | 解析 |
| knowledge_json | JSON | 是 | 子题知识点 |

索引：

- `KEY idx_question (question_id, sort_no)`


#### q_question_knowledge　题目知识点关联

支撑按知识点检索与统计。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 题目 ID |
| knowledge_id | BIGINT | 是 | 知识点 ID（历史数据可为空，靠名称匹配） |
| knowledge_name | VARCHAR(255) | 否 | 知识点名称（与知识点树叶子 tag 一致） |
| subject | VARCHAR(32) | 否 | 学科（冗余便于聚合） |

索引：

- `UNIQUE KEY uk_q_kp (question_id, knowledge_name)`
- `KEY idx_kp (knowledge_name)`


#### q_question_category　题库分类目录

题库/个人题库的自定义目录树。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 是 | 父目录 |
| category_name | VARCHAR(128) | 否 | 目录名称 |
| library | VARCHAR(16) | 否 | 所属题库：personal/org/wrong |
| owner_id | BIGINT | 是 | 归属人（个人目录） |
| category_path | VARCHAR(512) | 是 | 路径 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_lib_parent (library, parent_id)`


#### q_question_favorite　题目收藏夹

个人与备课组共享收藏夹。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| folder_name | VARCHAR(64) | 否 | 收藏夹名称 |
| scope | VARCHAR(16) | 否 | personal 个人 / group 备课组 |
| owner_id | BIGINT | 否 | 创建人 |
| group_id | BIGINT | 是 | 备课组 ID（组级收藏夹） |
| remark | VARCHAR(255) | 是 | 备注 |
| item_count | INT | 否 | 收藏题数（快照） |

索引：

- `KEY idx_owner (owner_id)`


#### q_question_favorite_item　收藏夹条目

收藏夹内的题目。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| favorite_id | BIGINT | 否 | 收藏夹 ID |
| question_id | BIGINT | 否 | 题目 ID |
| remark | VARCHAR(255) | 是 | 收藏备注 |
| sort_no | INT | 否 | 排序 |

索引：

- `UNIQUE KEY uk_fav_q (favorite_id, question_id)`


#### q_question_correction　题目纠错记录

组卷工作台/题库提交的问题反馈。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 题目 ID |
| correction_types | JSON | 否 | 问题类型（题干错误/答案错误/解析错误…） |
| description | LONGTEXT | 是 | 问题描述（富文本） |
| reporter_id | BIGINT | 否 | 反馈人 |
| reporter_name | VARCHAR(64) | 否 | 反馈人姓名 |
| handle_status | TINYINT | 否 | 0 待处理 1 处理中 2 已修正 3 已驳回 |
| handler_id | BIGINT | 是 | 处理人 |
| handle_opinion | VARCHAR(1024) | 是 | 处理意见 |
| handled_at | DATETIME | 是 | 处理时间 |

索引：

- `KEY idx_question (question_id)`
- `KEY idx_status (handle_status)`


#### q_question_version　题目版本

题目修改留痕，支持对比与回滚。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 题目 ID |
| version_no | INT | 否 | 版本号 |
| change_summary | VARCHAR(255) | 是 | 变更摘要 |
| before_json | JSON | 是 | 变更前快照 |
| after_json | JSON | 是 | 变更后快照 |
| operator_id | BIGINT | 是 | 操作人 |
| operator_name | VARCHAR(64) | 是 | 操作人姓名 |

索引：

- `UNIQUE KEY uk_q_version (question_id, version_no)`


#### q_question_check　题目 AI 质检结果

逐题质检项结果与修正建议。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 题目 ID |
| check_round | TINYINT | 否 | 质检轮次 |
| check_name | VARCHAR(128) | 否 | 检查项名称 |
| check_pass | TINYINT | 否 | 是否通过 |
| check_note | VARCHAR(1024) | 是 | 结论说明 |
| fixed_content | LONGTEXT | 是 | 自动修正后内容 |
| model_key | VARCHAR(64) | 是 | 质检模型 |
| confidence | DECIMAL(5,2) | 是 | 置信度（0-100） |

索引：

- `KEY idx_question (question_id, check_round)`


#### q_basket_item　试题篮条目

选题到组卷的中间态（会话级/草稿）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| user_id | BIGINT | 否 | 用户 ID |
| question_id | BIGINT | 否 | 题目 ID |
| source_page | VARCHAR(64) | 是 | 来源页面（题库/组卷/智能组卷） |
| temp_flag | TINYINT | 否 | 是否临时题 |
| sort_no | INT | 否 | 排序 |

索引：

- `UNIQUE KEY uk_user_q (user_id, question_id)`
- `KEY idx_user (user_id)`


### 4.4 试卷域（12 张）

#### p_paper　试卷主表

试卷元数据、卷面设置与统计。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_name | VARCHAR(255) | 否 | 试卷名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| duration | INT | 否 | 考试时长（分钟） |
| total_score | DECIMAL(6,2) | 否 | 卷面总分 |
| question_count | INT | 否 | 题目总数 |
| status | VARCHAR(16) | 否 | draft 草稿/aiReview AI 复审/pending 待审核/approved 已通过/rejected 已驳回；个人卷免审，保存即 approved |
| scope | VARCHAR(16) | 否 | 所属对象：platform 平台 / school 校本 / personal 个人；新建卷一律 personal，提审或协同送审通过后翻 school |
| paper_source | VARCHAR(16) | 否 | 来源：手动组卷/协同组卷/AI 组卷/真题导入/文档识别 |
| difficulty | VARCHAR(16) | 是 | 整卷难度 |
| exam_type | VARCHAR(64) | 是 | 考试类型 |
| competition | VARCHAR(64) | 是 | 杯赛名称 |
| region | VARCHAR(64) | 是 | 地区 |
| paper_year | VARCHAR(8) | 是 | 试卷年份 |
| paper_month | VARCHAR(8) | 是 | 试卷月份 |
| folder_id | BIGINT | 是 | 我的文件文件夹 ID（0 为根） |
| file_id | BIGINT | 是 | 关联文件 ID |
| view_count | INT | 否 | 浏览次数 |
| download_count | INT | 否 | 下载次数 |
| parallel_of | BIGINT | 是 | 母卷 ID（平行卷） |
| parallel_label | VARCHAR(16) | 是 | 平行卷标号（A/B/C） |
| notices_json | JSON | 是 | 卷首注意事项条目 |
| extras_json | JSON | 是 | 卷面附加区块（表格/四线格/横线） |
| attachments_json | JSON | 是 | 随卷参考资料（媒体） |
| shared_square | TINYINT | 否 | 是否分享到知识广场 |
| ai_flag | TINYINT | 否 | 是否 AI 生成 |
| ai_checks_json | JSON | 是 | 整卷质检结果 |
| ai_suspects_json | JSON | 是 | 疑点列表 |
| review_opinion | VARCHAR(1024) | 是 | 审核意见 |
| reviewer_id | BIGINT | 是 | 审核人 ID（审核中心或审批单通过时写入；个人卷免审时为空） |
| reviewer_name | VARCHAR(64) | 是 | 审核人姓名 |
| reviewed_at | DATETIME | 是 | 审核时间（驳回也写；与 published_at 语义不同） |
| owner_id | BIGINT | 否 | 创建人；个人卷可见性判定依据（禁止用姓名比较，同名教师会互相看见） |
| owner_name | VARCHAR(64) | 否 | 创建人姓名 |
| published_at | DATETIME | 是 | 通过审核时间 |

索引：

- `KEY idx_owner (owner_id)`
- `KEY idx_status (status)`
- `KEY idx_scope (scope, status)`
- `KEY idx_scope_owner (scope, owner_id)`
- `KEY idx_subject_grade (subject, grade)`
- `KEY idx_parallel (parallel_of)`


#### p_paper_section　试卷大题

大题结构与材料。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 试卷 ID |
| section_title | VARCHAR(255) | 否 | 大题标题（一、选择题） |
| sort_no | INT | 否 | 大题顺序 |
| material | LONGTEXT | 是 | 大题共用材料 |
| material_hint | VARCHAR(512) | 是 | 材料作答提示 |
| total_score | DECIMAL(6,2) | 否 | 大题总分 |
| question_count | INT | 否 | 大题题数 |

索引：

- `KEY idx_paper (paper_id, sort_no)`


#### p_paper_section_question　大题题目

大题内题目顺序、分值与快照。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 试卷 ID |
| section_id | BIGINT | 否 | 大题 ID |
| question_id | BIGINT | 否 | 题目 ID |
| sort_no | INT | 否 | 题内序号（卷面题号按卷内顺序现算） |
| score | DECIMAL(6,2) | 否 | 本题分值 |
| question_snapshot | JSON | 是 | 题目快照（防题库改动污染历史卷） |

索引：

- `KEY idx_section (section_id, sort_no)`
- `KEY idx_paper (paper_id)`


#### p_paper_version　试卷版本

完整卷面快照，支持撤销与替换。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 试卷 ID |
| version_no | INT | 否 | 版本号 |
| actor_id | BIGINT | 是 | 操作人 |
| actor_name | VARCHAR(64) | 是 | 操作人姓名 |
| summary | VARCHAR(255) | 是 | 变更摘要 |
| question_count | INT | 否 | 题数 |
| total_score | DECIMAL(6,2) | 否 | 总分 |
| sections_json | LONGTEXT | 否 | 卷面完整快照（sections 深拷贝） |
| replaced | TINYINT | 否 | 是否已被替换 |
| replace_note | VARCHAR(255) | 是 | 替换说明 |

索引：

- `UNIQUE KEY uk_paper_version (paper_id, version_no)`


#### p_paper_comment　卷面评论

卷头/大题/题目三级评论与 AI 检测意见。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 试卷 ID |
| target | VARCHAR(16) | 否 | head 卷头 / section 大题 / question 题目 |
| section_id | BIGINT | 是 | 大题 ID |
| question_id | BIGINT | 是 | 题目 ID |
| author_id | BIGINT | 是 | 评论人 ID |
| author_name | VARCHAR(64) | 是 | 评论人姓名 |
| comment_source | VARCHAR(16) | 否 | manual 手工 / ai AI 检测 / correct 纠错自动生成 |
| body | VARCHAR(2048) | 否 | 评论内容 |

索引：

- `KEY idx_paper_target (paper_id, target)`


#### p_paper_collab_task　协同组卷任务

任务壳：分工要求 + 版本 + 状态。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 关联试卷 ID（一对一） |
| task_name | VARCHAR(255) | 否 | 任务名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| duration | INT | 否 | 时长（分钟） |
| structure_json | JSON | 是 | 题型要求（题型/题数/单题分值） |
| difficulty_json | JSON | 是 | 难度占比要求 |
| knowledge_json | JSON | 是 | 考察知识点要求 |
| requirement_remark | VARCHAR(1024) | 是 | 命题说明 |
| viewers_json | JSON | 是 | 额外可见人（空数组表示不限制） |
| task_status | VARCHAR(16) | 否 | collecting 收题中/reviewing 待验收/ready 待送审/submitted 已送审/done 已完成/rejected 已驳回 |
| owner_id | BIGINT | 否 | 发起人 |
| owner_name | VARCHAR(64) | 否 | 发起人姓名 |
| deadline | DATETIME | 是 | 截止时间 |

索引：

- `KEY idx_status (task_status)`
- `KEY idx_paper (paper_id)`


#### p_paper_collab_member　协同组卷成员

成员分工、权限与验收状态。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_id | BIGINT | 否 | 任务 ID |
| user_id | BIGINT | 是 | 成员用户 ID |
| member_name | VARCHAR(64) | 否 | 成员姓名 |
| question_types | JSON | 否 | 负责题型（仅可为本组题型选题） |
| perms | JSON | 否 | 授权范围：选题/改分值/编辑卷头/只读 |
| quota | INT | 否 | 分配题数 |
| member_status | VARCHAR(16) | 否 | invited 待接受/working 组卷中/submitted 已提交/accepted 已验收 |
| review_note | VARCHAR(512) | 是 | 退回整改意见 |
| last_active_at | DATETIME | 是 | 最近活跃时间 |

索引：

- `UNIQUE KEY uk_task_member (task_id, member_name)`
- `KEY idx_task (task_id)`


#### p_paper_blueprint　双向细目表

知识点 × 难度/能力层级的组卷蓝图。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 是 | 关联试卷（模板时为空） |
| blueprint_name | VARCHAR(128) | 否 | 细目表名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| row_dim | VARCHAR(16) | 否 | 行维度：knowledge 知识点 |
| col_dim | VARCHAR(16) | 否 | 列维度：difficulty 难度 / ability 能力层级 |
| is_template | TINYINT | 否 | 是否模板 |
| scope | VARCHAR(16) | 否 | org 机构 / personal 个人 |
| owner_id | BIGINT | 是 | 创建人 |

索引：

- `KEY idx_subject (subject, grade)`


#### p_paper_blueprint_cell　细目表单元格

单元格题量与分值约束。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| blueprint_id | BIGINT | 否 | 细目表 ID |
| row_key | VARCHAR(128) | 否 | 行键（知识点） |
| row_name | VARCHAR(255) | 否 | 行名称 |
| col_key | VARCHAR(64) | 否 | 列键 |
| col_name | VARCHAR(64) | 否 | 列名称 |
| target_count | INT | 否 | 目标题量 |
| target_score | DECIMAL(6,2) | 是 | 目标分值 |
| filled_count | INT | 否 | 已填题量 |

索引：

- `UNIQUE KEY uk_bp_cell (blueprint_id, row_key, col_key)`


#### p_paper_template　模板试卷

空白试卷结构模板（不含题目）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| template_name | VARCHAR(128) | 否 | 模板名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| structure_json | JSON | 否 | 卷头与结构（大题/题型配比/分值/用时） |
| scope | VARCHAR(16) | 否 | org 机构 / personal 个人 |
| owner_id | BIGINT | 是 | 创建人 |
| enabled | TINYINT | 否 | 是否启用 |
| use_count | INT | 否 | 使用次数 |

索引：

- `KEY idx_subject (subject, grade)`


#### p_ai_compose_template　智能组卷参数模板

每次智能组卷成功后自动留档的参数集。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| template_name | VARCHAR(255) | 否 | 模板名称（默认取卷名） |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| knowledge_json | JSON | 是 | 知识点（硬条件） |
| exam_type | VARCHAR(64) | 是 | 考试类型 |
| difficulty | VARCHAR(16) | 是 | 难度 |
| region | VARCHAR(64) | 是 | 优先地区 |
| paper_year | VARCHAR(8) | 是 | 优先年份（含 earlier 哨兵） |
| structure_json | JSON | 是 | 卷面结构（题型/题量） |
| use_count | INT | 否 | 被复用次数 |
| owner_id | BIGINT | 否 | 归属人 |
| owner_name | VARCHAR(64) | 否 | 归属人姓名 |

索引：

- `KEY idx_owner (owner_id)`


#### p_paper_ref　试卷引用关系

删除保护与引用统计。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_id | BIGINT | 否 | 试卷 ID |
| ref_type | VARCHAR(16) | 否 | 引用方：homework 作业 / exam 考试 / teach_doc 备课 / collab 协同组卷 |
| ref_id | BIGINT | 否 | 引用方 ID |
| ref_name | VARCHAR(255) | 是 | 引用方名称 |
| ref_status | VARCHAR(16) | 是 | 引用方状态（进行中/已结束） |

索引：

- `KEY idx_paper (paper_id)`
- `KEY idx_ref (ref_type, ref_id)`


### 4.5 备课域（15 张）

#### t_teach_doc　备课文档

教案/学案/讲义/课件统一模型。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_kind | VARCHAR(16) | 否 | plan 教案/guide 学案/lecture 讲义/courseware 课件 |
| doc_name | VARCHAR(255) | 否 | 文档名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| textbook_version | VARCHAR(64) | 是 | 教材版本 |
| chapter | VARCHAR(255) | 是 | 章节（教材目录中的位置） |
| knowledge_json | JSON | 是 | 知识点范围 |
| doc_source | VARCHAR(16) | 否 | personal 个人/school 校本/platform 平台（决定编辑权限） |
| doc_status | VARCHAR(16) | 否 | draft 草稿/published 已发布 |
| content | LONGTEXT | 是 | 正文（文档流富文本 HTML，标题层级 h1-h4） |
| page_json | JSON | 是 | 页面设置档位（纸张/页边距/字体/页眉页脚/页码） |
| plan_json | JSON | 是 | 教案结构化扩展（兼容旧数据） |
| view_count | INT | 否 | 浏览次数 |
| shared_square | TINYINT | 否 | 是否分享到知识广场 |
| word_count | INT | 是 | 字数 |
| owner_id | BIGINT | 否 | 创建人 |
| owner_name | VARCHAR(64) | 否 | 创建人姓名 |

索引：

- `KEY idx_kind_owner (doc_kind, owner_id)`
- `KEY idx_subject (subject, grade)`


#### t_teach_plan　教案教学设计

教案专属结构化字段。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 备课文档 ID |
| objective_knowledge | LONGTEXT | 是 | 知识与技能目标 |
| objective_process | LONGTEXT | 是 | 过程与方法目标 |
| objective_emotion | LONGTEXT | 是 | 情感态度价值观目标 |
| key_points | LONGTEXT | 是 | 教学重点 |
| hard_points | LONGTEXT | 是 | 教学难点 |
| methods | JSON | 是 | 教学方法 |
| aids | JSON | 是 | 教具与媒体 |
| periods | INT | 是 | 课时数 |
| blackboard | LONGTEXT | 是 | 板书设计 |
| reflection | LONGTEXT | 是 | 教学反思 |

索引：

- `UNIQUE KEY uk_plan_doc (doc_id)`


#### t_teach_plan_step　教案教学过程环节

按环节记录教师活动/学生活动/设计意图。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 备课文档 ID |
| sort_no | INT | 否 | 环节顺序 |
| step_kind | VARCHAR(16) | 否 | lead 导入/teach 新授/consolidate 巩固/summary 小结/homework 作业/free 自定义 |
| step_title | VARCHAR(255) | 否 | 环节名称 |
| teacher_act | LONGTEXT | 是 | 教师活动 |
| student_act | LONGTEXT | 是 | 学生活动 |
| design_intent | LONGTEXT | 是 | 设计意图 |
| minutes | INT | 是 | 时间分配（分钟） |
| question_ids | JSON | 是 | 本环节引用题目 |

索引：

- `KEY idx_doc (doc_id, sort_no)`


#### t_teach_doc_block　文档块

讲义/学案的段落流（含分页与教师备注）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 备课文档 ID |
| sort_no | INT | 否 | 块顺序 |
| block_kind | VARCHAR(16) | 否 | goal/explain/example/practice/summary/homework/preview/explore/check/extend/text |
| block_title | VARCHAR(255) | 是 | 块标题 |
| body | LONGTEXT | 是 | 块正文（富文本） |
| question_ids | JSON | 是 | 引用的题库题目 |
| page_break | TINYINT | 否 | 是否强制分页 |
| teacher_note | LONGTEXT | 是 | 教师批注（仅教师版渲染） |
| ref_mode | VARCHAR(16) | 是 | 题目引用模式：snapshot 快照 / dynamic 动态引用 |

索引：

- `KEY idx_doc (doc_id, sort_no)`


#### t_teach_doc_slide　课件页面

课件分页内容与版式。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 备课文档 ID |
| sort_no | INT | 否 | 页序 |
| layout | VARCHAR(16) | 否 | cover/bullets/image/question/section/end |
| slide_title | VARCHAR(255) | 是 | 页标题 |
| subtitle | VARCHAR(255) | 是 | 副标题 |
| bullets | JSON | 是 | 要点列表 |
| note | LONGTEXT | 是 | 讲稿备注（不投屏） |
| question_id | BIGINT | 是 | 例题页引用题目 |
| thumb_url | VARCHAR(512) | 是 | 缩略图 |

索引：

- `KEY idx_doc (doc_id, sort_no)`


#### t_teach_doc_version　备课文档版本

版本快照与对比。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 备课文档 ID |
| version_no | INT | 否 | 版本号 |
| summary | VARCHAR(255) | 是 | 版本说明 |
| content_snapshot | LONGTEXT | 否 | 正文快照 |
| operator_id | BIGINT | 是 | 操作人 |
| operator_name | VARCHAR(64) | 是 | 操作人姓名 |

索引：

- `UNIQUE KEY uk_doc_version (doc_id, version_no)`


#### t_teach_template　备课模板

教案/学案/讲义模板。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| template_kind | VARCHAR(16) | 否 | plan/guide/lecture |
| template_name | VARCHAR(128) | 否 | 模板名称 |
| template_desc | VARCHAR(512) | 是 | 模板说明 |
| scope | VARCHAR(16) | 否 | org 机构 / personal 个人 |
| builtin | TINYINT | 否 | 是否系统内置（可停用不可删） |
| enabled | TINYINT | 否 | 是否启用 |
| is_default | TINYINT | 否 | 是否该类型默认模板 |
| subject | VARCHAR(32) | 是 | 预填学科 |
| grade | VARCHAR(32) | 是 | 预填年级 |
| periods | INT | 是 | 预填课时数 |
| content | LONGTEXT | 否 | 文档骨架（富文本 HTML） |
| owner_id | BIGINT | 是 | 创建人 |
| owner_name | VARCHAR(64) | 是 | 创建人姓名 |
| use_count | INT | 否 | 使用次数 |

索引：

- `KEY idx_kind_scope (template_kind, scope)`


#### t_prep_task　集体备课任务

共备一份教案/课件的过程管理。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_name | VARCHAR(255) | 否 | 任务名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| doc_kind | VARCHAR(16) | 是 | 关联文档类型 |
| doc_id | BIGINT | 是 | 关联备课文档 |
| doc_name | VARCHAR(255) | 是 | 关联文档名称 |
| topic | VARCHAR(255) | 是 | 备课主题 |
| goal | LONGTEXT | 是 | 教学目标 |
| key_points | LONGTEXT | 是 | 重点 |
| hard_points | LONGTEXT | 是 | 难点 |
| deadline | DATETIME | 是 | 截止时间 |
| requirement_note | VARCHAR(1024) | 是 | 备课说明 |
| task_status | VARCHAR(16) | 否 | draft 草稿/ongoing 备课中/review 研讨中/done 已定稿 |
| owner_id | BIGINT | 否 | 发起人 |
| owner_name | VARCHAR(64) | 否 | 发起人姓名 |

索引：

- `KEY idx_status (task_status)`


#### t_prep_member　集体备课成员

分工与提交状态。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_id | BIGINT | 否 | 任务 ID |
| user_id | BIGINT | 是 | 成员用户 ID |
| member_name | VARCHAR(64) | 否 | 成员姓名 |
| duty | VARCHAR(128) | 是 | 分工：教学目标/过程设计/例题选取/作业设计 |
| member_status | VARCHAR(16) | 否 | pending 待开始/working 进行中/submitted 已提交 |
| last_active_at | DATETIME | 是 | 最近活跃时间 |

索引：

- `UNIQUE KEY uk_prep_member (task_id, member_name)`


#### t_prep_comment　集体备课研讨记录

针对版本或环节的评论。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_id | BIGINT | 否 | 任务 ID |
| author_id | BIGINT | 是 | 评论人 |
| author_name | VARCHAR(64) | 否 | 评论人姓名 |
| target | VARCHAR(128) | 是 | 针对的环节/版本 |
| body | VARCHAR(2048) | 否 | 评论内容 |

索引：

- `KEY idx_task (task_id)`


#### t_prep_version　集体备课版本

成果快照与定稿留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_id | BIGINT | 否 | 任务 ID |
| version_no | INT | 否 | 版本号 |
| author_name | VARCHAR(64) | 是 | 提交人 |
| summary | VARCHAR(255) | 是 | 版本说明 |
| snapshot | LONGTEXT | 否 | 正文快照（JSON） |
| replaced | TINYINT | 否 | 是否已被替换 |

索引：

- `UNIQUE KEY uk_prep_version (task_id, version_no)`


#### t_doc_layout_style　排版样式包

一套可复用的标题/正文/引用样式集合，支撑 Word 级排版与 AI 美化排版。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| name | VARCHAR(100) | 否 | 样式包名称 |
| doc_type | VARCHAR(16) | 否 | 适用文档类型：plan 教案 / guide 学案 / lecture 讲义 / courseware 课件 / paper 试卷 |
| scope | VARCHAR(16) | 否 | 范围：personal 我的 / org 机构 |
| style_json | JSON | 否 | 样式定义（标题 1~4、正文、引用、表格、行距、段距、页边距、分栏） |
| source | VARCHAR(16) | 否 | 来源：manual 手工 / ai AI 生成 |
| is_default | TINYINT | 否 | 是否该类型默认样式包 |
| enabled | TINYINT | 否 | 是否启用 |
| use_count | INT | 否 | 使用次数 |
| creator_name | VARCHAR(64) | 是 | 创建人显示名（便于机构内识别） |

索引：

- `KEY idx_scope (tenant_id, scope, doc_type)`
- `KEY idx_default (tenant_id, doc_type, is_default)`


#### t_doc_collab_session　协同编辑会话

同一文档同一时刻只允许一个活动会话，避免版本分叉。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_id | BIGINT | 否 | 文档ID（t_teach_doc.id） |
| doc_type | VARCHAR(16) | 否 | 文档类型：plan / guide / lecture / courseware |
| session_no | VARCHAR(64) | 否 | 会话号 |
| owner_id | BIGINT | 否 | 主编辑用户ID |
| lock_mode | VARCHAR(16) | 否 | 协同模式：exclusive 锁编辑（他人只读）/ coedit 实时协同 |
| status | VARCHAR(16) | 否 | 状态：active 进行中 / archived 已归档 / closed 已关闭 |
| start_time | DATETIME | 否 | 开始时间 |
| end_time | DATETIME | 是 | 结束时间 |
| member_count | INT | 否 | 参与人数 |
| op_count | INT | 否 | 操作总数 |
| snapshot_count | INT | 否 | 快照数 |
| last_active_time | DATETIME | 是 | 最近活跃时间 |
| archive_doc_version | INT | 是 | 归档时对应文档版本号 |

索引：

- `UNIQUE KEY uk_session_no (session_no)`
- `KEY idx_doc (tenant_id, doc_id, status)`


#### t_doc_collab_member　协同成员

会话内成员、角色、在线状态与光标颜色。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 会话ID |
| user_id | BIGINT | 否 | 成员用户ID |
| collab_role | VARCHAR(16) | 否 | 角色：owner 主编辑 / editor 协作者 / commenter 评论者 |
| scope_desc | VARCHAR(255) | 是 | 可编辑范围说明（协作者可限章节） |
| cursor_color | VARCHAR(16) | 是 | 光标颜色（前端分配） |
| online_flag | TINYINT | 否 | 是否在线 |
| join_time | DATETIME | 否 | 加入时间 |
| leave_time | DATETIME | 是 | 离开时间 |
| last_active_time | DATETIME | 是 | 最近活跃时间 |

索引：

- `UNIQUE KEY uk_session_user (tenant_id, session_id, user_id)`
- `KEY idx_user (tenant_id, user_id)`


#### t_doc_collab_op　协同操作流水

实时协同的操作日志，用于重放、冲突对比与审计。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 会话ID |
| seq_no | BIGINT | 否 | 会话内自增序号（重放依据） |
| user_id | BIGINT | 否 | 操作人 |
| op_type | VARCHAR(24) | 否 | 操作类型：insert / delete / format / move / comment / snapshot |
| block_id | VARCHAR(64) | 是 | 块ID（块级操作时必填） |
| target_version | INT | 是 | 基于的文档版本 |
| op_payload | JSON | 是 | 操作载荷（差异内容、前后值） |
| client_ts | DATETIME | 是 | 客户端时间（冲突判断用） |
| server_ts | DATETIME | 否 | 服务端落库时间 |
| conflict_flag | TINYINT | 否 | 是否命中冲突 |

索引：

- `KEY idx_session_seq (tenant_id, session_id, seq_no)`
- `KEY idx_user_time (tenant_id, user_id, server_ts)`


### 4.6 资源域（15 张）

#### r_file_folder　我的文件目录

个人与机构文件目录树。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 是 | 父目录（空为根） |
| folder_name | VARCHAR(128) | 否 | 目录名称 |
| owner_id | BIGINT | 否 | 归属人 |
| folder_path | VARCHAR(512) | 是 | 路径 |
| pinned | TINYINT | 否 | 是否置顶 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_owner_parent (owner_id, parent_id)`


#### r_file　我的文件

上传文件与平台产出文件统一登记。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| folder_id | BIGINT | 否 | 所在目录（0 为根） |
| file_name | VARCHAR(255) | 否 | 文件名称 |
| file_kind | VARCHAR(16) | 否 | 类型：doc/paper/lecture/aiPaper/composePaper/courseware/book/word/ppt/pdf/video/audio/h5/image/miniapp/other/animation |
| file_ext | VARCHAR(16) | 是 | 扩展名 |
| mime | VARCHAR(128) | 是 | MIME |
| size_mb | DECIMAL(12,2) | 否 | 大小（MB） |
| file_url | VARCHAR(512) | 是 | 访问地址（签名 URL） |
| storage_key | VARCHAR(512) | 是 | 对象存储 Key |
| recognize_status | VARCHAR(16) | 否 | 识别状态：none/recognizing/done/failed |
| owner_id | BIGINT | 否 | 创建者 |
| owner_name | VARCHAR(64) | 否 | 创建者姓名 |
| shared | TINYINT | 否 | 是否他人分享进来 |
| shared_from_id | BIGINT | 是 | 分享人 |
| pinned | TINYINT | 否 | 是否置顶 |
| paper_id | BIGINT | 是 | 关联试卷 ID |
| teach_doc_id | BIGINT | 是 | 关联备课文档 ID |
| download_count | INT | 否 | 下载次数 |

索引：

- `KEY idx_folder (folder_id)`
- `KEY idx_owner (owner_id)`
- `KEY idx_kind (file_kind)`


#### r_material　教辅资料

机构订购与校本教辅的结构化书籍。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| material_name | VARCHAR(255) | 否 | 资料名称 |
| material_type | VARCHAR(64) | 否 | 类型：同步教辅/专项训练/试卷集/校本资料 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| size_mb | DECIMAL(12,2) | 是 | 文件大小（MB） |
| recognize_status | VARCHAR(16) | 否 | recognizing 识别中/proofreading 校对中/done 已完成/failed 失败 |
| fail_reason | VARCHAR(512) | 是 | 失败原因 |
| chapter_count | INT | 否 | 章节数 |
| example_count | INT | 否 | 条目数 |
| owner_id | BIGINT | 否 | 上传人 |
| owner_name | VARCHAR(64) | 否 | 上传人姓名 |

索引：

- `KEY idx_subject (subject, grade)`


#### r_material_chapter　教辅章节

教辅的章节结构。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| material_id | BIGINT | 否 | 教辅 ID |
| chapter_title | VARCHAR(255) | 否 | 章节标题 |
| sort_no | INT | 否 | 排序 |
| knowledge_json | JSON | 是 | 关联知识点 |

索引：

- `KEY idx_material (material_id, sort_no)`


#### r_material_example　教辅条目

章节下的可引用题目/文段。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| material_id | BIGINT | 否 | 教辅 ID |
| chapter_id | BIGINT | 否 | 章节 ID |
| stem | LONGTEXT | 否 | 题干/文段 |
| answer | LONGTEXT | 是 | 答案 |
| analysis | LONGTEXT | 是 | 解析 |
| example_status | VARCHAR(16) | 否 | pending 待处理/imported 已入库/ignored 已忽略 |
| question_id | BIGINT | 是 | 入库后生成的题目 ID |

索引：

- `KEY idx_chapter (chapter_id)`


#### r_media　媒体资源

图片/视频/动画与理科绘图工程。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| media_name | VARCHAR(255) | 否 | 资源名称 |
| media_kind | VARCHAR(16) | 否 | video 视频/animation 小程序动画/image 图片 |
| subject | VARCHAR(32) | 是 | 学科 |
| knowledge_json | JSON | 是 | 知识点 |
| size_mb | DECIMAL(12,2) | 是 | 大小（MB） |
| duration_sec | INT | 是 | 时长（秒） |
| mime | VARCHAR(128) | 是 | MIME |
| file_url | VARCHAR(512) | 是 | 可引用地址 |
| cover_url | VARCHAR(512) | 是 | 封面图 |
| editor_type | VARCHAR(32) | 是 | 绘图编辑器：jsxgraph/fabric-chem/ketcher/fabric-general |
| project_json | LONGTEXT | 是 | 绘图工程原始数据 |
| molfile_text | LONGTEXT | 是 | Ketcher 分子工程 |
| linked_count | INT | 否 | 被引用次数 |
| owner_id | BIGINT | 否 | 上传人 |
| owner_name | VARCHAR(64) | 否 | 上传人姓名 |

索引：

- `KEY idx_kind (media_kind)`
- `KEY idx_subject (subject)`


#### r_video_clip　微课切片

视频按时间打点切出的教学片段。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| media_id | BIGINT | 否 | 源视频 ID |
| media_name | VARCHAR(255) | 是 | 源视频名称 |
| clip_title | VARCHAR(255) | 否 | 切片标题 |
| start_sec | INT | 否 | 起始秒 |
| end_sec | INT | 否 | 结束秒 |
| knowledge_json | JSON | 是 | 知识点 |
| question_ids | JSON | 是 | 关联题目 |
| note | VARCHAR(512) | 是 | 说明 |
| creator_id | BIGINT | 是 | 创建人 |
| creator_name | VARCHAR(64) | 是 | 创建人姓名 |

索引：

- `KEY idx_media (media_id)`


#### r_formula_standard　标准公式库

平台标准公式（只读，可收藏）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| formula_name | VARCHAR(255) | 否 | 公式名称 |
| branch | VARCHAR(64) | 是 | 分支（代数/几何/物理…） |
| chapter | VARCHAR(128) | 是 | 章节 |
| latex | LONGTEXT | 否 | LaTeX 表达式 |
| knowledge_json | JSON | 是 | 知识点 |
| collect_count | INT | 否 | 收藏次数 |
| sort_no | INT | 否 | 排序 |

索引：

- `KEY idx_branch (branch)`


#### r_formula_org　机构与个人公式

我的公式与机构共享公式。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| formula_name | VARCHAR(255) | 否 | 公式名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| category | VARCHAR(64) | 否 | 细分类 |
| latex | LONGTEXT | 否 | LaTeX 表达式 |
| formula_scope | VARCHAR(16) | 否 | mine 我的 / shared 机构共享 |
| formula_status | VARCHAR(16) | 否 | pending 待审/approved 已通过/rejected 已驳回/off 已下架 |
| owner_id | BIGINT | 否 | 归属人 |
| owner_name | VARCHAR(64) | 否 | 归属人姓名 |
| use_count | INT | 否 | 使用次数 |

索引：

- `KEY idx_scope_status (formula_scope, formula_status)`


#### r_resource_ref　资源引用关系

题目/媒体/公式被文档与试卷引用的双向台账。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| resource_type | VARCHAR(16) | 否 | question/paper/media/material/formula |
| resource_id | BIGINT | 否 | 资源 ID |
| ref_type | VARCHAR(16) | 否 | teach_doc/paper/homework/courseware/slide |
| ref_id | BIGINT | 否 | 引用方 ID |
| ref_block_id | BIGINT | 是 | 引用块 ID |
| ref_mode | VARCHAR(16) | 是 | snapshot 快照 / dynamic 动态引用 |

索引：

- `KEY idx_resource (resource_type, resource_id)`
- `KEY idx_ref (ref_type, ref_id)`
- `UNIQUE KEY uk_ref (resource_type, resource_id, ref_type, ref_id, ref_block_id)`


#### r_resource_approval　资源审批单

校本资源上行共享审批。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| resource_kind | VARCHAR(16) | 否 | 题目/试卷/讲义/课件/教案/学案/视频 |
| resource_id | BIGINT | 是 | 资源 ID |
| resource_name | VARCHAR(255) | 否 | 资源名称 |
| subject | VARCHAR(32) | 是 | 学科 |
| grade | VARCHAR(32) | 是 | 年级 |
| scope | VARCHAR(16) | 否 | 目标范围：personal/group/school/public；个人内容提审校本固定 school |
| submit_note | VARCHAR(512) | 是 | 申请说明（来源与用途）；审批页「来源与版权」预检项据此判定，为空则该预检项不通过 |
| applicant_id | BIGINT | 否 | 申请人 |
| applicant_name | VARCHAR(64) | 否 | 申请人姓名 |
| approval_status | VARCHAR(16) | 否 | pending 待审批/approved 已通过/rejected 已驳回 |
| reviewer_id | BIGINT | 是 | 审批人 |
| reviewer_name | VARCHAR(64) | 是 | 审批人姓名 |
| reviewed_at | DATETIME | 是 | 审批时间 |
| opinion | VARCHAR(1024) | 是 | 审批意见 |
| submitted_at | DATETIME | 否 | 提交时间 |

索引：

- `KEY idx_status (approval_status)`
- `KEY idx_kind (resource_kind)`
- `KEY idx_resource (resource_kind, resource_id, approval_status)`


#### r_resource_approval_log　审批流转日志

审批动作留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| approval_id | BIGINT | 否 | 审批单 ID |
| action | VARCHAR(32) | 否 | submit 提交/approve 通过/reject 驳回/revoke 撤回 |
| operator_id | BIGINT | 是 | 操作人 |
| operator_name | VARCHAR(64) | 是 | 操作人姓名 |
| note | VARCHAR(512) | 是 | 说明 |

索引：

- `KEY idx_approval (approval_id)`


#### r_square_resource　知识广场资源

机构内共享的优质资源。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| resource_title | VARCHAR(255) | 否 | 资源标题 |
| resource_kind | VARCHAR(16) | 否 | 题目/试卷/教辅/视频/动画 |
| subject | VARCHAR(32) | 是 | 学科 |
| knowledge | VARCHAR(255) | 是 | 主知识点 |
| sharer_id | BIGINT | 是 | 分享人 |
| sharer_name | VARCHAR(64) | 否 | 分享人姓名 |
| org_name | VARCHAR(128) | 是 | 所属机构（脱敏展示） |
| collect_count | INT | 否 | 收藏数 |
| download_count | INT | 否 | 下载数 |
| resource_desc | VARCHAR(1024) | 是 | 简介 |
| source_id | BIGINT | 是 | 源资源 ID |
| audit_status | VARCHAR(16) | 否 | pending 待审/approved 已通过/rejected 已驳回/offline 已下架 |

索引：

- `KEY idx_kind (resource_kind)`
- `KEY idx_audit (audit_status)`


#### r_square_interaction　广场互动

收藏/下载/点赞行为。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| resource_id | BIGINT | 否 | 广场资源 ID |
| user_id | BIGINT | 否 | 用户 ID |
| action | VARCHAR(16) | 否 | collect 收藏/download 下载/like 点赞 |

索引：

- `UNIQUE KEY uk_user_resource_action (resource_id, user_id, action)`


#### r_scan_device　外接扫描设备

扫描仪/高拍仪注册信息与上次使用参数，用于 OCR 识题与答卷采集。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| device_name | VARCHAR(100) | 否 | 设备名称 |
| device_type | VARCHAR(24) | 否 | 类型：twain 扫描仪 / wia 扫描仪 / document_camera 高拍仪 |
| connect_type | VARCHAR(16) | 否 | 连接方式：usb / wifi / lan |
| device_sn | VARCHAR(64) | 是 | 设备序列号 |
| model | VARCHAR(64) | 是 | 型号 |
| owner_type | VARCHAR(16) | 否 | 归属类型：org 机构 / personal 个人 |
| owner_id | BIGINT | 是 | 归属对象ID（个人设备存用户ID） |
| dpi | INT | 否 | 默认分辨率（默认 300） |
| color_mode | VARCHAR(16) | 否 | 色彩模式：color / gray / bw |
| duplex | TINYINT | 否 | 是否双面：1 是 / 0 否 |
| auto_feed | TINYINT | 否 | 是否自动进纸 |
| last_use_time | DATETIME | 是 | 最近使用时间 |
| use_count | INT | 否 | 累计使用次数 |
| status | VARCHAR(16) | 否 | 状态：online 在线 / offline 离线 / disabled 停用 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `KEY idx_owner (tenant_id, owner_type, owner_id)`
- `KEY idx_type (device_type, status)`


### 4.7 教学执行域（23 张）

#### e_class　班级

教学班（校区→年级→班级）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| class_name | VARCHAR(64) | 否 | 班级名称（高一(1)班） |
| grade | VARCHAR(32) | 否 | 年级 |
| campus_id | BIGINT | 是 | 校区 |
| head_teacher_id | BIGINT | 是 | 班主任 ID |
| head_teacher_name | VARCHAR(64) | 是 | 班主任姓名 |
| assistant_name | VARCHAR(64) | 是 | 助教姓名 |
| student_count | INT | 否 | 学生数（快照） |
| subjects | JSON | 是 | 本学期学科 |
| room | VARCHAR(64) | 是 | 教室 |
| enabled | TINYINT | 否 | 是否启用 |

索引：

- `KEY idx_grade (grade)`
- `KEY idx_campus (campus_id)`


#### e_student　学生档案

学生主数据（敏感字段加密）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_no | VARCHAR(64) | 否 | 学号（租户内唯一） |
| student_name | VARCHAR(64) | 否 | 姓名 |
| gender | VARCHAR(8) | 是 | 性别 |
| class_id | BIGINT | 是 | 当前班级 |
| class_name | VARCHAR(64) | 是 | 班级名称（冗余） |
| grade | VARCHAR(32) | 是 | 年级 |
| guardian_name | VARCHAR(64) | 是 | 监护人姓名 |
| guardian_phone | VARCHAR(128) | 是 | 监护人手机（加密） |
| guardian_relation | VARCHAR(16) | 是 | 关系：父亲/母亲/其他 |
| id_card_cipher | VARCHAR(255) | 是 | 身份证号（加密，非必采集） |
| consent_status | VARCHAR(16) | 否 | granted 已同意/pending 待签署/withdrawn 已撤回 |
| tags_json | JSON | 是 | 画像标签 |
| warning_level | VARCHAR(16) | 否 | none 正常/watch 关注/risk 预警 |
| last_score | DECIMAL(6,2) | 是 | 最近考试总分 |
| last_percentile | DECIMAL(5,2) | 是 | 年级百分位 |
| enroll_at | DATE | 是 | 入校日期 |
| student_status | VARCHAR(16) | 否 | 在读/转班/休学/退出 |

索引：

- `UNIQUE KEY uk_student_no (tenant_id, student_no)`
- `KEY idx_class (class_id)`


#### e_guardian_binding　家长绑定关系

家长账号与学生绑定。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_id | BIGINT | 否 | 学生 ID |
| guardian_user_id | BIGINT | 否 | 家长用户 ID |
| guardian_name | VARCHAR(64) | 是 | 家长姓名 |
| relation | VARCHAR(16) | 是 | 父亲/母亲/其他 |
| phone | VARCHAR(128) | 是 | 手机（加密） |
| bind_status | VARCHAR(16) | 否 | pending 待核验/bound 已绑定/unbound 已解绑 |
| bind_channel | VARCHAR(16) | 是 | invite 邀请码 / phone 手机号核验 |
| bound_at | DATETIME | 是 | 绑定时间 |
| unbound_at | DATETIME | 是 | 解绑时间 |

索引：

- `UNIQUE KEY uk_student_guardian (student_id, guardian_user_id)`


#### e_consent_record　监护人知情同意

K12 合规红线：信息采集前需确认同意。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_id | BIGINT | 否 | 学生 ID |
| guardian_name | VARCHAR(64) | 否 | 监护人姓名 |
| relation | VARCHAR(16) | 是 | 关系 |
| doc_version | VARCHAR(32) | 否 | 同意书版本 |
| consent_status | VARCHAR(16) | 否 | granted/pending/withdrawn |
| scopes | JSON | 是 | 同意范围（学情分析/作业批改/画像推送等） |
| sign_channel | VARCHAR(16) | 是 | 签署渠道：app 纸质 h5 |
| signed_at | DATETIME | 是 | 签署时间 |
| withdrawn_at | DATETIME | 是 | 撤回时间 |
| file_url | VARCHAR(512) | 是 | 同意书扫描件 |

索引：

- `KEY idx_student (student_id)`
- `KEY idx_status (consent_status)`


#### e_homework　作业

作业布置与完成进度。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| homework_name | VARCHAR(255) | 否 | 作业名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| paper_id | BIGINT | 是 | 来源试卷（整卷作业） |
| paper_name | VARCHAR(255) | 是 | 试卷名称 |
| classes_json | JSON | 否 | 布置班级 |
| assign_at | DATETIME | 否 | 布置时间 |
| deadline | DATETIME | 否 | 截止时间 |
| require_text | VARCHAR(1024) | 是 | 作业要求 |
| answer_mode | VARCHAR(16) | 否 | online 在线作答/photo 拍照上传 |
| allow_analysis | TINYINT | 否 | 是否允许查看解析 |
| ai_grading | TINYINT | 否 | 是否启用 AI 批改 |
| homework_status | VARCHAR(16) | 否 | assigned 已布置/ongoing 进行中/closed 已截止 |
| submitted_count | INT | 否 | 已提交数 |
| total_count | INT | 否 | 应交数 |
| owner_id | BIGINT | 否 | 布置人 |
| owner_name | VARCHAR(64) | 否 | 布置人姓名 |

索引：

- `KEY idx_status_deadline (homework_status, deadline)`
- `KEY idx_owner (owner_id)`


#### e_homework_question　作业题目

作业包含的题目与分值。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| homework_id | BIGINT | 否 | 作业 ID |
| question_id | BIGINT | 否 | 题目 ID |
| sort_no | INT | 否 | 题序 |
| score | DECIMAL(6,2) | 是 | 分值 |

索引：

- `KEY idx_homework (homework_id, sort_no)`


#### e_homework_submission　作业提交

学生提交与批改结果。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| homework_id | BIGINT | 否 | 作业 ID |
| student_id | BIGINT | 否 | 学生 ID |
| student_name | VARCHAR(64) | 否 | 学生姓名 |
| class_name | VARCHAR(64) | 是 | 班级 |
| submit_at | DATETIME | 是 | 提交时间 |
| submit_status | VARCHAR(16) | 否 | submitted 已交/late 迟交/missing 未交 |
| score | DECIMAL(6,2) | 是 | 得分 |
| correct_rate | DECIMAL(5,2) | 是 | 正确率 |
| wrong_question_ids | JSON | 是 | 错题 ID |
| comment | VARCHAR(1024) | 是 | 评语 |
| grader_id | BIGINT | 是 | 批改人 |
| graded_at | DATETIME | 是 | 批改时间 |

索引：

- `UNIQUE KEY uk_hw_student (homework_id, student_id)`
- `KEY idx_student (student_id)`


#### e_exam_session　考试场次

一次考试（试卷下发到班级）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_name | VARCHAR(255) | 否 | 考试名称 |
| paper_id | BIGINT | 否 | 试卷 ID |
| paper_name | VARCHAR(255) | 否 | 试卷名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| classes_json | JSON | 否 | 参考班级 |
| student_count | INT | 否 | 参考人数 |
| exam_at | DATETIME | 否 | 考试时间 |
| session_status | VARCHAR(16) | 否 | preparing 待考/grading 阅卷中/finished 已完成 |
| full_score | DECIMAL(6,2) | 否 | 卷面总分 |
| created_by_name | VARCHAR(64) | 是 | 创建人姓名 |

索引：

- `KEY idx_status (session_status)`
- `KEY idx_paper (paper_id)`


#### e_exam_answer　答卷

一份学生答卷。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 考试场次 |
| student_id | BIGINT | 否 | 学生 ID |
| student_name | VARCHAR(64) | 否 | 学生姓名 |
| class_name | VARCHAR(64) | 是 | 班级 |
| total_score | DECIMAL(6,2) | 是 | 总分 |
| answer_status | VARCHAR(16) | 否 | pending 待阅/graded 已阅/absent 缺考/cheat 违纪 |
| remark | VARCHAR(512) | 是 | 异常备注 |
| grader_id | BIGINT | 是 | 阅卷人 |
| graded_at | DATETIME | 是 | 阅卷时间 |

索引：

- `UNIQUE KEY uk_session_student (session_id, student_id)`


#### e_exam_answer_item　答题明细

单题作答、AI 分数与人工分数。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| answer_id | BIGINT | 否 | 答卷 ID |
| question_id | BIGINT | 否 | 题目 ID |
| q_index | INT | 否 | 卷面题号 |
| section_title | VARCHAR(255) | 是 | 大题标题 |
| question_type | VARCHAR(32) | 是 | 题型 |
| knowledge_json | JSON | 是 | 知识点 |
| full_score | DECIMAL(6,2) | 否 | 本题满分 |
| score | DECIMAL(6,2) | 是 | 最终得分 |
| answer_text | LONGTEXT | 是 | 学生作答 |
| is_correct | TINYINT | 是 | 是否正确 |
| ai_score | DECIMAL(6,2) | 是 | AI 评分 |
| ai_confidence | DECIMAL(5,2) | 是 | AI 置信度 |
| ai_adopted | TINYINT | 否 | AI 分是否被采纳 |
| review_status | VARCHAR(16) | 否 | 待复核/已复核/已覆盖 |

索引：

- `KEY idx_answer (answer_id)`


#### e_grading_duty　阅卷分工

按大题分派阅卷人与单双评。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 考试场次 |
| section_title | VARCHAR(255) | 否 | 大题标题 |
| question_ids | JSON | 是 | 本分工题目 |
| grader_ids | JSON | 是 | 阅卷人 ID |
| grader_names | JSON | 是 | 阅卷人姓名 |
| grading_mode | VARCHAR(16) | 否 | single 单评 / double 双评 |
| done_count | INT | 否 | 已阅数 |
| total_count | INT | 否 | 应阅数 |

索引：

- `KEY idx_session (session_id)`


#### e_grading_record　评卷记录

单次评分留痕（支持双评仲裁）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 考试场次 |
| answer_id | BIGINT | 否 | 答卷 ID |
| question_id | BIGINT | 否 | 题目 ID |
| grader_id | BIGINT | 是 | 阅卷人 |
| grader_name | VARCHAR(64) | 是 | 阅卷人姓名 |
| score | DECIMAL(6,2) | 否 | 评分 |
| comment | VARCHAR(512) | 是 | 评语 |
| round_no | TINYINT | 否 | 评次（双评时 1/2） |
| is_arbitration | TINYINT | 否 | 是否仲裁结果 |

索引：

- `KEY idx_answer_q (answer_id, question_id)`


#### e_paper_analysis　试卷分析快照

整卷统计结果。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 考试场次 |
| student_count | INT | 否 | 参考人数 |
| full_score | DECIMAL(6,2) | 否 | 满分 |
| avg_score | DECIMAL(6,2) | 是 | 平均分 |
| max_score | DECIMAL(6,2) | 是 | 最高分 |
| min_score | DECIMAL(6,2) | 是 | 最低分 |
| median | DECIMAL(6,2) | 是 | 中位数 |
| std_dev | DECIMAL(6,2) | 是 | 标准差 |
| pass_rate | DECIMAL(5,2) | 是 | 及格率（%） |
| excellent_rate | DECIMAL(5,2) | 是 | 优秀率（%） |
| difficulty | DECIMAL(5,2) | 是 | 整卷难度系数 |
| discrimination | DECIMAL(5,2) | 是 | 整卷区分度 |
| bands_json | JSON | 是 | 分数段分布 |
| knowledge_json | JSON | 是 | 知识点得分率 |
| classes_json | JSON | 是 | 班级对比 |
| suggestions_json | JSON | 是 | 讲评建议 |
| calc_time | DATETIME | 是 | 计算时间 |

索引：

- `UNIQUE KEY uk_analysis_session (session_id)`


#### e_question_analysis　题目分析明细

逐题得分率、难度与区分度。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| session_id | BIGINT | 否 | 考试场次 |
| question_id | BIGINT | 否 | 题目 ID |
| q_index | INT | 否 | 题号 |
| section_title | VARCHAR(255) | 是 | 大题 |
| question_type | VARCHAR(32) | 是 | 题型 |
| knowledge_json | JSON | 是 | 知识点 |
| full_score | DECIMAL(6,2) | 否 | 满分 |
| avg_score | DECIMAL(6,2) | 是 | 平均得分 |
| score_rate | DECIMAL(5,2) | 是 | 得分率 |
| difficulty | DECIMAL(5,2) | 是 | 难度系数 |
| discrimination | DECIMAL(5,2) | 是 | 区分度 |
| correct_rate | DECIMAL(5,2) | 是 | 客观题正确率 |

索引：

- `UNIQUE KEY uk_session_question (session_id, question_id)`


#### e_mistake　错题

班级/个人错题本条目。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_id | BIGINT | 否 | 题目 ID |
| scope | VARCHAR(128) | 否 | 归属（班级名或个人名） |
| source | VARCHAR(255) | 是 | 来源（考试名/作业名） |
| student_id | BIGINT | 是 | 学生 ID（个人错题） |
| student_name | VARCHAR(64) | 是 | 学生姓名 |
| wrong_answer | LONGTEXT | 是 | 错误作答 |
| wrong_count | INT | 否 | 错误次数 |
| reason | VARCHAR(32) | 是 | 错误原因：概念不清/方法不当/计算失误/审题偏差/表达不规范/时间不足 |
| mastery | VARCHAR(16) | 否 | weak 未掌握/improving 巩固中/mastered 已掌握 |
| practiced_count | INT | 否 | 重练次数 |
| note | VARCHAR(512) | 是 | 备注 |
| last_wrong_at | DATETIME | 是 | 最近错误时间 |

索引：

- `KEY idx_scope (scope)`
- `KEY idx_student (student_id)`


#### e_mastery　知识点掌握度

学生×知识点掌握度（画像底座）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_id | BIGINT | 否 | 学生 ID |
| subject | VARCHAR(32) | 否 | 学科 |
| knowledge_id | BIGINT | 是 | 知识点 ID |
| knowledge_name | VARCHAR(255) | 否 | 知识点名称 |
| mastery | DECIMAL(5,2) | 否 | 掌握度（0-100） |
| trend | VARCHAR(8) | 否 | up 上升/flat 持平/down 下降 |
| practice_count | INT | 否 | 练习次数 |
| weak_flag | TINYINT | 否 | 是否薄弱（掌握度小于 60） |
| calc_time | DATETIME | 是 | 计算时间 |

索引：

- `UNIQUE KEY uk_student_kp (student_id, subject, knowledge_name)`


#### e_student_profile　学生学情画像

画像汇总与 AI 归因建议。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_id | BIGINT | 否 | 学生 ID |
| overall_mastery | DECIMAL(5,2) | 是 | 综合掌握度（加权） |
| percentile | DECIMAL(5,2) | 是 | 年级百分位 |
| diagnosis | LONGTEXT | 是 | AI 归因结论 |
| suggestion | LONGTEXT | 是 | AI 建议动作 |
| calc_time | DATETIME | 是 | 计算时间 |

索引：

- `UNIQUE KEY uk_profile_student (student_id)`


#### e_class_profile　班级学情报告

班级维度掌握度与建议。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| class_id | BIGINT | 否 | 班级 ID |
| student_count | INT | 是 | 学生数 |
| subject_mastery_json | JSON | 是 | 各学科平均掌握度（含上学期对比） |
| weak_nodes_json | JSON | 是 | 薄弱知识点列表 |
| score_bands_json | JSON | 是 | 最近一次统考分数段 |
| advice_json | JSON | 是 | AI 班级诊断与教学建议 |
| calc_time | DATETIME | 是 | 计算时间 |

索引：

- `KEY idx_class (class_id)`


#### e_practice_push　个性化练习推送

基于薄弱点的练习下发记录。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| student_id | BIGINT | 否 | 学生 ID |
| push_title | VARCHAR(255) | 否 | 推送标题 |
| question_count | INT | 否 | 题目数 |
| weak_points_json | JSON | 是 | 薄弱知识点 |
| pushed_at | DATETIME | 否 | 推送时间 |
| done_count | INT | 否 | 已完成数 |
| push_status | VARCHAR(16) | 否 | pending 待确认/pushed 已下发/done 已完成/canceled 已取消 |
| homework_id | BIGINT | 是 | 生成的作业 ID |

索引：

- `KEY idx_student (student_id)`


#### e_answer_sheet　答卷影像

一份学生答卷（可多页）的归集与判分/回传状态主记录。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| exam_session_id | BIGINT | 否 | 考试场次ID |
| student_id | BIGINT | 否 | 学生ID |
| class_id | BIGINT | 是 | 班级ID |
| subject | VARCHAR(32) | 否 | 学科 |
| source | VARCHAR(24) | 否 | 来源：parent_upload 家长上传 / teacher_scan 教师扫描 / teacher_manual 教师代传 |
| upload_by_type | VARCHAR(16) | 否 | 上传人类型：parent / teacher |
| upload_by_id | BIGINT | 否 | 上传人ID |
| page_count | INT | 否 | 页数 |
| recognize_status | VARCHAR(16) | 否 | 识别状态：uploaded / processing / success / failed |
| match_type | VARCHAR(16) | 是 | 身份匹配方式：qrcode 二维码 / ocr 识别 / manual 人工 |
| match_confidence | DECIMAL(5,2) | 是 | 匹配置信度 0~100 |
| claim_status | VARCHAR(16) | 否 | 归属状态：matched 已匹配 / unclaimed 待认领 / claimed 已认领 |
| score | DECIMAL(6,2) | 是 | 答卷总分 |
| score_status | VARCHAR(16) | 否 | 判分状态：pending / scored / confirmed |
| recall_status | VARCHAR(16) | 否 | 回传状态：pending / success / retry / failed |
| late_flag | TINYINT | 否 | 是否迟交 |
| upload_time | DATETIME | 否 | 上传时间 |
| fail_reason | VARCHAR(255) | 是 | 失败原因 |

索引：

- `KEY idx_session_student (tenant_id, exam_session_id, student_id)`
- `KEY idx_claim (tenant_id, claim_status)`
- `KEY idx_recall (tenant_id, recall_status)`


#### e_answer_sheet_page　答卷页

答卷的每一页影像与切题区域映射。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| sheet_id | BIGINT | 否 | 答卷ID（e_answer_sheet.id） |
| page_no | INT | 否 | 页码（从 1 开始） |
| file_id | BIGINT | 是 | 文件ID（r_file.id） |
| image_url | VARCHAR(500) | 是 | 影像地址（私有桶 Key，不存公网直链） |
| width | INT | 是 | 像素宽 |
| height | INT | 是 | 像素高 |
| quality_score | DECIMAL(5,2) | 是 | 质量分 0~100（模糊/缺角/反光检测） |
| quality_issue | VARCHAR(255) | 是 | 质量问题说明 |
| question_map | JSON | 是 | 题号与作答区域坐标映射 |
| ocr_text | LONGTEXT | 是 | 整页 OCR 文本（脱敏后，仅供检索与复核） |

索引：

- `UNIQUE KEY uk_sheet_page (tenant_id, sheet_id, page_no)`


#### e_score_recall　成绩回传

按「场次+学生+学科」向教务系统回传成绩的主记录，幂等键保证不重复入账。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| exam_session_id | BIGINT | 否 | 考试场次ID |
| student_id | BIGINT | 否 | 学生ID |
| subject | VARCHAR(32) | 否 | 学科 |
| sheet_id | BIGINT | 是 | 关联答卷ID |
| score | DECIMAL(6,2) | 否 | 本次回传分数 |
| full_score | DECIMAL(6,2) | 否 | 该科满分 |
| idem_key | VARCHAR(128) | 否 | 幂等键：场次ID+学生ID+学科+版本号 |
| recall_status | VARCHAR(16) | 否 | 状态：pending / success / retry / failed |
| recall_times | INT | 否 | 回传尝试次数 |
| recall_time | DATETIME | 是 | 最近回传时间 |
| ext_exam_id | VARCHAR(64) | 是 | 教务系统考试ID |
| ext_student_id | VARCHAR(64) | 是 | 教务系统学生ID |
| ext_score_id | VARCHAR(64) | 是 | 教务系统成绩记录ID |
| diff_flag | TINYINT | 否 | 是否与已回传分数存在差异（>10 分） |
| confirm_required | TINYINT | 否 | 是否需要二次确认 |
| operator | VARCHAR(64) | 是 | 确认人 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `UNIQUE KEY uk_idem (tenant_id, idem_key)`
- `KEY idx_session_subject (tenant_id, exam_session_id, subject)`
- `KEY idx_status (recall_status)`


#### e_score_recall_log　成绩回传日志

每次回传请求的完整记录，用于排障与对账。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| recall_id | BIGINT | 否 | 回传记录ID |
| action | VARCHAR(24) | 否 | 动作：submit 提交 / retry 重试 / manual 手动重推 |
| request_body | TEXT | 是 | 请求报文（脱敏） |
| response_body | TEXT | 是 | 响应报文 |
| http_status | INT | 是 | HTTP 状态码 |
| cost_ms | INT | 是 | 耗时（毫秒） |
| result | VARCHAR(16) | 否 | 结果：success / fail |
| error_code | VARCHAR(64) | 是 | 错误码 |
| error_msg | VARCHAR(500) | 是 | 错误信息 |

索引：

- `KEY idx_recall (tenant_id, recall_id)`


### 4.8 家长端域（7 张）

#### g_parent_account　家长账号

家长端登录账号；全局账号（tenant_id 固定 0），与机构端员工账号互不影响。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| phone_cipher | VARCHAR(255) | 否 | 手机号（加密存储） |
| phone_hash | VARCHAR(64) | 否 | 手机号哈希（用于唯一索引与查询，避免明文索引） |
| phone_mask | VARCHAR(20) | 否 | 脱敏手机号（138****8888，列表展示用） |
| nickname | VARCHAR(50) | 是 | 昵称 |
| avatar | VARCHAR(255) | 是 | 头像地址 |
| wx_openid | VARCHAR(64) | 是 | 微信 openid（小程序/H5 内） |
| wx_unionid | VARCHAR(64) | 是 | 微信 unionid |
| status | VARCHAR(16) | 否 | 状态：active 正常 / disabled 停用 / cancelled 已注销 |
| register_source | VARCHAR(16) | 否 | 注册来源：h5 / miniprogram |
| last_login_time | DATETIME | 是 | 最近登录时间 |
| last_login_ip | VARCHAR(64) | 是 | 最近登录 IP |
| last_login_region | VARCHAR(64) | 是 | 最近登录归属地 |
| fail_count | INT | 否 | 连续验证码失败次数 |
| lock_until | DATETIME | 是 | 锁定到期时间 |

索引：

- `UNIQUE KEY uk_phone_hash (phone_hash)`
- `KEY idx_wx (wx_openid)`


#### g_parent_student　监护关系

家长与学生绑定关系，是家长端全部数据权限的唯一依据；按租户隔离。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 否 | 家长账号ID |
| student_id | BIGINT | 否 | 学生ID（e_student.id） |
| class_id | BIGINT | 是 | 班级ID（冗余，便于按班统计） |
| relation | VARCHAR(16) | 否 | 关系：father 父 / mother 母 / grandparent 祖辈 / other 其他 |
| bind_status | VARCHAR(16) | 否 | 状态：pending 待审核 / granted 已通过 / rejected 已驳回 / revoked 已解除 |
| bind_code | VARCHAR(16) | 是 | 绑定码（6 位，用后失效） |
| apply_time | DATETIME | 否 | 申请时间 |
| audit_by | BIGINT | 是 | 审核人 |
| audit_time | DATETIME | 是 | 审核时间 |
| audit_remark | VARCHAR(255) | 是 | 审核意见（驳回必填） |
| consent_status | VARCHAR(16) | 否 | 监护人同意：none 未同意 / granted 已同意 / revoked 已撤回 |
| consent_time | DATETIME | 是 | 同意时间 |
| is_primary | TINYINT | 否 | 是否主监护人 |
| revoke_reason | VARCHAR(255) | 是 | 解除原因 |

索引：

- `UNIQUE KEY uk_parent_student (tenant_id, parent_id, student_id)`
- `KEY idx_student (tenant_id, student_id, bind_status)`
- `KEY idx_parent (parent_id, bind_status)`


#### g_parent_login_log　家长登录日志

家长端登录与安全事件记录。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 是 | 家长账号ID（未注册成功时为空） |
| login_type | VARCHAR(16) | 否 | 登录方式：sms 验证码 / wechat 微信 / password 密码 |
| phone_mask | VARCHAR(20) | 是 | 脱敏手机号 |
| ip | VARCHAR(64) | 是 | IP |
| region | VARCHAR(64) | 是 | 归属地 |
| device | VARCHAR(64) | 是 | 设备型号 |
| ua | VARCHAR(255) | 是 | User-Agent |
| result | VARCHAR(16) | 否 | 结果：success / fail |
| fail_reason | VARCHAR(255) | 是 | 失败原因 |

索引：

- `KEY idx_parent_time (parent_id, create_time)`
- `KEY idx_result (result)`


#### g_share_link　分享链接

试卷/学情报告/作业的定向分享；带随机令牌、绑定接收人、有有效期、访问留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| share_token | VARCHAR(64) | 否 | 随机令牌（≥32 位，不可枚举） |
| target_type | VARCHAR(16) | 否 | 分享对象：paper 试卷 / report 学情报告 / homework 作业 |
| target_id | BIGINT | 否 | 对象ID |
| target_version | VARCHAR(32) | 是 | 对象版本（改版后旧分享失效） |
| share_type | VARCHAR(16) | 否 | 形态：online 在线页 / image 图片 / pdf 文档 / print 打印件 |
| parent_id | BIGINT | 否 | 接收家长ID |
| student_id | BIGINT | 否 | 接收学生ID |
| class_id | BIGINT | 是 | 班级ID |
| file_id | BIGINT | 是 | 生成物文件ID（图片/PDF） |
| expire_time | DATETIME | 否 | 失效时间 |
| allow_answer | TINYINT | 否 | 是否对家长可见答案与解析 |
| watermark_text | VARCHAR(255) | 是 | 水印文案（机构名+学生姓名+用途） |
| access_count | INT | 否 | 访问次数 |
| last_access_time | DATETIME | 是 | 最近访问时间 |
| status | VARCHAR(16) | 否 | 状态：valid 有效 / expired 已过期 / revoked 已撤销 |
| remark | VARCHAR(255) | 是 | 备注 |

索引：

- `UNIQUE KEY uk_token (share_token)`
- `KEY idx_target (tenant_id, target_type, target_id)`
- `KEY idx_parent (tenant_id, parent_id, status)`


#### g_share_access_log　分享访问日志

家长对分享内容的访问、保存、打印记录，用于风控与纠纷核查。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| share_id | BIGINT | 否 | 分享记录ID |
| parent_id | BIGINT | 否 | 家长账号ID |
| action | VARCHAR(16) | 否 | 动作：view 查看 / save 保存 / print 打印 / download 下载 |
| ip | VARCHAR(64) | 是 | IP |
| region | VARCHAR(64) | 是 | 归属地 |
| ua | VARCHAR(255) | 是 | User-Agent |
| duration_ms | INT | 是 | 停留时长（毫秒） |
| result | VARCHAR(16) | 否 | 结果：success / blocked 被拦截 |
| block_reason | VARCHAR(255) | 是 | 拦截原因（如访问过于频繁） |

索引：

- `KEY idx_share_time (tenant_id, share_id, create_time)`
- `KEY idx_parent_time (tenant_id, parent_id, create_time)`


#### g_notify_setting　家长通知偏好

按通知类型控制站内/推送/短信/微信渠道开关。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| parent_id | BIGINT | 否 | 家长账号ID |
| notify_type | VARCHAR(24) | 否 | 类型：homework 作业提醒 / report 报告送达 / score 成绩更新 / notice 系统公告 / security 账号安全 |
| inapp_enabled | TINYINT | 否 | 站内是否接收（公告与安全类强制开启） |
| push_enabled | TINYINT | 否 | App 推送是否接收 |
| sms_enabled | TINYINT | 否 | 短信是否接收 |
| wechat_enabled | TINYINT | 否 | 微信模板消息是否接收 |

索引：

- `UNIQUE KEY uk_parent_type (parent_id, notify_type)`


#### g_report_push　学情报告推送

学情报告的生成物、推送状态与查收状态。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| report_no | VARCHAR(64) | 否 | 报告编号 |
| report_type | VARCHAR(16) | 否 | 类型：enrollment 入学 / midterm 期中 / final 期末 / custom 自定义周期 |
| student_id | BIGINT | 否 | 学生ID |
| parent_id | BIGINT | 是 | 接收家长ID（未绑定时为空） |
| class_id | BIGINT | 是 | 班级ID |
| period | VARCHAR(32) | 否 | 报告周期（如 2026 学年第一学期） |
| batch_no | VARCHAR(64) | 是 | 生成批次号 |
| pdf_file_id | BIGINT | 是 | PDF 文件ID |
| image_file_id | BIGINT | 是 | 长图文件ID |
| push_status | VARCHAR(16) | 否 | 推送状态：pending 待推送 / sent 已发送 / delivered 已送达 / read 已读 / failed 失败 |
| push_time | DATETIME | 是 | 推送时间 |
| read_time | DATETIME | 是 | 首次打开时间 |
| fail_reason | VARCHAR(255) | 是 | 失败原因（如未绑定家长） |
| gen_by | BIGINT | 是 | 生成人 |

索引：

- `KEY idx_student_type (tenant_id, student_id, report_type)`
- `KEY idx_batch (tenant_id, batch_no)`
- `KEY idx_status (push_status)`


### 4.9 AI 域（17 张）

#### r_prompt_org　机构提示词模板

机构基于平台模板派生的提示词。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| prompt_name | VARCHAR(128) | 否 | 模板名称 |
| scene | VARCHAR(64) | 否 | 适用场景 |
| content | LONGTEXT | 否 | 模板正文（支持 变量占位） |
| prompt_status | VARCHAR(16) | 否 | enabled 启用/disabled 停用 |
| is_default | TINYINT | 否 | 是否场景默认 |
| source_prompt_id | BIGINT | 是 | 来源平台模板 ID |
| remark | VARCHAR(255) | 是 | 备注 |
| versions_json | JSON | 是 | 历史版本（版本号/时间/正文） |
| owner_id | BIGINT | 否 | 创建人 |
| owner_name | VARCHAR(64) | 否 | 创建人姓名 |

索引：

- `KEY idx_scene (scene)`


#### ai_model　模型接入

大模型/多模态/OCR 接入配置。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| model_name | VARCHAR(64) | 否 | 模型名称 |
| model_type | VARCHAR(16) | 否 | llm/multimodal/ocr |
| provider | VARCHAR(64) | 否 | 服务商 |
| api_url | VARCHAR(512) | 否 | 接口地址 |
| api_key_cipher | VARCHAR(1024) | 是 | 密钥（加密存储） |
| qps | INT | 否 | QPS 上限 |
| timeout_sec | INT | 否 | 超时（秒） |
| price_per_k | DECIMAL(10,4) | 是 | 单价（元/千 tokens） |
| enabled | TINYINT | 否 | 是否启用 |
| calls_month | BIGINT | 否 | 本月调用次数 |
| cost_month | DECIMAL(12,2) | 否 | 本月成本（元） |
| last_check_at | DATETIME | 是 | 最近健康检查时间 |
| last_check_ok | TINYINT | 是 | 最近健康检查结果 |

索引：

- `UNIQUE KEY uk_model_name (model_name)`


#### ai_agent_config　智能体编排配置

质检/出题等智能体的编排与策略。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| agent_name | VARCHAR(64) | 否 | 智能体名称 |
| agent_desc | VARCHAR(255) | 是 | 说明 |
| scene | VARCHAR(64) | 否 | 适用场景 |
| auto_fix_types | JSON | 是 | 可自动修复的错误类型 |
| auto_fix_threshold | DECIMAL(5,2) | 是 | 自动修复置信度阈值 |
| min_confidence | DECIMAL(5,2) | 是 | 转人工最低置信度 |
| max_similarity | DECIMAL(5,2) | 是 | 转人工最高相似度 |
| version_no | INT | 否 | 配置版本 |
| config_status | VARCHAR(16) | 否 | draft 草稿/published 已发布 |

索引：

- `KEY idx_scene (scene)`


#### ai_agent_check_item　智能体检查项

编排节点（检查项）配置。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| agent_id | BIGINT | 否 | 智能体配置 ID |
| item_key | VARCHAR(64) | 否 | 检查项键 |
| item_label | VARCHAR(128) | 否 | 检查项名称 |
| enabled | TINYINT | 否 | 是否启用 |
| model_id | BIGINT | 是 | 绑定模型 |
| weight | INT | 否 | 权重 |
| timeout_sec | INT | 否 | 超时（秒） |
| ocr_only | TINYINT | 否 | 是否仅可绑定多模态/OCR 模型 |
| sort_no | INT | 否 | 执行顺序 |

索引：

- `UNIQUE KEY uk_agent_item (agent_id, item_key)`


#### ai_prompt_template　Prompt 模板

平台与机构 Prompt 模板。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| prompt_name | VARCHAR(128) | 否 | 模板名称 |
| scene | VARCHAR(64) | 否 | 适用场景 |
| content | LONGTEXT | 否 | 模板正文（支持 变量占位） |
| prompt_status | VARCHAR(16) | 否 | draft 草稿/published 已发布/disabled 已停用 |
| is_default | TINYINT | 否 | 是否场景默认 |
| source_prompt_id | BIGINT | 是 | 派生来源（平台模板） |
| gray_rule | JSON | 是 | 灰度规则（租户标签/套餐/比例） |
| remark | VARCHAR(255) | 是 | 说明 |

索引：

- `KEY idx_scene_status (scene, prompt_status)`


#### ai_prompt_version　Prompt 版本

Prompt 版本化与回滚。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| template_id | BIGINT | 否 | 模板 ID |
| version_no | INT | 否 | 版本号 |
| content | LONGTEXT | 否 | 版本正文 |
| change_note | VARCHAR(255) | 是 | 变更说明 |
| gray_status | VARCHAR(16) | 否 | none 未灰度/graying 灰度中/released 已全量/rolled_back 已回滚 |

索引：

- `UNIQUE KEY uk_prompt_version (template_id, version_no)`


#### ai_call_log　AI 调用日志

每次模型调用的明细（计量与排障）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| trace_id | VARCHAR(64) | 否 | 链路 ID |
| user_id | BIGINT | 是 | 调用人 |
| scene | VARCHAR(64) | 否 | 场景：出题/组卷/讲义/阅卷/识题/识卷/问答 |
| model_key | VARCHAR(64) | 否 | 模型标识 |
| model_name | VARCHAR(64) | 是 | 模型名称 |
| input_tokens | INT | 否 | 输入 tokens |
| output_tokens | INT | 否 | 输出 tokens |
| cost_amount | DECIMAL(12,6) | 否 | 费用（元） |
| cost_ms | INT | 否 | 耗时（毫秒） |
| result | TINYINT | 否 | 1 成功 0 失败 |
| error_type | VARCHAR(32) | 是 | 超时/限流/内容安全/解析失败/模型异常 |
| error_msg | VARCHAR(1024) | 是 | 错误信息 |
| input_digest | VARCHAR(2048) | 是 | 输入摘要（脱敏） |
| output_digest | VARCHAR(2048) | 是 | 输出摘要（脱敏） |
| prompt_version | INT | 是 | Prompt 版本 |

索引：

- `KEY idx_time (create_time)`
- `KEY idx_tenant_scene (tenant_id, scene)`
- `KEY idx_result (result)`


#### ai_task　AI 任务

异步 AI 任务中心。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_no | VARCHAR(64) | 否 | 任务号 |
| scene | VARCHAR(64) | 否 | 场景 |
| task_title | VARCHAR(255) | 否 | 任务标题 |
| creator_id | BIGINT | 是 | 发起人 |
| creator_name | VARCHAR(64) | 是 | 发起人姓名 |
| task_status | VARCHAR(16) | 否 | running 进行中/success 已完成/failed 失败/reviewing 待复核 |
| elapsed_sec | INT | 是 | 耗时（秒） |
| tokens | INT | 是 | token 消耗 |
| output_count | INT | 是 | 产物数量 |
| biz_type | VARCHAR(32) | 是 | 业务类型 |
| biz_id | BIGINT | 是 | 业务对象 ID |
| params_json | JSON | 是 | 入参快照 |
| result_json | JSON | 是 | 结果摘要 |
| error_msg | VARCHAR(1024) | 是 | 失败原因 |
| started_at | DATETIME | 是 | 开始时间 |
| finished_at | DATETIME | 是 | 结束时间 |

索引：

- `UNIQUE KEY uk_task_no (task_no)`
- `KEY idx_status (task_status)`


#### ai_artifact_review　AI 产物复核

AI 生成内容的教师复核（合规强制）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| artifact_kind | VARCHAR(16) | 否 | 题目/试卷/讲义/课件/批改/画像 |
| artifact_id | BIGINT | 是 | 产物 ID |
| artifact_title | VARCHAR(255) | 否 | 产物标题 |
| scene | VARCHAR(64) | 是 | 生成场景 |
| model_key | VARCHAR(64) | 是 | 生成模型 |
| review_status | VARCHAR(16) | 否 | pending 待复核/approved 已通过/rejected 已驳回 |
| auto_check | VARCHAR(16) | 否 | pass/warn/error |
| auto_check_note | VARCHAR(1024) | 是 | 自动质检结论 |
| ai_labeled | TINYINT | 否 | 是否已加 AI 标识 |
| reviewer_id | BIGINT | 是 | 复核人 |
| reviewer_name | VARCHAR(64) | 是 | 复核人姓名 |
| reviewed_at | DATETIME | 是 | 复核时间 |
| review_note | VARCHAR(1024) | 是 | 复核意见 |

索引：

- `KEY idx_status (review_status)`
- `KEY idx_kind (artifact_kind)`


#### ai_quality_eval　AI 质量评测

评测集抽样与多维度得分。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| scene | VARCHAR(64) | 否 | 场景 |
| model_key | VARCHAR(64) | 是 | 模型 |
| dataset_name | VARCHAR(128) | 否 | 评测集名称 |
| sample_count | INT | 否 | 样本数 |
| score_accuracy | DECIMAL(5,2) | 是 | 事实准确率 |
| score_completeness | DECIMAL(5,2) | 是 | 信息完整度 |
| score_grade_fit | DECIMAL(5,2) | 是 | 年级适配度 |
| score_safety | DECIMAL(5,2) | 是 | 内容安全分 |
| overall_score | DECIMAL(5,2) | 是 | 综合分 |
| delta | DECIMAL(5,2) | 是 | 较上一轮变化 |
| ran_at | DATETIME | 否 | 评测时间 |

索引：

- `KEY idx_scene_time (scene, ran_at)`


#### ai_trace　AI 生成留痕

生成内容溯源（模型/Prompt/知识库版本）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| trace_id | VARCHAR(64) | 否 | 链路 ID |
| scene | VARCHAR(64) | 否 | 场景 |
| model_key | VARCHAR(64) | 是 | 模型 |
| artifact_kind | VARCHAR(32) | 是 | 产物类型 |
| artifact_id | BIGINT | 是 | 产物 ID |
| artifact_title | VARCHAR(255) | 是 | 产物标题 |
| input_digest | VARCHAR(2048) | 是 | 输入摘要（脱敏） |
| safety_result | VARCHAR(16) | 否 | pass/masked/blocked |
| safety_reason | VARCHAR(1024) | 是 | 命中触发条件：命中哪条策略、命中什么内容、执行了什么动作（masked/blocked 必有值） |
| prompt_version | INT | 是 | Prompt 版本 |
| knowledge_version | VARCHAR(32) | 是 | 知识库版本 |

索引：

- `UNIQUE KEY uk_trace_id (trace_id)`


#### ai_billing_rule　AI 计费规则

两级计价：tenant_id=0 为全局默认价，tenant_id>0 为该租户专属覆盖价。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| scene | VARCHAR(64) | 否 | 场景 |
| model_key | VARCHAR(64) | 否 | 模型 |
| billing_unit | VARCHAR(16) | 否 | call 按次 / 1k-token 按千 token |
| price | DECIMAL(10,4) | 否 | 单价（元）；租户覆盖行只覆盖单价，不覆盖启停 |
| currency | VARCHAR(8) | 否 | 币种（CNY） |
| enabled | TINYINT | 否 | 是否启用（以全局行为准；租户覆盖行该列不参与判定） |
| effective_from | DATETIME | 是 | 生效时间 |

索引：

- `KEY idx_scene (scene, model_key)`
- `UNIQUE KEY uk_tenant_scene_model (tenant_id, scene, model_key)`


#### ai_quota_account　AI 额度账户

租户额度账户（充值/赠送/月度）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| account_type | VARCHAR(16) | 否 | gift 赠送/recharge 充值/monthly 月度套餐额度 |
| total_amount | DECIMAL(12,2) | 否 | 总额度（元） |
| used_amount | DECIMAL(12,2) | 否 | 已用（元） |
| frozen_amount | DECIMAL(12,2) | 否 | 冻结（元） |
| expire_time | DATETIME | 是 | 过期时间 |
| account_status | VARCHAR(16) | 否 | active 有效/expired 已过期/frozen 已冻结 |

索引：

- `KEY idx_tenant (tenant_id, account_type)`


#### ai_quota_flow　AI 额度流水

额度变动台账（禁止直接改余额）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| account_id | BIGINT | 否 | 账户 ID |
| flow_type | VARCHAR(16) | 否 | recharge 充值/gift 赠送/consume 消费/freeze 冻结/unfreeze 解冻/refund 退回/expire 过期 |
| amount | DECIMAL(12,2) | 否 | 变动金额（元，正负） |
| balance_after | DECIMAL(12,2) | 否 | 变动后余额 |
| biz_type | VARCHAR(32) | 是 | 业务类型 |
| biz_id | BIGINT | 是 | 业务 ID |
| remark | VARCHAR(255) | 是 | 说明 |
| occur_time | DATETIME | 否 | 发生时间 |

索引：

- `KEY idx_account_time (account_id, occur_time)`


#### ai_tenant_switch　租户 AI 能力开关

按租户控制各 AI 能力。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| capability_key | VARCHAR(64) | 否 | 能力键：aiGenerate/aiVariant/aiPhoto/aiPaper/aiLecture/aiCourseware/aiGrading/aiProfile/aiChat |
| capability_label | VARCHAR(64) | 否 | 能力名称 |
| enabled | TINYINT | 否 | 是否开启 |
| month_cost | DECIMAL(12,2) | 否 | 本月用量（元） |
| quota_left | DECIMAL(12,2) | 否 | 剩余额度（元） |
| trial_quota | DECIMAL(12,2) | 是 | 体验额度（元） |

索引：

- `UNIQUE KEY uk_tenant_cap (tenant_id, capability_key)`


#### ai_sensitive_policy　内容安全策略

敏感词与内容安全策略分组。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| policy_name | VARCHAR(128) | 否 | 策略名称 |
| policy_action | VARCHAR(16) | 否 | 命中动作：block 拒答/human 转人工/mask 替换脱敏 |
| scope | VARCHAR(64) | 否 | 适用场景：学生问答/教师助手/出题/全部 |
| words_json | JSON | 是 | 词库 |
| enabled | TINYINT | 否 | 是否启用 |
| hits_30d | INT | 否 | 近 30 天命中次数 |

索引：

- `KEY idx_scope (scope)`


#### ai_knowledge_doc　AI 知识库文档

RAG 知识库文档与切片状态。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| doc_name | VARCHAR(255) | 否 | 文档名称 |
| subject | VARCHAR(32) | 是 | 学科 |
| doc_type | VARCHAR(32) | 否 | 类型：教材/课标/考纲/错题语料 |
| version_no | VARCHAR(32) | 是 | 教材或课标版本 |
| file_url | VARCHAR(512) | 是 | 文件地址 |
| chunk_count | INT | 否 | 切片数 |
| vector_status | VARCHAR(16) | 否 | pending 待向量化/indexing 向量化中/ready 已就绪/failed 失败 |
| namespace | VARCHAR(64) | 是 | 向量库命名空间（按学科/租户隔离） |

索引：

- `KEY idx_subject (subject)`


### 4.10 平台内容运营域（6 张）

#### c_public_question　公共题库题目

平台侧题目内容运营。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| question_type | VARCHAR(32) | 否 | 题型 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| difficulty | VARCHAR(16) | 是 | 难度 |
| knowledge_json | JSON | 是 | 知识点 |
| stem | LONGTEXT | 否 | 题干 |
| answer | LONGTEXT | 是 | 答案 |
| analysis | LONGTEXT | 是 | 解析 |
| content_status | VARCHAR(16) | 否 | draft 草稿/pending 待审/published 已上架/rejected 已驳回/offline 已下架 |
| quality_grade | VARCHAR(4) | 是 | 质量分级 A/B/C |
| content_source | VARCHAR(64) | 是 | 来源：真题/教辅/投稿/AI 生成 |
| ref_count | INT | 否 | 被租户引用次数 |
| ai_status | VARCHAR(32) | 是 | AI 质检状态 |

索引：

- `KEY idx_subject_status (subject, content_status)`


#### c_public_paper　公共试卷

平台公共试卷库。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| paper_name | VARCHAR(255) | 否 | 试卷名称 |
| subject | VARCHAR(32) | 否 | 学科 |
| grade | VARCHAR(32) | 否 | 年级 |
| question_count | INT | 否 | 题量 |
| full_score | DECIMAL(6,2) | 否 | 总分 |
| paper_source | VARCHAR(64) | 是 | 来源：真题/教辅/投稿 |
| content_status | VARCHAR(16) | 否 | draft/pending/published/rejected/offline |
| ref_count | INT | 否 | 引用次数 |

索引：

- `KEY idx_subject_status (subject, content_status)`


#### c_content_distribution　内容分发授权

按套餐/租户授权公共内容。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| content_type | VARCHAR(16) | 否 | 题目/试卷/教辅/素材 |
| content_id | BIGINT | 是 | 内容 ID |
| content_name | VARCHAR(255) | 否 | 内容名称 |
| scope_type | VARCHAR(16) | 否 | all 全部租户/package 指定套餐/tenant 指定租户 |
| scope_value | JSON | 是 | 范围值（套餐 ID 或租户 ID 列表） |
| tenant_count | INT | 否 | 授权租户数 |
| dist_status | VARCHAR(16) | 否 | syncing 同步中/synced 已同步/paused 已暂停 |
| synced_at | DATETIME | 是 | 最近同步时间 |

索引：

- `KEY idx_type (content_type)`


#### c_compliance_check　内容合规抽检

抽检任务与命中结果。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| check_title | VARCHAR(255) | 否 | 抽检任务名称 |
| check_scope | VARCHAR(255) | 是 | 抽检范围 |
| sample_count | INT | 否 | 抽检数量 |
| flagged_count | INT | 否 | AI 命中疑似问题数 |
| confirmed_count | INT | 否 | 人工确认违规数 |
| check_status | VARCHAR(16) | 否 | running 进行中/done 已完成/closed 已关闭 |
| samples_json | JSON | 是 | 命中样例（内容名/原因/风险等级） |
| finished_at | DATETIME | 是 | 完成时间 |

索引：

- `KEY idx_status (check_status)`


#### c_feedback_ticket　内容问题反馈工单

机构教师反馈公共内容问题。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| ticket_title | VARCHAR(255) | 否 | 工单标题 |
| content_type | VARCHAR(32) | 是 | 内容类型 |
| content_id | BIGINT | 是 | 内容 ID |
| content_name | VARCHAR(255) | 是 | 内容名称 |
| reporter_id | BIGINT | 是 | 反馈人 |
| reporter_name | VARCHAR(64) | 是 | 反馈人姓名 |
| tenant_name | VARCHAR(128) | 是 | 所属机构 |
| ticket_kind | VARCHAR(32) | 否 | 问题类型：内容错误/版权争议/敏感内容/其他 |
| priority | VARCHAR(16) | 否 | high/normal/low |
| ticket_status | VARCHAR(16) | 否 | open 待处理/processing 处理中/resolved 已解决/rejected 已驳回 |
| resolved_at | DATETIME | 是 | 解决时间 |
| reply | VARCHAR(2048) | 是 | 处理回复 |

索引：

- `KEY idx_status_priority (ticket_status, priority)`


#### c_review_record　内容审核记录

平台内容审核与 AI 预审留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| object_type | VARCHAR(32) | 否 | 对象类型 |
| object_id | BIGINT | 否 | 对象 ID |
| object_name | VARCHAR(255) | 是 | 对象名称 |
| agent_passed | INT | 是 | AI 通过项数 |
| agent_total | INT | 是 | AI 检查项总数 |
| auto_fixed | INT | 是 | 自动修正项数 |
| reviewer_id | BIGINT | 是 | 审核人 |
| reviewer_name | VARCHAR(64) | 是 | 审核人姓名 |
| conclusion | VARCHAR(32) | 是 | 结论：通过/驳回/待议 |
| timeline_json | JSON | 是 | 审核过程时间线 |
| reviewed_at | DATETIME | 是 | 审核时间 |

索引：

- `KEY idx_object (object_type, object_id)`


### 4.11 审计与日志域（4 张）

#### sys_operation_log　操作日志

平台端与机构端写操作留痕。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| biz_module | VARCHAR(64) | 否 | 业务模块 |
| action | VARCHAR(64) | 否 | 动作：新增/编辑/删除/审核/导出/登录… |
| target | VARCHAR(255) | 是 | 操作对象 |
| target_id | VARCHAR(64) | 是 | 对象 ID |
| request_uri | VARCHAR(255) | 是 | 请求地址 |
| request_method | VARCHAR(16) | 是 | 请求方法 |
| params | TEXT | 是 | 请求参数（脱敏） |
| ip | VARCHAR(64) | 是 | 来源 IP |
| user_agent | VARCHAR(512) | 是 | UA |
| result | TINYINT | 否 | 1 成功 0 失败 |
| error_msg | VARCHAR(1024) | 是 | 失败原因 |
| cost_ms | INT | 是 | 耗时（毫秒） |
| operator_name | VARCHAR(64) | 是 | 操作人姓名（冗余便于查询） |

索引：

- `KEY idx_module_time (biz_module, create_time)`
- `KEY idx_operator (create_by, create_time)`


#### sys_login_log　登录日志

登录成功与失败记录。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| user_id | BIGINT | 是 | 用户 ID |
| account | VARCHAR(64) | 否 | 登录账号 |
| login_ip | VARCHAR(64) | 是 | IP |
| location | VARCHAR(128) | 是 | 归属地 |
| device | VARCHAR(64) | 是 | 设备 |
| browser | VARCHAR(64) | 是 | 浏览器 |
| result | TINYINT | 否 | 1 成功 0 失败 |
| fail_reason | VARCHAR(255) | 是 | 失败原因 |
| risk_flag | TINYINT | 否 | 异常标记（异地/频繁失败） |

索引：

- `KEY idx_account_time (account, create_time)`


#### sys_error_log　异常日志

服务端异常与告警。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| level | VARCHAR(16) | 否 | ERROR/WARN |
| biz_module | VARCHAR(64) | 是 | 模块 |
| message | VARCHAR(1024) | 否 | 异常摘要 |
| stack | TEXT | 是 | 堆栈 |
| trace_id | VARCHAR(64) | 是 | 链路 ID |
| occur_time | DATETIME | 否 | 发生时间 |

索引：

- `KEY idx_level_time (level, occur_time)`


#### sys_audit_log　审计日志

高危操作与内容审核留痕（不可篡改追加写）。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| object_type | VARCHAR(64) | 否 | 对象类型：tenant/question/paper/content/role… |
| object_id | VARCHAR(64) | 是 | 对象 ID |
| object_name | VARCHAR(255) | 是 | 对象名称 |
| action | VARCHAR(64) | 否 | 动作 |
| before_json | JSON | 是 | 变更前快照 |
| after_json | JSON | 是 | 变更后快照 |
| approval_no | VARCHAR(64) | 是 | 二次审批单号 |
| audit_desc | VARCHAR(1024) | 是 | 审计说明 |
| operator_name | VARCHAR(64) | 是 | 操作人姓名 |

索引：

- `KEY idx_object (object_type, object_id)`
- `KEY idx_time (create_time)`


### 4.12 系统配置域（4 张）

#### sys_storage_policy　存储策略

对象存储与 CDN 接入策略。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| policy_key | VARCHAR(64) | 否 | 策略键 |
| policy_name | VARCHAR(64) | 否 | 策略名称 |
| provider | VARCHAR(64) | 否 | 服务商 |
| bucket | VARCHAR(128) | 是 | 存储桶 |
| region | VARCHAR(64) | 是 | 区域 |
| domain | VARCHAR(255) | 是 | CDN 加速域名 |
| max_upload_mb | INT | 否 | 单文件大小上限（MB） |
| accept_types | JSON | 是 | 允许的文件类型 |
| enabled | TINYINT | 否 | 是否启用 |
| used_gb | DECIMAL(12,2) | 是 | 已用容量 |
| quota_gb | DECIMAL(12,2) | 是 | 容量上限 |

索引：

- `UNIQUE KEY uk_policy_key (policy_key)`


#### sys_backup_record　数据备份记录

数据库与对象存储备份。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| backup_name | VARCHAR(128) | 否 | 备份名称 |
| backup_kind | VARCHAR(16) | 否 | auto 自动 / manual 手动 |
| backup_scope | VARCHAR(128) | 是 | 备份范围 |
| size_gb | DECIMAL(12,2) | 是 | 备份大小（GB） |
| status | VARCHAR(16) | 否 | running/done/failed |
| started_at | DATETIME | 否 | 开始时间 |
| finished_at | DATETIME | 是 | 结束时间 |
| restore_times | INT | 否 | 恢复演练次数 |
| file_url | VARCHAR(512) | 是 | 备份文件地址 |

索引：

- `KEY idx_time (started_at)`


#### sys_service_health　服务健康快照

监控页各服务健康与水位快照。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| service_key | VARCHAR(64) | 否 | 服务键 |
| service_name | VARCHAR(64) | 否 | 服务名称 |
| status | VARCHAR(16) | 否 | up/degraded/down |
| uptime | DECIMAL(5,2) | 是 | 近 24h 可用率（%） |
| latency_ms | INT | 是 | 平均响应（毫秒） |
| cpu_rate | DECIMAL(5,2) | 是 | CPU 使用率（%） |
| memory_rate | DECIMAL(5,2) | 是 | 内存使用率（%） |
| queue_backlog | INT | 是 | 队列积压 |
| last_alert_at | DATETIME | 是 | 最近告警时间 |
| collect_time | DATETIME | 否 | 采集时间 |

索引：

- `KEY idx_service_time (service_key, collect_time)`


#### sys_export_task　导入导出任务

批量导入导出的异步任务。

| 字段 | 类型 | 允许空 | 说明 |
|------|------|--------|------|
| id | BIGINT | 否 | 主键，雪花 ID（前端按字符串传输，避免 JS 精度丢失） |
| tenant_id | BIGINT | 否 | 租户 ID：平台级数据固定为 0，机构数据写租户 ID（全表隔离首过滤条件） |
| create_by | BIGINT | 是 | 创建人用户 ID（系统任务写系统账号 0） |
| create_time | DATETIME | 否 | 创建时间 |
| update_by | BIGINT | 是 | 最后修改人用户 ID |
| update_time | DATETIME | 否 | 最后修改时间 |
| deleted | TINYINT | 否 | 删除标识：0 正常 / 1 已删除（软删除，彻底删除由留存策略任务执行） |
| task_type | VARCHAR(16) | 否 | export 导出 / import 导入 |
| biz_module | VARCHAR(64) | 否 | 业务模块 |
| file_name | VARCHAR(255) | 是 | 文件名 |
| file_url | VARCHAR(512) | 是 | 结果文件地址 |
| total_count | INT | 是 | 总条数 |
| success_count | INT | 是 | 成功条数 |
| fail_count | INT | 是 | 失败条数 |
| fail_file_url | VARCHAR(512) | 是 | 失败明细文件 |
| status | VARCHAR(16) | 否 | waiting/running/done/failed |
| started_at | DATETIME | 是 | 开始时间 |
| finished_at | DATETIME | 是 | 结束时间 |
| params | TEXT | 是 | 任务参数 |

索引：

- `KEY idx_type_status (task_type, status)`


## 五、数据生命周期与容量估算

| 数据 | 留存策略 | 估算口径 |
|------|----------|----------|
| 题目 / 试卷 / 备课文档 | 长期保留，软删除后回收站 30 天，超期物理清理 | 单租户 10 万题目约 6GB（含富文本与快照） |
| 作答与成绩 | 保留 3 个学年，毕业班按机构策略归档 | 单场考试 1000 人 × 25 题 = 2.5 万条明细 |
| AI 调用日志 | 热存 90 天 + 冷归档 180 天，按月分区 | 日 5 万次调用约 40MB/天 |
| 操作 / 审计日志 | 保留 ≥ 180 天（合规要求），只追加不修改 | 日 20 万条约 60MB/天 |
| 文件与媒体 | 对象存储，按租户配额管控；彻底删除后 7 天内可恢复 | 单租户默认 100GB |
| 答卷/作业影像（v1.1） | 默认保留 1 个学年（按机构策略可调），到期自动清理并留痕；影像禁止进入 AI 训练集 | 单份答卷 6 页约 3MB，单校区 5000 份/年约 15GB |
| 家长端账号与分享链接（v1.1） | 账号注销后按留存策略处理；分享链接到期后仅保留元数据 90 天 | 量级较小，单租户 < 10 万条 |

> 合规声明：本设计为产品与技术参考，涉及个人信息与未成年人数据的具体存储、加密与留存周期，实施前须经公司法务与安全团队确认。