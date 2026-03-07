# ModelForge 中文说明

[English README](./README.md) | [发布检查清单](./docs/RELEASE_CHECKLIST.md)

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiwangz671-netizen/ModelForge?style=for-the-badge" alt="最新版本" />
  <img src="https://img.shields.io/github/license/caiwangz671-netizen/ModelForge?style=for-the-badge" alt="许可证" />
  <img src="https://img.shields.io/badge/macOS-supported-111827?style=for-the-badge&logo=apple&logoColor=white" alt="支持 macOS" />
  <img src="https://img.shields.io/badge/Windows-supported-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="支持 Windows" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-149eca?style=for-the-badge&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/FastAPI-backend-059669?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI 后端" />
  <img src="https://img.shields.io/badge/Electron-desktop-1f2937?style=for-the-badge&logo=electron&logoColor=9feaf9" alt="Electron 桌面层" />
  <img src="https://img.shields.io/badge/Ollama-local%20AI-111827?style=for-the-badge" alt="Ollama 本地 AI" />
</p>

ModelForge 是一套围绕 Ollama 构建的本地 AI 工作台，目标不是只做一个聊天壳，而是把模型管理、下载、记忆、桌面自动化和桌面封装整合到同一套产品里。项目当前由 React 前端、FastAPI 后端和面向 macOS、Windows 的 Electron 桌面层组成。

这个目录就是独立的 `ModelForge` 仓库本体，可直接用于开发、打包和发布。

## 项目定位

ModelForge 主要解决的是本地 AI 工作流里几个经常分散的问题：

- 模型下载和切换分散在命令行里，不适合日常使用
- 本地聊天、模型管理和桌面能力通常是割裂的
- 下载状态、会话记录、桌面任务上下文容易丢失
- 桌面自动化如果只靠截图点坐标，鲁棒性非常差

这套项目的方向是把这些能力收敛到一个桌面工作台里。

## 核心能力

### 1. 模型管理

- 查看本地模型与运行状态
- 浏览官方 Ollama Library
- 按 tag 查看并下载模型版本
- 加载、卸载模型
- 设置模型常驻策略

### 2. 下载管理

- 同模型/tag 下载去重，避免重复任务
- 下载进度持久化，重启后仍能恢复展示
- 展示进度、速度、ETA、状态文案
- 对网络抖动和异常状态做重试
- 支持取消任务

### 3. 对话

- 多会话管理
- 流式输出
- 自动标题
- 会话级模型切换
- 联网搜索辅助回答
- 将内容写入记忆

### 4. 记忆

- 手动创建记忆
- 导入文件内容
- 搜索、编辑、删除
- 检查嵌入配置和启用状态

### 5. Computer Use

这是当前最重要、也最复杂的部分。它已经不是最早那种只展示截图、每一步都强依赖人工点击的 demo 逻辑。

现在的 `Computer Use` 具备这些能力：

- 任务会话历史
- 父任务上下文继承，类似对话的连续上下文
- 连续执行模式与审批模式
- 审批拒绝后的可恢复执行，而不是直接整轮失败
- 截图观察 + 桌面动作
- 受控浏览器能力，优先走元素级交互，而不是盲点屏幕
- 登录、验证码、支付等敏感场景的用户接管与恢复
- 暂停、继续、取消、清空历史

### 6. 桌面封装

- 一键生成 `ModelForge.app`
- 一键生成 macOS DMG
- 一键生成 Windows 桌面包
- 将前端、后端和 Electron 桌面层打成一个可分发产物

## 架构说明

项目分为三层：

### 前端 `frontend/`

使用 React 19、TypeScript、Vite、Tailwind CSS、Zustand、i18next，负责：

- 模型页
- 对话页
- 下载页
- 记忆页
- `Computer Use` 页面
- 设置页

### 后端 `backend/`

使用 FastAPI、SQLite、httpx、uvicorn，负责：

- REST API
- 会话、下载、记忆数据持久化
- 模型管理与 Ollama 通信
- `Computer Use` 编排逻辑
- Web 搜索服务

### 桌面层 `desktop/`

使用 Electron，负责：

