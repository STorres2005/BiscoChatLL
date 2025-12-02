# app/schemas/estado_mensaje.py
from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Literal


class EstadoMensajeCrear(BaseModel):
    mensaje_id: UUID = Field(..., description="ID del mensaje")
    usuario_id: UUID = Field(..., description="Usuario que registró el estado")
    estado: Literal["enviado", "entregado", "leido", "recibido"] = Field(
        ...,
        example="entregado",
        description="Estado del mensaje: enviado | entregado | leido | recibido",
    )

    model_config = ConfigDict(extra="forbid")



class EstadoMensajeLeer(BaseModel):
    id: UUID
    mensaje_id: UUID
    usuario_id: UUID
    estado: str
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)
