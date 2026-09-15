# AI 教学云平台

> 面向学校与培训机构的 SaaS 多租户 AI 教学平台前端 Demo。

本项目基于《AI 教学云平台（SaaS 多租户）软件需求规格说明书 V1.0》搭建，采用 pnpm workspace 管理多个独立前端应用，覆盖平台运营管理、机构教学业务和演示入口。

当前版本处于 **Demo / 原型阶段**：前端页面、路由、交互和 Mock 数据已搭建完成；后端服务尚未接入，默认 API 请求由共享 Mock 引擎处理，部分菜单仍以“正在开发中”占位页展示。

## 项目预览

项目包含三个可独立启动和构建的应用：

| 应用 | 默认端口 | 说明 |
| --- | ---: | --- |
| `portal` | `5172` | 演示总入口，可跳转至超级管理端和机构端 |
| `admin` | `5173` | 超级管理端：租户、套餐、AI 模型、智能体、基础字典和审计 |
| `tenant` | `5174` | 机构端：题库、试卷、教辅、AI 出题、组织和资源管理 |

启动后访问 <http://localhost:5172>，在演示入口选择要查看的端。

## 功能范围

### 演示总入口

- 统一展示项目定位和两个业务端入口。
- 提供超级管理端、机构端的本地跳转。

### 超级管理端

- 平台数据概览、租户数量和到期预警。
- 租户入驻申请审核、租户详情与套餐管理。
- 全局基础字典、教材与知识树管理。
- AI 模型、提示词和智能体配置入口。
- 平台资源、AI 调用日志和审计日志查看。
- 平台端仅承担配置与只读审计职责，不直接操作机构业务数据。

### 机构端

- 机构工作台、AI 用量和业务待办。
- 题库管理、手动录题、AI 出题、拍照识题和题目审核。
- 手动组卷、AI 组卷、双向细目表、试卷协作与审核。
- 教辅、媒体、公式、文件和知识广场管理。
- 校区、员工、角色、菜单、通知和操作日志管理。
- 个人资料、回收站及相关业务入口。

### 共享层

`packages/shared` 为两个业务端提供：

- 统一请求客户端和 API 错误处理。
- Mock 路由、Mock 数据和本地状态存储。
- 登录会话、通用格式化、Toast 和共享图标组件。
- 趋势图、柱状图等轻量演示组件。

## 技术栈

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Router
- pnpm workspace monorepo

正式版规划按需求规格说明书接入 Element Plus、ECharts、KaTeX 以及真实后端服务；Demo 阶段使用轻量自定义组件和 Mock 数据，以便快速演示完整业务导航与交互流程。

## 目录结构

```text
教学云AI/
├── apps/
│   ├── portal/              # 演示总入口，静态页，可独立部署
│   ├── admin/               # 超级管理端，可独立构建部署
│   └── tenant/              # 机构端，可独立构建部署
├── packages/
│   └── shared/              # 共享请求层、Mock 引擎、会话和通用组件
├── package.json             # 根级脚本与 workspace 命令
├── pnpm-workspace.yaml      # workspace 配置
└── README.md
```

`admin` 和 `tenant` 相互独立，各自产生 `apps/*/dist` 构建产物；`@aiteach/shared` 以 workspace 源码形式被业务端引用。

## 环境要求

- Node.js `>= 18.0.0`
- pnpm 8+（推荐使用当前稳定版）
- macOS、Linux 或 Windows

可使用以下命令确认版本：

```bash
node --version
pnpm --version
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 同时启动三个前端应用
pnpm dev
```

启动后访问：

- 演示入口：<http://localhost:5172>
- 超级管理端：<http://localhost:5173/login>
- 机构端：<http://localhost:5174/login>

也可以只启动一个应用：

```bash
pnpm dev:portal   # 仅启动演示入口
pnpm dev:admin    # 仅启动超级管理端
pnpm dev:tenant   # 仅启动机构端
```

### Demo 账号

当前账号由 Mock 数据提供，仅用于本地演示，请勿用于生产环境：

| 端 | 账号 | 密码 | 角色 |
| --- | --- | --- | --- |
| 超级管理端 | `admin` | `admin123` | 超级管理员 |
| 机构端 | `orgadmin` | `org123456` | 机构管理员 |
| 机构端 | `auditor` | `aud123456` | 审核员 |
| 机构端 | `teacher` | `tea123456` | 老师 |

登录页提供“一键填充”功能。部分角色权限和业务模块仍处于 Demo 展示阶段。

