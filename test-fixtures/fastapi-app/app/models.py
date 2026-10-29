from pydantic import BaseModel
from typing import Optional


class User(BaseModel):
    id: int
    name: str
    email: str
    nickname: Optional[str] = None
