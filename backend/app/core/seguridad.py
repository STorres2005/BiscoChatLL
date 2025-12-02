# app/core/seguridad.py
from datetime import datetime, timedelta
from typing import Any, Optional
from jose import jwt, JWTError, ExpiredSignatureError
from passlib.context import CryptContext
from app.core.config import config

# Contexto de hashing de contraseñas
contexto_claves = CryptContext(schemes=["bcrypt"], deprecated="auto")

# -----------------------------
# Claves
# -----------------------------
def encriptar_clave(clave: str) -> str:
    """Genera un hash seguro a partir de la clave ingresada."""
    return contexto_claves.hash(clave)

def verificar_clave(clave: str, hash_clave: str) -> bool:
    """Verifica si la clave en texto plano coincide con el hash almacenado."""
    return contexto_claves.verify(clave, hash_clave)

# -----------------------------
# JWT Tokens
# -----------------------------
def crear_token_acceso(usuario_id: str, minutos: Optional[int] = None) -> str:
    """
    Crea un token JWT firmado y con expiración.
    """
    expira = datetime.utcnow() + timedelta(minutes=minutos or config.JWT_EXPIRES_MIN)
    payload: dict[str, Any] = {"sub": usuario_id, "exp": expira}
    token = jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)
    return token

def decodificar_token(token: str) -> dict[str, Any]:
    """
    Decodifica un token JWT y valida su firma.
    Lanza excepciones específicas si el token es inválido o expiró.
    """
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return payload
    except ExpiredSignatureError:
        raise ValueError("Token expirado, inicia sesión nuevamente.")
    except JWTError:
        raise ValueError("Token inválido o manipulado.")
