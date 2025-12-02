# app/db/sesion.py
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import ssl
from app.core.config import config

# ================================
# 🚀 Crear el motor asíncrono
# ================================
connect_args = {}

# Agrega SSL solo si la URL lo requiere (Neon, RDS, etc.)
if "neon.tech" in config.DATABASE_URL or "sslmode=require" in config.DATABASE_URL:
    connect_args["ssl"] = ssl.create_default_context()

engine = create_async_engine(
    config.DATABASE_URL,
    echo=config.DEBUG,        # True = muestra SQL en consola
    pool_pre_ping=True,       # Verifica conexión antes de usarla
    max_overflow=10,
    connect_args=connect_args,
)

# ================================
# 🧩 Fábrica de sesiones asíncronas
# ================================
SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

# ================================
# ⚙️ Dependencia para FastAPI
# ================================
async def obtener_sesion():
    async with SessionLocal() as session:
        try:
            yield session
        except Exception as e:
            if session.is_active:
                await session.rollback()
            print("⚠️ Error durante la sesión:", e)
            raise