- 托管前端页面
- 启动后端二进制
- 桌面桥接
- 截图与坐标操作
- 受控浏览器窗口
- 非遮挡状态 HUD

## 目录结构

```text
project-root/
├── backend/                # FastAPI 后端、数据库、服务编排
├── desktop/                # Electron 主进程、preload、桌面桥接
├── frontend/               # React 前端
├── scripts/                # 构建与打包脚本
├── docs/                   # 发布和项目文档
├── data/                   # 本地运行数据
├── logs/                   # 开发日志
├── docker-compose.yml
├── start-dev.sh
├── .env.example
├── README.md               # 英文说明
└── README.zh-CN.md         # 中文说明
```

## 环境要求

- macOS 或 Windows
- Node.js 18+
- Python 3.11+
- Ollama 已安装，并且默认地址可访问：`http://localhost:11434`

## 配置说明

建议先复制环境文件：

```bash
cp .env.example .env
```

常用后端配置项：

```env
OLLAMA_HOST=http://localhost:11434
DATABASE_URL=sqlite+aiosqlite:///./ollama_studio.db
DEBUG=true
MEMORY_ENABLED=true
MEMORY_EMBEDDING_MODEL=
MAX_OUTPUT_TOKENS=8192
MAX_CONTEXT_TOKENS=8192
AUTO_UNLOAD_AFTER_RESPONSE=true
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
MODELFORGE_COMPUTER_USE_MAX_TOOL_ROUNDS=48
```

前端常用配置：

```env
VITE_API_URL=http://localhost:8000/api
VITE_DESKTOP=false
```

## 本地开发

### 一键启动

```bash
cd /path/to/project-root
chmod +x start-dev.sh
./start-dev.sh
```

默认行为：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`
- 健康检查：`http://localhost:8000/api/health`
- OpenAPI：`http://localhost:8000/docs`
- 开发日志：`logs/backend.log` 与 `logs/frontend.log`

常用参数：

```bash
./start-dev.sh --no-install
./start-dev.sh --backend-only
./start-dev.sh --frontend-only
./start-dev.sh --skip-ollama
```

### 手动启动

后端：

```bash
cd /path/to/project-root/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
cd /path/to/project-root/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

## Computer Use 详细说明

`Computer Use` 现在是整套项目里最需要稳定性的模块，因此有几个关键点需要明确：

### 1. 不再只靠截图点坐标

当前能力已经分成两层：

- 受控浏览器层
  用于网页中的导航、点击、输入、滚动、读取元素状态
- 桌面动作层
  用于桌面、Finder、系统窗口、非 DOM 目标的操作

也就是说，像“去京东搜索并比较商品”这种网页任务，优先走浏览器元素级交互；只有脱离浏览器控制范围时，才回退到桌面级动作。

### 2. 支持任务历史与上下文继承

`Computer Use` 不是每次都像新对话一样完全失忆。当前实现支持：

- 任务历史列表
- 新任务继承父任务上下文
- 运行状态、模型输出、动作时间线持久化

### 3. 支持用户接管

当模型识别到这些场景时，会主动请求用户接手：

- 登录
- 验证码
- 支付
- 结算
- 其他高风险确认场景

你完成这些动作后，可以继续让任务往下跑，而不是整轮报废。

### 4. 支持审批与恢复

如果一个审批被拒绝，不会默认整轮失败。系统会尽量把它标记为可恢复错误，让模型选择下一种策略继续执行。

### 5. 平台差异

两边平台现在走的是同一套任务编排，但桌面执行驱动不同：

- macOS
  需要屏幕录制和辅助功能权限，桌面动作通过系统事件和原生 API 执行。
- Windows
  通过 PowerShell + Win32 API 执行桌面输入，不需要额外的授权弹窗流程。
- 两边共用
  截图、OCR、受控浏览器、任务历史、审批、用户接管、恢复执行。

### 6. macOS 权限要求

首次使用通常需要授予：

- 屏幕录制权限
- 辅助功能权限

如果权限缺失，前端会提示并引导进入系统设置。

## API 概览

主要接口分组如下：

- `/api/models`
- `/api/downloads`
- `/api/chat`
- `/api/computer-use`
- `/api/memory`
- `/api/system`

常用接口举例：

- `GET /api/models/library`
- `POST /api/downloads/`
- `POST /api/chat/completions`
- `POST /api/computer-use/sessions`
- `POST /api/computer-use/sessions/{session_id}/run`
- `POST /api/computer-use/sessions/{session_id}/approve`
- `POST /api/computer-use/sessions/{session_id}/resume`
- `GET /api/memory/status`
- `GET /api/system/health`

完整接口说明请直接查看：

- `http://localhost:8000/docs`

