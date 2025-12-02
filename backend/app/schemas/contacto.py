# app/schemas/contacto.py
from pydantic import BaseModel, Field, ConfigDict
from uuid import UUID
from datetime import datetime
from typing import Optional

class ContactoCrearTelefono(BaseModel):
    contacto_telefono: str = Field(..., example="0986473829")
    alias: Optional[str] = Field(None, example="Juancho")
    model_config = ConfigDict(extra="forbid")

class ContactoActualizarAlias(BaseModel):
    alias: Optional[str] = Field(None, example="Mi Jefe")
    model_config = ConfigDict(extra="forbid")

class ContactoLeer(BaseModel):
    id: UUID
    usuario_id: UUID
    contacto_id: UUID
    alias: Optional[str] = None
    creado_en: Optional[datetime] = None
    
    nombre_mostrar: str
    telefono: str
    foto_perfil: str

    model_config = ConfigDict(from_attributes=True, extra="forbid")