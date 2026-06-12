from __future__ import annotations
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import courses, health, sync
from src.config import settings, setup_logging
from src.database import init_db

logger = logging.getLogger("classroom_sync.api")


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(title="Classroom Bot API", version="0.2.0")

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
    app.include_router(sync.router, prefix="/api")

    scheduler = AsyncIOScheduler()

    @app.on_event("startup")
    async def on_startup() -> None:
        await init_db()
        logger.info("API database initialized")

        if settings.CLASSROOM_SYNC_INTERVAL_MINUTES > 0:
            from src.api.routes.sync import _run_full_sync

            scheduler.add_job(
                _run_full_sync,
                "interval",
                minutes=settings.CLASSROOM_SYNC_INTERVAL_MINUTES,
                id="classroom_cache_sync",
                replace_existing=True,
            )
            scheduler.start()
            logger.info(
                "Scheduled Classroom cache sync every %s minutes",
                settings.CLASSROOM_SYNC_INTERVAL_MINUTES,
            )

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        if scheduler.running:
            scheduler.shutdown(wait=False)

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