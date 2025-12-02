# app/api/usuarios.py
from fastapi import APIRouter, Depends, HTTPException, Body, Query, Header, Cookie, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.sesion import obtener_sesion
from app.db import crud
from app.db.modelos import Usuario
from app.schemas.usuario import UsuarioLeer
from typing import Optional
import jwt
from app.core.config import config
from app.realtime import online_users
from datetime import datetime

# 🚨 NUEVA IMPORTACIÓN PARA VALIDACIÓN DE TELÉFONO 🚨
import phonenumbers

router = APIRouter(prefix="/auth", tags=["Autenticación"])


# ==========================================================
# ✅ NUEVA FUNCIÓN: Dependencia para validar el teléfono
# (Usa 'phonenumbers' para verificar validez y posibilidad)
# ==========================================================
def validar_telefono_valido(telefono: str = Body(..., embed=True, description="Número de teléfono en formato internacional")):
    """
    Valida que el número de teléfono tenga un formato válido según el estándar E.164.
    """
    if not telefono:
        raise HTTPException(status_code=400, detail="El número de teléfono es obligatorio.")

    try:
        # Intentamos parsear el número. 'None' como región asume formato internacional (+código_país)
        parsed_number = phonenumbers.parse(telefono, None)
        
        # 1. Chequea si el formato es generalmente válido (evita '0000000', números reservados, etc.)
        if not phonenumbers.is_valid_number(parsed_number):
            raise ValueError("Número no válido o reservado (ej: 000000).")
        
        # 2. Chequea si es un número de un móvil/fijo posible (evita longitudes incorrectas, etc.)
        if not phonenumbers.is_possible_number(parsed_number):
            raise ValueError("Número imposible. Revise el código de país o la longitud.")

        # Estandariza a E.164 (ej: +5939XXXXXXXX) para consistencia en la base de datos
        e164_format = phonenumbers.format_number(parsed_number, phonenumbers.PhoneNumberFormat.E164)
        
        # Retorna el número ya limpio y validado
        return e164_format

    except phonenumbers.NumberParseException:
        # Error al parsear (ej: si no tiene el '+' inicial o formato extraño)
        raise HTTPException(
            status_code=400, 
            detail="Formato de teléfono inválido. Debe incluir el código de país (ej: +593...).",
        )
    except ValueError as e:
        # Captura los errores personalizados de la validación interna
        raise HTTPException(
            status_code=400,
            detail=f"El número proporcionado es inválido: {str(e)}",
        )


# ---------------------- OTP ----------------------
@router.post("/otp/solicitar", summary="Solicitar código OTP para un número")
async def solicitar_otp(
    # 🚨 USO DE LA DEPENDENCIA AQUÍ: Asegura que el número sea real antes de pedir el OTP 🚨
    telefono_validado: str = Depends(validar_telefono_valido), 
    sesion: AsyncSession = Depends(obtener_sesion),
):
    """Genera y envía (simulado) un código OTP a un número."""
    # Usamos el número validado y estandarizado que devuelve la dependencia
    codigo = await crud.solicitar_otp(sesion, telefono_validado) 
    # En producción se enviaría por SMS, aquí solo lo devolvemos para pruebas
    return {"telefono": telefono_validado, "codigo_enviado": codigo}


@router.post("/otp/verificar", summary="Verificar código OTP")
async def verificar_otp(
    telefono: str = Body(..., embed=True),
    codigo: str = Body(..., embed=True),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    """Verifica un código OTP y crea el usuario si no existe."""
    # OJO: Se podría añadir el Depends(validar_telefono_valido) también aquí para doble check
    exito, resultado = await crud.verificar_otp(sesion, telefono, codigo)
    if not exito:
        # 🚨 CORRECCIÓN: Usamos códigos de estado más específicos 🚨
        http_status = status.HTTP_401_UNAUTHORIZED if "código incorrecto" in resultado.lower() or "expirado" in resultado.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=http_status, detail=resultado)
    return {"ok": True, "usuario_id": resultado}


# ---------------------- QR ----------------------
@router.get("/qr/generar", summary="Generar QR temporal para vincular sesión web")
async def generar_qr(sesion: AsyncSession = Depends(obtener_sesion)):
    token = await crud.generar_qr(sesion)
    return {"token_qr": token}


@router.get("/qr/estado", summary="Consultar estado de un QR")
async def estado_qr(token: str = Query(...), sesion: AsyncSession = Depends(obtener_sesion)):
    estado = await crud.estado_qr(sesion, token)
    return {"token": token, "estado": estado}


