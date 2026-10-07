# CLAUDE.md

> You should always answer questions in Simplified Chinese first, unless the user explicitly requests another language.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库总览

「AI 教学云平台（SaaS 多租户）」是一个前后端同仓的项目：

```text
教学云AI/
├── apps/               # 前端（pnpm workspace）
│   ├── admin/          #   超级管理端，Vite + Vue 3，端口 5173
│   └── tenant/         #   机构端，Vite + Vue 3，端口 5174
├── packages/shared/    # 前端共享层：@aiteach/shared
├── Service/            # 后端（JeecgBoot 3.9.5），Maven 根目录
└── doc/                # 需求规格说明书与功能大纲
```

前端当前处于 **Demo / 原型阶段**，业务数据默认由 `@aiteach/shared` 的 Mock 引擎提供。后端为 JeecgBoot 3.9.5 基础框架，已落地「教学云业务接入 Wave 1」（登录会话、平台端概览、机构端题库分类、租户隔离建表）。

前端正按服务灰度接入真实后端：超级管理端 `VITE_REMOTE_SERVICES=auth,admin`（登录会话与平台端业务走真机），机构端仍为纯 Mock。灰度按请求 URL 前缀生效，与页面无关。

---

## 前端

### 常用命令

```bash
pnpm install        # 安装全部 workspace 依赖
pnpm dev            # 并行启动 admin(5173) 与 tenant(5174)
pnpm dev:admin      # 仅启动超级管理端
pnpm dev:tenant     # 仅启动机构端
pnpm typecheck      # 全 workspace 类型检查
pnpm build          # 构建全部应用，产物在 apps/*/dist
```

项目未配置单元测试脚本，`pnpm typecheck && pnpm build` 是现阶段的基础验证方式。

### 结构约定

- 两个应用各自独立：独立的路由（`src/router`）、菜单（`src/menu.ts`）、Pinia store（`src/stores`）、布局（`src/layouts`）与视图（`src/views`）。
- 跨端复用一律下沉到 `packages/shared`（`@aiteach/shared`），以 workspace 源码形式被引用，不经过构建产物。其中包含统一请求层、Mock 引擎与数据、会话、文件类型字典、通用格式化，以及 `src/components/ui/` 下的浮层与表单类共享组件（`AppModal`、`AppDrawer`、`AppConfirm` 等）。
- 业务端的浮层与确认框**必须**使用 `packages/shared` 的共享组件（如统一走 `appConfirm`），不要各自实现。

### Mock 与真实后端切换

所有业务请求统一经过 `@aiteach/shared` 的请求层，由 `resolveApiMode()` 决定走向：

```text
请求
 └─ VITE_REMOTE_SERVICES 命中服务前缀？── 是 → 真实后端
                                      └─ 否
 └─ VITE_USE_MOCK=false？────────────── 是 → 真实后端
                                      └─ 否 → Mock 引擎
```

- 环境变量见 `apps/admin/.env.development`、`apps/tenant/.env.development`。
- 新增 Mock 接口在 `packages/shared/src/mock/routes.ts` 按 `{ method, path, handler }` 注册。
- 接入真实后端的统一响应格式为 `{ code, message, data }`，`code=0` 表示成功；框架自身的鉴权/全局异常返回 `{ success, code, message, result }`，请求层两种都认。
- 请求头：鉴权用 `X-Access-Token`（JeecgBoot 约定，**不是** `Authorization: Bearer`），租户上下文用 `X-Tenant-Id`。
- **当前灰度：** `apps/admin` 为 `auth,admin`（登录会话与平台端业务走真机），`apps/tenant` 为空（纯 Mock）。灰度按请求 URL 前缀生效，与页面/路由无关；`VITE_USE_MOCK` 保持 `true` 以便未列入前缀的请求继续走 Mock。
- 两个应用的 `vite.config.ts` 中 `/api` 代理已启用，开发环境 target 指向网关 `http://localhost:9999`（不是单体 8080）。

---

## 后端（Service/）

**Service/ 直接作为 Maven 根目录**，`Service/pom.xml` 即 jeecg-boot-parent。JeecgBoot 3.9.5 基于 **Spring Boot 4.1.0**、**Java 17**（亦支持 21、24），默认单体运行，可选 Spring Cloud 微服务模式；全量使用 `jakarta` 命名空间（不是 `javax`）。

### 构建与运行

```bash
# 全量构建（surefire 配置默认跳过测试）
cd Service && mvn clean package

# 含测试构建
cd Service && mvn clean package -DskipTests=false

# 启动单体应用（端口 8080，context-path: /jeecg-boot）
cd Service/jeecg-module-system/jeecg-system-start && mvn spring-boot:run

# 单独构建某模块（连同其依赖）
cd Service && mvn clean package -pl jeecg-boot-base-core -am

# 运行单个测试类
cd Service && mvn test -DskipTests=false -pl <module> -Dtest=<TestClassName>
```