## Mock 与真实后端切换

所有业务请求统一经过 `@aiteach/shared` 的请求层，由 `resolveApiMode()` 决定请求走向：

```text
请求
 └─ VITE_REMOTE_SERVICES 命中服务前缀？── 是 → 真实后端
                                      └─ 否
 └─ VITE_USE_MOCK=false？────────────── 是 → 真实后端
                                      └─ 否 → Mock 引擎
```

开发环境配置位于：

- `apps/admin/.env.development`
- `apps/tenant/.env.development`

生产/联调配置模板位于：

- `apps/admin/.env.production.example`
- `apps/tenant/.env.production.example`

主要变量如下：

| 变量 | 说明 |
| --- | --- |
| `VITE_USE_MOCK` | `true` 时默认使用 Mock；`false` 时全部请求走真实后端 |
| `VITE_API_BASE_URL` | 真实后端 API 网关前缀，默认可使用 `/api` |
| `VITE_REMOTE_SERVICES` | 逗号分隔的服务前缀；用于在 Mock 模式下按服务灰度接入真实后端 |
| `VITE_PORTAL_URL` | 业务端返回演示入口时使用的地址，默认 `http://localhost:5172` |

接入后端时：

1. 复制对应的 `.env.production.example` 为 `.env.production`，按部署环境修改配置。
2. 在对应的 `vite.config.ts` 中配置开发代理，指向后端网关。
3. 选择全量切换（`VITE_USE_MOCK=false`）或按服务切换（配置 `VITE_REMOTE_SERVICES`）。
4. 保持统一响应格式 `{ code, message, data }`，其中 `code=0` 表示成功。

> **安全提示：** `.env.development`、`.env.production` 等环境文件可能包含本地地址或敏感配置。不要提交真实密钥、Token、证书和生产环境配置；生产环境请通过部署平台注入环境变量。

新增 Mock 接口时，在 `packages/shared/src/mock/routes.ts` 中按 `{ method, path, handler }` 注册，并补充对应的 Mock 状态或类型。

## 构建、检查与预览

```bash
# 类型检查全部 workspace
pnpm typecheck

# 构建全部应用
pnpm build

# 单独构建
pnpm build:portal
pnpm build:admin
pnpm build:tenant

# 预览业务端构建产物
pnpm preview:admin
pnpm preview:tenant
```

构建产物位置：

- `apps/portal/dist`
- `apps/admin/dist`
- `apps/tenant/dist`

建议提交前至少执行：

```bash
pnpm typecheck && pnpm build
```

项目当前未配置独立的单元测试脚本；类型检查和生产构建是现阶段的基础验证方式。

## 部署说明

三个应用的产物相互独立，可以分别部署到不同域名或路径，使用 Nginx、对象存储静态网站托管或其他静态 Web 服务即可。

部署时请注意：

- 为 Vue Router 配置 history fallback，将未知路径回退到对应应用的 `index.html`。
- 确保业务端中的 `VITE_PORTAL_URL` 指向实际的演示入口地址，或根据部署方式调整跳转逻辑。
- 如果使用真实 API，配置网关代理、跨域策略和生产环境变量。
- 不要将 `.env.production`、密钥和后端凭证打包进公开仓库。

## 当前限制与后续计划

当前限制：

- 后端服务尚未接入，业务数据和登录均为 Mock。
- 部分导航菜单使用“正在开发中”占位页。
- Demo 账号和前端权限模型不适合生产环境。
- 暂未提供完整的单元测试、E2E 测试和 CI 流程。

后续计划：

1. 按需求规格说明书接入 Element Plus、ECharts、KaTeX 等正式 UI 与渲染能力。
2. 接入真实认证、图形验证码、手机验证码、账号锁定和安全审计。
3. 完善租户隔离、RBAC 权限和按角色裁剪菜单。
4. 将题库、试卷、教辅、AI 质量流水线等业务模块从 Demo 扩展为完整生产功能。
5. 增加单元测试、端到端测试、CI 构建和部署流水线。
6. 规划机构端移动端（uni-app）与后端微服务体系。

## 许可证

当前仓库尚未声明正式开源许可证。若用于公开分发，请在发布前补充许可证文件和版权信息。

## 相关文档

仓库根目录中的《AI 教学云平台（SaaS 多租户）软件需求规格说明书》用于记录产品需求和功能边界；README 以当前可运行的前端 Demo 为准，实际生产能力以代码、后端接口和正式发布说明为准。
