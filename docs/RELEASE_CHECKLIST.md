# 发布检查清单

这份清单用于 `ModelForge` 在提交、打包和分发前的最后确认。

## 1. 代码与索引状态

- 确认工作区没有未暂存改动
- 确认 `.env`、数据库、日志、`node_modules`、`venv`、`release/` 没有被跟踪
- 检查 `git status`
- 检查 `git diff --cached --stat`

## 2. 基础构建检查

前端：

```bash
cd frontend
npm run build
```

后端：

```bash
cd ..
python3 -m py_compile backend/app/api/*.py backend/app/services/*.py
```

## 3. 桌面打包

```bash
./scripts/build-desktop-mac.sh
```

确认产物存在：

- `release/ModelForge.app`
- `release/ModelForge-arm64.dmg` 或对应架构 DMG

## 4. 手动 smoke test

至少确认以下流程：

- 应用可以正常启动
- 首页、模型页、聊天页、下载页、记忆页、设置页可正常打开
- `Computer Use` 页面可正常展示状态
- 权限缺失时能正确提示
- 聊天历史与 `Computer Use` 历史可以清空
- 下载列表重进后不会出现 `NaN undefined`
- `Computer Use` 的任务历史、折叠、删除全部逻辑正常

## 5. Computer Use 专项检查

- 屏幕录制权限正常
- 辅助功能权限正常
- 截图能更新
- 模型输出区能正常刷新
- 受控浏览器能打开页面
- 遇到登录场景时能进入用户接管
- 恢复执行后会话不会直接失败

## 6. 发布材料

- `README.md` 为英文版
- `README.zh-CN.md` 为更完整的中文版
- `.env.example` 已更新
- `.dockerignore` 已更新
- `LICENSE` 已存在

## 7. 提交前建议

- 确认提交信息清晰
- 确认版本号策略
- 确认发布说明中包含主要改动
- 如需对外分发，附上 `.dmg` 的平台和架构说明
