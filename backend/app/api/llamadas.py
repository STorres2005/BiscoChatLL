# app/api/llamadas.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.db.sesion import obtener_sesion
from app.db.modelos import Llamada, ParticipanteLlamada
from app.schemas.llamada import LlamadaCrear, LlamadaLeer


router = APIRouter(prefix="/llamadas", tags=["Llamadas"])


# ============================================================
#  📞 Crear una llamada
# ============================================================
@router.post("", response_model=LlamadaLeer)
async def crear_llamada(
    payload: LlamadaCrear,
    db: AsyncSession = Depends(obtener_sesion)
):
    # Crear la llamada
    llamada = Llamada(
        tipo=payload.tipo,
        iniciador_id=payload.iniciador_id,
        conversacion_id=payload.conversacion_id
    )
    db.add(llamada)
    await db.flush()  # Para disponer del ID antes del commit

    # Registrar participantes
    for uid in payload.participantes:
        p = ParticipanteLlamada(llamada_id=llamada.id, usuario_id=uid)
        db.add(p)

    await db.commit()
    await db.refresh(llamada)

    # Obtener lista simple de IDs de participantes
    parts_q = await db.execute(
        select(ParticipanteLlamada.usuario_id)
        .where(ParticipanteLlamada.llamada_id == llamada.id)
    )
    participantes = [row[0] for row in parts_q.all()]

    return LlamadaLeer(
        id=llamada.id,
        tipo=llamada.tipo,
        iniciador_id=llamada.iniciador_id,
        conversacion_id=llamada.conversacion_id,
        estado=llamada.estado,
        creado_en=llamada.creado_en,
        finalizado_en=llamada.finalizado_en,
        participantes=participantes
    )


# ============================================================
#  📞 Obtener llamada por ID
# ============================================================
@router.get("/{llamada_id}", response_model=LlamadaLeer)
async def obtener_llamada(
    llamada_id: str,
    db: AsyncSession = Depends(obtener_sesion)
):
    llamada = await db.get(Llamada, llamada_id)
    if not llamada:
        raise HTTPException(status_code=404, detail="Llamada no encontrada")

    # Participantes
    parts_q = await db.execute(
        select(ParticipanteLlamada.usuario_id)
        .where(ParticipanteLlamada.llamada_id == llamada.id)
    )
    participantes = [row[0] for row in parts_q.all()]

    return LlamadaLeer(
        id=llamada.id,
        tipo=llamada.tipo,
        iniciador_id=llamada.iniciador_id,
        conversacion_id=llamada.conversacion_id,
        estado=llamada.estado,
        creado_en=llamada.creado_en,
        finalizado_en=llamada.finalizado_en,
        participantes=participantes
    )
