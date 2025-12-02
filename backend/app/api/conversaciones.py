# app/api/conversaciones.py
from uuid import UUID
from typing import List, Optional
import uuid
from sqlalchemy import update
from fastapi import Response

from datetime import datetime, timezone
from fastapi import Query

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Cookie,
    WebSocket,
    WebSocketDisconnect,
    Request,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete  # 👈 asegúrate de tener delete importado

import jwt

from app.db.sesion import obtener_sesion
from app.db.modelos import (
    Conversacion,
    MiembroConversacion,
    Usuario,
    Mensaje,
    Llamada,
    Contacto,
    EstadoMensaje,     # 👈 AGREGA
    MensajeOculto,     # 👈 AGREGA
    Mencion,           # 👈 AGREGA
    ParticipanteLlamada,  # 👈 para borrar participantes de llamadas
    ReaccionMensaje,
    ConversacionOculta,
)
from app.db import crud
from app.schemas.conversacion import ConversacionCrear, ConversacionLeer, ConversacionDetalle
from app.schemas.mensaje import MensajeCrear, MensajeLeer, MensajeEditar
from app.core.config import config
from app.realtime import sio, CONV_ROOM, USER_ROOM
from fastapi import UploadFile, File, Form
from app.api.files import upload_file
from app.realtime import sio
# from app.api.sockets import manager

# =========================================================
# Routers principales
# =========================================================
router_conversaciones = APIRouter(prefix="/conversaciones", tags=["conversaciones"])
router_mensajes = APIRouter(prefix="/mensajes", tags=["mensajes"])
router_llamadas = APIRouter(prefix="/llamadas", tags=["llamadas"])
router = APIRouter(tags=["chats"])  # para /chats/{usuario_id}


# ============================================================
# 🔥 Helper: obtener nombre visible (alias > teléfono)
# ============================================================
async def obtener_nombre_visible(
    sesion: AsyncSession,
    usuario_actual_id: str,
    usuario_objetivo: Usuario
):
    """
    Devuelve alias si existe,
    sino teléfono (NUNCA nombre real de la BD).
    """

    # Buscar alias en CONTACTOS
    q = await sesion.execute(
        select(Contacto.alias).where(
            Contacto.usuario_id == usuario_actual_id,
            Contacto.contacto_id == str(usuario_objetivo.id)
        )
    )
    alias = q.scalar_one_or_none()

    if alias:
        return alias

    # Si no hay alias → usar teléfono
    if usuario_objetivo.telefono:
        return usuario_objetivo.telefono

    # Último fallback
    return usuario_objetivo.telefono or "Usuario"

# ----------------------------------------------------
# Helper: verificar miembro (VERSIÓN FINAL 2025)
# ----------------------------------------------------
async def _asegurar_miembro(sesion: AsyncSession, conversacion_id: UUID, usuario_id: UUID):
    """
    - En CHATS 1–1: permitir SIEMPRE.
    - En GRUPOS:
        • permitir ver chat si fue miembro alguna vez
        • pero bloquear enviar mensajes si no es activo (eso se controla en enviar_mensaje)
    """

    cid = str(conversacion_id)
    uid = str(usuario_id)

    # Buscar conversación
    conv = await sesion.get(Conversacion, cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no existe")

    # Buscar membresía (activo o inactivo)
    q = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == cid,
            MiembroConversacion.usuario_id == uid
        )
    )
    miembro = q.scalar_one_or_none()

    if not miembro:
        raise HTTPException(status_code=403, detail="No perteneces a esta conversación")

    # CHATS 1 A 1 → permitir siempre
    if not conv.es_grupo:
        return miembro

    # GRUPOS → permitir ver historial aunque esté inactivo
    return miembro


