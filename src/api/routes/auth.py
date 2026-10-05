from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import os
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from google_auth_oauthlib.flow import Flow
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.deps import (
    SESSION_COOKIE,
    Principal,
    allowed_origins,
    get_db_session,
    get_principal,
    require_permission,
)
from src.config import settings
from src.google_service import SCOPES, GoogleClassroomService
from src.repositories import google_connections, users

logger = logging.getLogger("classroom_sync.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

# Path (relative to the web origin) that Google redirects back to. nginx and the
# vite dev server both proxy /api/* to this FastAPI app, so the callback is
# always same-origin with the web UI.
CALLBACK_PATH = "/api/auth/google/callback"

# Sign-in asks for identity only; Classroom access is a separate consent. The
# long forms are what Google echoes back, so oauthlib sees no scope change.
LOGIN_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

# The pending handshake (state, PKCE verifier, where to return) lives in a
# short-lived HttpOnly cookie rather than server memory. That ties the callback
# to the browser that started the flow: without it, an attacker could complete
# consent with their own account and feed the callback URL to a victim.
STATE_COOKIE = "classroom_oauth"
STATE_TTL_SECONDS = 600
_STATE_COOKIE_PATH = "/api/auth"
_COOKIE_PATH = "/api"


def _is_secure(origin: str) -> bool:
    return origin.startswith("https://")


def _safe_next(next_path: str | None) -> str:
    """Only same-site paths are valid post-login destinations."""
    if next_path and next_path.startswith("/") and not next_path.startswith(("//", "/\\")):
        return next_path
    return "/"


def _return_url(origin: str, purpose: str, **params: str) -> str:
    """Where to send the browser when a handshake fails (or a connect succeeds)."""
    page = "/settings" if purpose == "connect" else "/sign-in"
    query = "&".join(f"{k}={quote(v)}" for k, v in params.items())
    return f"{origin}{page}?{query}"


def _begin(
    response: Response,
    *,
    origin: str,
    purpose: str,
    scopes: list[str],
    next_path: str = "/",
    **auth_kwargs: str,
) -> dict:
    """Build the Google authorization URL and stash the handshake in a cookie.

    The frontend passes its own ``window.location.origin``; Google will redirect
    back to ``{origin}{CALLBACK_PATH}`` after consent. That exact redirect URI
    must be registered on the OAuth client in the Google Cloud Console.
    """
    origin = origin.rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid origin: {origin}")

    allowed = allowed_origins()
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
        flow = Flow.from_client_secrets_file(secret_path, scopes=scopes, redirect_uri=redirect_uri)
        auth_url, state = flow.authorization_url(**auth_kwargs)
    except Exception as exc:  # malformed client_secret.json, etc.
        logger.exception("Failed to build OAuth authorization URL")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"OAuth init failed: {exc}")

    # The PKCE code_verifier generated for this flow must be replayed by the
    # callback, or Google rejects the token exchange with "invalid_grant:
    # Missing code verifier".
    pending = {
        "state": state,
        "origin": origin,
        "purpose": purpose,
        "next": _safe_next(next_path),
        "code_verifier": flow.code_verifier or "",
    }
    response.set_cookie(
        STATE_COOKIE,
        base64.urlsafe_b64encode(json.dumps(pending).encode()).decode(),
        max_age=STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_is_secure(origin),
        path=_STATE_COOKIE_PATH,
    )
    return {"authorization_url": auth_url, "redirect_uri": redirect_uri, "state": state}


def _read_pending(request: Request, state: str) -> dict | None:
    """Return the handshake this browser started, if it matches ``state``."""
    raw = request.cookies.get(STATE_COOKIE)
    if not raw:
        return None
    try:
        pending = json.loads(base64.urlsafe_b64decode(raw))
    except ValueError:
        return None
    if not isinstance(pending, dict) or not hmac.compare_digest(str(pending.get("state", "")), state):
        return None
    # The cookie is client-held, so nothing in it is trusted without a re-check.
    origin = str(pending.get("origin", ""))
    allowed = allowed_origins()
    if urlparse(origin).scheme not in {"http", "https"} or (allowed and origin not in allowed):
        return None
    pending["next"] = _safe_next(pending.get("next"))
    return pending


@router.get("/login/start")
async def login_start(
    response: Response,
    origin: str = Query(..., description="Browser-visible web origin"),
    next: str = Query(default="/", description="Path to open after signing in"),
) -> dict:
    """Begin Google sign-in and return the Google authorization URL."""
    return _begin(
        response, origin=origin, purpose="login", scopes=LOGIN_SCOPES, next_path=next,
        prompt="select_account",
    )


@router.get("/google/start")
async def start(
    response: Response,
    origin: str = Query(..., description="Browser-visible web origin"),
    _: Principal = Depends(require_permission("courses:view")),
) -> dict:
    """Begin the Classroom consent flow and return the Google authorization URL."""
    return _begin(
        response, origin=origin, purpose="connect", scopes=SCOPES,
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # force a refresh_token even on re-auth
    )


async def _audit_login(action: str, status_str: str, origin: str, actor: str | None, error: str | None) -> None:
    """Record a sign-in / Classroom-connect outcome to the audit trail (category=api)."""
    from src import database
    from src.repositories import audit_log

    async with database.async_session_factory() as session:
        await audit_log.record(
            session, category="api", action=action,
            actor=actor, target=origin, status=status_str,
            detail={"error": error} if error else None,
        )


