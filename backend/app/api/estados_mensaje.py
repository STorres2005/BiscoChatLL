# app/api/estados_mensaje.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from uuid import UUID

from app.db.sesion import obtener_sesion
from app.db.modelos import EstadoMensaje
from app.schemas.estado_mensaje import EstadoMensajeCrear, EstadoMensajeLeer

router = APIRouter(prefix="/estados_mensaje", tags=["EstadosMensaje"])


# -------------------------------------------------------------------------
# POST ✔ Registrar nuevo estado del mensaje (enviado / entregado / leido)
# -------------------------------------------------------------------------
@router.post("", response_model=EstadoMensajeLeer, status_code=status.HTTP_201_CREATED)
async def registrar_estado(payload: EstadoMensajeCrear, db: AsyncSession = Depends(obtener_sesion)):

    nuevo_estado = EstadoMensaje(
        mensaje_id=payload.mensaje_id,
        usuario_id=payload.usuario_id,
        estado=payload.estado
    )

    db.add(nuevo_estado)

    try:
        await db.commit()
        await db.refresh(nuevo_estado)
        return nuevo_estado

    except IntegrityError:
        # ⚠ Ya existe este registro (mensaje_id + usuario_id + estado)
        await db.rollback()

        # → Lo devolvemos (no es error)
        q = await db.execute(
            select(EstadoMensaje).where(
                EstadoMensaje.mensaje_id == payload.mensaje_id,
                EstadoMensaje.usuario_id == payload.usuario_id,
                EstadoMensaje.estado == payload.estado
            )
        )
        existente = q.scalars().first()

        if existente:
            return existente

        # Si NO se encontró → error real
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error inesperado al registrar el estado del mensaje."
        )


# -------------------------------------------------------------------------
# GET ✔ Listar estados de un mensaje
# -------------------------------------------------------------------------
@router.get("/mensaje/{mensaje_id}", response_model=list[EstadoMensajeLeer])
async def estados_de_mensaje(mensaje_id: UUID, db: AsyncSession = Depends(obtener_sesion)):

    q = await db.execute(
        select(EstadoMensaje)
        .where(EstadoMensaje.mensaje_id == mensaje_id)
        .order_by(EstadoMensaje.creado_en.asc())
    )

    return q.scalars().all()
