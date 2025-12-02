# ================================================================
# app/main.py — versión revisada y completa
# ================================================================
import asyncio
import platform
import uuid
import time
import random
import logging
import re
import smtplib
import phonenumbers
from pathlib import Path
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from pydantic import EmailStr
from uuid import UUID as UUID_t

# -----------------------------
# FastAPI & utilidades
# -----------------------------
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Depends,
    WebSocket,
    WebSocketDisconnect,
    Cookie,
    Query,
    APIRouter,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    PlainTextResponse,
)
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.utils import get_openapi
from app.api import webrtc  # Para TURN/STUN de llamadas
# -----------------------------
# Validaciones y datos
# -----------------------------
from pydantic import BaseModel

# -----------------------------
# SQLAlchemy async
# -----------------------------
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

# -----------------------------
# Seguridad / JWT
# -----------------------------
import jwt as jwt_lib

# -----------------------------
# Configuración de tu app
# -----------------------------
from app.db.sesion import SessionLocal
from app.core.config import config
from app.db import crud
from app.db.modelos import Conversacion, MiembroConversacion, Usuario

# -----------------------------
# Errores y trazas
# -----------------------------
import traceback


# ================================================================
# Fix Windows event loop
# ================================================================
if platform.system() == "Windows":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ================================================================
# Logging global
# ================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("app.main")

# ================================================================
# Configuración general
# ================================================================
from app.core.config import config

TTL_TOKEN = 600
TOKEN_RENEW_WINDOW = 120

# ================================================================
# Importar rutas y servicios
# ================================================================
from app.api.usuarios import router as usuarios_router
from app.api.usuarios_crud import router as usuarios_crud_router
from app.api.contactos import router as contactos_router
from app.api.conversaciones import (
    router_conversaciones,
    router_mensajes as mensajes_anidados_router,
    router_llamadas,
    router as router_chats

)
from app.api.mensajes_plano import router as mensajes_planos_router
from app.api.conversaciones import router

try:
    from app.api.llamadas import router as llamadas_router
    from app.api.estados_mensaje import router as estados_mensaje_router
except ImportError:
    llamadas_router = None
    estados_mensaje_router = None
    logger.warning("⚠ Rutas de llamadas o estados_mensaje no encontradas (opcional).")

from app.db import crud
from app.db.sesion import obtener_sesion
from app.db.modelos import Conversacion, MiembroConversacion, Usuario

# ================================================================
# Instancia principal de FastAPI
# ================================================================
app = FastAPI(title="BiscoChat Backend", version="3.4")

from app.api.files import router as files_router
app.include_router(files_router, prefix="/api", tags=["files"])

from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ================================================================
# 🔥 DESACTIVAR CACHÉ PARA ARCHIVOS ESTÁTICOS (JS/CSS) EN DEV
# ================================================================
@app.middleware("http")
async def disable_static_cache(request: Request, call_next):
    response = await call_next(request)

    # Archivos que NO deben cachearse
    if request.url.path.endswith(".js") or request.url.path.endswith(".css"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response

logger.info("[CONFIG] DATABASE_URL: %s", config.DATABASE_URL)
logger.info("[CONFIG] REDIS_URL: %s", config.REDIS_URL)

# ================================================================
# CORS (con soporte para ngrok)
# ================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"https://.\.ngrok(-free)?\.app$|https://.\.ngrok\.io$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================================================================
# Custom OpenAPI / Swagger con autenticación Bearer
# ================================================================
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title="BiscoChat Backend",
        version="3.4",
        description="API del sistema de mensajería BiscoChat con soporte JWT Bearer.",
        routes=app.routes,
    )
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }
    openapi_schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

# ================================================================
# FRONTEND (HTML/CSS/JS/ASSETS)
# ================================================================
APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

HTML_DIR = FRONTEND_DIR / "html"
CSS_DIR = FRONTEND_DIR / "css"
JS_DIR = FRONTEND_DIR / "js"
ASSETS_DIR = FRONTEND_DIR / "assets"

# ================================================================
# 🚀 MONTAR LA CARPETA FRONTEND COMPLETA
# ================================================================
app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")

for p in (HTML_DIR, CSS_DIR, JS_DIR):
    if not p.exists():
        raise RuntimeError(f"Carpeta requerida no encontrada: {p}")

templates = Jinja2Templates(directory=str(HTML_DIR))