# ----------------------------------------------------
# Helper: obtener usuario desde cookie / JWT / header
# ----------------------------------------------------
async def _obtener_usuario_desde_cookie(
    auth_token: Optional[str],
    sesion: AsyncSession,
    request: Optional[Request] = None
) -> Usuario:
    token = auth_token
    if not token and request:
        token = request.query_params.get("jwt")
    if not token and request:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado (falta token)")

    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido (sin sub)")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

    usuario = await sesion.get(Usuario, user_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return usuario


# ----------------------------------------------------
# 🗨️ Listar conversaciones del usuario
# ----------------------------------------------------
@router_conversaciones.get("", response_model=List[ConversacionLeer])
async def listar_conversaciones(
    request: Request,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)
    conversaciones = await crud.obtener_conversaciones_usuario(sesion, str(usuario.id))
    return conversaciones



# ----------------------------------------------------
# 🆕 Crear conversación (VERSIÓN 100% CORREGIDA)
# ----------------------------------------------------
@router_conversaciones.post("", response_model=ConversacionDetalle, status_code=201)
async def crear_conversacion(
    request: Request,
    payload: ConversacionCrear,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # ----------------------------------------------------
    # Normalizar lista de miembros
    # ----------------------------------------------------
    miembros: List[UUID] = list(set(payload.miembros or []))

    # Asegurar que el usuario actual esté incluido
    if usuario.id not in miembros:
        miembros.append(usuario.id)

    miembros_str = [str(m) for m in miembros]
    usuario_id_str = str(usuario.id)

    # ----------------------------------------------------
    # CHAT INDIVIDUAL 1 A 1
    # ----------------------------------------------------
    if not payload.es_grupo and len(miembros) == 2:

        otro_id = next(m for m in miembros if m != usuario.id)
        otro_id_str = str(otro_id)

        # ============================
        # BUSCAR CHAT 1 A 1 REAL
        # ============================
        # SOLO conversaciones:
        # - es_grupo == False
        # - EXACTAMENTE 2 miembros
        # - ambos activos
        # - los 2 ids corresponden exactamente usuario + otro
        # ============================

        q_conv = await sesion.execute(
            select(Conversacion.id)
            .where(Conversacion.es_grupo == False)
        )
        candidatos = q_conv.scalars().all()

        existente = None

        for cid in candidatos:

            # obtener usuario_id y activo
            rows = await sesion.execute(
                select(
                    MiembroConversacion.usuario_id,
                    MiembroConversacion.activo
                ).where(MiembroConversacion.conversacion_id == cid)
            )
            miembros_chat = rows.all()

            # Debe tener EXACTAMENTE 2 miembros
            if len(miembros_chat) != 2:
                continue

            # Ambos activos
            if not all(row[1] for row in miembros_chat):
                continue

            ids = {row[0] for row in miembros_chat}

            # Deben ser EXACTAMENTE usuario + otro
            if ids == {usuario_id_str, otro_id_str}:
                existente = await sesion.get(Conversacion, cid)
                break

        # Reusar conversación existente correcta
        if existente:
            return ConversacionDetalle(
                id=existente.id,
                titulo=existente.titulo,
                es_grupo=existente.es_grupo,
                creado_en=existente.creado_en,
                miembros=miembros,
            )

        # ----------------------------------------------------
        # Determinar nombre del chat 1 a 1
        # ----------------------------------------------------
        q_contacto = await sesion.execute(
            select(Contacto).where(
                Contacto.usuario_id == usuario.id,
                Contacto.contacto_id == otro_id,
            )
        )
        contacto = q_contacto.scalars().first()

        if contacto and contacto.alias:
            nombre_chat = contacto.alias
        else:
            q_otro = await sesion.execute(
                select(Usuario).where(Usuario.id == otro_id)
            )
            otro_usuario = q_otro.scalar_one_or_none()

            if otro_usuario:
                nombre_chat = (
                    (otro_usuario.nombre or "").strip()
                    or (otro_usuario.telefono or "").strip()
                    or "Chat"
                )
            else:
                nombre_chat = "Chat"

    # ----------------------------------------------------
    # GRUPOS
    # ----------------------------------------------------
    else:
        nombre_chat = payload.titulo or "Nuevo grupo"

    # ----------------------------------------------------
    # CREAR NUEVA CONVERSACIÓN
    # ----------------------------------------------------
    conv = await crud.crear_conversacion(
        sesion,
        titulo=nombre_chat,
        creador_id=str(usuario.id),
        es_grupo=payload.es_grupo,
    )

    # Insertar miembros como activos
    for uid in miembros:
        await crud.agregar_miembro_conversacion(sesion, conv.id, str(uid))

    await sesion.commit()
    await sesion.refresh(conv)

    # ----------------------------------------------------
    # Emitir por socket a todos los miembros
    # ----------------------------------------------------
    payload_socket = {
        "tipo": "conversacion_creada",
        "creador_id": str(usuario.id),
        "conversacion": {
            "id": str(conv.id),
            "es_grupo": conv.es_grupo,
            "titulo": conv.titulo,
        },
    }

    q_miembros = await sesion.execute(
        select(MiembroConversacion.usuario_id)
        .where(MiembroConversacion.conversacion_id == conv.id)
    )

    for (uid,) in q_miembros.all():
        await sio.emit(
            "conversacion_creada",
            payload_socket,
            room=USER_ROOM(str(uid)),
        )

    return ConversacionDetalle(
        id=conv.id,
        titulo=conv.titulo,
        es_grupo=conv.es_grupo,
        creado_en=conv.creado_en,
        miembros=miembros,
    )


# ============================================================
# 📎 ENVIAR MENSAJE CON ARCHIVO (imagen / video / audio / doc)
# ============================================================
@router_conversaciones.post("/{conversacion_id}/archivo")
async def enviar_archivo(
    request: Request,
    conversacion_id: str,
    file: UploadFile = File(...),      # 👈 NOMBRE EXACTO: "file"
    usuario_id: str = Form(...),       # 👈 viene en el FormData
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # 1) Validar conversación
    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # 2) Subir archivo al disco usando el helper de files.py
    file_info = await upload_file(request, file)

    # 3) Crear mensaje en la BD
    nuevo = Mensaje(
        conversacion_id=conversacion_id,
        remitente_id=usuario_id,
        cuerpo="",  # vacío si es archivo
        tipo="archivo",
        url_adjunto=file_info["url"],
        tipo_adjunto=file_info["tipo"],
        tamano_adjunto=file_info["tamano"],
        nombre_archivo=file_info["nombre_archivo"],
    )

    sesion.add(nuevo)
    await sesion.commit()
    await sesion.refresh(nuevo)

    # 4) Notificar en tiempo real a los miembros
    data_emit = {
        "id": str(nuevo.id),
        "conversacion_id": conversacion_id,
        "usuario_id": usuario_id,
        "cuerpo": "",
        "tipo": "archivo",
        "url_adjunto": file_info["url"],
        "tipo_adjunto": file_info["tipo"],
        "tamano_adjunto": file_info["tamano"],
        "nombre_archivo": file_info["nombre_archivo"],
        "creado_en": nuevo.creado_en.isoformat(),
    }

    # 👉 usa la sala del USER si quieres, o la de la conv:
    await sio.emit("mensaje_recibido", data_emit, room=CONV_ROOM(conversacion_id))

    # 5) Devolver al frontend el mensaje ya creado
    return data_emit


# ============================================================
# 📌 OBTENER MIEMBROS DEL GRUPO — CON ALIAS Y TELÉFONO (FINAL)
# ============================================================
@router_conversaciones.get("/conversaciones/{conv_id}/miembros")
async def obtener_miembros_grupo(
    conv_id: str,
    request: Request,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # 🔐 1) Usuario autenticado (alias > teléfono)
    usuario_actual = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 🔎 2) Validar que la conversación existe
    conv = await sesion.get(Conversacion, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # 📌 3) Obtener miembros activos del grupo
    res = await sesion.execute(
        select(MiembroConversacion, Usuario)
        .join(Usuario, Usuario.id == MiembroConversacion.usuario_id)
        .where(
            MiembroConversacion.conversacion_id == conv_id,
            MiembroConversacion.activo == True
        )
        .order_by(MiembroConversacion.creado_en)
    )

    rows = res.all()
    miembros = []

    # 📌 4) Para cada miembro, obtener alias > teléfono
    for mc, user in rows:

        q_alias = await sesion.execute(
            select(Contacto.alias)
            .where(
                Contacto.usuario_id == usuario_actual.id,     # mi agenda
                Contacto.contacto_id == user.id               # contacto objetivo
            )
        )
        alias = q_alias.scalar_one_or_none()

        miembros.append({
            "id": str(user.id),
            "alias": alias or "",
            "telefono": user.telefono or "",
            "foto_perfil": user.foto_perfil or None
        })

    return miembros


# ============================================================
# 🔵 OBTENER ESTADOS DE MENSAJES (✓ / ✓✓)
# ============================================================
@router_conversaciones.get("/{conversacion_id}/estados")
async def obtener_estados_mensajes(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion)
):
    # 1️⃣ usuario autenticado
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 2️⃣ validar membresía (activo o inactivo)
    await _asegurar_miembro(sesion, conversacion_id, usuario.id)

    # 3️⃣ obtener estados de todos los mensajes de esta conversación
    q = await sesion.execute(
        select(
            EstadoMensaje.mensaje_id,
            EstadoMensaje.usuario_id,
            EstadoMensaje.estado
        )
        .join(Mensaje, Mensaje.id == EstadoMensaje.mensaje_id)
        .where(Mensaje.conversacion_id == conversacion_id)
    )

    rows = q.all()

    # 4️⃣ Formato EXACTO que espera tu frontend
    estados = [
        {
            "mensaje_id": str(mid),
            "usuario_id": str(uid),
            "estado": est
        }
        for mid, uid, est in rows
    ]

    return {"ok": True, "estados": estados}

# ----------------------------------------------------
# 📨 LISTAR MENSAJES DE UNA CONVERSACIÓN (OFICIAL)
# ----------------------------------------------------
@router_conversaciones.get("/{conversacion_id}/mensajes", response_model=List[MensajeLeer])
async def listar_mensajes(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # Usuario autenticado
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # Verificar membresía
    res_miembro = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario.id,
        )
    )
    miembro = res_miembro.scalar_one_or_none()
    if not miembro:
        raise HTTPException(403, "No perteneces a esta conversación")

    # Seleccionar mensajes visibles
    res_msg = await sesion.execute(
        select(Mensaje)
        .outerjoin(
            MensajeOculto,
            (MensajeOculto.mensaje_id == Mensaje.id)
            & (MensajeOculto.usuario_id == usuario.id),
        )
        .where(
            Mensaje.conversacion_id == conversacion_id,
            MensajeOculto.mensaje_id.is_(None),
        )
        .order_by(Mensaje.creado_en.asc())
    )

    mensajes = res_msg.scalars().all()

    # Si salió, cortar
    if not miembro.activo and miembro.fecha_salida:
        mensajes = [m for m in mensajes if m.creado_en <= miembro.fecha_salida]

    # Si ingresó después, cortar anteriores
    if miembro.activo and miembro.creado_en:
        mensajes = [m for m in mensajes if m.creado_en >= miembro.creado_en]

    return mensajes



# ----------------------------------------------------
# 🆕 Eliminar conversación (solo para MÍ, y borrar todo
#     solo si ya no quedan miembros)
# ----------------------------------------------------
@router_conversaciones.delete("/{conversacion_id}", status_code=204)
async def eliminar_conversacion(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # 1️⃣ Usuario autenticado
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 2️⃣ Verificar que la conversación exista
    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    # 3️⃣ Verificar que el usuario sea miembro de la conversación
    res_miembro = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario.id,
        )
    )
    miembro = res_miembro.scalar_one_or_none()
    if not miembro:
        raise HTTPException(
            status_code=404,
            detail="No perteneces a esta conversación o ya la eliminaste",
        )

    # 4️⃣ ELIMINAR COMPLETAMENTE SU MEMBRESÍA
    #    (para que JAMÁS vuelva a aparecerle en la lista de chats)
    await sesion.execute(
        delete(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario.id,
        )
    )
    await sesion.flush()

    # 5️⃣ Ver cuántos miembros quedan en TOTAL
    res_count = await sesion.execute(
        select(func.count())
        .select_from(MiembroConversacion)
        .where(MiembroConversacion.conversacion_id == conversacion_id)
    )
    restantes = res_count.scalar_one() or 0

    # 6️⃣ Si todavía quedan miembros → no borramos nada más
    #     (ellos siguen viendo el chat normal)
    if restantes > 0:
        await sesion.commit()
        return Response(status_code=204)

    # 🧹 7️⃣ Si NO queda NADIE, eliminar TODO lo relacionado

    # == MENSAJES ==
    res_ids = await sesion.execute(
        select(Mensaje.id).where(Mensaje.conversacion_id == conversacion_id)
    )
    msg_ids = [row[0] for row in res_ids.all()]

    if msg_ids:
        await sesion.execute(
            delete(EstadoMensaje).where(EstadoMensaje.mensaje_id.in_(msg_ids))
        )
        await sesion.execute(
            delete(MensajeOculto).where(MensajeOculto.mensaje_id.in_(msg_ids))
        )
        await sesion.execute(
            delete(Mencion).where(Mencion.mensaje_id.in_(msg_ids))
        )
        await sesion.execute(
            delete(ReaccionMensaje).where(ReaccionMensaje.mensaje_id.in_(msg_ids))
        )
        await sesion.execute(
            delete(Mensaje).where(Mensaje.id.in_(msg_ids))
        )

    # == LLAMADAS ==
    res_llam = await sesion.execute(
        select(Llamada.id).where(Llamada.conversacion_id == conversacion_id)
    )
    llam_ids = [row[0] for row in res_llam.all()]

    if llam_ids:
        await sesion.execute(
            delete(ParticipanteLlamada).where(
                ParticipanteLlamada.llamada_id.in_(llam_ids)
            )
        )
        await sesion.execute(
            delete(Llamada).where(Llamada.id.in_(llam_ids))
        )

    # == CONVERSACIONES OCULTAS (por si existiera algo viejo) ==
    await sesion.execute(
        delete(ConversacionOculta).where(
            ConversacionOculta.conversacion_id == conversacion_id
        )
    )

    # == CONVERSACIÓN ==
    await sesion.execute(
        delete(Conversacion).where(Conversacion.id == conversacion_id)
    )

    await sesion.commit()
    return Response(status_code=204)

# ===================================================================
# 📨 ENVIAR MENSAJE — VERSIÓN FINAL, COMPLETA Y SIN DUPLICADOS
# ===================================================================
@router_conversaciones.post(
    "/{conversacion_id}/mensajes",
    response_model=MensajeLeer,
    status_code=201
)
async def enviar_mensaje(
    request: Request,
    conversacion_id: UUID,
    payload: MensajeCrear,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # ---------------------------------------------------
    # 1️⃣ Autenticación del usuario
    # ---------------------------------------------------
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # ---------------------------------------------------
    # 2️⃣ La conversación existe?
    # ---------------------------------------------------
    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv:
        raise HTTPException(404, "Conversación no encontrada")

    # ---------------------------------------------------
    # 3️⃣ Verificar que el usuario sigue dentro del grupo
    # ---------------------------------------------------
    miembro = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario.id,
            MiembroConversacion.activo.is_(True)
        )
    )
    miembro = miembro.scalar_one_or_none()

    if not miembro:
        raise HTTPException(403, "No puedes enviar mensajes en esta conversación")

    # ---------------------------------------------------
    # 4️⃣ Crear el mensaje usando tu CRUD (corregido)
    # ---------------------------------------------------
    msg = await crud.enviar_mensaje(
        db=sesion,
        conversacion_id=str(conversacion_id),
        remitente_id=str(usuario.id),
        cuerpo=payload.cuerpo,
        mensaje_id_respuesta=payload.mensaje_id_respuesta,
        mencionados_ids=payload.mencionados   # TU BACKEND RECIBE ESTO
    )
    await sesion.flush()

    # ---------------------------------------------------
    # 5️⃣ Listar miembros activos de la conversación
    # ---------------------------------------------------
    q = select(MiembroConversacion.usuario_id).where(
        MiembroConversacion.conversacion_id == conversacion_id,
        MiembroConversacion.activo.is_(True)
    )
    miembros_activos = (await sesion.execute(q)).scalars().all()

    estados_iniciales = []
    destinos = []

    # ---------------------------------------------------
    # 6️⃣ Registrar estados iniciales (SIN DUPLICADOS)
    # ---------------------------------------------------
    for uid in miembros_activos:
        uid = str(uid)

        # el remitente no recibe estado (solo lectura)
        if uid == str(usuario.id):
            continue

        u = await sesion.get(Usuario, uid)
        esta_online = bool(u and u.en_linea)

        estado = "enviado" if esta_online else "pendiente"

        sesion.add(EstadoMensaje(
            id=uuid.uuid4(),
            mensaje_id=msg.id,
            usuario_id=uid,
            estado=estado
        ))

        estados_iniciales.append({
            "usuario_id": uid,
            "estado": estado
        })

        destinos.append(uid)

    await sesion.commit()
    await sesion.refresh(msg, attribute_names=["menciones"])


    # ---------------------------------------------------
    # 7️⃣ Preparar JSON para Sockets
    # ---------------------------------------------------
    msg_dict = {
        "id": str(msg.id),
        "usuario_id": str(usuario.id),
        "conversacion_id": str(conversacion_id),
        "cuerpo": msg.cuerpo,
        "tipo": msg.tipo,
        "creado_en": msg.creado_en.isoformat(),
        "mensaje_id_respuesta": (
            str(msg.mensaje_id_respuesta)
            if msg.mensaje_id_respuesta else None
        )
    }

    # ---------------------------------------------------
    # 8️⃣ Emitir el mensaje solo a los otros miembros
    # ---------------------------------------------------
    for uid in destinos:
        await sio.emit(
            "mensaje_recibido",
            msg_dict,
            room=USER_ROOM(uid)
        )

    # ---------------------------------------------------
    # 9️⃣ Emitir estados iniciales SOLO al remitente
    # ---------------------------------------------------
    await sio.emit(
        "estado_mensaje_inicial",
        {
            "mensaje_id": str(msg.id),
            "conversacion_id": str(conversacion_id),
            "estados": estados_iniciales
        },
        room=USER_ROOM(str(usuario.id))
    )

    # ---------------------------------------------------
    # 🔟 Retorno Pydantic FINAL seguro y limpio
    # ---------------------------------------------------
    return MensajeLeer.model_validate({
        "id": msg.id,
        "conversacion_id": msg.conversacion_id,
        "remitente_id": str(msg.remitente_id) if msg.remitente_id else None,
        "cuerpo": msg.cuerpo,
        "tipo": msg.tipo,
        "creado_en": msg.creado_en,
        "editado_en": msg.editado_en,
        "borrado_en": msg.borrado_en,
        "url_adjunto": msg.url_adjunto,
        "tipo_adjunto": msg.tipo_adjunto,
        "mensaje_id_respuesta": (
            str(msg.mensaje_id_respuesta)
            if msg.mensaje_id_respuesta else None
        ),
        "mencionados": [m.usuario_id for m in msg.menciones]
    })




