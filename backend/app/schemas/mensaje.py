# app/schemas/mensaje.py
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

# ============================================================
# BASE
# ============================================================
class MensajeBase(BaseModel):
    cuerpo: Optional[str] = Field(
        None,
        example="Hola, ¿cómo estás?",
        description="Texto del mensaje enviado por el usuario"
    )
    url_adjunto: Optional[str] = Field(
        None,
        example="https://example.com/imagen.png",
        description="URL del archivo adjunto, si aplica"
    )
    tipo_adjunto: Optional[str] = Field(
        None,
        example="imagen",
        description="Tipo de archivo adjunto (imagen, audio, video, documento)"
    )

    model_config = ConfigDict(extra="forbid")


# ============================================================
# CREAR MENSAJE
# ============================================================
class MensajeCrear(MensajeBase):
    destinatario_id: Optional[UUID] = Field(
        default=None,
        description="Solo se usa cuando se crea un chat 1 a 1 desde cero"
    )

    mensaje_id_respuesta: Optional[UUID] = Field(
        default=None,
        description="ID del mensaje al que se responde"
    )

    mencionados: List[UUID] = Field(
        default_factory=list,
        description="Usuarios mencionados en el mensaje"
    )


# ============================================================
# LEER MENSAJE (AHORA COMPATIBLE CON REMITENTE_ID NULL)
# ============================================================
class MensajeLeer(MensajeBase):
    id: UUID = Field(...)
    conversacion_id: UUID = Field(...)
    
    # 👇 AHORA ES OPCIONAL → PERMITE MENSAJES DE SISTEMA
    remitente_id: Optional[UUID] = Field(
        None,
        description="ID del remitente o null si es mensaje del sistema"
    )

    tipo: str = Field(
        ...,
        example="normal",
        description="Tipo de mensaje: normal | sistema"
    )

    creado_en: datetime = Field(...)
    editado_en: Optional[datetime] = None
    borrado_en: Optional[datetime] = None
    mensaje_id_respuesta: Optional[UUID] = None
    mencionados: Optional[List[UUID]] = None

    model_config = ConfigDict(
        from_attributes=True,
        extra="forbid"
    )


# ============================================================
# ACTUALIZAR MENSAJE
# ============================================================
class MensajeActualizar(BaseModel):
    cuerpo: str = Field(
        ...,
        example="Mensaje actualizado"
    )

    model_config = ConfigDict(extra="forbid")


# ============================================================
# EDITAR MENSAJE (alias)
# ============================================================
class MensajeEditar(MensajeActualizar):
    model_config = ConfigDict(extra="forbid")