> **注意：** 根 pom 中 `SpringCloud` profile 的 `activeByDefault=true`，因此 `mvn package` **默认会连同 `jeecg-server-cloud` 微服务栈一起构建**。只需单体时用 `-P !SpringCloud` 关闭。

### 模块结构

```text
Service/                                    # jeecg-boot-parent（根 pom）
├── jeecg-boot-base-core                    # 内核：Shiro/JWT 鉴权、MyBatis-Plus 配置、
│                                           #   通用工具类、AOP 切面、基础 Controller
├── jeecg-module-system                     # 系统管理（用户、角色、权限、字典、菜单）
│   ├── jeecg-system-api                    # API 接口，单体/微服务切换点
│   │   ├── jeecg-system-local-api          #   直接方法调用（单体）
│   │   └── jeecg-system-cloud-api          #   Feign 客户端（微服务）
│   ├── jeecg-system-biz                    # 业务逻辑、实体、Mapper、Service
│   └── jeecg-system-start                  # 启动入口 JeecgSystemApplication 与全部配置
├── jeecg-boot-module                       # 业务模块
│   ├── jeecg-module-edu-platform           # 教学云平台端业务（/admin/**，服务名 edu-platform）
│   ├── jeecg-module-edu-tenant             # 教学云机构端业务（/tenant/**，服务名 edu-tenant）
│   ├── jeecg-module-demo                   # 官方示例代码
│   └── jeecg-boot-module-airag             # AI / RAG 集成
└── jeecg-server-cloud                      # 可选微服务栈（仅 -P SpringCloud 构建）
    ├── jeecg-cloud-gateway                 #   网关，端口 9999
    ├── jeecg-cloud-nacos                   #   Nacos，端口 8848 / 控制台 18080
    ├── jeecg-system-cloud-start            #   系统微服务启动模块
    ├── jeecg-edu-platform-cloud-start      #   edu-platform 启动模块，端口 7003
    ├── jeecg-edu-tenant-cloud-start        #   edu-tenant 启动模块，端口 7004
    ├── jeecg-demo-cloud-start              #   示例微服务启动模块
    └── jeecg-visual                        #   监控 9111、Sentinel 9000、XXL-Job 9080、测试模块
```

**教学云业务现状（Wave 1）：** 登录会话 `EduAuthController`（`jeecg-system-biz`，`/auth/login|me|logout`）、平台端 `/admin/dashboard`、机构端 `/tenant/categories`。建表与网关路由由 Flyway `V3.9.6_0` ~ `V3.9.6_3` 落地。

> 需求文档或上游资料中提到的 `jeecg-boot-platform`、`jeecg-boot-module-online`、`-bigscreen`、`-desform`、`-drag`、`-lowapp`、`-bpm-flowable`、`-mindesflow-flowable`、`-easyoa`、`-joa-flowable`、`-pay`、`-wps`、`-airag-flow` **在本仓库中不存在源码目录**——这些能力以外部发布的 jar（如 `org.jeecgframework.boot3:jeecg-online`）形式引入，不要去找对应的源码模块。

### 技术栈

| 层 | 技术 |
|-------|-----------|
| ORM | MyBatis-Plus 3.5.16（`BaseMapper<T>`、`ServiceImpl<M,T>`） |
| Auth | Apache Shiro 3.0.0 + JWT 4.5.0，Session 存 Redis |
| 连接池 | Druid 1.2.28，支持动态数据源 |
| 数据库迁移 | Flyway（脚本位于 `Service/jeecg-module-system/jeecg-system-start/src/main/resources/flyway/sql/mysql/`） |
| JSON | FastJSON 2 |
| Excel | AutoPoi（`autopoi-spring-boot-3-starter`） |
| 接口文档 | Knife4j 4.5.0（OpenAPI v3，`@Schema` 注解） |
| 定时任务 | Quartz（JDBC 存储，集群） |
| 文件存储 | MinIO / 阿里云 OSS / 七牛（由 `jeecg.uploadType` 配置控制） |
| 微服务 | Spring Cloud 2025.1.0.0 + Alibaba（Nacos、Gateway、Sentinel） |

### 代码约定

**包结构：** `org.jeecg.modules.<module-name>.{controller,entity,mapper,mapper.xml,service,service.impl,vo}`

**命名约定：**
- 实体：系统实体用 `Sys` 前缀（如 `SysUser`、`SysRole`）。使用 `@TableName`、`@TableId(type = IdType.ASSIGN_ID)`
- Controller：`<Entity>Controller extends JeecgController<Entity, IService>`，基类提供标准 CRUD 与 Excel 导入导出
- Service：接口 `I<Entity>Service extends IService<Entity>`，实现 `<Entity>ServiceImpl extends ServiceImpl<Mapper, Entity>`
- Mapper：`<Entity>Mapper extends BaseMapper<Entity>`，XML 放在 `mapper/xml/` 下

**实体常用注解：** `@Data`、`@EqualsAndHashCode(callSuper = false)`、`@Accessors(chain = true)`、`@TableName`

