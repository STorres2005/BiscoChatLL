import uuid
import hashlib
import os
from datetime import datetime, timedelta
from random import randint

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from ..db.modelos import (
    Usuario,
    Contacto,
    Conversacion,
    MiembroConversacion,
    Mensaje,
    Mencion,
    CodigoOTP,
    SesionQR,
    SesionWeb,
    EstadoMensaje,
    MensajeOculto,
    Llamada,
    ParticipanteLlamada,
)

# =========================================
# 🔧 UTILS
# =========================================
def _hash_otp(codigo: str, salt: str) -> str:
    return hashlib.sha256((salt + codigo).encode("utf-8")).hexdigest()

def _gen_otp(n=6) -> str:
    return str(randint(10 ** (n - 1), 10 ** n - 1))

def _gen_token() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


# =========================================
# 👤 USUARIOS CRUD
# =========================================
async def obtener_usuario_por_telefono(db: AsyncSession, telefono: str):
    q = await db.execute(select(Usuario).where(Usuario.telefono == telefono))
    return q.scalar_one_or_none()

async def obtener_usuario_por_id(db: AsyncSession, usuario_id: str):
    q = await db.execute(select(Usuario).where(Usuario.id == usuario_id))
    return q.scalar_one_or_none()

async def listar_usuarios(db: AsyncSession):
    q = await db.execute(select(Usuario).order_by(Usuario.creado_en.desc()))
    return q.scalars().all()

async def crear_usuario_minimo(db: AsyncSession, telefono: str, nombre=None, apellido=None, verificado=False):
    usr = Usuario(
        id=str(uuid.uuid4()),
        telefono=telefono,
        nombre=nombre,
        apellido=apellido,
        verificado=verificado,
    )
    db.add(usr)

    try:
        await db.commit()
        await db.refresh(usr)
        return usr

    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="El teléfono ya está registrado.")
    except:
        await db.rollback()
        raise HTTPException(500, "Error interno al crear usuario")


async def actualizar_usuario(db: AsyncSession, usuario_id: str, datos: dict):
    usuario = await db.get(Usuario, usuario_id)
    if not usuario:
        return None

    for campo, valor in datos.items():
        if hasattr(usuario, campo) and valor is not None:
            setattr(usuario, campo, valor)

    try:
        await db.commit()
        await db.refresh(usuario)
        return usuario
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Conflicto con datos únicos")
    except:
        await db.rollback()
        raise HTTPException(500, "Error interno al actualizar usuario")


# =========================================
# 🤝 CONTACTOS CRUD
# =========================================
async def obtener_contactos_usuario(db: AsyncSession, usuario_id: str):
    q = await db.execute(select(Contacto).where(Contacto.usuario_id == usuario_id))
    return q.scalars().all()

async def agregar_contacto(db: AsyncSession, usuario_id: str, contacto_id: str):
    contacto = Contacto(usuario_id=usuario_id, contacto_id=contacto_id)
    db.add(contacto)
    try:
        await db.commit()
        await db.refresh(contacto)
        return contacto
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "El contacto ya existe")
    except:
        await db.rollback()
        raise HTTPException(500, "Error interno al agregar contacto")


# =========================================
# 💬 CONVERSACIONES CRUD
# =========================================
async def obtener_conversaciones_usuario(db: AsyncSession, usuario_id: str):
    usuario_id = str(usuario_id)
    q = await db.execute(
        select(Conversacion)
        .join(MiembroConversacion)
        .where(MiembroConversacion.usuario_id == usuario_id)
        .order_by(Conversacion.creado_en.desc())
    )
    return q.scalars().all()


# === MÉTODO FINAL CORREGIDO ===
async def agregar_miembro_conversacion(db: AsyncSession, conversacion_id: str, usuario_id: str):
    conversacion_id = str(conversacion_id)
    usuario_id = str(usuario_id)

    q = await db.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == conversacion_id,
            MiembroConversacion.usuario_id == usuario_id,
        )
    )
    existente = q.scalar_one_or_none()

    if existente:
        if not existente.activo:
            existente.activo = True
            existente.fecha_salida = None
            await db.flush()
        return existente

    miembro = MiembroConversacion(
        conversacion_id=conversacion_id,
        usuario_id=usuario_id,
        activo=True,
        fecha_salida=None,
    )
    db.add(miembro)
    await db.flush()
    await db.refresh(miembro)
    return miembro


# === MÉTODO FINAL CORREGIDO ===
async def obtener_conversacion_entre(db: AsyncSession, u1: str, u2: str):
    u1, u2 = str(u1), str(u2)

    q_conv = await db.execute(
        select(Conversacion.id)
        .where(Conversacion.es_grupo == False)
    )
    ids = q_conv.scalars().all()

    for cid in ids:
        q = await db.execute(
            select(MiembroConversacion.usuario_id, MiembroConversacion.activo)
            .where(MiembroConversacion.conversacion_id == cid)
        )
        rows = q.all()

        if len(rows) != 2:
            continue

        if not all(r[1] for r in rows):
            continue

        if {r[0] for r in rows} == {u1, u2}:
            return await db.get(Conversacion, cid)

    return None


async def crear_conversacion(db: AsyncSession, titulo: str | None, creador_id: str, es_grupo=False):
    conv = Conversacion(
        id=str(uuid.uuid4()),
        titulo=titulo,
        es_grupo=es_grupo,
        creador_id=str(creador_id)
    )
    db.add(conv)
    await db.flush()

    miembro = MiembroConversacion(
        conversacion_id=conv.id,
        usuario_id=str(creador_id),
        activo=True,
    )
    db.add(miembro)
    await db.flush()

    await db.refresh(conv)
    return conv