app.mount("/css", StaticFiles(directory=str(CSS_DIR)), name="css")
app.mount("/js", StaticFiles(directory=str(JS_DIR)), name="js")

# Siempre montar HTML aunque no existan assets
app.mount("/html", StaticFiles(directory=str(HTML_DIR)), name="html")

# Assets solo si existe la carpeta
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")



logger.info(f"📁 Frontend HTML : {HTML_DIR}")
logger.info(f"📁 Frontend CSS  : {CSS_DIR}")
logger.info(f"📁 Frontend JS   : {JS_DIR}")
logger.info(f"📁 Frontend assets: {ASSETS_DIR if ASSETS_DIR.exists() else '(no existe)'}")

# ================================================================
# Favicon dummy
# ================================================================
@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return PlainTextResponse("", status_code=204)

# ================================================================
# Healthcheck
# ================================================================
@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}

# ================================================================
# ======================== HELPERS ==============================
# ================================================================

# Generar JWT
def generar_jwt(usuario_id: str) -> str:
    expiracion = datetime.now(timezone.utc) + timedelta(minutes=int(config.JWT_EXPIRES_MIN))
    payload = {"sub": str(usuario_id), "exp": int(expiracion.timestamp())}
    return jwt_lib.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)

# Setear cookie de auth
def set_auth_cookie(request: Request, response: RedirectResponse, jwt_token: str) -> None:
    scheme = request.url.scheme.lower()
    is_https = scheme == "https"
    response.set_cookie(
        key="auth_token",
        value=jwt_token,
        httponly=True,
        secure=is_https,
        samesite="None" if is_https else "Lax",
        path="/",
        # max_age=3600,
    )

# ================================================================
# Tokens QR en memoria
# ================================================================
db_tokens: dict = {}

# ================================================================
# Página principal (Login con QR)
# ================================================================
@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    base_url = str(request.base_url)
    if "ngrok" in base_url and base_url.startswith("http://"):
        base_url = base_url.replace("http://", "https://")
    if not base_url.endswith("/"):
        base_url += "/"
    return templates.TemplateResponse("login_qr.html", {"request": request, "api_url": base_url})

