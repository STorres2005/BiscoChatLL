# app/schemas/llamada.py
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ============================================================
#  📞 Crear llamada (voz o video)
# ============================================================
class LlamadaCrear(BaseModel):
    tipo: str = Field(
        ...,
        example="voz",
        description="Tipo de llamada: 'voz' o 'video'"
    )

    iniciador_id: UUID = Field(
        ...,
        description="Usuario que inicia la llamada"
    )

    conversacion_id: Optional[UUID] = Field(
        None,
        description="ID de conversación si aplica"
    )

    participantes: List[UUID] = Field(
        ...,
        example=[],
        description="IDs de todos los usuarios participantes"
    )

    model_config = ConfigDict(extra="forbid")


# ============================================================
#  📞 Participante (para detalles internos si luego los usas)
# ============================================================
class ParticipanteLlamadaLeer(BaseModel):
    id: UUID
    llamada_id: UUID
    usuario_id: UUID
    unido_en: Optional[datetime] = None
    salio_en: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  📞 Leer llamada (resumen general)
# ============================================================
class LlamadaLeer(BaseModel):
    id: UUID
    tipo: str
    iniciador_id: UUID
    conversacion_id: Optional[UUID] = None
    estado: Optional[str] = Field(
        None,
        example="iniciada",
        description="Estado de la llamada: iniciada|finalizada|fallida"
    )
    creado_en: datetime
    finalizado_en: Optional[datetime] = None

    participantes: List[UUID] = []

    model_config = ConfigDict(from_attributes=True)
