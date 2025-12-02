# app/api/usuarios_crud.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from app.db.sesion import obtener_sesion
from app.db import crud
from app.schemas.usuario import UsuarioLeer, UsuarioActualizar, UsuarioBase

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])

# ----------------------- Crear usuario -----------------------
@router.post("/", response_model=UsuarioLeer, status_code=status.HTTP_201_CREATED)
async def crear_usuario(usuario: UsuarioBase, db: AsyncSession = Depends(obtener_sesion)):
    existente = await crud.obtener_usuario_por_telefono(db, usuario.telefono)
    if existente:
        raise HTTPException(status_code=400, detail="El teléfono ya está registrado.")

    nuevo = await crud.crear_usuario_minimo(
        db,
        telefono=usuario.telefono,
        nombre=usuario.nombre,
        apellido=usuario.apellido,
        verificado=True,
    )
    return nuevo

# ----------------------- Listar usuarios -----------------------
@router.get("/", response_model=List[UsuarioLeer])
async def listar_usuarios(db: AsyncSession = Depends(obtener_sesion)):
    return await crud.listar_usuarios(db)

# ----------------------- Obtener usuario por ID -----------------------
@router.get("/{usuario_id}", response_model=UsuarioLeer)
async def obtener_usuario(usuario_id: str, db: AsyncSession = Depends(obtener_sesion)):
    usuario = await crud.obtener_usuario_por_id(db, usuario_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return usuario

# ----------------------- Actualizar usuario -----------------------
@router.put("/{usuario_id}", response_model=UsuarioLeer)
async def actualizar_usuario(usuario_id: str, datos: UsuarioActualizar, db: AsyncSession = Depends(obtener_sesion)):
    data = datos.model_dump(exclude_unset=True)
    usuario = await crud.actualizar_usuario(db, usuario_id, data)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return usuario

# ----------------------- Eliminar usuario -----------------------
@router.delete("/{usuario_id}", status_code=status.HTTP_204_NO_CONTENT)
async def eliminar_usuario(usuario_id: str, db: AsyncSession = Depends(obtener_sesion)):
    eliminado = await crud.eliminar_usuario(db, usuario_id)
    if not eliminado:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return None