# ----------------------------------------------------
# 🟢 MARCAR MENSAJES COMO LEÍDOS (VERSIÓN CORREGIDA)
# ----------------------------------------------------

@router_conversaciones.put("/{conversacion_id}/marcar_leidos", status_code=204)
async def marcar_leidos(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion)
):
    # 1️⃣ Usuario autenticado
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 2️⃣ Validar que pertenece (aunque inactivo)
    await _asegurar_miembro(sesion, conversacion_id, usuario.id)

    # 3️⃣ Actualizar estados → marcar como leido
    await sesion.execute(
        update(EstadoMensaje)
        .where(
            EstadoMensaje.usuario_id == str(usuario.id),
            EstadoMensaje.estado != "leido",
            EstadoMensaje.mensaje_id.in_(
                select(Mensaje.id).where(Mensaje.conversacion_id == conversacion_id)
            )
        )
        .values(
            estado="leido"
        )
    )

    await sesion.commit()
    return Response(status_code=204)



# ----------------------------------------------------
# 🧑‍💼 ADMINISTRAR MIEMBROS DEL GRUPO (VERSIÓN DEFINITIVA 2025)
# ----------------------------------------------------
@router_conversaciones.delete("/{conversacion_id}/miembros/{usuario_objetivo}", status_code=204)
async def administrar_miembro_grupo(
    request: Request,
    conversacion_id: UUID,
    usuario_objetivo: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # Usuario que hace la acción
    usuario_actor = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv or not conv.es_grupo:
        raise HTTPException(404, "Grupo no encontrado")

    await _asegurar_miembro(sesion, conversacion_id, usuario_actor.id)

    es_salida_propia = str(usuario_objetivo) == str(usuario_actor.id)
    actor_es_admin = str(conv.creador_id) == str(usuario_actor.id)

    # Si NO es salida propia → solo admin puede expulsar
    if not es_salida_propia and not actor_es_admin:
        raise HTTPException(403, "Solo el administrador puede eliminar miembros")

    # Obtener membresía
    res = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario_objetivo
        )
    )
    miembro = res.scalar_one_or_none()
    if not miembro:
        raise HTTPException(404, "Miembro no pertenece al grupo")

    # No se puede expulsar al admin si él no es quien sale
    if not es_salida_propia and str(usuario_objetivo) == str(conv.creador_id):
        raise HTTPException(400, "No puedes expulsar al administrador actual")

    # Marcar salida
    miembro.activo = False
    miembro.fecha_salida = datetime.utcnow()

    usuario_salida = await sesion.get(Usuario, usuario_objetivo)

    # ------------------------------
    # FUNCIÓN nombre_visible(alias>telefono)
    # ------------------------------
    async def nombre_visible(visto_por, usuario_obj):
        q_alias = await sesion.execute(
            select(Contacto).where(
                Contacto.usuario_id == visto_por,
                Contacto.contacto_id == usuario_obj.id
            )
        )
        c = q_alias.scalar_one_or_none()
        return c.alias if (c and c.alias) else usuario_obj.telefono

    # nombres visibles
    nombre_salida_para_actor = await nombre_visible(usuario_actor.id, usuario_salida)
    nombre_actor_visible = await nombre_visible(usuario_actor.id, usuario_actor)

    # ----------------------------------------------------
    # TRANSFERENCIA AUTOMÁTICA DE ADMINISTRADOR
    # ----------------------------------------------------
    nuevo_admin_id = None
    if str(conv.creador_id) == str(usuario_objetivo):
        q = await sesion.execute(
            select(MiembroConversacion)
            .where(
                MiembroConversacion.conversacion_id == conversacion_id,
                MiembroConversacion.activo.is_(True)
            )
            .order_by(func.random())
        )
        nuevo = q.scalars().first()

        if nuevo:
            conv.creador_id = nuevo.usuario_id
            nuevo_admin_id = str(nuevo.usuario_id)
        else:
            conv.creador_id = None

    await sesion.flush()

    # ----------------------------------------------------
    # 🔵 MENSAJE PARA EL ADMIN Y MIEMBROS
    # ----------------------------------------------------
    # Cada usuario debe ver un mensaje personalizado
    # así que NO grabamos "Has eliminado..." en DB.
    # Solo se guarda la versión neutra:
    #   "AdminAlias eliminó a Alias"
    if es_salida_propia:
        cuerpo_msg_db = f"{usuario_salida.telefono} salió del grupo"
    else:
        cuerpo_msg_db = f"{usuario_actor.telefono} eliminó a {usuario_salida.telefono}"

    msg_db = Mensaje(
        id=uuid.uuid4(),
        conversacion_id=conversacion_id,
        remitente_id=None,
        cuerpo=cuerpo_msg_db,
        creado_en=datetime.utcnow(),
        tipo="sistema"
    )
    sesion.add(msg_db)

    # ----------------------------------------------------
    # 🔵 MENSAJE NUEVO ADMIN (NEUTRO)
    # ----------------------------------------------------
    if nuevo_admin_id:
        usuario_nuevo_admin = await sesion.get(Usuario, nuevo_admin_id)
        msg_admin_db = Mensaje(
            id=uuid.uuid4(),
            conversacion_id=conversacion_id,
            remitente_id=None,
            cuerpo=f"{usuario_nuevo_admin.telefono} ahora es el administrador",
            creado_en=datetime.utcnow(),
            tipo="sistema"
        )
        sesion.add(msg_admin_db)

    await sesion.commit()

    # ----------------------------------------------------
    # 🔵 SOCKET - mensaje personalizado para cada usuario
    # ----------------------------------------------------
    await sio.emit(
        "usuario_salio_grupo",
        {
            "conversacion_id": str(conversacion_id),
            "usuario_id": str(usuario_objetivo),

            # nombre visible para todos (alias>telefono)
            "nombre_salida": await nombre_visible(usuario_actor.id, usuario_salida),

            # para que el front personalice:
            "actor_id": str(usuario_actor.id),
            "actor_nombre": nombre_actor_visible,
            "es_salida_propia": es_salida_propia,
            "nuevo_admin_id": nuevo_admin_id,
        },
        room=CONV_ROOM(str(conversacion_id)),
    )

    # nuevo admin → emitir
    if nuevo_admin_id:
        usuario_admin_nuevo = await sesion.get(Usuario, nuevo_admin_id)
        await sio.emit(
            "nuevo_admin_grupo",
            {
                "conversacion_id": str(conversacion_id),
                "nuevo_admin_id": nuevo_admin_id,
                "nombre": await nombre_visible(usuario_actor.id, usuario_admin_nuevo),
            },
            room=CONV_ROOM(str(conversacion_id)),
        )

    return Response(status_code=204)