@router.post("/qr/confirmar", summary="Confirmar vinculación QR (desde móvil verificado)")
async def confirmar_qr(
    token: str = Body(..., embed=True),
    telefono: str = Body(..., embed=True),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    exito, token_sesion = await crud.confirmar_qr(sesion, token, telefono)
    if not exito:
        raise HTTPException(status_code=400, detail=token_sesion)
    return {"token_sesion": token_sesion}


# ---------------------- Sesiones Web ----------------------
@router.get("/sesion/validar", summary="Validar sesión web activa")
async def validar_sesion(token_sesion: str = Query(...), sesion: AsyncSession = Depends(obtener_sesion)):
    s = await crud.validar_sesion_web(sesion, token_sesion)
    if not s:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
    return {"valida": True, "usuario_id": str(s.usuario_id)}


@router.post("/sesion/cerrar", summary="Cerrar sesión web")
async def cerrar_sesion(token_sesion: str = Body(..., embed=True), sesion: AsyncSession = Depends(obtener_sesion)):
    cerrado = await crud.cerrar_sesion_web(sesion, token_sesion)
    if not cerrado:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return {"cerrado": True}


# ---------------------- Perfil ----------------------
@router.get("/me", response_model=UsuarioLeer, summary="Obtener perfil del usuario actual (por token de sesión)")
async def obtener_perfil(
    token_sesion: str = Query(..., description="Token de sesión válido"),
    sesion: AsyncSession = Depends(obtener_sesion)
):
    s = await crud.validar_sesion_web(sesion, token_sesion)
    if not s:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
    usuario = await crud.obtener_usuario_por_id(sesion, s.usuario_id)
    return usuario


# ==========================================================
# ✅ FUNCIÓN: validar_sesion_header (uso con Depends)
# ==========================================================
async def validar_sesion_header(
    authorization: Optional[str] = Header(None),
    token_sesion: Optional[str] = Cookie(None),
    sesion: AsyncSession = Depends(obtener_sesion),
):
    """
    Valida un token JWT recibido por cabecera Authorization o cookie.
    Retorna el usuario_id si es válido. Compatible con nuevas rutas.
    """
    token = None

    # 1️⃣ Preferencia: Authorization: Bearer <token>
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
    # 2️⃣ Si no hay, usar cookie
    elif token_sesion:
        token = token_sesion

    # 3️⃣ Verificar presencia
    if not token:
        raise HTTPException(status_code=401, detail="Falta token de autenticación")

    # 4️⃣ Decodificar JWT
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

    # 5️⃣ Confirmar usuario existente
    usuario = await sesion.get(Usuario, user_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    return {"usuario_id": str(usuario.id)}

# ---------------------- Estado de presencia ----------------------
@router.get("/estado_usuario/{usuario_id}", summary="Obtener estado (en línea / última conexión) de un usuario")
async def obtener_estado_usuario(
    usuario_id: str,
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await sesion.get(Usuario, usuario_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    en_linea = bool(usuario.en_linea)
    ultima_conexion = usuario.ultima_conexion

    info = online_users.get(str(usuario.id))

    # 🟢 Si hay SID → está realmente online
    if info and info.get("sid"):
        en_linea = True
    else:
        # 🔴 OFFLINE → usar solo BD
        en_linea = False
        ultima_conexion = usuario.ultima_conexion

    return {
        "id": str(usuario.id),
        "en_linea": en_linea,
        "ultima_conexion": ultima_conexion.isoformat() if ultima_conexion else None,
    }

# ---------------------- Marcar usuario online/offline por HTTP ----------------------
@router.post("/marcar_online/{usuario_id}", summary="Marcar usuario como en línea (HTTP)")
async def marcar_online_http(
    usuario_id: str,
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await sesion.get(Usuario, usuario_id)
    if not usuario:
      raise HTTPException(status_code=404, detail="Usuario no encontrado")

    usuario.en_linea = True
    # guardamos también la última actividad
    usuario.ultima_conexion = datetime.utcnow()
    await sesion.commit()
    return {"ok": True}


@router.post("/marcar_offline/{usuario_id}", summary="Marcar usuario como desconectado (HTTP)")
async def marcar_offline_http(
    usuario_id: str,
    sesion: AsyncSession = Depends(obtener_sesion),
):
    usuario = await sesion.get(Usuario, usuario_id)
    if not usuario:
      raise HTTPException(status_code=404, detail="Usuario no encontrado")

    usuario.en_linea = False
    # esta será la "última vez" que verás en el chat
    usuario.ultima_conexion = datetime.utcnow()
    await sesion.commit()
    return {"ok": True}
