from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow

from src.api.deps import verify_admin_token
from src.config import settings
from src.google_service import SCOPES, google_service

logger = logging.getLogger("classroom_sync.auth")

router = APIRouter(prefix="/auth/google", tags=["auth"])

# Path (relative to the web origin) that Google redirects back to. nginx and the
# vite dev server both proxy /api/* to this FastAPI app, so the callback is
# always same-origin with the admin UI.
CALLBACK_PATH = "/api/auth/google/callback"

# Pending OAuth handshakes keyed by the state token we hand to Google. This is a
# single-process admin tool, so a module-level dict is sufficient; entries are
# short-lived (one consent round-trip) and popped on callback.
_PENDING: dict[str, dict[str, str]] = {}


def _allowed_origins() -> set[str]:
    return {
        o.strip().rstrip("/")
        for o in settings.API_CORS_ORIGINS.split(",")
        if o.strip()
    }


def _settings_url(origin: str, **params: str) -> str:
    """Build a redirect back to the admin Settings page with status params."""
    query = "&".join(f"{k}={quote(v)}" for k, v in params.items())
    return f"{origin}/settings?{query}"


@router.get("/start", dependencies=[Depends(verify_admin_token)])
async def start(origin: str = Query(..., description="Browser-visible web origin")) -> dict:
    """Begin the OAuth consent flow and return the Google authorization URL.

    The frontend passes its own ``window.location.origin``; Google will redirect
    back to ``{origin}{CALLBACK_PATH}`` after consent. That exact redirect URI
    must be registered on the OAuth client in the Google Cloud Console.
    """
    origin = origin.rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid origin: {origin}")

    allowed = _allowed_origins()
    if allowed and origin not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Origin {origin} is not allowed. Add it to API_CORS_ORIGINS "
                "so the OAuth redirect can return here."
            ),
        )

    secret_path = settings.GOOGLE_CLIENT_SECRET_FILE
    if not os.path.exists(secret_path):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"client_secret.json not found at {secret_path}. Upload your Web OAuth client first.",
        )

    redirect_uri = f"{origin}{CALLBACK_PATH}"
    try:
        flow = Flow.from_client_secrets_file(secret_path, scopes=SCOPES, redirect_uri=redirect_uri)
        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",  # force a refresh_token even on re-auth
        )
    except Exception as exc:  # malformed client_secret.json, etc.
        logger.exception("Failed to build OAuth authorization URL")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"OAuth init failed: {exc}")

    _PENDING[state] = {"redirect_uri": redirect_uri, "origin": origin}
    return {"authorization_url": auth_url, "redirect_uri": redirect_uri, "state": state}


@router.get("/callback")
async def callback(
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> RedirectResponse:
    """Google redirects the browser here after consent. Exchange the code for a
    token, persist it, and bounce back to the admin Settings page.

    This endpoint is intentionally unauthenticated (Google's redirect carries no
    admin token); it is protected by the single-use ``state`` we issued in /start.
    """
    pending = _PENDING.pop(state, None)
    if pending is None:
        fallback = next(iter(_allowed_origins()), "")
        return RedirectResponse(
            _settings_url(fallback, auth="error", reason="invalid_or_expired_state"),
            status_code=status.HTTP_302_FOUND,
        )

    origin = pending["origin"]
    redirect_uri = pending["redirect_uri"]

    if error:
        return RedirectResponse(
            _settings_url(origin, auth="error", reason=error),
            status_code=status.HTTP_302_FOUND,
        )
    if not code:
        return RedirectResponse(
            _settings_url(origin, auth="error", reason="missing_code"),
            status_code=status.HTTP_302_FOUND,
        )

    # Google permits http only for localhost redirects; oauthlib still refuses
    # non-https unless told otherwise. Also relax scope matching since Google may
    # return equivalent Classroom scope aliases.
    if redirect_uri.startswith("http://"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

    try:
        flow = Flow.from_client_secrets_file(
            settings.GOOGLE_CLIENT_SECRET_FILE,
            scopes=SCOPES,
            redirect_uri=redirect_uri,
            state=state,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        token_path = settings.GOOGLE_TOKEN_FILE
        Path(token_path).parent.mkdir(parents=True, exist_ok=True)
        with open(token_path, "w") as token_fp:
            token_fp.write(creds.to_json())

        # Drop any cached invalid creds so the next API call reloads the token.
        google_service.creds = None
        google_service.last_credential_error = None
        logger.info("Google OAuth token written via WebUI flow to %s", token_path)
    except Exception as exc:
        logger.exception("WebUI OAuth callback failed")
        return RedirectResponse(
            _settings_url(origin, auth="error", reason=str(exc)),
            status_code=status.HTTP_302_FOUND,
        )

    return RedirectResponse(
        _settings_url(origin, auth="success"),
        status_code=status.HTTP_302_FOUND,
    )
