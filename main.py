"""
main.py — Local development server.

Imports the unified app from api/index.py and adds static file serving.
Vercel uses api/index.py directly via vercel.json rewrites.
"""

import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from api.index import app  # noqa: F401 — re-export for uvicorn
from fastapi.responses import HTMLResponse
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent

# Static file mounts — for local dev only (Vercel's CDN handles these in production)
app.mount("/css", StaticFiles(directory=str(BASE / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE / "js")), name="js")
app.mount("/img", StaticFiles(directory=str(BASE / "img")), name="img")
app.mount("/data", StaticFiles(directory=str(BASE / "data")), name="data")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root():
    """Serve the existing index.html site (local dev only)."""
    index_path = BASE / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>index.html not found</h1>", status_code=404)
    return HTMLResponse(index_path.read_text(encoding="utf-8"))


_GROUP_TITLES = {
    "pathogens": "Pathogens & Literature",
    "effectors": "Effectors",
    "host-proteins": "Host Proteins",
    "trafficking": "Trafficking",
    "interactome": "Interactome",
    "enrichment": "Enrichment",
    "sequence": "Sequence Analysis",
    "ml": "Machine Learning",
    "novel-findings": "Novel Findings",
    "literature": "Literature",
    "notebooks": "Notebooks",
    "stats": "Stats",
}


def _dashboard_sections() -> dict[str, list[tuple[str, str, str]]]:
    """Group every /api route by its resource so the dashboard cannot go stale."""
    groups: dict[str, list[tuple[str, str, str]]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        methods = [m for m in route.methods if m not in ("HEAD", "OPTIONS")]
        if not methods:
            continue
        parts = [p for p in route.path.split("/") if p]
        key = parts[1] if len(parts) > 1 else "root"
        desc = route.summary or (route.name or "").replace("_", " ")
        groups.setdefault(key, []).append((methods[0], route.path, desc))
    for rows in groups.values():
        rows.sort(key=lambda r: r[1])
    return groups


def _dashboard_html() -> str:
    cards = []
    for key in sorted(_dashboard_sections()):
        rows = _dashboard_sections()[key]
        title = _GROUP_TITLES.get(key, key.replace("-", " ").title())
        items = []
        for method, path, desc in rows:
            cls = "get" if method == "GET" else "post"
            items.append(
                '<div class="endpoint">'
                f'<span class="method {cls}">{html.escape(method)}</span>'
                f'<span class="path">{html.escape(path)}</span>'
                f'<span class="desc">{html.escape(desc)}</span>'
                "</div>"
            )
        cards.append(
            f'<div class="card"><h2>{html.escape(title)}</h2>' + "".join(items) + "</div>"
        )
    return "\n".join(cards)


_DASHBOARD_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PathoMap API Dashboard</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f8fafc; color: #1e293b; line-height: 1.6; }}
    .container {{ max-width: 960px; margin: 0 auto; padding: 24px; }}
    h1 {{ font-size: 1.75rem; margin-bottom: 8px; color: #0f172a; }}
    h1 small {{ font-size: 0.9rem; font-weight: 400; color: #64748b; }}
    p {{ color: #475569; margin-bottom: 24px; }}
    .card {{ background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1);
            padding: 20px; margin-bottom: 16px; }}
    .card h2 {{ font-size: 1.1rem; margin-bottom: 12px; color: #0f172a; }}
    .card code {{ background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
                 font-size: 0.85rem; }}
    .endpoint {{ padding: 8px 0; border-bottom: 1px solid #e2e8f0; display: flex;
                align-items: center; gap: 12px; }}
    .endpoint:last-child {{ border-bottom: none; }}
    .method {{ font-weight: 600; padding: 2px 8px; border-radius: 4px;
              font-size: 0.75rem; text-transform: uppercase; min-width: 52px;
              text-align: center; }}
    .get {{ background: #dbeafe; color: #1d4ed8; }}
    .post {{ background: #dcfce7; color: #15803d; }}
    .path {{ font-family: monospace; font-size: 0.9rem; color: #334155; }}
    .desc {{ font-size: 0.85rem; color: #64748b; }}
    a {{ color: #2563eb; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .footer {{ text-align: center; color: #94a3b8; font-size: 0.85rem;
              padding: 24px 0; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>PathoMap <small>API v{version}</small></h1>
    <p>REST API for the curated host&ndash;pathogen dataset served to the PathoMap site. Data is sourced from <code>pathomap.db</code>.</p>
{sections}
    <div class="card">
      <h2>Interactive Docs</h2>
      <p style="margin-bottom:0"><a href="/docs" target="_blank">Swagger UI &rarr;</a> &middot; <a href="/redoc" target="_blank">ReDoc &rarr;</a></p>
    </div>

    <div class="footer">
      PathoMap &mdash; Built with FastAPI + SQLite
    </div>
  </div>
</body>
</html>"""


@app.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def api_dashboard():
    return HTMLResponse(
        _DASHBOARD_TEMPLATE.format(version=app.version, sections=_dashboard_html())
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
