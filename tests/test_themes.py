from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.api.main import app
from src.api.routes import themes as theme_routes
from src.config import settings
from src.themes import pick_theme_tokens

ORIGIN = "http://localhost:5173"

# Shaped like tweakcn's "caffeine" export: a `theme` block for both modes, and
# mode blocks that win where they overlap it.
CAFFEINE = {
    "name": "caffeine",
    "cssVars": {
        "theme": {"font-sans": "Inter, sans-serif", "radius": "0.5rem", "tracking-normal": "0em"},
        "light": {
            "background": "oklch(0.98 0 0)",
            "primary": "oklch(0.43 0.04 42)",
            "sidebar": "oklch(0.96 0 0)",
            "font-mono": "'JetBrains Mono', monospace",
            "shadow-sm": "0 1px 3px 0 hsl(0 0% 0% / 0.1)",
            "radius": "0.75rem",
            # Each of these could escape the <style> tag or reach the network.
            "inject-a": "red;} body{display:none",
            "inject-b": "url(//evil.example/x.png)",
            "inject-c": "'unbalanced",
            "Bad Name": "red",
        },
        "dark": {"background": "oklch(0.18 0 0)", "primary": "oklch(0.92 0.05 66)"},
    },
}


@pytest.fixture(autouse=True)
def _origins(monkeypatch):
    monkeypatch.setattr(settings, "API_CORS_ORIGINS", ORIGIN)


@pytest.fixture
def tweakcn(monkeypatch):
    """tweakcn.com: caffeine exists, `colourless` has no colours, `down` is unreachable."""
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        slug = request.url.path.rsplit("/", 1)[-1]
        if slug == "caffeine":
            return httpx.Response(200, json=CAFFEINE)
        if slug == "colourless":
            return httpx.Response(200, json={"name": "x", "cssVars": {"theme": {"radius": "1rem"}}})
        if slug == "garbage":
            return httpx.Response(200, text="<html>")
        if slug == "down":
            raise httpx.ConnectError("down")
        return httpx.Response(500, text="no such theme")

    monkeypatch.setattr(theme_routes, "_transport", httpx.MockTransport(handler))
    return asked


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": ORIGIN})


def test_sanitiser_drops_what_could_escape_the_style_tag():
    picked = pick_theme_tokens({
        "background": "oklch(0.5 0.1 200)",
        "primary": "url(x)",  # a colour naming a resource
        "font-sans": '"Inter", sans-serif',
        "radius": "1rem; color: red",
        "spacing": "/* hi */ 1px",
        "Upper": "red",
        "number": 3,
    })
    assert picked == {"background": "oklch(0.5 0.1 200)", "font-sans": '"Inter", sans-serif'}
    # Past 80 design tokens the rest are dropped; the 23 colours do not count.
    many = pick_theme_tokens({f"x-{i}": "1px" for i in range(100)} | {"background": "#fff"})
    assert len(many) == 81 and many["background"] == "#fff"


@pytest.mark.asyncio
async def test_tweakcn_import(sign_in, tweakcn):
    async with _client() as admin:
        await sign_in(admin)
        res = await admin.get("/api/themes/tweakcn/caffeine")
        assert res.status_code == 200
        theme = res.json()
        assert theme["name"] == "caffeine"
        # No ".json" on the registry path: an id with one answers 500.
        assert tweakcn[-1] == "https://tweakcn.com/r/themes/caffeine"
        light, dark = theme["light"], theme["dark"]
        # The `theme` block reaches both modes; the light block wins on radius.
        assert dark["font-sans"] == light["font-sans"] == "Inter, sans-serif"
        assert light["radius"] == "0.75rem" and dark["radius"] == "0.5rem"
        assert light["sidebar"] and light["shadow-sm"] and "sidebar" not in dark
        for unsafe in ("inject-a", "inject-b", "inject-c", "Bad Name"):
            assert unsafe not in light

        assert (await admin.get("/api/themes/tweakcn/nope")).status_code == 404
        assert (await admin.get("/api/themes/tweakcn/Not_A_Slug")).status_code == 400
        assert (await admin.get("/api/themes/tweakcn/colourless")).status_code == 502
        assert (await admin.get("/api/themes/tweakcn/garbage")).status_code == 502
        assert (await admin.get("/api/themes/tweakcn/down")).status_code == 502


@pytest.mark.asyncio
async def test_install_pick_default_and_delete(sign_in, tweakcn):
    async with _client() as admin, _client() as alice:
        await sign_in(admin, email="admin@example.com")
        await sign_in(alice, permissions=["courses:view"], email="alice@example.com")

        imported = (await admin.get("/api/themes/tweakcn/caffeine")).json()
        res = await admin.post("/api/themes", json={**imported, "name": "Caffeine", "source": "caffeine"})
        assert res.status_code == 201
        caffeine = res.json()
        assert caffeine["light"]["background"] == "oklch(0.98 0 0)"
        assert (await admin.post("/api/themes", json={**imported, "name": "caffeine"})).status_code == 409
        # Sanitised again on the way in: the body is the browser's.
        sneaky = await admin.post("/api/themes", json={"name": "Sneaky", "light": {"background": "red;}"}})
        assert sneaky.status_code == 422
        ocean = (await admin.post("/api/themes", json={"name": "Ocean", "light": {"background": "#f0fdfa"}})).json()

        # Nobody has picked one and there is no default: built-in colours for both.
        assert (await alice.get("/api/themes/mine")).json() == {"theme_id": None, "theme": None}

        # The user-panel default reaches Alice, not the admin.
        assert (await admin.put("/api/themes/default", json={"theme_id": ocean["id"]})).status_code == 200
        assert (await alice.get("/api/themes/mine")).json()["theme"]["name"] == "Ocean"
        assert (await admin.get("/api/themes/mine")).json()["theme"] is None
        listed = (await alice.get("/api/themes")).json()
        assert [t["name"] for t in listed["items"]] == ["Caffeine", "Ocean"] and listed["default_id"] == ocean["id"]

        # Her own pick beats the default; the admin's own pick is the admin's.
        assert (await alice.put("/api/themes/mine", json={"theme_id": caffeine["id"]})).status_code == 200
        assert (await alice.get("/api/themes/mine")).json()["theme"]["name"] == "Caffeine"
        await admin.put("/api/themes/mine", json={"theme_id": ocean["id"]})
        assert (await admin.get("/api/themes/mine")).json()["theme"]["name"] == "Ocean"
        assert (await alice.put("/api/themes/mine", json={"theme_id": 999})).status_code == 404

        # Users pick; only the admin installs, deletes and sets the default.
        assert (await alice.get("/api/themes/tweakcn/caffeine")).status_code == 403
        assert (await alice.post("/api/themes", json={"name": "Mine", "light": {"background": "#000"}})).status_code == 403
        assert (await alice.put("/api/themes/default", json={"theme_id": None})).status_code == 403
        assert (await alice.delete(f"/api/themes/{ocean['id']}")).status_code == 403

        # Deleting a theme drops it as anyone's pick and as the default.
        assert (await admin.delete(f"/api/themes/{caffeine['id']}")).json()["deleted"] is True
        assert (await alice.get("/api/themes/mine")).json()["theme"]["name"] == "Ocean"
        await admin.delete(f"/api/themes/{ocean['id']}")
        assert (await alice.get("/api/themes/mine")).json() == {"theme_id": None, "theme": None}
        assert (await admin.get("/api/themes")).json() == {"items": [], "default_id": None}
        assert (await admin.delete(f"/api/themes/{ocean['id']}")).status_code == 404
