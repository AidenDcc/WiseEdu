# AI 教学云平台

> 面向学校与培训机构的 SaaS 多租户 AI 教学平台。

本项目基于《AI 教学云平台（SaaS 多租户）软件需求规格说明书 V1.0》搭建，采用 pnpm workspace 管理前端应用，覆盖平台运营管理（超级管理端）与机构教学业务（机构端）两个端；后端服务位于 `Service/` 目录。

当前版本处于 **Demo / 原型阶段**：前端页面、路由、交互和 Mock 数据已搭建完成；后端已引入 JeecgBoot 3.9.5 基础框架，并落地「教学云业务接入 Wave 1」——平台端数据概览、机构端题库分类、登录会话与租户隔离建表。

前后端对接由一个**统一开关**控制：关闭时全部走 Mock（与接入后端之前完全一致），打开时只有后端**已实现**的接口走真实网关，其余接口自动回退 Mock。后端目前完成 Wave 1（登录会话、平台端概览、机构端题库分类，共 7 个接口端点），其余业务仍由 `@aiteach/shared` 的 Mock 引擎提供数据，部分菜单以“正在开发中”占位页展示。

## 项目预览

项目包含两个可独立启动和构建的前端应用，以及一个后端服务：

| 应用 | 默认端口 | 说明 |
| --- | ---: | --- |
| `apps/admin` | `5173` | 超级管理端：租户、套餐、内容运营、AI 服务配置与治理、基础字典、审计和系统配置 |
| `apps/tenant` | `5174` | 机构端：题库、试卷、备课、考试、班级学生、AI 能力中心和资源管理 |
| `Service` | `8080` | 后端服务（JeecgBoot 3.9.5 单体），context-path 为 `/jeecg-boot`；微服务模式下经网关 `9999` 访问 |

启动后访问 <http://localhost:5173/login>（超级管理端）或 <http://localhost:5174/login>（机构端）。