**统一响应包装：** `Result<T>`（`org.jeecg.common.api.vo.Result`）——用 `Result.OK(data)`、`Result.OK(msg, data)`、`Result.error(msg)`。`result` 字段承载数据，`success`/`code`/`message` 承载状态。

**自动查询构建：** `QueryGenerator.initQueryWrapper(entity, request.getParameterMap())` 依据 HTTP 请求参数自动构建 `QueryWrapper`，支持模糊匹配、区间查询等。

**单体 ↔ 微服务切换：** `jeecg-system-api` 下有两套同包同名的实现（`local-api` 直调、`cloud-api` Feign）。切换靠改启动模块的依赖，不改业务代码。

**组件扫描：** 启动类 `JeecgSystemApplication` 位于 `org.jeecg` 包，靠 `@SpringBootApplication` 隐式扫描 `org.jeecg.**`，没有显式 `@ComponentScan`；Mapper 扫描在 `jeecg-boot-base-core` 的 `MybatisPlusSaasConfig` 中声明为 `@MapperScan("org.jeecg.**.mapper*")`。新增模块只要类在 `org.jeecg` 下即可被发现。

> **已知的拆分包：** `org.jeecg.modules.airag` 同时存在于 `jeecg-system-biz`（仅 `JeecgBizToolsProvider.java`）与 `jeecg-boot-module-airag`（105 个类）两个 Maven 模块。依赖方向是 `jeecg-system-biz → jeecg-boot-module-airag`，因此**不能**把前者搬进后者（会形成循环依赖）。

### 数据库

**支持：** MySQL 8.0+（默认）、PostgreSQL、Oracle 11g+、SQL Server 2017+、MariaDB、DM8（达梦）、KingBase ES。各数据库配置见 `application-{dbtype}.yml`。

**初始化：** 导入 `Service/db/jeecgboot-mysql-5.7.sql` 建基础 schema；后续增量由 Flyway 负责（脚本按日期目录组织，如 `202512/`）。

**Flyway 注意：** dev 模式下 `spring.main.lazy-initialization=true` 用于加快启动，会干扰 Flyway 自动配置，因此 Flyway 自动配置被显式排除、单独管理。

**教学云业务表约定（新增业务表必须遵守）：**
- 业务表统一 `edu_` 前缀，避免与框架 `sys_` 表及上游外部 jar 重名。
- 机构端业务表必须带 `tenant_id int NOT NULL DEFAULT 0` 并建索引——这是 `TenantLineInnerInterceptor` 的行级隔离列；`DEFAULT 0` 不可省（平台侧写入值就是 0，`NULL` 会让 `tenant_id = 0` 查不到）。
- 「引用某个租户」的外键列一律命名 `org_tenant_id`，**绝不能叫 `tenant_id`**——`MybatisInterceptor` 会把字段名恰为 `tenantId` 且值为 null 的字段静默改写成当前登录租户。
- 平台侧全局共享表（如 `edu_package`、`edu_tenant_ext`、`edu_tenant_apply`）不登记进 `TENANT_TABLE`，不做行级隔离。
- 主键 `id varchar(36)` 存雪花串，与 `JeecgEntity` 的 `IdType.ASSIGN_ID` 一致。

### 配置

主配置文件位于 `Service/jeecg-module-system/jeecg-system-start/src/main/resources/`：

- `application.yml` — profile 选择器（active profile 由 Maven 注入：dev/test/prod/docker）
- `application-dev.yml` — 开发配置（端口 8080，开启 lazy-init）

开发环境**必需** MySQL 与 Redis；MongoDB、RabbitMQ 可选。

`jeecg.*` 是控制平台特性的核心配置命名空间（上传方式、防火墙、AI 配置、MinIO、shiro 放行清单等）。

### Docker 依赖服务

`Service/docker-compose.yml` 提供 MySQL（端口 13306）、Redis、PostgreSQL+pgvector、MongoDB，以及应用容器（端口 8080）。

### Online 低代码能力

Online 能力采用**元数据驱动**架构，通过数据库配置表（`onl_cgform_*`）实现运行时 CRUD，无需生成代码。注意：本仓库**没有 Online 的源码模块**，该能力由外部 jar `org.jeecgframework.boot3:jeecg-online` 提供，配置存在数据库中而非文件系统，Claude Code 无法直接读取具体表单配置，需用户提供 JSON 导出或截图。

---

## 仓库级约定

- **`Service/` 是 Maven 根目录**，所有 Maven 命令都在 `Service/` 下执行。
- 根 `.gitignore` 已包含后端构建产物规则（`**/target`、`**/logs`、`*.iml` 等），后端目录内不再单独放置 ignore 文件。
- 根 `.claudeignore` 中的路径型规则一律带 `Service/` 前缀限定作用域——**不要**写成裸 `doc/`，否则会隐藏仓库根自己的 `doc/` 需求文档目录。
- `Service/LICENSE` 是 JeecgBoot 的 Apache License 2.0，随后端代码保留在 `Service/` 下。