## 数据、缓存与产物

默认本地数据和构建目录：

- 数据库：`backend/ollama_studio.db`
- 前端构建：`frontend/dist/`
- 后端打包：`backend/dist/`
- 桌面发布产物：`release/`
- 开发日志：`logs/`

清理旧缓存和构建产物：

```bash
rm -rf release frontend/dist backend/build backend/dist
find backend -type d -name "__pycache__" -prune -exec rm -rf {} +
```

如果你想回到“没有任何本地状态”的干净状态：

```bash
rm -f backend/ollama_studio.db
```

这会清空：

- 对话历史
- 下载任务状态
- 记忆数据
- `Computer Use` 会话记录

桌面打包版不会把可写状态留在应用安装目录里：

- Electron 会把用户级状态目录传给后端
- SQLite 数据、持久化设置、`Computer Use` 产物和官方库缓存都会写入这个用户目录
- 这样应用安装到 macOS 的 `/Applications` 或 Windows 的 `Program Files` 后，也不会因为目录只读而导致运行期写入失败

## 桌面打包

### macOS

使用一键脚本：

```bash
cd /path/to/project-root
chmod +x scripts/build-desktop-mac.sh
./scripts/build-desktop-mac.sh
```

脚本会依次执行：

1. 清理旧构建与旧日志
2. 构建前端 `frontend/dist`
3. 使用 PyInstaller 生成 `backend/dist/backend-api`
4. 组装 Electron 应用
5. 生成 `release/ModelForge.app`
6. 生成 DMG 文件

### Windows

请在 Windows 机器上运行 PowerShell 脚本：

```powershell
cd C:\path\to\project-root
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop-win.ps1
```

脚本会依次执行：

1. 清理旧构建与旧日志
2. 构建前端 `frontend/dist`
3. 使用 PyInstaller 生成 `backend-api.exe`
4. 准备桌面打包所需的前端与后端产物
5. 生成未压缩的 Windows 桌面程序目录
6. 生成可分发的 Windows `exe` 产物

预期的 Windows 产物包括：

- `release/win-unpacked/`
- `release/ModelForge-<version>-x64-portable.exe`
- `release/ModelForge-<version>-x64-nsis.exe`

如果要在 Windows 本地开发，可直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev-win.ps1
```

常用环境变量：

```bash
SKIP_DEP_INSTALL=true
BACKEND_PORT=18000
APP_BUNDLE_ID=io.modelforge.desktop
ELECTRON_DOWNLOAD_URL=https://cdn.npmmirror.com/binaries/electron/...
```

Windows 脚本常用参数：

```powershell
.\scripts\build-desktop-win.ps1 -ElectronArch x64
.\scripts\build-desktop-win.ps1 -SkipDepInstall
.\scripts\build-desktop-win.ps1 -BackendPort 18000
```

如果当前 shell 带有 `ELECTRON_RUN_AS_NODE=1`，Electron 会以 Node 模式运行，应用无法正常打开。此时请这样启动：

```bash
env -u ELECTRON_RUN_AS_NODE open /absolute/path/to/ModelForge.app
```

## 发布前建议

在正式发布前，建议至少做这些检查：

1. 前端 `npm run build`
2. 后端语法检查或最小启动检查
3. 每个目标系统的桌面打包脚本完整跑通
4. 聊天、下载、`Computer Use`、受控浏览器和桌面输入做一轮 smoke test
5. 确认 `.env`、数据库、日志、`node_modules`、`venv` 没有进 Git

仓库里已经补了一份明确的发布检查清单，见 [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md)。

## 许可证

MIT
