# Changelog / 更新紀錄

All notable changes to this project are documented here.

所有重要變更會記錄於此文件。

## [0.1.0] - 2026-06-12

### Added / 新增
- Flat monorepo layout with Python bot at repo root (`src/`), web dashboard in `web/`, and Docker assets in `docker/`.
- 扁平化 monorepo：bot 在根目錄 `src/`、Web dashboard 在 `web/`、Docker 設定集中在 `docker/`。
- Discord bot with Google Classroom sync, slash commands, and SQLite-backed deduplication.
- Vite/React operations dashboard with deployment guidance and env export.
- Docker Compose profiles for local development (`dev`) and manual production deployment (`prod`).
- Multilingual README (Japanese default, English, Traditional Chinese).
- Gmail notification configuration placeholders for a future phase.

### Removed / 移除
- GitHub Actions CI/CD workflow, GHCR publishing, and self-hosted runner automation.
- 移除 GitHub Actions CI/CD、GHCR 推送與 self-hosted runner 自動部署。
- Legacy `classroom-discord-sync/` directory layout.

## Unreleased