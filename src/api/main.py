from __future__ import annotations
import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src import __version__
from src.api.routes import audit, auth, backup, bot, bot_commands, bot_messages, courses, discord_meta, health, links, scheduler, search, sync, todos
from src.api.services.scheduler_service import SchedulerService
from src.config import settings, setup_logging
from src.database import init_db
from src import maintenance

logger = logging.getLogger("classroom_sync.api")


def _skip_audit(path: str, method: str) -> bool:
    """Keep the audit trail meaningful: never record the audit/health endpoints,
    and skip high-frequency GET status polling that would flood the log."""
    if path.startswith("/api/audit") or path.startswith("/api/health"):
        return True
    if method == "GET" and path.startswith(
        ("/api/sync/status", "/api/bot/status", "/api/scheduler", "/api/version", "/api/backup")
    ):
        return True
    return False


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(title="Classroom Bot API", version=__version__)

    origins = [o.strip() for o in settings.API_CORS_ORIGINS.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(courses.router, prefix="/api")
    app.include_router(todos.router, prefix="/api")
    app.include_router(sync.router, prefix="/api")
    app.include_router(scheduler.router, prefix="/api")
    app.include_router(bot.router, prefix="/api")
    app.include_router(bot_commands.router, prefix="/api")
    app.include_router(bot_messages.router, prefix="/api")
    app.include_router(links.router, prefix="/api")
    app.include_router(discord_meta.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(search.router, prefix="/api")
    app.include_router(audit.router, prefix="/api")
    app.include_router(backup.router, prefix="/api")

    @app.middleware("http")
    async def audit_requests(request: Request, call_next):
        """Record every meaningful API request to the audit trail (category=api)."""
        start = time.perf_counter()
        response = await call_next(request)
        try:
            path = request.url.path
            if path.startswith("/api/") and not _skip_audit(path, request.method):
                from src.database import async_session_factory
                from src.repositories import audit_log

                duration_ms = int((time.perf_counter() - start) * 1000)
                async with async_session_factory() as session:
                    await audit_log.record(
                        session,
                        category="api",
                        action="api.request",
                        target=f"{request.method} {path}",
                        status="ok" if response.status_code < 400 else "error",
                        duration_ms=duration_ms,
                        detail={"status_code": response.status_code},
                    )
        except Exception:  # noqa: BLE001 — auditing must never break the response
            logger.warning("Audit middleware failed", exc_info=True)
        return response

    @app.middleware("http")
    async def restore_maintenance(request: Request, call_next):
        """Refuse API traffic while a restore is swapping the database file.

        Registered last on purpose: add_middleware inserts at the front, so the
        last one added is the outermost and short-circuits before
        audit_requests gets a chance to write a row into the file being
        replaced.
        """
        path = request.url.path
        if (
            path.startswith("/api/")
            and path != "/api/health"
            and not path.startswith("/api/backup/restores")
            and maintenance.is_active()
        ):
            return JSONResponse(
                status_code=503,
                content={"detail": "Restore in progress", "code": "RESTORE_IN_PROGRESS"},
            )
        return await call_next(request)

    scheduler_service = SchedulerService()
    app.state.scheduler_service = scheduler_service

    @app.on_event("startup")
    async def on_startup() -> None:
        await init_db()
        logger.info("API database initialized")
        from src.database import async_session_factory

        # A restore that died mid-flight left the marker behind; clear it so the
        # API is reachable again, and fail whatever rows are stuck 'running'.
        if maintenance.is_active():
            logger.warning("Clearing a stale restore marker left by a previous run")
            maintenance.clear()

        async with async_session_factory() as session:
            from src.repositories import backup_jobs

            stuck_backups, stuck_restores = await backup_jobs.recover_interrupted(session)
            if stuck_backups or stuck_restores:
                logger.warning(
                    "Recovered %d interrupted backup(s) and %d restore(s)",
                    stuck_backups, stuck_restores,
                )
            await scheduler_service.apply_persisted_setting(session)
            await scheduler_service.apply_persisted_audit_retention(session)
            await scheduler_service.apply_persisted_backup(session)
            from src.repositories import audit_log

            await audit_log.record(
                session, category="general", action="app.startup",
                actor="system", detail={"version": __version__},
            )

        # Event-driven sync (Cloud Pub/Sub pull subscriber). No-op unless
        # CLASSROOM_PUSH_ENABLED and GCP is configured — see docs/push-sync-setup.md.
        if settings.CLASSROOM_PUSH_ENABLED:
            from src.api.services.push_subscriber import push_subscriber

            await push_subscriber.start()

        # Lightweight announcement (stream) poller — near-instant stream updates
        # without a full sync. No-op unless CLASSROOM_ANNOUNCEMENT_POLL_ENABLED.
        if settings.CLASSROOM_ANNOUNCEMENT_POLL_ENABLED:
            from src.api.services.announcement_poller import announcement_poller

            await announcement_poller.start()

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        scheduler_service.shutdown()
        if settings.CLASSROOM_PUSH_ENABLED:
            from src.api.services.push_subscriber import push_subscriber

            await push_subscriber.stop()
        if settings.CLASSROOM_ANNOUNCEMENT_POLL_ENABLED:
            from src.api.services.announcement_poller import announcement_poller

            await announcement_poller.stop()

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run(
        "src.api.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=False,
    )


if __name__ == "__main__":
    main()