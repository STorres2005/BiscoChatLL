# app/db/base.py
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.db.sesion import engine  # ✅ Usa el mismo engine global
from sqlalchemy.ext.asyncio import async_sessionmaker


# ================================
# 🧱 BASE DE DATOS MODELOS
# ================================
class Base(DeclarativeBase):
    """Clase base para todos los modelos SQLAlchemy."""
    pass


# ================================
# 🧩 SESIÓN LOCAL (reutilizable)
# ================================
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


# ================================
# ⚙️ Dependencia para FastAPI
# ================================
async def get_db_async():
    """Dependencia para obtener una sesión de BD."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ================================
# 🧩 Creación de tablas (dev only)
# ================================
async def create_all_tables_async():
    """Crea todas las tablas registradas en Base (solo para desarrollo)."""
    from app.db import modelos  # Asegura que todos los modelos están importados
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Tablas creadas exitosamente.")
