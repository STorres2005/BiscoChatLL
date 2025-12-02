# app/api/whatsapp_service.py
import os
import logging
import httpx
from fastapi import APIRouter, HTTPException
from app.core.config import config

# ===============================================================
# 🔹 Configuración y logger
# ===============================================================
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
logger = logging.getLogger("whatsapp_service")

# URL del servicio Node.js (se toma del entorno o config)
NODE_SERVICE_URL = os.getenv("NODE_SERVICE_URL", config.NODE_SERVICE_URL or "http://whatsapp:3001")


# ===============================================================
# 🔹 1. Función interna para obtener QR desde Node.js
# ===============================================================
async def get_whatsapp_qr(callback_url: str) -> str:
    """
    Solicita al servicio Node.js el código QR y devuelve la cadena base64
    que se incrusta en la plantilla HTML de inicio de sesión (login QR).
    """
    qr_endpoint = f"{NODE_SERVICE_URL.rstrip('/')}/qr"

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            # Enviamos callback solo por compatibilidad futura (no es requerido)
            response = await client.get(qr_endpoint, params={"callback": callback_url})

            if response.status_code != 200:
                logger.error(f"❌ [WhatsApp] Error desde Node.js: {response.status_code} {response.text}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Error {response.status_code} al generar QR en el servicio Node.js"
                )

            data = response.json()

            # Acepta múltiples formatos de campo (según la versión del microservicio)
            qr_code = (
                data.get("qr")
                or data.get("qr_code")
                or data.get("base64")
                or data.get("data")
                or ""
            )

            if not qr_code:
                logger.error("⚠️ QR vacío recibido desde Node.js.")
                raise HTTPException(status_code=500, detail="QR vacío recibido desde Node.js")

            logger.info("✅ QR recibido correctamente desde Node.js (%d bytes)", len(qr_code))
            return qr_code

    except httpx.RequestError as e:
        logger.error(f"❌ No se pudo conectar con Node.js ({NODE_SERVICE_URL}): {e}")
        raise HTTPException(status_code=500, detail="No se pudo conectar con el servicio Node.js")
    except Exception as e:
        logger.exception("❌ Error inesperado al obtener QR desde Node.js:")
        raise HTTPException(status_code=500, detail=str(e))


# ===============================================================
# 🔹 2. Endpoint REST público (para probar desde Swagger o Postman)
# ===============================================================
@router.get("/qr", summary="Obtener QR desde el servicio Node.js")
async def get_qr():
    """
    Endpoint público que reenvía la solicitud al microservicio Node.js
    para verificar manualmente el QR sin pasar por todo el flujo de FastAPI.
    """
    qr_endpoint = f"{NODE_SERVICE_URL.rstrip('/')}/qr"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(qr_endpoint)
            if response.status_code != 200:
                logger.error(f"⚠️ Error {response.status_code} al obtener QR desde Node.js.")
                raise HTTPException(status_code=500, detail="Error al obtener QR desde Node.js")
            return response.json()
    except httpx.RequestError as e:
        logger.error(f"❌ No se pudo conectar con Node.js ({NODE_SERVICE_URL}): {e}")
        raise HTTPException(status_code=500, detail="No se pudo conectar con el servicio Node.js")
    except Exception as e:
        logger.exception("❌ Error en /whatsapp/qr:")
        raise HTTPException(status_code=500, detail=str(e))
