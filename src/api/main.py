from __future__ import annotations
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src import __version__
from src.api.routes import auth, bot, courses, health, scheduler, sync, todos
from src.api.services.scheduler_service import SchedulerService
from src.config import settings, setup_logging
from src.database import init_db

logger = logging.getLogger("classroom_sync.api")


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
    app.include_router(auth.router, prefix="/api")

    scheduler_service = SchedulerService()
    app.state.scheduler_service = scheduler_service

    @app.on_event("startup")
    async def on_startup() -> None:
        await init_db()
        logger.info("API database initialized")
        from src.database import async_session_factory

        async with async_session_factory() as session:
            await scheduler_service.apply_persisted_setting(session)

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        scheduler_service.shutdown()

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