> 是否走后端由统一开关 `VITE_USE_MOCK` 控制，两个端共用同一份「后端已实现接口清单」（[backend-ready.ts](packages/shared/src/request/backend-ready.ts)）。开发环境当前开关为**关闭**（全部走 Mock），要连本地后端再打开，详见 [Mock 与真实后端切换](#mock-与真实后端切换)。

## 功能范围

### 超级管理端

- 平台数据概览、租户数量和到期预警。
- 租户入驻申请审核、租户详情与套餐管理。
- 全局基础字典、教材与知识树管理。
- 内容运营：公共题库与公共试卷库的审核上架、按「全部租户 / 指定套餐 / 指定租户」的内容分发授权、内容合规抽检和内容问题反馈工单。
- AI 服务配置：模型接入、多智能体编排、全局 Prompt 模板，以及 AI 安全治理（敏感词策略、输出质量评测、生成内容留痕）和 AI 计费与租户能力开关。
- 数据审计：AI 调用日志、平台资源总库、日志审计和服务健康监控。
- 系统管理：管理员账号、机构菜单权限、系统参数、消息模板和存储与备份策略。
- 平台端仅承担配置与只读审计职责，不直接操作机构业务数据；公共题库与试卷只做审核和分发，不直接下发给具体机构。

### 机构端

- 机构工作台、AI 用量和业务待办。
- 题库管理、手动录题、AI 出题、拍照识题和题目审核。
- 手动组卷、AI 组卷、双向细目表、试卷协作与审核（协作选题池默认按卷头学科过滤题源，可切换查看全部学科）。
- 备课中心、集体备课、作业系统、在线阅卷、试卷分析、错题本，以及 AI 学情画像（班级学情报告、学生知识点掌握度与个性化练习推送，不呈现公开排名）。
- 班级与学生管理：班级年级与名册、学生档案（手机号默认脱敏）、监护人知情同意（补签 / 撤回，撤回后对该生停用 AI 学情能力）。
- AI 能力中心：能力卡片直达业务页 + AI 任务中心（执行状态、耗时、token 消耗与取消），以及 AI 生成内容复核（AI 标识、质检结论、教师复核放行）。
- 教辅、媒体、公式、文件和知识广场管理；「我的文件」支持新建在线文档、多级文件夹、移动、置顶、重命名、复制到、创建副本、转为课件、批量删除与下载，并按 17 种文件类型分三组筛选。
- 校区、员工、角色、菜单、通知、机构设置和操作日志管理。
- 个人资料、回收站及相关业务入口。

### AI 能力说明

- AI 出题、拍照识题、文档识别均可接入 Deepseek（`VITE_DEEPSEEK_API_KEY` 等环境变量，详见下文配置表）；未配置 Key 时回退本地演示数据。
- 生成/识别结果支持 **AI 自动质检**：检查轮次可配置（关闭 / 1~3 轮，localStorage 持久化、AI 出题与拍照识题两处页面共享同一份设置）。每一轮由质检模型独立重新演算答案、逐小问核对答案与解析一致性、审查解析完整性与年级适配度，并产出逐题修正版；有错才继续下一轮，无错提前结束。
- 超过设定轮次仍存在 error 级异常时，页面逐题打标（异常红 / 提醒橙）并提示人工介入处理；质检 token 消耗计入本次 AI 用量。
- **AI 治理红线**：AI 生成内容默认带显著标识，须经教师复核后方可发布给学生（AI 能力中心 → AI 内容复核，error 级必须人工放行）；平台端可维护敏感词策略、发起输出质量评测并追溯生成内容留痕（traceId、模型、租户、输入摘要）。
- 机构端「AI 能力中心」汇总各 AI 任务的执行轨迹与 token 消耗，与平台端「AI 计费与能力开关」共享同一份用量数据。
- 生成与识别提示词强制要求多小问题目「题干完整含全部小问、答案逐小问给出具体结论、解析逐小问完整到最终结论」，降低半截输出入库的风险；Deepseek 返回 `finish_reason=length`（输出截断）时按失败自动重试。

### 共享层

`packages/shared` 为两个业务端提供：

- 统一请求客户端和 API 错误处理。
- Mock 路由、Mock 数据和本地状态存储（题库、组卷、备课、机构文件、班级学生、AI 能力中心、平台内容运营等）。
- 登录会话、通用格式化、Toast 和共享图标组件。
- 文件类型字典（17 种类型的中文名、图标、底色与分组）及文件大小、下载等通用处理。
- 趋势图、柱状图等轻量演示组件。

## 技术栈

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Router
- pnpm workspace monorepo

正式版规划按需求规格说明书接入 Element Plus、ECharts、KaTeX，并持续推进真实后端接入；Demo 阶段使用轻量自定义组件和 Mock 数据，以便快速演示完整业务导航与交互流程。

## 目录结构

```text
教学云AI/
├── apps/
│   ├── admin/               # 超级管理端，可独立构建部署
│   └── tenant/              # 机构端，可独立构建部署
├── packages/
│   └── shared/              # 共享请求层、Mock 引擎、会话和通用组件
├── Service/                 # 后端服务（JeecgBoot 3.9.5），直接作为 Maven 根
│   ├── pom.xml
│   ├── jeecg-boot-base-core/        # 内核：鉴权、MyBatis-Plus、工具类、AOP
│   ├── jeecg-module-system/         # 系统管理：用户、角色、权限、字典、菜单
│   ├── jeecg-boot-module/           # 业务模块：教学云 edu-platform / edu-tenant、示例与 AI/RAG
│   ├── jeecg-server-cloud/          # 可选微服务栈（仅 -P SpringCloud 构建），含 edu 微服务启动模块
│   ├── db/                          # 数据库初始化与增量脚本
│   └── docker-compose.yml           # MySQL / Redis / pgvector 本地编排
├── doc/                     # 需求规格说明书与功能大纲
├── package.json             # 根级脚本与 workspace 命令
├── pnpm-workspace.yaml      # workspace 配置
└── README.md
```

`admin` 和 `tenant` 相互独立，各自产生 `apps/*/dist` 构建产物；`@aiteach/shared` 以 workspace 源码形式被业务端引用。

## 环境要求

前端：

- Node.js `>= 18.0.0`
- pnpm 11+（根 `package.json` 的 `packageManager` 字段锁定 `pnpm@11.13.0`，建议与之一致）
- macOS、Linux 或 Windows

后端（仅在需要启动 `Service/` 时要求）：

- JDK 17 及以上（同时支持 21、24）
- Maven 3.9+
- MySQL 8.0+ 与 Redis（**均为必需**）

可使用以下命令确认版本：

```bash
node --version
pnpm --version
java -version
mvn -version
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 同时启动两个前端应用
pnpm dev
```

启动后访问：

- 超级管理端：<http://localhost:5173/login>
- 机构端：<http://localhost:5174/login>

也可以只启动一个应用：

```bash
pnpm dev:admin    # 仅启动超级管理端
pnpm dev:tenant   # 仅启动机构端
```

### 登录账号

能用的账号取决于 `VITE_USE_MOCK` 开关。开发环境**默认关闭**（全 Mock）。**登录一律需要手动输入账号与密码**，登录页不再显示任何账号密码，也没有「一键填充」。

**开关关闭（默认，全 Mock）** —— 账号清单见 `packages/shared/src/auth/accounts.ts`（只存盐 + 哈希），仅用于本地演示，请勿用于生产环境：

| 端 | 账号 | 角色 |
| --- | --- | --- |
| 超级管理端 | `admin` | 超级管理员 |
| 机构端 | `orgadmin` | 机构管理员 |
| 机构端 | `auditor` | 审核员 |
| 机构端 | `teacher` | 老师 |

密码不在仓库里（README、代码、注释都没有），由演示负责人掌握。密码比对用的是「每账号随机盐 + SHA-256」：输入密码后与配置表里的 `passwordHash` 比对，任一处都不出现明文。**改密码 / 加账号**：

```bash
pnpm hash-password --app tenant --account orgadmin   # 密码交互输入、不回显，输出可直接粘贴的配置行
```

把输出的那一行粘进 `packages/shared/src/auth/accounts.ts`；新增**机构端**账号还要在 `packages/shared/src/mock/data.ts` 的 `mockUsers` 里补一条同 `appId + account` 的用户资料（姓名 / 角色 / 机构，不含密码）。

> 前端可读的哈希不是「安全」：盐与哈希都随 bundle 发到浏览器，拿到 bundle 就能离线爆破弱口令。它保证的是仓库与界面里不出现明文；真正的密码校验必须由服务端负责。

**开关打开（`VITE_USE_MOCK=false`，走真实后端）** —— `/auth/*` 已登记在清单里，**两个端**的登录都会请求后端 `sys_user`，上面的演示账号不再有效。请使用 JeecgBoot 内置超级管理员（账号 `admin`，口令为框架默认口令，登录后请立即修改；仓库内不记录该口令）。

> 教学云初始化数据基于框架自带的租户 `1000`、`1001`（见 `V3.9.6_3__edu_initial_data.sql`），租户侧账号需在 sys_user 中自行创建并关联租户。真实后端只在前端做「30 分钟固定窗口」的本地有效期判断，服务端 token 过期以 HTTP 401 兜底。

### 会话有效期与登录拦截

- **固定 30 分钟，不滑动续期**：登录成功即写入到期时间（`aiteach:<端>:tokenExpire`），到点必重新登录，切换演示身份、翻页、发请求都不会顺延。
- 到期后有**三条独立通路**强制登出，都收敛到「清会话 + 跳登录页（带回跳地址）」：路由守卫、请求层（含真实后端 HTTP 401，403 不触发）、到期看门狗定时器。
- Mock 模式下的 token 本身不带过期信息（真实后端的 JWT 也无法被前端统一解析出过期时间），因此 localStorage 里那份到期时间是前端的唯一事实源。本功能上线前的历史会话没有该字段，会按「已过期」处理，需要重登一次。
- 到点即踢会丢失页面上未保存的编辑内容；当前不做「到期前提醒」，也不做滑动续期。

## Mock 与真实后端切换

所有业务请求统一经过 `@aiteach/shared` 的请求层，由 `resolveApiMode()` 决定请求走向。**只有一个开关 `VITE_USE_MOCK`**：

```text
请求
 └─ VITE_USE_MOCK=false（开关已打开）？
      ├─ 否 → Mock 引擎（与接入后端之前完全一致）
      └─ 是 → 该接口已在 backend-ready.ts 清单中？
                ├─ 是 → 真实后端
                └─ 否 → Mock 引擎（后端尚未实现，自动回退）
```

**「打开开关」不等于「所有请求都打后端」**：教学云后端的接口是分批落地的，只有清单里登记过的接口才走真实后端，未登记的继续由 Mock 承接 —— 这样打开开关也不会把还没有后端的页面弄坏。

### 后端已实现接口清单

清单维护在 [packages/shared/src/request/backend-ready.ts](packages/shared/src/request/backend-ready.ts)，**前缀匹配**，两个端共用同一份：

| 已登记路径 | 对应后端 |
| --- | --- |
| `/auth/login`、`/auth/me`、`/auth/logout` | `EduAuthController` |
| `/admin/dashboard/overview` | `AdminDashboardController` |
| `/tenant/categories` | `EduQuestionCategoryController`（同时覆盖其 `/save`、`/delete`） |

后端每补齐一个接口，在这个文件里登记一次即可（`/tenant/categories` 这类前缀条目会连带覆盖其子路径）。

### 环境变量

开发环境配置位于 `apps/admin/.env.development`、`apps/tenant/.env.development`；生产/联调模板为对应的 `.env.production.example`。

| 变量 | 说明 |
| --- | --- |
| `VITE_USE_MOCK` | **统一开关**。`true`（默认，含未配置）全部走 Mock；`false` 时清单内接口走真实后端，其余回退 Mock |
| `VITE_API_BASE_URL` | 真实后端 API 网关前缀，默认可使用 `/api` |
| `VITE_DEEPSEEK_API_KEY` | Deepseek Key，写入 `.env.local`（已被 `.gitignore` 排除）启用真实 AI 出题；未配置时回退本地演示数据 |
| `VITE_DEEPSEEK_BASE_URL` | Deepseek 网关地址，默认 `/deepseek`（开发环境经 `apps/tenant/vite.config.ts` 代理转发，规避 CORS）；生产环境指向自建网关 |
| `VITE_DEEPSEEK_MODEL` | 模型名，默认 `deepseek-chat` |

> AI 服务（Deepseek 出题、拍照识题、文档识别）不经过教学云后端，由 `VITE_DEEPSEEK_*` 独立控制，**不受 `VITE_USE_MOCK` 影响**。

接入后端时：

1. 启动后端并确认接口可用（单体 8080 或 微服务 + 网关 9999，见[后端服务](#后端服务service)章节）。
2. 确认 `vite.config.ts` 的 `/api` 代理 target 指向实际网关地址（开发环境已指向 `http://localhost:9999`，网关按 `/admin/**`、`/tenant/**`、`/auth/**` 转发到对应服务）。
3. 把该应用的 `VITE_USE_MOCK` 置为 `false`。清单里没登记的接口仍会走 Mock，不会因为后端还没实现而报错。
4. 请求头由请求层统一处理：鉴权用 `X-Access-Token`（JeecgBoot 约定，不是 `Authorization: Bearer`），租户上下文用 `X-Tenant-Id`。
5. 保持统一响应格式 `{ code, message, data }`，其中 `code=0` 表示成功；框架自身的鉴权/全局异常返回 `{ success, code, message, result }`。

> **安全提示：** `.env.development`、`.env.production` 等环境文件可能包含本地地址或敏感配置。不要提交真实密钥、Token、证书和生产环境配置；生产环境请通过部署平台注入环境变量。

新增 Mock 接口时，在 `packages/shared/src/mock/routes.ts` 中按 `{ method, path, handler }` 注册，并补充对应的 Mock 状态或类型。

## 后端服务（Service/）

后端位于 `Service/` 目录，采用 **JeecgBoot 3.9.5** 基础框架。既支持单体运行，也支持可选的微服务模式；教学云业务代码以独立模块形式落地，前端通过网关灰度接入。

### 教学云业务模块现状

已完成「教学云业务接入 Wave 1」，覆盖从登录鉴权到租户隔离的第一条完整链路：

| 模块 | 职责 | 已实现接口 |
| --- | --- | --- |
| `jeecg-system-biz` | 登录与会话（`EduAuthController`） | `/auth/login`、`/auth/me`、`/auth/logout` |
| `jeecg-module-edu-platform` | 平台端业务 | `/admin/dashboard`（平台数据概览：租户数、到期预警、待审申请） |
| `jeecg-module-edu-tenant` | 机构端业务 | `/tenant/categories`（题库分类的增删改查，含租户隔离样板） |

数据层由 Flyway 脚本 `V3.9.6_0` ~ `V3.9.6_3` 建立，位于 `Service/jeecg-module-system/jeecg-system-start/src/main/resources/flyway/sql/mysql/`：

- `V3.9.6_0__edu_platform_ddl.sql` — 教学云建表（`edu_package`、`edu_tenant_ext`、`edu_tenant_apply`、`edu_question_category`）。
- `V3.9.6_1__edu_gateway_routes.sql` — 网关路由：`/admin/**` → `edu-platform`，`/tenant/**` → `edu-tenant`，`/auth/**` 并入 `jeecg-system`。
- `V3.9.6_2__edu_menu_permissions.sql` — 教学云菜单与按钮权限。
- `V3.9.6_3__edu_initial_data.sql` — 初始化数据。

> **业务表约定：** 教学云业务表统一 `edu_` 前缀；机构端业务表必须带 `tenant_id`（行级隔离列，由 `TenantLineInnerInterceptor` 自动注入条件）；「引用某个租户」的外键列一律命名 `org_tenant_id`，避免被租户插件误改写。

### 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Spring Boot 4.1.0 / Java 17（同时支持 21、24），全量使用 `jakarta` 命名空间 |
| ORM | MyBatis-Plus 3.5.16 |
| 鉴权 | Apache Shiro + JWT，基于 Redis 的会话 |
| 连接池 | Druid，支持动态数据源 |
| 数据库迁移 | Flyway（脚本位于 `Service/jeecg-module-system/jeecg-system-start/src/main/resources/flyway/sql/mysql/`） |
| JSON / Excel | FastJSON 2 / AutoPoi |
| 接口文档 | Knife4j（OpenAPI v3） |
| 定时任务 | Quartz（JDBC 存储，支持集群） |
| 微服务 | Spring Cloud 2025.1.0.0 + Alibaba（Nacos、Gateway、Sentinel），可选 |

### 模块结构

```text
Service/                         # Maven 根（jeecg-boot-parent）
├── jeecg-boot-base-core         # 内核：鉴权、MyBatis-Plus 配置、工具类、AOP、基础 Controller
├── jeecg-module-system          # 系统管理
│   ├── jeecg-system-api         #   API 接口（local-api 单体直调 / cloud-api Feign）
│   ├── jeecg-system-biz         #   业务逻辑、实体、Mapper、Service
│   └── jeecg-system-start       #   启动入口（JeecgSystemApplication）与全部配置
├── jeecg-boot-module            # 业务模块
│   ├── jeecg-module-edu-platform #  教学云平台端业务（/admin/**，微服务名 edu-platform）
│   ├── jeecg-module-edu-tenant  #   教学云机构端业务（/tenant/**，微服务名 edu-tenant）
│   ├── jeecg-module-demo        #   官方示例代码（后续可直接移除）
│   └── jeecg-boot-module-airag  #   AI / RAG 集成
└── jeecg-server-cloud           # 可选微服务栈
    ├── jeecg-cloud-gateway      #   网关(9999)，教学云路由的入口
    ├── jeecg-cloud-nacos        #   Nacos(8848 / 控制台 18080)
    ├── jeecg-edu-platform-cloud-start # edu-platform 微服务启动模块(7003)
    ├── jeecg-edu-tenant-cloud-start   # edu-tenant 微服务启动模块(7004)
    └── jeecg-visual             #   监控、Sentinel、XXL-Job
```

### 本地启动

```bash
# 1. 拉起依赖服务（MySQL 映射到 13306；Redis / PostgreSQL+pgvector 默认仅在容器网络内）
cd Service && docker compose up -d

# 2. 初始化数据库：导入基础 schema（增量变更由 Flyway 负责）
#    Service/db/jeecgboot-mysql-5.7.sql

# 3. 构建
cd Service && mvn clean package

# 4. 启动单体应用
cd Service/jeecg-module-system/jeecg-system-start && mvn spring-boot:run
```

启动后服务地址为 <http://localhost:8080/jeecg-boot>，接口文档经 Knife4j 访问。默认管理账号为 `admin / 123456`（框架内置，请在正式环境立即修改）。

> 本地裸跑后端时若连不上 Redis，检查 `application-dev.yml` 中的 `spring.data.redis` 配置——`docker-compose.yml` 里的 Redis 端口默认是注释状态，需要按需放开映射。

### 微服务模式（灰度联调需要）

前端的 `/admin/**`、`/tenant/**` 由网关按服务名分发，因此**打开开关、真正连后端时前端必须连网关**，而不是单体 8080：

```bash
# 1. 构建（根 pom 的 SpringCloud profile 默认激活，会连同微服务栈一并构建）
cd Service && mvn clean package

# 2. 依次启动 Nacos → 网关 → edu 微服务（各启动模块的 application.yml 已配好端口）
cd Service/jeecg-server-cloud/jeecg-cloud-nacos            && mvn spring-boot:run  # 8848 / 控制台 18080
cd Service/jeecg-server-cloud/jeecg-cloud-gateway          && mvn spring-boot:run  # 9999
cd Service/jeecg-server-cloud/jeecg-edu-platform-cloud-start && mvn spring-boot:run # 7003
cd Service/jeecg-server-cloud/jeecg-edu-tenant-cloud-start   && mvn spring-boot:run # 7004
```

网关路由数据存放在 `sys_gateway_route` 表，由 `V3.9.6_1__edu_gateway_routes.sql` 灌入并在 `jeecg-system` 启动时写入 Redis（key `GATEWAY_ROUTES`）——**改了路由脚本需要重启 `jeecg-system` 才会生效**。

> **注意：** 根 pom 的 `SpringCloud` profile 当前为 `activeByDefault=true`，因此 `mvn package` 默认会连同 `jeecg-server-cloud` 微服务栈一并构建。若只需单体，可用 `-P !SpringCloud` 关闭。

### 前后端联调

两个应用的 `/api` 代理**已启用**并把开发环境 target 指向网关 `http://localhost:9999`，因此联调时只需确保后端在跑，再把开关打开：

1. 启动微服务模式（Nacos → 网关 → edu 微服务，见上一节）。
2. 把该应用的 `VITE_USE_MOCK` 置为 `false`；要回退到纯 Mock 就改回 `true`。
3. 登录后请求会自带 `X-Access-Token` 与 `X-Tenant-Id`，由网关按前缀转发到对应微服务。

> 走真机与否取决于**请求 URL 是否在已实现清单里**，与路由/页面无关。打开开关后，登录与会话、平台端工作台概览走真机，而租户管理、内容运营、题库等页面依旧读取 Mock 数据 —— 因为后端还没实现这些接口。

## 构建、检查与预览

```bash
# 类型检查全部 workspace
pnpm typecheck

# 构建全部应用
pnpm build

# 单独构建
pnpm build:admin
pnpm build:tenant

# 预览业务端构建产物
pnpm preview:admin
pnpm preview:tenant
```

构建产物位置：

- `apps/admin/dist`
- `apps/tenant/dist`

建议提交前至少执行：

```bash
pnpm typecheck && pnpm build
```

项目当前未配置独立的单元测试脚本；类型检查和生产构建是现阶段的基础验证方式。

## 部署说明

两个前端应用的产物相互独立，可以分别部署到不同域名或路径，使用 Nginx、对象存储静态网站托管或其他静态 Web 服务即可。

部署时请注意：

- 为 Vue Router 配置 history fallback，将未知路径回退到对应应用的 `index.html`。
- 如果使用真实 API，配置网关代理、跨域策略和生产环境变量。
- 不要将 `.env.production`、密钥和后端凭证打包进公开仓库。
- 后端部署涉及数据库连接、Redis、上传存储等配置，见 `Service/jeecg-module-system/jeecg-system-start/src/main/resources/application-{profile}.yml`（`dev` / `test` / `prod` / `docker`）与 `Service/docker-compose.yml`。
- 微服务部署还需 Nacos 配置中心与 `sys_gateway_route` 路由数据，网关端口为 `9999`。

## 当前限制与后续计划

当前限制：

- 后端教学云业务仅完成 Wave 1（登录会话、平台端概览、机构端题库分类），绝大部分业务接口尚未落地；即使打开开关，也只有已登记的这几个接口走真机，其余仍为 Mock。
- 部分导航菜单使用“正在开发中”占位页。
- 内容运营、AI 治理、班级学生和学情画像等模块同样为前端演示实现，规则与数据均来自 Mock。
- Mock 演示账号（含前端可读的盐与哈希）和前端权限模型不适合生产环境；会话有效期是**前端**强制的 30 分钟固定窗口，真实后端的过期以 HTTP 401 兜底。
- 暂未提供完整的单元测试、E2E 测试和 CI 流程。

后续计划：

1. 按 Wave 分期在 `Service/` 中继续落地教学云业务模块（Wave 2 起含全局字典 `edu_dict_item_ext` 等），每完成一批接口即在 `backend-ready.ts` 登记，逐步替换前端 Mock。
2. 按需求规格说明书接入 Element Plus、ECharts、KaTeX 等正式 UI 与渲染能力。
3. 接入真实认证、图形验证码、手机验证码、账号锁定和安全审计（密码哈希比对与会话有效期已落地，见「登录账号」与「会话有效期与登录拦截」）。
4. 完善租户隔离、RBAC 权限和按角色裁剪菜单，并把学生档案、知情同意等数据接入教务系统。
5. 将题库、试卷、教辅、AI 质量流水线、内容运营与 AI 治理等业务模块从 Demo 扩展为完整生产功能。
6. 增加单元测试、端到端测试、CI 构建和部署流水线。
7. 规划机构端移动端（uni-app），并完善后端微服务体系（服务治理、配置中心与链路监控）。

## 许可证

前端代码当前仓库尚未声明正式开源许可证。`Service/` 下的后端基于 JeecgBoot，遵循其自带的 Apache License 2.0，许可证文件见 `Service/LICENSE`。

## 相关文档

- 仓库根目录中的《AI 教学云平台（SaaS 多租户）软件需求规格说明书》用于记录产品需求和功能边界；README 以当前可运行的代码为准，实际生产能力以代码、后端接口和正式发布说明为准。
- 后端框架细节与开发约定见根目录 [CLAUDE.md](CLAUDE.md)；JeecgBoot 上游项目说明见 <https://github.com/jeecgboot/JeecgBoot>。