# =========================================
# ✉️ MENSAJES CRUD
# =========================================
async def enviar_mensaje(db: AsyncSession, conversacion_id, remitente_id, cuerpo,
                         url_adjunto=None, tipo_adjunto=None,
                         mensaje_id_respuesta=None, mencionados_ids=None):

    q = await db.execute(
        select(MiembroConversacion).where(
            MiembroConversacion.conversacion_id == str(conversacion_id),
            MiembroConversacion.usuario_id == str(remitente_id),
            MiembroConversacion.activo == True
        )
    )
    if not q.scalar_one_or_none():
        raise HTTPException(403, "No perteneces a esta conversación")

    msg = Mensaje(
        conversacion_id=str(conversacion_id),
        remitente_id=str(remitente_id),
        cuerpo=cuerpo,
        url_adjunto=url_adjunto,
        tipo_adjunto=tipo_adjunto,
        mensaje_id_respuesta=mensaje_id_respuesta
    )
    db.add(msg)
    await db.flush()

    if mencionados_ids:
        for uid in mencionados_ids:
            db.add(Mencion(mensaje_id=msg.id, usuario_id=str(uid)))

    await db.refresh(msg)
    return msg


async def obtener_mensajes_conversacion(db: AsyncSession, conversacion_id):
    q = await db.execute(
        select(Mensaje)
        .where(Mensaje.conversacion_id == str(conversacion_id))
        .order_by(Mensaje.creado_en.asc())
    )
    return q.scalars().all()


# =========================================
# 🔐 OTP
# =========================================
OTP_TTL_MINUTES = 5
OTP_SALT = os.getenv("OTP_SALT", "super_salt")

async def solicitar_otp(db: AsyncSession, telefono: str):
    codigo = _gen_otp(6)
    otp = CodigoOTP(
        telefono=telefono,
        codigo_hash=_hash_otp(codigo, OTP_SALT),
        expiracion=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES)
    )
    db.add(otp)

    try:
        await db.commit()
        return codigo
    except:
        await db.rollback()
        raise HTTPException(500, "Error al generar OTP")


async def verificar_otp(db: AsyncSession, telefono: str, codigo: str):
    q = await db.execute(
        select(CodigoOTP)
        .where(CodigoOTP.telefono == telefono, CodigoOTP.usado == False)
        .order_by(CodigoOTP.creado_en.desc())
    )
    otp = q.scalar_one_or_none()

    if not otp:
        return False, "No hay OTP pendiente"
    if otp.expiracion < datetime.utcnow():
        return False, "OTP expirado"
    if otp.codigo_hash != _hash_otp(codigo, OTP_SALT):
        otp.intentos = (otp.intentos or 0) + 1
        await db.commit()
        return False, "Código incorrecto"

    otp.usado = True
    await db.commit()

    usuario = await obtener_usuario_por_telefono(db, telefono)
    if not usuario:
        usuario = await crear_usuario_minimo(db, telefono=telefono, verificado=True)
    else:
        usuario.verificado = True
        await db.commit()

    return True, str(usuario.id)


# =========================================
# 📱 SESIONES QR / WEB
# =========================================
QR_TTL_MINUTES = 2

async def generar_qr(db: AsyncSession):
    token = _gen_token()
    qr = SesionQR(
        token=token,
        estado="pendiente",
        creado_en=datetime.utcnow(),
        expiracion=datetime.utcnow() + timedelta(minutes=QR_TTL_MINUTES)
    )
    db.add(qr)
    await db.commit()
    return token


async def estado_qr(db: AsyncSession, token: str):
    q = await db.execute(select(SesionQR).where(SesionQR.token == token))
    qr = q.scalar_one_or_none()

    if not qr:
        return "invalido"

    if qr.expiracion < datetime.utcnow() and qr.estado == "pendiente":
        qr.estado = "expirado"
        await db.commit()

    return qr.estado


async def confirmar_qr(db: AsyncSession, token: str, telefono: str):
    q = await db.execute(select(SesionQR).where(SesionQR.token == token))
    qr = q.scalar_one_or_none()

    if not qr:
        return False, "QR inválido"
    if qr.estado != "pendiente":
        return False, "QR ya usado"
    if qr.expiracion < datetime.utcnow():
        qr.estado = "expirado"
        await db.commit()
        return False, "QR expirado"

    usuario = await obtener_usuario_por_telefono(db, telefono)
    if not usuario or not usuario.verificado:
        return False, "Número no verificado"

    qr.telefono = telefono
    qr.estado = "confirmado"
    await db.commit()

    ses = SesionWeb(
        usuario_id=usuario.id,
        token_sesion=_gen_token(),
        fecha_inicio=datetime.utcnow(),
        fecha_expiracion=datetime.utcnow() + timedelta(days=7),
        activo=True
    )
    db.add(ses)
    await db.commit()

    return True, ses.token_sesion


async def validar_sesion_web(db: AsyncSession, token_sesion: str):
    q = await db.execute(
        select(SesionWeb)
        .where(SesionWeb.token_sesion == token_sesion, SesionWeb.activo == True)
    )
    ses = q.scalar_one_or_none()

    if not ses:
        return None

    if ses.fecha_expiracion and ses.fecha_expiracion < datetime.utcnow():
        ses.activo = False
        await db.commit()
        return None

    return ses


async def cerrar_sesion_web(db: AsyncSession, token_sesion: str):
    q = await db.execute(select(SesionWeb).where(SesionWeb.token_sesion == token_sesion))
    ses = q.scalar_one_or_none()

    if not ses:
        return False

    ses.activo = False
    await db.commit()
    return True