# ----------------------------------------------------
# 🟢 AGREGAR MIEMBROS AL GRUPO (VERSIÓN DEFINITIVA 2025)
# ----------------------------------------------------
@router_conversaciones.post("/{conversacion_id}/miembros/agregar", status_code=201)
async def agregar_miembros_grupo(
    request: Request,
    conversacion_id: UUID,
    payload: dict,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    """
    Agrega uno o varios miembros a un grupo.
    Y ENVÍA MENSAJES PERSONALIZADOS:
       - Para el admin: "Has agregado a X"
       - Para los demás: "AdminAlias agregó a X"
    """

    # Usuario que hace la acción (admin)
    usuario_admin = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # Validar grupo
    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv or not conv.es_grupo:
        raise HTTPException(400, "Esta conversación no es un grupo")

    # Validar que sea miembro
    await _asegurar_miembro(sesion, conversacion_id, usuario_admin.id)

    # Validar admin
    if str(conv.creador_id) != str(usuario_admin.id):
        raise HTTPException(403, "Solo el administrador puede agregar miembros")

    nuevos = payload.get("miembros", [])
    if not nuevos:
        raise HTTPException(400, "No se enviaron miembros")

    # Miembros actuales
    q_actuales = await sesion.execute(
        select(MiembroConversacion.usuario_id)
        .where(MiembroConversacion.conversacion_id == conversacion_id)
    )
    actuales = {row[0] for row in q_actuales.all()}

    agregados = []

    # Insertar nuevos
    for uid in nuevos:
        uid = str(uid)
        if uid in actuales:
            continue

        sesion.add(
            MiembroConversacion(
                id=uuid.uuid4(),
                conversacion_id=str(conversacion_id),
                usuario_id=uid,
                activo=True,
                fecha_salida=None
            )
        )
        agregados.append(uid)

    if not agregados:
        return {"agregados": [], "mensaje": "No se agregaron nuevos miembros"}

    await sesion.commit()

    # ----------------------------------------------------
    # ALIAS O TELÉFONO (alias > teléfono)
    # ----------------------------------------------------
    async def nombre_visible(para_usuario_id, usuario_obj):
        q_alias = await sesion.execute(
            select(Contacto).where(
                Contacto.usuario_id == para_usuario_id,
                Contacto.contacto_id == usuario_obj.id
            )
        )
        c = q_alias.scalar_one_or_none()
        return c.alias if (c and c.alias) else usuario_obj.telefono

    # Obtener nombre visible del admin para él mismo
    admin_visible_para_admin = await nombre_visible(usuario_admin.id, usuario_admin)

    # ----------------------------------------------------
    # CREAR MENSAJE EN BD (versión NEUTRA)
    # ----------------------------------------------------
    for uid in agregados:
        usuario_nuevo = await sesion.get(Usuario, uid)

        # nombre visible del NUEVO miembro
        nombre_nuevo_para_admin = await nombre_visible(usuario_admin.id, usuario_nuevo)

        # Mensaje NEUTRO para BD:
        #    "AdminTel agregó a NuevoTel"
        msg_db = Mensaje(
            id=uuid.uuid4(),
            conversacion_id=conversacion_id,
            remitente_id=None,
            cuerpo=f"{usuario_admin.telefono} agregó a {usuario_nuevo.telefono}",
            creado_en=datetime.utcnow(),
            tipo="sistema"
        )
        sesion.add(msg_db)

    await sesion.commit()

    # ----------------------------------------------------
    # SOCKETS — PERSONALIZAR EL MENSAJE EN FRONT
    # ----------------------------------------------------
    for uid in agregados:

        usuario_nuevo = await sesion.get(Usuario, uid)

        # nombre visible del nuevo para el admin
        nombre_nuevo_para_admin = await nombre_visible(usuario_admin.id, usuario_nuevo)

        # Emitir a la sala del grupo (lo recibirán todos)
        await sio.emit(
            "miembro_agregado",
            {
                "conversacion_id": str(conversacion_id),

                # Para que el FRONT personalice:
                "nuevo_id": uid,
                "admin_id": str(usuario_admin.id),

                "admin_visible": admin_visible_para_admin,
                "nuevo_visible": nombre_nuevo_para_admin,
            },
            room=CONV_ROOM(str(conversacion_id)),
        )

        # Enviar chat al usuario nuevo SIN RECARGAR
        await sio.emit(
            "nuevo_chat",
            {
                "id": str(conversacion_id),
                "titulo": conv.titulo,
                "es_grupo": True,
            },
            room=USER_ROOM(uid),
        )

    return {"agregados": agregados}


# ----------------------------------------------------
# 📨 Vaciar mensajes de una conversación (SOLO PARA MÍ)
#     - No borra los Mensaje de la BD.
#     - Marca todos como ocultos para el usuario actual.
# ----------------------------------------------------
@router_mensajes.delete("/{conversacion_id}/mensajes", status_code=204)
async def vaciar_mensajes_conversacion(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # 1️⃣ Usuario autenticado y miembro de la conversación
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)
    await _asegurar_miembro(sesion, conversacion_id, usuario.id)

    # 2️⃣ Obtener TODOS los mensajes de esta conversación
    res_ids = await sesion.execute(
        select(Mensaje.id).where(Mensaje.conversacion_id == conversacion_id)
    )
    msg_ids = [row[0] for row in res_ids.all()]

    if not msg_ids:
        # No hay mensajes → nada que hacer
        return Response(status_code=204)

    # 3️⃣ Ver qué mensajes YA están ocultos para este usuario
    res_ocultos = await sesion.execute(
        select(MensajeOculto.mensaje_id).where(
            MensajeOculto.usuario_id == usuario.id,
            MensajeOculto.mensaje_id.in_(msg_ids),
        )
    )
    ocultos_existentes = {row[0] for row in res_ocultos.all()}

    # 4️⃣ Crear registros MensajeOculto sólo para los que falten
    for mid in msg_ids:
        if mid not in ocultos_existentes:
            sesion.add(
                MensajeOculto(
                    mensaje_id=mid,
                    usuario_id=usuario.id,
                )
            )

    await sesion.commit()

    # 204 → el front solo mira resp.ok
    return Response(status_code=204)


@router_mensajes.delete("/mensajes/{mensaje_id}", status_code=204)
async def eliminar_mensaje(
    request: Request,
    mensaje_id: UUID,
    modo: str = Query("para_mi", pattern="^(para_mi|para_todos)$"),
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # 🔐 Usuario actual
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 📩 Buscar mensaje
    msg = await sesion.get(Mensaje, mensaje_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")

    # ✅ Asegurar que el usuario pertenece a la conversación
    await _asegurar_miembro(sesion, msg.conversacion_id, usuario.id)

    # ─────────────────────────────────────────────
    #  MODO 1: ELIMINAR SOLO PARA MÍ
    # ─────────────────────────────────────────────
    if modo == "para_mi":
        existe_q = await sesion.execute(
            select(MensajeOculto).where(
                MensajeOculto.mensaje_id == mensaje_id,
                MensajeOculto.usuario_id == usuario.id,
            )
        )
        existe = existe_q.scalars().first()

        if not existe:
            sesion.add(MensajeOculto(mensaje_id=mensaje_id, usuario_id=usuario.id))
            await sesion.commit()

        payload = {
            "tipo": "mensaje_eliminado",
            "modo": "para_mi",
            "mensaje_id": str(msg.id),
            "conversacion_id": str(msg.conversacion_id),
            "usuario_id": str(usuario.id),
        }

        # Solo se emite al usuario que lo borró (por si tiene más pestañas abiertas)
        await sio.emit("mensaje_eliminado", payload, room=USER_ROOM(str(usuario.id)))
        return Response(status_code=204)

    # ─────────────────────────────────────────────
    #  MODO 2: ELIMINAR PARA TODOS
    # ─────────────────────────────────────────────

    # Solo el remitente puede borrar para todos
    if msg.remitente_id != usuario.id:
        raise HTTPException(status_code=403, detail="Solo el autor puede eliminar para todos")

    # Cambiamos el cuerpo del mensaje a texto estándar
    msg.cuerpo = "Este mensaje fue eliminado"

    # Si el modelo tiene columna 'borrado_en', la llenamos
    if hasattr(msg, "borrado_en"):
        msg.borrado_en = datetime.utcnow()

    await sesion.commit()

    payload = {
        "tipo": "mensaje_eliminado",
        "modo": "para_todos",
        "mensaje_id": str(msg.id),
        "conversacion_id": str(msg.conversacion_id),
        "texto": msg.cuerpo,
    }

    # A todos los miembros de la conversación (sala de la conversación)
    await sio.emit("mensaje_eliminado", payload, room=CONV_ROOM(str(msg.conversacion_id)))

    # Y además a cada usuario por si tiene más pestañas abiertas
    q_miembros = await sesion.execute(
        select(MiembroConversacion.usuario_id).where(
            MiembroConversacion.conversacion_id == msg.conversacion_id
        )
    )
    for (uid,) in q_miembros.all():
        await sio.emit("mensaje_eliminado", payload, room=USER_ROOM(str(uid)))

    return Response(status_code=204)


@router_mensajes.put("/{mensaje_id}", response_model=MensajeLeer)
async def editar_mensaje(
    request: Request,
    mensaje_id: UUID,
    payload: MensajeEditar,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    """
    Editar el texto de un mensaje existente.
    - Solo puede editarlo el remitente del mensaje.
    - Notifica por Socket.IO a todos los miembros de la conversación.
    """
    # 🔐 Usuario actual
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # 📩 Buscar mensaje
    msg = await sesion.get(Mensaje, mensaje_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Mensaje no encontrado")

    # ✅ Asegurar que el usuario pertenece a la conversación
    await _asegurar_miembro(sesion, msg.conversacion_id, usuario.id)

    # Solo el remitente puede editar
    if msg.remitente_id != usuario.id:
        raise HTTPException(status_code=403, detail="Solo el autor puede editar este mensaje")

    # 📝 Actualizar cuerpo
    nuevo_texto = (payload.cuerpo or "").trim()
    if not nuevo_texto:
        raise HTTPException(status_code=400, detail="El mensaje no puede quedar vacío")

    msg.cuerpo = nuevo_texto

    ahora = datetime.utcnow()
    if hasattr(msg, "editado_en"):
        msg.editado_en = ahora
    if hasattr(msg, "editado"):
        msg.editado = True

    await sesion.commit()
    await sesion.refresh(msg)

    # 🔔 Payload para Socket.IO
    payload_socket = {
        "tipo": "mensaje_editado",
        "mensaje_id": str(msg.id),
        "conversacion_id": str(msg.conversacion_id),
        "cuerpo": msg.cuerpo,
        "editado_en": msg.editado_en.isoformat() if msg.editado_en else None,
    }

    # Emitir actualización a la sala del grupo/chat
    await sio.emit(
        "mensaje_editado",
        payload_socket,
        room=CONV_ROOM(str(msg.conversacion_id)),
    )

    # Emitir a todas las sesiones del usuario
    q_miembros = await sesion.execute(
        select(MiembroConversacion.usuario_id).where(
            MiembroConversacion.conversacion_id == msg.conversacion_id
        )
    )
    for (uid,) in q_miembros.all():
        await sio.emit("mensaje_editado", payload_socket, room=USER_ROOM(str(uid)))

    return msg


@router_mensajes.post("/mensajes/{mensaje_id}/reacciones")
async def reaccionar(
    request: Request,
    mensaje_id: UUID,
    emoji: str = Query(...),
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion)
):
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # Guardar reacción
    reaccion = ReaccionMensaje(
        id=uuid.uuid4(),
        mensaje_id=mensaje_id,
        usuario_id=usuario.id,
        emoji=emoji
    )
    sesion.add(reaccion)
    await sesion.commit()
    
    # Emitir socket
    msg = await sesion.get(Mensaje, mensaje_id)
    await sio.emit(
        "reaccion_recibida",
        {
            "mensaje_id": str(mensaje_id),
            "usuario_id": str(usuario.id),
            "emoji": emoji,
        },
        room=CONV_ROOM(str(msg.conversacion_id))
    )

    return {"ok": True}


# ----------------------------------------------------
# 📞 Llamadas
# ----------------------------------------------------
@router_llamadas.post("/{conversacion_id}/llamadas", status_code=201)
async def iniciar_llamada(
    request: Request,
    conversacion_id: UUID,
    tipo: str = "voz",
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)
    await _asegurar_miembro(sesion, conversacion_id, usuario.id)
    llamada = Llamada(conversacion_id=conversacion_id, tipo=tipo, creado_por=usuario.id)
    sesion.add(llamada)
    await sesion.commit()
    await sesion.refresh(llamada)
    return {"llamada_id": llamada.id, "estado": llamada.estado}

@router_conversaciones.get("/{conversacion_id}/info_grupo")
async def obtener_info_grupo(
    request: Request,
    conversacion_id: UUID,
    auth_token: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    # Usuario autenticado
    usuario = await _obtener_usuario_desde_cookie(auth_token, sesion, request)

    # Verificar conversación
    conv = await sesion.get(Conversacion, conversacion_id)
    if not conv:
        raise HTTPException(404, "Conversación no encontrada")

    if not conv.es_grupo:
        raise HTTPException(400, "Esta conversación no es un grupo")

    # Verificar que fue o es miembro
    q = await sesion.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario.id
        )
    )
    miembro = q.scalar_one_or_none()
    if not miembro:
        raise HTTPException(403, "No perteneces a este grupo")

    # Obtener miembros con alias o teléfono (alias > teléfono)
    miembros_q = await sesion.execute(
        select(Usuario, MiembroConversacion)
        .join(MiembroConversacion, MiembroConversacion.usuario_id == Usuario.id)
        .where(MiembroConversacion.conversacion_id == conversacion_id)
    )

    miembros = []
    for u, m in miembros_q.all():

        # Obtener alias que ESTE usuario tiene para ese contacto
        alias_query = await sesion.execute(
            select(Contacto.alias)
            .where(
                Contacto.usuario_id == usuario.id,
                Contacto.contacto_id == u.id
            )
        )
        alias_row = alias_query.scalar()

        miembros.append({
            "id": str(u.id),
            "alias": alias_row or "",          # 🔥 PRIORIDAD: alias
            "telefono": u.telefono or "",      # 🔥 fallback: número
            "activo": m.activo,
            "es_admin": (str(u.id) == str(conv.creador_id))
        })

    return {
        "id": str(conv.id),
        "titulo": conv.titulo,
        "creador_id": str(conv.creador_id),
        "miembros": miembros
    }


# ----------------------------------------------------
# 💬 Listar chats visibles (VERSIÓN FINAL DEFINITIVA)
# ----------------------------------------------------
@router.get("/chats/{usuario_id}")
async def obtener_chats(usuario_id: str, sesion: AsyncSession = Depends(obtener_sesion)):
    try:
        uid = uuid.UUID(usuario_id)

        res = await sesion.execute(
            select(
                Conversacion,
                MiembroConversacion.activo,
                MiembroConversacion.fecha_salida
            )
            .join(
                MiembroConversacion,
                MiembroConversacion.conversacion_id == Conversacion.id
            )
            .where(MiembroConversacion.usuario_id == uid)
        )
        rows = res.all()
        if not rows:
            return []

        conversaciones = []
        for conv, activo, fecha_salida in rows:

            # Lista de usuarios
            miembros_q = await sesion.execute(
                select(Usuario, MiembroConversacion)
                .join(MiembroConversacion, MiembroConversacion.usuario_id == Usuario.id)
                .where(MiembroConversacion.conversacion_id == conv.id)
            )
            miembros = miembros_q.all()

            usuarios_list = []
            for u, m in miembros:
                usuarios_list.append({
                    "id": str(u.id),
                    "nombre": u.nombre,
                    "telefono": u.telefono,
                    "es_admin": (str(u.id) == str(conv.creador_id))
                })

            # Últimos mensajes
            ult_q = await sesion.execute(
                select(Mensaje)
                .outerjoin(
                    MensajeOculto,
                    (MensajeOculto.mensaje_id == Mensaje.id)
                    & (MensajeOculto.usuario_id == uid)
                )
                .where(
                    Mensaje.conversacion_id == conv.id,
                    MensajeOculto.mensaje_id.is_(None),
                )
                .order_by(Mensaje.creado_en.desc())
                .limit(3)
            )

            ult_msgs = [
                {
                    "id": str(m.id),
                    "usuario_id": str(m.remitente_id),
                    "contenido": m.cuerpo,
                    "fecha": m.creado_en.isoformat()
                }
                for m in ult_q.scalars().all()
            ]

            # 🔥 Contador de no leídos
            unread_q = await sesion.execute(
                select(func.count())
                .select_from(EstadoMensaje)
                .join(Mensaje, EstadoMensaje.mensaje_id == Mensaje.id)
                .where(
                    EstadoMensaje.usuario_id == uid,
                    EstadoMensaje.estado != "leido",
                    Mensaje.conversacion_id == conv.id
                )
            )
            unread = unread_q.scalar_one()

            conversaciones.append({
                "id": str(conv.id),
                "es_grupo": conv.es_grupo,
                "titulo": conv.titulo,
                "soy_miembro": bool(activo),
                "fue_miembro": True,
                "fecha_salida": fecha_salida.isoformat() if fecha_salida else None,
                "creador_id": str(conv.creador_id) if conv.creador_id else None,
                "usuarios": usuarios_list,
                "mensajes": list(reversed(ult_msgs)),
                "no_leidos": unread,
            })

        return conversaciones

    except Exception as e:
        print("❌ Error obtener_chats:", e)
        raise HTTPException(500, "Error interno del servidor")
