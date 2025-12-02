# app/api/contactos.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from uuid import UUID
from typing import List

from app.db.sesion import obtener_sesion
from app.api.usuarios import validar_sesion_header as validar_sesion
from app.db.modelos import Contacto, Usuario
from app.schemas.contacto import (
    ContactoLeer,
    ContactoCrearTelefono,
    ContactoActualizarAlias,
)

router = APIRouter(prefix="/contactos", tags=["Contactos"])


@router.post("", response_model=ContactoLeer, status_code=status.HTTP_201_CREATED)
async def agregar_contacto(
    payload: ContactoCrearTelefono,
    sesion_web: dict = Depends(validar_sesion),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario_id = sesion_web["usuario_id"]
    telefono = payload.contacto_telefono.strip()
    alias = payload.alias.strip() if payload.alias else None

    if not telefono:
        raise HTTPException(422, detail="Número de teléfono requerido")

    result = await sesion.execute(select(Usuario).where(Usuario.telefono == telefono))
    destino = result.scalar_one_or_none()
    if not destino:
        raise HTTPException(404, detail="Este número no está registrado en BiscoChat")
    if destino.id == usuario_id:
        raise HTTPException(400, detail="No puedes agregarte a ti mismo")

    existe = await sesion.execute(
        select(Contacto).where(
            Contacto.usuario_id == usuario_id,
            Contacto.contacto_id == destino.id
        )
    )
    if existe.scalar_one_or_none():
        raise HTTPException(400, detail="Ya tienes este contacto agregado")

    nuevo = Contacto(usuario_id=usuario_id, contacto_id=destino.id, alias=alias)
    sesion.add(nuevo)
    await sesion.commit()
    await sesion.refresh(nuevo, ["contacto_agregado"])

    perfil = nuevo.contacto_agregado
    nombre_mostrar = nuevo.alias or f"{perfil.nombre or ''} {perfil.apellido or ''}".strip() or perfil.telefono

    return ContactoLeer(
        id=nuevo.id,
        usuario_id=usuario_id,
        contacto_id=nuevo.contacto_id,
        alias=nuevo.alias,
        creado_en=nuevo.creado_en,
        nombre_mostrar=nombre_mostrar,
        telefono=perfil.telefono,
        foto_perfil=perfil.foto_perfil or "https://i.imgur.com/6b5gQ5D.png",
    )


@router.get("", response_model=List[ContactoLeer])
async def listar_contactos(
    sesion_web: dict = Depends(validar_sesion),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario_id = sesion_web["usuario_id"]

    result = await sesion.execute(
        select(Contacto)
        .options(selectinload(Contacto.contacto_agregado))
        .where(Contacto.usuario_id == usuario_id)
        .order_by(Contacto.creado_en.desc())
    )
    contactos = result.scalars().all()

    return [
        ContactoLeer(
            id=c.id,
            usuario_id=c.usuario_id,
            contacto_id=c.contacto_id,
            alias=c.alias,
            creado_en=c.creado_en,
            nombre_mostrar=c.alias or f"{c.contacto_agregado.nombre or ''} {c.contacto_agregado.apellido or ''}".strip() or c.contacto_agregado.telefono,
            telefono=c.contacto_agregado.telefono,
            foto_perfil=c.contacto_agregado.foto_perfil or "https://i.imgur.com/6b5gQ5D.png",
        )
        for c in contactos
    ]


@router.patch("/{contacto_id}/alias", response_model=ContactoLeer)
async def actualizar_alias(
    contacto_id: UUID,
    datos: ContactoActualizarAlias,
    sesion_web: dict = Depends(validar_sesion),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario_id = sesion_web["usuario_id"]

    result = await sesion.execute(
        select(Contacto)
        .options(selectinload(Contacto.contacto_agregado))
        .where(Contacto.id == contacto_id, Contacto.usuario_id == usuario_id)
    )
    contacto = result.scalar_one_or_none()
    if not contacto:
        raise HTTPException(404, detail="Contacto no encontrado")

    contacto.alias = datos.alias
    await sesion.commit()
    await sesion.refresh(contacto)

    perfil = contacto.contacto_agregado
    nombre_mostrar = contacto.alias or f"{perfil.nombre or ''} {perfil.apellido or ''}".strip() or perfil.telefono

    return ContactoLeer(
        id=contacto.id,
        usuario_id=contacto.usuario_id,
        contacto_id=contacto.contacto_id,
        alias=contacto.alias,
        creado_en=contacto.creado_en,
        nombre_mostrar=nombre_mostrar,
        telefono=perfil.telefono,
        foto_perfil=perfil.foto_perfil or "https://i.imgur.com/6b5gQ5D.png",
    )


@router.delete("/{contacto_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_contacto(
    contacto_id: UUID,
    sesion_web: dict = Depends(validar_sesion),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario_id = sesion_web["usuario_id"]

    result = await sesion.execute(
        delete(Contacto).where(
            Contacto.id == contacto_id,
            Contacto.usuario_id == usuario_id
        )
    )
    if result.rowcount == 0:
        raise HTTPException(404, detail="Contacto no encontrado")
    await sesion.commit()
    return None