from fastapi import APIRouter, Header, Path, Query, Body
from typing import List

from .models import User

router = APIRouter(prefix="/api/users")


@router.get("/")
def list_users(role: str = Query(None, max_length=50), limit: int = 10) -> List[User]:
    return []


@router.get("/{user_id}")
def get_user(user_id: int = Path(...)) -> User:
    return User(id=user_id, name="x", email="x@example.com")


@router.post("/")
def create_user(user: User = Body(...), x_trace_id: str = Header(None)) -> User:
    return user


@router.put("/{user_id}")
def update_user(user_id: int, user: User = Body(...)) -> User:
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int) -> None:
    return None
