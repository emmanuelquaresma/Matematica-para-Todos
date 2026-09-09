import os

from fastapi import FastAPI


APP_ENV = os.getenv("APP_ENV", "development")


app = FastAPI(title="Matemática pra Todos")


@app.get("/")
def read_root() -> dict[str, str]:
    return {"app": "Matemática pra Todos", "status": "online"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
