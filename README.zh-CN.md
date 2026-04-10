# ModelForge

**全栈式本地 AI 工作站 —— 集模型发现、深度对话与桌面自动化于一体。**

[English README](./README.md) | [发布检查清单](./docs/RELEASE_CHECKLIST.md)

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiwangz671-netizen/ModelForge?style=for-the-badge&color=8B5CF6" alt="最新版本" />
  <img src="https://img.shields.io/github/license/caiwangz671-netizen/ModelForge?style=for-the-badge&color=10B981" alt="开源协议" />
  <img src="https://img.shields.io/badge/macOS-M1%2FM2%2FM3-111827?style=for-the-badge&logo=apple&logoColor=white" alt="macOS 支持" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 支持" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/FastAPI-后端-059669?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI Backend" />
  <img src="https://img.shields.io/badge/Electron-桌面-1f2937?style=flat-square&logo=electron&logoColor=9feaf9" alt="Electron Desktop" />
  <img src="https://img.shields.io/badge/Ollama-本地%20AI-111827?style=flat-square" alt="Ollama Local AI" />
</p>

---

## ⚡ 不仅仅是一个 LLM 客户端

**ModelForge** 并非简单的聊天界面。它是为追求极致本地掌控感的开发者与创作者设计的 **AI 工作站**。基于 **Ollama** 构建，我们通过深度集成硬件监控、智元记忆与自动代理，弥补了原生计算算力与日常生产力流转之间的鸿沟。

### ✨ 核心高阶特性

#### 🔹 智能模型编排
- **全量目录集成**：直接在应用内浏览、发现并下载 Ollama 官方模型库，无需跳转。
- **多维度特征识别**：在获取前精准识别标签版本、存储大小及能力声明（视觉、工具调用、推理思维）。
- **显存常驻管理**：手动将核心模型固化至显存，或配置空闲策略实现自动资源回收。

#### 🔹 实时硬件感知
- **VRAM 深度监控**：实时追踪 GPU 显存与显存占用状态。
- **Apple Silicon 优化**：针对 M1/M2/M3 系列芯片的统一内存架构进行了专项适配，确保显存报告精准无误。
- **部署智能建议**：基于当前硬件 profile，自动标记最适配的计算模型规格。

#### 🔹 无缝 RAG 智元记忆
- **语义驱动检索**：采用 RAG-first 架构，无需特定关键词（如“记得”、“检索”），系统会根据对话意图自动关联长期背景。
- **智能降噪过滤**：分级关联阈值确保日常寒暄保持清爽，仅在项目相关时静默注入参考知识。
- **本地向量库**：通过内置向量引擎持久化管理海量知识片段与文档资产。

#### 🔹 桌面自动化代理 (Computer Use)
- **多模态感知**：通过视觉直连或 OCR 语义路由精准理解屏幕内容并执行跨应用操作。
- **分级审批机制**：针对敏感操作（终端命令、文件改动）提供确认机制，平衡效率与安全。
- **任务全过程溯源**：完整的任务时间线、截图轨迹与执行产出自动归档。

#### 🔹 极致交互体验
- **持久化多模态上传**：由专用存储引擎驱动的附件系统，支持图片与文档。
- **流式对话美学**：现代悬浮感 UI，深度集成 LaTeX 公式解析、Markdown 渲染与实时生成统计。
- **系统状态同步**：跨平台的全局状态管理，始终掌握后端与引擎的健康状态。

---

## 🏗️ 系统架构

ModelForge 采用高性能三层架构设计：

1.  **Frontend (前端)**：React 19 + TypeScript + Vite。极速响应，深度适配流式输出与多维状态同步。
2.  **Backend (后端)**：FastAPI + SQLite。负责模型生命周期编排、向量存储、持久化文件管理与业务逻辑。
3.  **Desktop (桌面层)**：Electron 壳。提供系统级 Hook、屏幕录制/辅助功能网桥，以及标准化的桌面安装包分发。

---

## 🚀 快速开始

### 环境依赖
- **Node.js**: 18.0+
- **Python**: 3.11+
- **Ollama**: 确保 Ollama 已安装并在运行 (默认监听: `http://localhost:11434`)

### 安装与运行

1.  **克隆并配置**:
    ```bash
    git clone https://github.com/caiwangz671-netizen/ModelForge.git
    cd ModelForge
    cp .env.example .env
    ```

2.  **启动开发环境**:
    ```bash
    chmod +x start-dev.sh
    ./start-dev.sh
    ```

3.  **构建 macOS 安装包**:
    ```bash
    ./scripts/build-desktop-mac.sh
    ```
    *生成的 DMG 文件将位于 `/release` 目录下。*

---

## 🛠️ 技术栈与鸣谢

-   **核心引擎**: [Ollama](https://ollama.ai/)
-   **UI 框架**: React 19, Tailwind CSS 4, Framer Motion
-   **后端框架**: FastAPI, SQLAlchemy, Pydantic
-   **桌面封装**: Electron, PyInstaller
-   **知识库**: 基于语义检索的 SQLite 原生向量化方案

---

## 📜 开源协议

基于 **MIT License** 协议发布。详情参见 `LICENSE` 文件。

---

<p align="center">
  专为本地智能而生。为专业生产力而造。
</p>
