from fastapi import FastAPI, Depends
from .models import User
from .routers import router as users_router


def get_current_user() -> User:
    raise NotImplementedError


app = FastAPI(title="FastAPI fixture", version="1.0.0")
app.include_router(users_router, prefix="/v1", tags=["users"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/protected", dependencies=[Depends(get_current_user)])
def protected() -> dict:
    return {"ok": True}
