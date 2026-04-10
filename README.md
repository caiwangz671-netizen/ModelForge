# ModelForge

**The Unified Local AI Workstation — Explore, Chat, and Automate with Desktop Intelligence.**

[中文文档](./README.zh-CN.md) | [Release Checklist](./docs/RELEASE_CHECKLIST.md)

<p align="center">
  <img src="https://img.shields.io/github/v/release/caiwangz671-netizen/ModelForge?style=for-the-badge&color=8B5CF6" alt="Latest Release" />
  <img src="https://img.shields.io/github/license/caiwangz671-netizen/ModelForge?style=for-the-badge&color=10B981" alt="License" />
  <img src="https://img.shields.io/badge/macOS-M1%2FM2%2FM3-111827?style=for-the-badge&logo=apple&logoColor=white" alt="macOS Supported" />
  <img src="https://img.shields.io/badge/Windows-10%2F11-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Supported" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06b6d4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/FastAPI-backend-059669?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI Backend" />
  <img src="https://img.shields.io/badge/Electron-desktop-1f2937?style=flat-square&logo=electron&logoColor=9feaf9" alt="Electron Desktop" />
  <img src="https://img.shields.io/badge/Ollama-local%20AI-111827?style=flat-square" alt="Ollama Local AI" />
</p>

---

## ⚡ Beyond a LLM Client

**ModelForge** is not just another chat interface. It is a desktop-native AI workstation designed for those who demand high-fidelity control over their local LLM environment. Built on top of **Ollama**, it bridges the gap between raw compute and everyday productivity.

### ✨ Key High-Fidelity Features

#### 🔹 Intelligent Multi-Model Orchestration
- **Official Library Integration**: Browse, discover, and download models directly from the Ollama catalog without leaving the app.
- **Smart Versioning**: Inspect tags, sizes, and capabilities (Vision, Tools, Reasoning) before pulling.
- **Residency Control**: Manually pin models to VRAM or let the system manage auto-unloading based on idle timeouts.

#### 🔹 Hardware-Aware Telemetry
- **Real-time VRAM Monitoring**: Live occupancy tracking for GPU and RAM.
- **Unified Memory Optimization**: Specifically tuned for Apple Silicon (M1/M2/M3) to accurately report unified memory usage.
- **Adaptive Recommendations**: Intelligent model selection hints based on your current hardware profile.

#### 🔹 Seamless RAG Memory
- **Keyword-Independent Retrieval**: Our "RAG-first" approach automatically retrieves relevant long-term context based on semantic intent, no explicit "recall cues" required.
- **Intelligent Noise Filtering**: Graded thresholds ensure that conversational filler stays clean while project-specific knowledge is seamlessly injected.
- **File Ingestion**: Persistent knowledge base powered by a local vector database.

#### 🔹 Autonomous Desktop Agency (Computer Use)
- **Multi-Mode Perception**: Leverages direct visual understanding or OCR fallback to navigate your desktop.
- **Safety First**: Graded approval mechanisms for sensitive actions (terminal commands, file deletion).
- **Session Persistence**: Complete task history with screenshot timelines and result archival.

#### 🔹 Premium Communication
- **Persistent Multi-modal Uploads**: Robust file and image attachment system backed by a dedicated storage engine.
- **Fluid UI**: Modern, glassmorphism-inspired interface with responsive sidebars and real-time generation stats.
- **Streaming Intelligence**: Real-time title generation and LaTeX/Markdown rendering.

---

## 🏗️ Architecture

ModelForge leverages a high-performance three-tier architecture:

1.  **Frontend**: React 19 + TypeScript + Vite. A sleek, responsive UI with deep integration for streaming states.
2.  **Backend**: FastAPI + SQLite. A robust orchestration layer handling model lifecycles, vector memory, and persistent file storage.
3.  **Desktop Layer**: Electron Shell. Provides system-level hooks, Screen Recording/Accessibility bridge for Computer Use, and native packaging.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: 18.0+
- **Python**: 3.11+
- **Ollama**: Installed and running (Default: `http://localhost:11434`)

### Installation & Execution

1.  **Clone & Configure**:
    ```bash
    git clone https://github.com/caiwangz671-netizen/ModelForge.git
    cd ModelForge
    cp .env.example .env
    ```

2.  **Launch Developer Environment**:
    ```bash
    chmod +x start-dev.sh
    ./start-dev.sh
    ```

3.  **Production Packaging (macOS)**:
    ```bash
    ./scripts/build-desktop-mac.sh
    ```
    *Resulting DMG will be in the `/release` directory.*

---

## 🛠️ Tech Stack & Credits

-   **Runtime**: [Ollama](https://ollama.ai/)
-   **UI Framework**: React 19, Tailwind CSS 4, Framer Motion
-   **Backend**: FastAPI, SQLAlchemy, Pydantic
-   **Desktop**: Electron, PyInstaller
-   **Knowledge**: SQLite-native vector search (via semantic retrieval)

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Designed for Local Intelligence. Built for Professional Productivity.
</p>
