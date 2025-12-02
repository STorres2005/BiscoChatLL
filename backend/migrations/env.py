from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context
from pathlib import Path

# --------------------------------------------------
# 1. AÑADIR BACKEND A PYTHONPATH
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parents[1]  # backend/
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# --------------------------------------------------
# 2. LEER CONFIG DE ALEMBIC
# --------------------------------------------------
config = context.config

# Logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --------------------------------------------------
# 3. IMPORTAR MODELOS Y METADATA
# --------------------------------------------------
from app.db.base import Base     # <— IMPORTANTE
import app.db.modelos            # <— IMPORTANTE

# Esto es lo que Alembic necesita
target_metadata = Base.metadata

# --------------------------------------------------
# 4. URL DE BD DESDE alembic.ini
# --------------------------------------------------
DATABASE_URL = config.get_main_option("sqlalchemy.url")

# --------------------------------------------------
# 5. MODO OFFLINE
# --------------------------------------------------
def run_migrations_offline():
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()

# --------------------------------------------------
# 6. MODO ONLINE
# --------------------------------------------------
def run_migrations_online():
    connectable = engine_from_config(
        {"sqlalchemy.url": DATABASE_URL},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True
        )

        with context.begin_transaction():
            context.run_migrations()

# --------------------------------------------------
# 7. EJECUTAR SEGÚN MODO
# --------------------------------------------------
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