# ================================================================
# Generar token QR
# ================================================================
@app.get("/generar_token_qr")
async def generar_token_qr(request: Request):
    ahora = time.time()
    expirados = [t for t, d in db_tokens.items() if (ahora - d["creacion"]) > TTL_TOKEN]
    for t in expirados:
        del db_tokens[t]
    token = str(uuid.uuid4())
    expira = datetime.now(timezone.utc) + timedelta(seconds=TTL_TOKEN)
    db_tokens[token] = {
    "creacion": ahora,
    "expira": expira,
    "estado": "pendiente",
    "usuario_id": None,
}
    base = str(request.base_url)
    if "ngrok" in base and base.startswith("http://"):
        base = base.replace("http://", "https://")
    if not base.endswith("/"):
        base += "/"
    qr_url = f"{base}simular_escaneo/{token}"
    import qrcode, io, base64
    img = qrcode.make(qr_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {"token": token, "qr_code": qr_base64}

# ================================================================
# Verificar estado QR
# ================================================================
@app.get("/verificar_estado_qr/{token}")
def verificar_estado_qr(token: str):
    token_data = db_tokens.get(token)
    if not token_data:
        raise HTTPException(status_code=404, detail="Token no encontrado o expirado")
    if (time.time() - token_data["creacion"]) > TTL_TOKEN:
        del db_tokens[token]
        raise HTTPException(status_code=404, detail="Token expirado")
    return {
        "estado": token_data["estado"],
        "usuario_id": token_data["usuario_id"],
        "jwt": token_data.get("jwt", None),
    }

# ================================================================
# Simular escaneo
# ================================================================
@app.get("/simular_escaneo/{token}", response_class=HTMLResponse)
def simular_escaneo(request: Request, token: str):
    if token not in db_tokens:
        raise HTTPException(status_code=404, detail="Token inválido o expirado")
    return templates.TemplateResponse("qr_validacion.html", {"request": request, "token": token})

@app.get("/validacion_dos_pasos.html")
def validacion_dos_pasos(request: Request):
    return templates.TemplateResponse("validacion_dos_pasos.html", {"request": request})

@app.get("/qr_escaneo_exitoso.html", response_class=HTMLResponse)
def qr_escaneo_exitoso(request: Request):
    return templates.TemplateResponse("qr_escaneo_exitoso.html", {"request": request})

# ================================================================
# Cerrar sesión manualmente
# ================================================================
@app.post("/cerrar_sesion/{token}")
async def cerrar_sesion(token: str):
    if token in db_tokens:
        db_tokens.pop(token)
        logger.info(f"🔒 Token {token} eliminado manualmente al cerrar sesión.")
    return JSONResponse(content={"mensaje": "Sesión cerrada correctamente."})

# ================================================================
# Modelo de validación
# ================================================================
class ValidacionTelefono(BaseModel):
    telefono: str
    nombre: str | None = None
    apellido: str | None = None

# ================================================================
# ⚙ Helper: Validar número ecuatoriano (10 dígitos, empieza con 09)
# ================================================================
def validar_telefono_ec_stricto(numero_raw: str) -> tuple[bool, str]:
    """
    Valida que el número sea un teléfono móvil ecuatoriano válido (sin +593).
    Ejemplo correcto: 0986170583 → 10 dígitos, empieza por 09.
    Retorna (es_valido, número_formateado_o_mensaje_error).
    """
    if not numero_raw:
        return False, "Número vacío."

    # Extraer solo dígitos
    digits = re.sub(r"\D", "", numero_raw)

    # Si viene con +593 → lo convertimos a formato local (09xxxxxxx)
    if digits.startswith("593") and len(digits) >= 11:
        digits = "0" + digits[3:]

    # Verificar que tenga 10 dígitos y empiece con 09
    if not re.fullmatch(r"09\d{8}", digits):
        return False, "Formato inválido. Debe tener 10 dígitos y comenzar con 09."

    # Validación con librería phonenumbers
    try:
        parsed = phonenumbers.parse(digits, "EC")
        if not phonenumbers.is_possible_number(parsed):
            return False, "Número no posible según las reglas de Ecuador."
        if not phonenumbers.is_valid_number(parsed):
            return False, "Número no válido según la numeración ecuatoriana."
        formatted = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL)
        return True, formatted
    except phonenumbers.NumberParseException as e:
        return False, f"Error al analizar número: {str(e)}"


# ================================================================
# 🧪 Endpoint para validar número manualmente (debug)
# ================================================================
@app.get("/validar_numero/{numero}")
def validar_numero_api(numero: str):
    valido, info = validar_telefono_ec_stricto(numero)
    if not valido:
        return JSONResponse(status_code=422, content={"valido": False, "mensaje": info})
    return {"valido": True, "numero_formateado": info}


