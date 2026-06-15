from __future__ import annotations
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, loaded from environment variables and .env file."""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    DISCORD_BOT_TOKEN: str = ""
    BOT_ENABLED: bool = True
    SYNC_INTERVAL_MINUTES: int = 10
    DATABASE_URL: str = "sqlite+aiosqlite:////app/data/classroom_sync.db"
    GOOGLE_CLIENT_SECRET_FILE: str = "/app/credentials/client_secret.json"
    GOOGLE_TOKEN_FILE: str = "/app/credentials/token.json"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    # Emit structured JSON logs (with timestamp + job_id) instead of plain text.
    LOG_JSON: bool = False

    # API / Web admin
    ADMIN_API_TOKEN: str = ""
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    CLASSROOM_SYNC_INTERVAL_MINUTES: int = 30
    API_CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:8080"

    # Classwork attachment content sync (downloads Drive attachments during sync).
    # Requires the optional Drive scope (re-run setup_google_auth.py); when the
    # scope is absent, downloads are skipped and Classroom sync is unaffected.
    ATTACHMENT_SYNC_ENABLED: bool = True
    ATTACHMENT_STORAGE_DIR: str = "/app/data/attachments"
    ATTACHMENT_MAX_BYTES: int = 52_428_800  # 50 MB; larger files are skipped
    ATTACHMENT_DOWNLOAD_RETRIES: int = 2

    # Reserved for the next phase: Gmail inbox notifications delivered to Discord.
    # These settings are intentionally inert until the Gmail sync service is implemented.
    GMAIL_NOTIFICATIONS_ENABLED: bool = False
    GMAIL_POLL_INTERVAL_MINUTES: int = 5
    GMAIL_LABEL_FILTER: str = "INBOX"
    GMAIL_DISCORD_CHANNEL_ID: str = ""
    GOOGLE_GMAIL_TOKEN_FILE: str = "/app/credentials/gmail_token.json"


# Initialize configuration
# Note: In non-production or development / script environments, we might want to check
# if DISCORD_BOT_TOKEN is strictly loaded. For running initialization scripts,
# we default it to a placeholder or check during runtime start.
try:
    settings = Settings()
except Exception as e:
    # Safe fallback if loaded via script where env doesn't exist yet but we need settings schema
    # Or let it propagate if running the main bot
    import sys
    if "setup_google_auth" in sys.argv[0]:
        # Fill placeholders for setup script
        settings = Settings(
            DISCORD_BOT_TOKEN="PLACEHOLDER",
            GOOGLE_CLIENT_SECRET_FILE=os.getenv("GOOGLE_CLIENT_SECRET_FILE", "credentials/client_secret.json"),
            GOOGLE_TOKEN_FILE=os.getenv("GOOGLE_TOKEN_FILE", "credentials/token.json")
        )
    else:
        # Prompt user about missing configuration
        print(f"Configuration Error: {e}")
        print("Please check your .env file or environment variables.")
        raise e


class JsonLogFormatter(logging.Formatter):
    """Structured JSON log formatter.

    Always includes an ISO-8601 ``timestamp`` and, when provided via
    ``logger.info(..., extra={"job_id": ...})``, a ``job_id`` field so sync
    runs can be correlated. Never emits secrets — only the standard record
    fields plus an explicit allow-list of extras.
    """

    def format(self, record: logging.LogRecord) -> str:
        import json as _json

        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, TOKYO_TZ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        job_id = getattr(record, "job_id", None)
        if job_id is not None:
            payload["job_id"] = job_id
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return _json.dumps(payload, ensure_ascii=False)


def setup_logging() -> logging.Logger:
    """Configures global logging system for the application."""
    log_level_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL
    }

    level = log_level_map.get(settings.LOG_LEVEL, logging.INFO)

    if settings.LOG_JSON:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonLogFormatter())
        logging.basicConfig(level=level, handlers=[handler], force=True)
    else:
        logging.basicConfig(
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            level=level,
            datefmt="%Y-%m-%d %H:%M:%S"
        )

    # Minimize noise from external packages
    logging.getLogger("discord").setLevel(logging.WARNING)
    logging.getLogger("googleapiclient").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
    
    logger = logging.getLogger("classroom_sync")
    logger.info(f"Logging initialized with level: {settings.LOG_LEVEL}")
    return logger

def normalize_database_url(database_url: str) -> str:
    """Convert common absolute SQLite paths to the correct 4-slash URL form."""
    sqlite_prefix = "sqlite+aiosqlite:///"
    if database_url.startswith(sqlite_prefix) and not database_url.startswith("sqlite+aiosqlite:////"):
        sqlite_path = database_url[len(sqlite_prefix):]
        if sqlite_path.startswith("app/") or sqlite_path.startswith("Users/") or sqlite_path.startswith("private/"):
            return f"sqlite+aiosqlite:////{sqlite_path}"
    return database_url


settings.DATABASE_URL = normalize_database_url(settings.DATABASE_URL)

logger = logging.getLogger("classroom_sync")


# Japan (Tokyo) timezone helper for server times (as requested)
TOKYO_TZ = ZoneInfo("Asia/Tokyo")

def now_jst() -> datetime:
    """Return current time in Asia/Tokyo timezone (server time)."""
    return datetime.now(TOKYO_TZ)
