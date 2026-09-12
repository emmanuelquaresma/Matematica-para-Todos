import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routes.dama import router as dama_router


APP_ENV = os.getenv("APP_ENV", "development")


app = FastAPI(title="Matemática pra Todos")
app.include_router(dama_router)

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BACKEND_DIR / "frontend"

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def read_root() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/menu")
def menu() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "pages" / "menu.html")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