# ================================================================
# ✅ Validar escaneo - versión FINAL con validación de correo
# ================================================================
@app.post("/validar_escaneo/{token}")
async def validar_escaneo(request: Request, token: str, validacion: ValidacionTelefono):
    token_data = db_tokens.get(token)

    # 🔒 Si el token ya fue usado o pertenece a otro usuario → reiniciarlo
    if token_data and token_data.get("estado") == "autenticado":
        logger.info(f"♻ Reiniciando token usado previamente: {token}")
        usuario_anterior = token_data.get("usuario_id")
        db_tokens.pop(token, None)
        for t, d in list(db_tokens.items()):
            if d.get("usuario_id") == usuario_anterior:
                db_tokens.pop(t, None)
                logger.info(f"🧹 Token anterior del usuario {usuario_anterior} eliminado.")
        token_data = None

    if not token_data:
        raise HTTPException(status_code=404, detail="Token inválido o expirado")

    # Validar teléfono
    es_valido, info = validar_telefono_ec_stricto(validacion.telefono)
    if not es_valido:
        return JSONResponse(
            status_code=422,
            content={"detalle": "telefono_invalido", "mensaje": info},
        )

    usuario_bd = None
    ultimo_error = ""

    # Intentos DB (3)
    for intento in range(3):
        try:
            async with SessionLocal() as db:
                await db.execute(text("SELECT 1"))

                # Buscar usuario existente
                usuario_bd = await crud.obtener_usuario_por_telefono(db, validacion.telefono)

                # Usuario existente
                if usuario_bd:
                    mensaje = f"Bienvenido, {usuario_bd.nombre}. Ingresa tu correo para continuar."
                    break

                # Nuevo usuario: nombre/apellido requerido
                if not validacion.nombre or not validacion.apellido:
                    return JSONResponse(
                        status_code=404,
                        content={
                            "detalle": "nuevo_usuario",
                            "mensaje": "Número válido pero no registrado. Ingresa tu nombre y apellido.",
                        },
                    )

                # Crear nuevo usuario
                usuario_bd = await crud.crear_usuario_minimo(
                    db,
                    telefono=validacion.telefono,
                    nombre=validacion.nombre,
                    apellido=validacion.apellido,
                    verificado=True,
                )
                await db.commit()
                mensaje = f"Cuenta creada para {usuario_bd.nombre}. Ingresa tu correo para continuar."
                break

        except Exception as e:
            logger.error(f"⚠ Intento {intento + 1} falló: {e}")
            ultimo_error = str(e)
            if intento == 2:
                return JSONResponse(
                    status_code=503,
                    content={
                        "detalle": "db_no_disponible",
                        "mensaje": f"Base de datos no disponible: {ultimo_error[:120]}",
                    },
                )
            await asyncio.sleep(2)

    if not usuario_bd:
        return JSONResponse(
            status_code=500,
            content={
                "detalle": "usuario_no_creado",
                "mensaje": "No se pudo crear ni obtener el usuario tras varios intentos.",
            },
        )

    # Actualizar token (pendiente de correo)
    token_data["estado"] = "pendiente_correo"
    token_data["usuario_id"] = str(usuario_bd.id)
    token_data["jwt"] = generar_jwt(usuario_bd.id)

    # RESPUESTA: indicar que ahora se debe validar correo
    return JSONResponse(
        status_code=200,
        content={
            "detalle": "validar_correo",
            "mensaje": mensaje,
            "token": token
        }
    )

# ================================================================
# ✅ Validación de dos pasos por CORREO (6 dígitos)
# ================================================================

class ValidacionCorreo(BaseModel):
    email: EmailStr
    codigo: str | None = None  # Código de 6 dígitos enviado por correo

# Almacenamiento temporal de códigos por email
db_email_codes: dict = {}  # clave: email, valor: {codigo: str, expira: datetime}

def enviar_correo(email_destino: str, mensaje: str) -> None:
    """
    Envía un correo con el mensaje especificado usando SMTP Gmail.
    """
    msg = MIMEText(mensaje)
    msg["Subject"] = "Tu código de verificación"
    msg["From"] = config.EMAIL_FROM
    msg["To"] = email_destino

    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as server:
            server.starttls()
            server.login(config.EMAIL_FROM, config.EMAIL_PASSWORD)
            server.send_message(msg)
        logger.info(f"📨 Código enviado a {email_destino} por correo.")
    except Exception as e:
        logger.error(f"⚠️ Error enviando correo a {email_destino}: {e}")
        raise HTTPException(status_code=500, detail=f"Error enviando correo: {str(e)}")

# ================================================================
# ✅ Enviar código de verificación por correo
# ================================================================
@app.post("/enviar_codigo_correo/{token}")
async def enviar_codigo_correo(token: str, validacion: ValidacionCorreo):
    # 🔹 Verificar si el token existe y está en estado pendiente
    token_data = db_tokens.get(token)
    if not token_data or token_data.get("estado") != "pendiente_correo":
        raise HTTPException(status_code=401, detail="Token inválido o no autorizado")

    # 🔹 Generar un código de 6 dígitos
    codigo = f"{random.randint(0, 999999):06d}"
    expiracion = datetime.now(timezone.utc) + timedelta(minutes=5)

    # Guardar el código temporalmente en memoria
    db_email_codes[validacion.email] = {
        "codigo": codigo,
        "expira": expiracion,
        "token": token
    }

    try:
        # 🔹 Enviar correo (debes tener configurada la función enviar_correo)
        enviar_correo(validacion.email, f"Tu código de verificación es: {codigo}")
    except Exception as e:
        print("❌ Error al enviar correo:", e)
        raise HTTPException(status_code=500, detail="Error al enviar el correo. Verifica configuración SMTP.")

    # 🔹 Responder correctamente
    return {"mensaje": "Código enviado al correo.", "email": validacion.email}


