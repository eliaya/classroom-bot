# Changelog / 更新紀錄

All notable changes to this project are documented here.

所有重要變更會記錄於此文件。

## Unreleased

### Removed / 移除
- Removed GitHub Actions CI/CD workflow, GHCR image publishing, and self-hosted production deployment automation.
- 移除 GitHub Actions CI/CD workflow、GHCR image 推送與 self-hosted production 自動部署。

### Added / 新增
- Added production Docker images for the Discord bot and Vite web UI.
- 新增 Discord bot 與 Vite web UI 的 production Docker image 設定。
- Added production Docker Compose stack with persistent bot data and credentials volumes.
- 新增 production Docker Compose stack，保留 bot 的資料庫與 Google OAuth 憑證 volume。
- Added local Docker Compose development stack and localhost workflow documentation.
- 新增本機 Docker Compose 開發 stack 與 localhost 開發流程文件。
- Added local bot idle mode through `BOT_ENABLED=false` so compose can run before Discord credentials are ready.
- 新增 `BOT_ENABLED=false` 本機 idle mode，讓 Discord credentials 尚未準備時 compose 仍可運行。
- Added bilingual deployment, architecture, and tech stack documentation.
- 新增中英雙語部署、架構與技術棧文件。
- Added inert Gmail notification configuration placeholders for the next implementation phase.
- 新增 Gmail incoming notification 的設定占位，供下一階段實作使用。
