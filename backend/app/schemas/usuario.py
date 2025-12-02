# app/schemas/usuario.py
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional
from uuid import UUID
from datetime import datetime
import re

# Validación formato internacional (E.164)
E164_REGEX = re.compile(r"^\+\d{8,15}$")  # +593..., +57..., etc.

# ----------------------------- #
# BASE
# ----------------------------- #
class UsuarioBase(BaseModel):
    model_config = ConfigDict(extra="forbid")  # No aceptar campos desconocidos

    nombre: Optional[str] = Field(None, example="Santiago", description="Nombre del usuario")
    apellido: Optional[str] = Field(None, example="Lopez", description="Apellido del usuario")
    telefono: str = Field(..., example="+593987654321", description="Número de teléfono único en formato E.164 (+########)")

    @field_validator("telefono")
    @classmethod
    def validar_telefono(cls, v: str) -> str:
        if not E164_REGEX.match(v):
            raise ValueError("El teléfono debe estar en formato E.164, ej: +593987654321")
        return v


# ----------------------------- #
# LECTURA
# ----------------------------- #
class UsuarioLeer(UsuarioBase):
    id: UUID = Field(..., example="a3dca4b3-8f9d-4df1-b731-b5e0e6789a45")
    ultimo_estado: Optional[str] = Field(None, example="Disponible")
    foto_perfil: Optional[str] = Field(None, example="https://example.com/foto.jpg")
    en_linea: Optional[bool] = Field(None, example=True)
    ultima_conexion: Optional[datetime] = Field(None, example="2025-10-11T20:45:00Z")
    verificado: Optional[bool] = Field(None, example=True)
    creado_en: datetime = Field(..., example="2025-10-10T15:30:00Z")

    model_config = ConfigDict(from_attributes=True, extra="forbid")


# ----------------------------- #
# ACTUALIZACIÓN
# ----------------------------- #
class UsuarioActualizar(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: Optional[str] = Field(None, example="Kevin", description="Nuevo nombre del usuario")
    apellido: Optional[str] = Field(None, example="Carrillo", description="Nuevo apellido del usuario")
    foto_perfil: Optional[str] = Field(None, example="https://example.com/foto_nueva.jpg")
    ultimo_estado: Optional[str] = Field(None, example="En clase")
    en_linea: Optional[bool] = Field(None, example=False)
    telefono: Optional[str] = Field(None, example="+593912345678")

    @field_validator("telefono")
    @classmethod
    def validar_telefono_opcional(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not E164_REGEX.match(v):
            raise ValueError("El teléfono debe estar en formato E.164, ej: +593987654321")
        return v


# ----------------------------- #
# TOKEN
# ----------------------------- #
class Token(BaseModel):
    access_token: str = Field(..., example="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")
    token_type: str = Field("bearer", example="bearer")