# ================================================================
# ✅ Validar código de correo y redirigir a qr_escaneo_exitoso.html
# ================================================================
@app.post("/validar_codigo_correo/{token}")
async def validar_codigo_correo(token: str, validacion: ValidacionCorreo, request: Request):
    # 🔹 Buscar el registro del correo y token
    registro = db_email_codes.get(validacion.email)
    token_data = db_tokens.get(token)

    if not registro or not token_data:
        raise HTTPException(status_code=401, detail="Código o token inválido")

    if token_data.get("estado") != "pendiente_correo":
        raise HTTPException(status_code=403, detail="Token ya usado o no válido para validación de correo.")

    # 🔹 Verificar expiración
    if datetime.now(timezone.utc) > registro["expira"]:
        db_email_codes.pop(validacion.email, None)
        raise HTTPException(status_code=410, detail="Código expirado")

    # 🔹 Verificar coincidencia del código
    if validacion.codigo != registro["codigo"]:
        raise HTTPException(status_code=422, detail="Código incorrecto")

    # 🔹 Si todo está correcto → limpiar código y actualizar token
    db_email_codes.pop(validacion.email, None)
    token_data["estado"] = "autenticado"
    token_data["verificado_en"] = datetime.now(timezone.utc)

    # 🔹 Devolver respuesta JSON (para que JS redirija correctamente)
    return {"mensaje": "Verificación completa.", "token": token}

# ================================================================
# Limpieza automática de tokens expirados (cada 60 segundos)
# ================================================================

async def limpiar_tokens_expirados():
    while True:
        try:
            # Usar SIEMPRE UTC con tzinfo
            ahora = datetime.now(timezone.utc)

            expirados = []
            for t, data in list(db_tokens.items()):
                exp = data.get("expira")
                if isinstance(exp, datetime):
                    # Si viene sin tz, forzamos UTC
                    if exp.tzinfo is None:
                        exp = exp.replace(tzinfo=timezone.utc)
                    if exp < ahora:
                        expirados.append(t)

            for token in expirados:
                db_tokens.pop(token, None)
                logger.info(f"🧹 Token expirado eliminado: {token}")
        except Exception as e:
            logger.error(f"Error al limpiar tokens expirados: {e}")

        await asyncio.sleep(60)


@app.on_event("startup")
async def iniciar_limpieza_tokens():
    asyncio.create_task(limpiar_tokens_expirados())

# ================================================================
# Redirección al chat
# ================================================================
@app.get("/iniciar_sesion_con_token/{token}", response_class=RedirectResponse)
async def iniciar_sesion_con_token(token: str, request: Request):
    token_data = db_tokens.get(token)
    if not token_data or token_data.get("estado") != "autenticado" or not token_data.get("jwt"):
        raise HTTPException(status_code=401, detail="Token inválido o no autenticado")
    base_url = str(request.base_url)
    if "ngrok" in base_url and base_url.startswith("http://"):
        base_url = base_url.replace("http://", "https://")
    if not base_url.endswith("/"):
        base_url += "/"
    usuario_id = token_data["usuario_id"]
    jwt_token = token_data["jwt"]
    redirect_url = f"{base_url}web/conversaciones?usuario_id={usuario_id}&jwt={jwt_token}"
    return RedirectResponse(url=redirect_url, status_code=302)

