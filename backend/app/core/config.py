# app/core/config.py
from pathlib import Path
from dotenv import load_dotenv, find_dotenv
import os
import logging

# ================================
# LOGGING BÁSICO
# ================================
logger = logging.getLogger("app.config")

def _load_env_if_present():
    """Carga el archivo .env automáticamente si existe."""
    env_path = find_dotenv(usecwd=True)
    if env_path:
        load_dotenv(env_path, override=False)
        logger.info(f"[config] .env cargado desde: {env_path}")
        return env_path

    # Buscar manualmente hacia arriba por seguridad
    here = Path(__file__).resolve()
    for up in range(1, 5):
        candidate = here.parents[up] / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=False)
            logger.info(f"[config] .env cargado desde: {candidate}")
            return str(candidate)

    logger.warning("[config] ⚠️ .env no encontrado (OK si estás en Docker)")
    return None

_loaded_env = _load_env_if_present()

# ================================
# CLASE DE CONFIGURACIÓN GLOBAL
# ================================
class Config:
    ENV = os.getenv("ENV", "development")
    TZ = os.getenv("TZ", "America/Guayaquil")

    # Bases de datos
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    ALEMBIC_URL = os.getenv("ALEMBIC_URL", DATABASE_URL)
    REDIS_URL = os.getenv("REDIS_URL", "")

    # Servicios externos
    NODE_SERVICE_URL = os.getenv("NODE_SERVICE_URL", "http://whatsapp:3001")

    # Seguridad JWT
    JWT_SECRET = os.getenv("JWT_SECRET", "dev")
    JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRES_MIN = int(os.getenv("JWT_EXPIRES_MIN", "1440"))

    # Modo debug
    DEBUG = ENV != "production"

    # ================================
    # Configuración para envío de email
    # ================================
    EMAIL_FROM = os.getenv("EMAIL_FROM", "kevinlopezgarces2016@gmail.com")
    EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "fwmzjqchyduryztt")  # App Password Gmail sin espacios
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", 587))


# Instancia única de configuración
config = Config()

# ================================
# AJUSTES DE ENTORNO
# ================================
os.environ["TZ"] = config.TZ

def _print_summary():
    print("========== CONFIG SUMMARY ==========")
    print(f"[config] ENV = {config.ENV}")
    print(f"[config] TZ = {config.TZ}")
    print(f"[config] DATABASE_URL? {'✅' if config.DATABASE_URL else '❌'}")
    print(f"[config] REDIS_URL? {'✅' if config.REDIS_URL else '❌'}")
    print(f"[config] NODE_SERVICE_URL = {config.NODE_SERVICE_URL}")
    print(f"[config] JWT_ALGORITHM = {config.JWT_ALGORITHM}")
    print(f"[config] JWT_EXPIRES_MIN = {config.JWT_EXPIRES_MIN}")
    print(f"[config] EMAIL_FROM = {config.EMAIL_FROM}")
    print(f"[config] SMTP_HOST = {config.SMTP_HOST}:{config.SMTP_PORT}")
    if not config.DATABASE_URL:
        print("[⚠️ config] Falta DATABASE_URL — revisa tu .env o docker-compose.yml")
    if not config.REDIS_URL:
        print("[⚠️ config] Falta REDIS_URL — Redis necesario para tiempo real")
    if config.JWT_SECRET in ("dev", "", None):
        print("[⚠️ config] JWT_SECRET inseguro — cambia en producción")
    print("====================================")

if config.DEBUG:
    _print_summary()