def _exchange(flow: Flow, code: str, want_identity: bool) -> dict | None:
    """Blocking: trade the code for a token and, for sign-in, verify the ID token."""
    flow.fetch_token(code=code)
    if not want_identity:
        return None
    return id_token.verify_oauth2_token(
        flow.credentials.id_token,
        google_requests.Request(),
        flow.client_config["client_id"],
        clock_skew_in_seconds=10,
    )


@router.get("/google/callback")
async def callback(
    request: Request,
    state: str = Query(...),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: AsyncSession = Depends(get_db_session),
) -> RedirectResponse:
    """Google redirects the browser here after consent, for both sign-in and
    connecting a Classroom account.

    This endpoint is intentionally unauthenticated (Google's redirect cannot
    carry anything but the query string); it is protected by the single-use
    ``state`` bound to this browser by the cookie set in the start endpoint.
    """
    def _redirect(url: str) -> RedirectResponse:
        res = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
        res.delete_cookie(STATE_COOKIE, path=_STATE_COOKIE_PATH)
        return res

    pending = _read_pending(request, state)
    if pending is None:
        fallback = next(iter(allowed_origins()), "")
        return _redirect(_return_url(fallback, "login", auth="error", reason="invalid_or_expired_state"))

    origin = pending["origin"]
    purpose = pending["purpose"]
    redirect_uri = f"{origin}{CALLBACK_PATH}"
    is_login = purpose == "login"
    action = "auth.login" if is_login else "auth.connect"

    if error or not code:
        return _redirect(_return_url(origin, purpose, auth="error", reason=error or "missing_code"))

    # Google permits http only for localhost redirects; oauthlib still refuses
    # non-https unless told otherwise. Also relax scope matching since Google may
    # return equivalent Classroom scope aliases.
    if redirect_uri.startswith("http://"):
        os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

    actor: str | None = None
    try:
        if not is_login:
            # The callback cannot depend on get_principal (a failure must redirect,
            # not 401), so the connecting user is read from the session cookie here.
            raw = request.cookies.get(SESSION_COOKIE)
            resolved = await users.resolve_session(session, raw) if raw else None
            if resolved is None:
                return _redirect(_return_url(origin, "login", auth="error", reason="sign_in_required"))
            actor = resolved[0].email
            connecting_user_id = resolved[0].id

        flow = Flow.from_client_secrets_file(
            settings.GOOGLE_CLIENT_SECRET_FILE,
            scopes=LOGIN_SCOPES if is_login else SCOPES,
            redirect_uri=redirect_uri,
            state=state,
        )
        # Replay the PKCE verifier captured in the start endpoint for this state.
        if pending.get("code_verifier"):
            flow.code_verifier = pending["code_verifier"]
        # Both calls block on HTTPS to Google.
        claims = await asyncio.to_thread(_exchange, flow, code, is_login)

        if is_login:
            actor = str(claims.get("email", "")).lower() or None
            if not claims.get("email_verified") or not actor:
                raise PermissionError("email_not_verified")
            user = await users.upsert_from_google(
                session,
                sub=claims["sub"],
                email=actor,
                name=claims.get("name"),
                picture_url=claims.get("picture"),
            )
            if not user.is_active:
                raise PermissionError("account_disabled")
            raw_session = await users.create_session(session, user.id)
            await _audit_login(action, "ok", origin, actor, None)
            res = _redirect(f"{origin}{pending['next']}")
            res.set_cookie(
                SESSION_COOKIE,
                raw_session,
                max_age=int(users.SESSION_TTL.total_seconds()),
                httponly=True,
                samesite="lax",
                secure=_is_secure(origin),
                path=_COOKIE_PATH,
            )
            return res

        connection = await google_connections.connect(
            session, connecting_user_id, flow.credentials.to_json()
        )
        # Which Google account this is, for display; it need not be the one the
        # user signs in with.
        connection.google_email = await GoogleClassroomService(
            google_connections.token_path(connection)
        ).my_email()
        session.add(connection)
        await session.commit()
        logger.info("Google Classroom account connected for user %s", connecting_user_id)
        await _audit_login(action, "ok", origin, actor, None)
    except PermissionError as exc:
        await _audit_login(action, "error", origin, actor, str(exc))
        return _redirect(_return_url(origin, purpose, auth="error", reason=str(exc)))
    except Exception as exc:
        logger.exception("OAuth callback failed (%s)", purpose)
        await _audit_login(action, "error", origin, actor, str(exc))
        return _redirect(_return_url(origin, purpose, auth="error", reason=str(exc)))

    return _redirect(_return_url(origin, purpose, auth="success"))


@router.get("/me")
async def me(
    principal: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """The signed-in user and what they may do. An empty ``permissions`` list
    means the account is awaiting approval."""
    user = await users.get_user(session, principal.user_id)
    role = await users.get_role(session, user.role_id) if user.role_id else None
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "role": role.name if role else None,
        "permissions": sorted(principal.permissions),
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    _: Principal = Depends(get_principal),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    await users.delete_session(session, request.cookies[SESSION_COOKIE])
    response.delete_cookie(SESSION_COOKIE, path=_COOKIE_PATH)
    return {"ok": True}