# ================================================================
# Página de conversaciones (HTML)
# ================================================================
@app.get("/web/conversaciones", response_class=HTMLResponse)
async def conversaciones_web(request: Request, usuario_id: str | None = None, jwt: str | None = Query(None, alias="jwt"), auth_token: str | None = Cookie(None), sesion: AsyncSession = Depends(obtener_sesion)):
    token = auth_token or jwt
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado (falta token)")
    try:
        payload = jwt_lib.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        real_user_id = payload.get("sub")
        exp_time = payload.get("exp")
        if exp_time and (exp_time - int(time.time())) < TOKEN_RENEW_WINDOW:
            token = generar_jwt(real_user_id)
            logger.info("🔄 Token renovado automáticamente")
        if not usuario_id:
            usuario_id = real_user_id
        if real_user_id != usuario_id:
            raise HTTPException(status_code=401, detail="Token no coincide con usuario")
    except jwt_lib.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt_lib.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")
    usuario = await sesion.get(Usuario, usuario_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    q = await sesion.execute(
        select(Conversacion)
        .join(MiembroConversacion)
        .where(MiembroConversacion.usuario_id == usuario.id)
        .order_by(Conversacion.creado_en.desc())
    )
    conversaciones = q.scalars().all() or []
    response = templates.TemplateResponse(
        "conversaciones.html",
        {
            "request": request,
            "usuario": {
                "id": usuario.id,
                "nombre": usuario.nombre or "Usuario",
                "telefono": usuario.telefono or "",
            },
            "conversaciones": conversaciones,
        },
    )
    if token != (auth_token or jwt):
        set_auth_cookie(request, response, token)
    return response

# ================================================================
# Crear nueva conversación (endpoint simple desde el frontend)
# ================================================================
from uuid import UUID as UUID_t  # 👈 arriba del archivo, donde tengas los imports

@app.post("/conversaciones/nueva")
async def crear_conversacion_nueva(
    data: dict,
    sesion: AsyncSession = Depends(obtener_sesion),
):
    titulo = data.get("titulo")
    creador_id = data.get("creador_id")
    es_grupo = bool(data.get("es_grupo", False))  # por defecto chat individual

    if not titulo or not creador_id:
        raise HTTPException(status_code=400, detail="Datos incompletos")

    # ✅ Convertir a UUID
    try:
        creador_uuid = UUID_t(str(creador_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="creador_id no es un UUID válido")

    # ✅ Verificar que el usuario exista
    creador = await sesion.get(Usuario, creador_uuid)
    if not creador:
        raise HTTPException(status_code=404, detail="Creador no encontrado")

    # ✅ Crear conversación usando la firma nueva de crud.crear_conversacion
    nueva_conv = await crud.crear_conversacion(
        sesion,
        titulo=titulo,
        creador_id=creador_uuid,
        es_grupo=es_grupo,
    )

    # ✅ Agregar al creador como miembro
    await crud.agregar_miembro_conversacion(sesion, nueva_conv.id, creador_uuid)

    await sesion.commit()
    await sesion.refresh(nueva_conv)

    return {
        "id": str(nueva_conv.id),
        "titulo": nueva_conv.titulo,
        "es_grupo": nueva_conv.es_grupo,
        "creador_id": str(nueva_conv.creador_id),
    }

# ================================================================
# WebSocket Chat
# ================================================================
# conexiones_activas: dict[str, list[WebSocket]] = {}

# @app.websocket("/ws/{chat_id}")
# async def websocket_chat(websocket: WebSocket, chat_id: str):
#    await websocket.accept()
#    conexiones_activas.setdefault(chat_id, []).append(websocket)
#    try:
#        while True:
#            data = await websocket.receive_text()
#            for conn in list(conexiones_activas.get(chat_id, [])):
#                if conn is not websocket:
#                    await conn.send_text(data)
#    except WebSocketDisconnect:
#        conexiones_activas[chat_id].remove(websocket)
#        if not conexiones_activas.get(chat_id):
#            conexiones_activas.pop(chat_id, None)
#        logger.info("🔌 Cliente desconectado del chat %s", chat_id)
#    except Exception as e:
#        logger.error("Error en WebSocket: %s", e)
#        conexiones_activas.get(chat_id, []).remove(websocket)

# ================================================================
# 🔌 Integración Socket.IO (modo HTTP polling)
# ================================================================
import socketio
from app.realtime import sio, app_sio  # importar el módulo nuevo

# Creamos el ASGI combinado: primero FastAPI (app) + Socket.IO
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)

# ================================================================
# ✅ INCLUSIÓN DE ROUTERS API — versión final limpia y funcional
# ================================================================

# 🔹 Incluir los routers principales SIN duplicados
#    Usamos los prefijos nativos de cada router (/conversaciones, /contactos, /usuarios...)
#    porque el frontend YA apunta correctamente a `${API}conversaciones`, etc.
app.include_router(router_conversaciones)
app.include_router(mensajes_anidados_router)
app.include_router(router_llamadas)
app.include_router(router_chats)
app.include_router(webrtc.router)

# 🔹 Otros módulos de la app
app.include_router(contactos_router)
app.include_router(usuarios_router)
app.include_router(usuarios_crud_router)
app.include_router(mensajes_planos_router)

# 🔹 Rutas opcionales (solo si existen)
if llamadas_router:
    app.include_router(llamadas_router)
if estados_mensaje_router:
    app.include_router(estados_mensaje_router)

logger.info("✅ Routers cargados correctamente")
