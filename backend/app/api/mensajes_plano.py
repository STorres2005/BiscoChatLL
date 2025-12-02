# app/api/mensajes_plano.py
from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.sesion import obtener_sesion
from app.db.modelos import Mensaje, Conversacion, MiembroConversacion
from app.db import crud
from app.schemas.mensaje import MensajeCrear, MensajeLeer, MensajeActualizar

router = APIRouter(prefix="/mensajes", tags=["mensajes"])

async def _asegurar_miembro(sesion: AsyncSession, conversacion_id: UUID, usuario_id: UUID):
    q = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario_id,
        )
    )
    if not q.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="No eres miembro de esta conversación")

@router.get("", response_model=List[MensajeLeer])
async def listar_mensajes_plano(
    conversacion_id: UUID = Query(...),
    token_sesion: str = Query(...),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    s = await crud.validar_sesion_web(sesion, token_sesion)
    if not s:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    await _asegurar_miembro(sesion, conversacion_id, s.usuario_id)
    q = await sesion.execute(select(Mensaje).where(Mensaje.conversacion_id == conversacion_id).order_by(Mensaje.creado_en.asc()))
    return q.scalars().all()

@router.post("", response_model=MensajeLeer, status_code=201)
async def crear_mensaje_plano(
    conversacion_id: UUID = Body(..., embed=True),
    cuerpo: str = Body(..., embed=True),
    token_sesion: str = Query(...),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    s = await crud.validar_sesion_web(sesion, token_sesion)
    if not s:
        raise HTTPException(status_code=401, detail="Sesión inválida")
    await _asegurar_miembro(sesion, conversacion_id, s.usuario_id)
    msg = await crud.enviar_mensaje(sesion, conversacion_id, s.usuario_id, cuerpo)
    return msg
