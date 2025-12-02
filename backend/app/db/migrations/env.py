# app/db/migrations/env.py
from __future__ import annotations  # PRIMERA LÍNEA OBLIGATORIA

import os
import sys
from logging.config import fileConfig
from sqlalchemy import pool, create_engine
from alembic import context
from pathlib import Path

# Añadir proyecto al path
BACKEND_DIR = Path(__file__).resolve().parents[3]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# CONFIG
config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# IMPORTAR MODELOS DESPUÉS DEL __future__ (ESTO ES LA CLAVE)
from app.db.base import Base
import app.db.modelos  # AHORA SÍ FUNCIONA

target_metadata = Base.metadata

# URL para Alembic (síncrona)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://chatuser:chatpass@postgres:5432/chatdb")

# Cambiar asyncpg → psycopg si es Neon
ALEMBIC_URL = DATABASE_URL.replace("+asyncpg", "+psycopg") if "+asyncpg" in DATABASE_URL else DATABASE_URL

def run_migrations_offline():
    context.configure(
        url=ALEMBIC_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = create_engine(
        ALEMBIC_URL,
        poolclass=pool.NullPool,
        connect_args={"sslmode": "require"} if "neon.tech" in ALEMBIC_URL else {}
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()