# app/schemas/conversacion.py

from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

# ============================================================
# 📦  CREAR CONVERSACIÓN (schema de entrada)
# ============================================================
class ConversacionCrear(BaseModel):
    titulo: Optional[str] = Field(
        None,
        example="Chat del proyecto",
        description="Título de la conversación (solo aplica para grupos)"
    )
    es_grupo: bool = Field(
        False,
        example=False,
        description="Indica si la conversación es grupal"
    )
    miembros: List[UUID] = Field(
        default_factory=list,
        example=[
            "a3dca4b3-8f9d-4df1-b731-b5e0e6789a45",
            "c1a0b5f8-4e4d-4a23-b8f3-59fca1d2d7b5"
        ],
        description="IDs de todos los miembros que participarán en la conversación"
    )

    model_config = ConfigDict(
        extra="forbid",   # No se permiten campos desconocidos
        json_schema_extra={
            "example": {
                "titulo": "Chat del proyecto",
                "es_grupo": False,
                "miembros": [
                    "a3dca4b3-8f9d-4df1-b731-b5e0e6789a45",
                    "c1a0b5f8-4e4d-4a23-b8f3-59fca1d2d7b5"
                ]
            }
        }
    )


# ============================================================
# 📄  LEER CONVERSACIÓN (schema base de salida)
# ============================================================
class ConversacionLeer(BaseModel):
    id: UUID = Field(
        ...,
        example="d3fa2b59-7c8e-4cf7-812e-92bdf96d2b11",
        description="ID único de la conversación"
    )
    titulo: Optional[str] = Field(
        None,
        example="Chat del proyecto",
        description="Título de la conversación o nombre del grupo"
    )
    es_grupo: bool = Field(
        ...,
        example=False,
        description="Indica si la conversación es grupal"
    )
    creado_en: datetime = Field(
        ...,
        example="2025-10-11T21:00:00Z",
        description="Fecha de creación"
    )

    model_config = ConfigDict(
        orm_mode=True,          # Permite leer desde modelos ORM (SQLAlchemy)
        from_attributes=True,
        extra="forbid"
    )


# ============================================================
# 🔍 DETALLE DE CONVERSACIÓN (incluye miembros)
# ============================================================
class ConversacionDetalle(ConversacionLeer):
    miembros: List[UUID] = Field(
        ...,
        example=[
            "a3dca4b3-8f9d-4df1-b731-b5e0e6789a45",
            "c1a0b5f8-4e4d-4a23-b8f3-59fca1d2d7b5"
        ],
        description="Lista de IDs de usuarios que pertenecen a la conversación"
    )

    model_config = ConfigDict(
        orm_mode=True,
        from_attributes=True,
        extra="forbid"
    )
