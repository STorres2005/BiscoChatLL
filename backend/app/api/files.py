# app/api/files.py
import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from starlette.requests import Request

router = APIRouter()

# Carpeta raíz de uploads
UPLOAD_ROOT = "uploads"

# Extensiones soportadas
EXT_IMAGES = {"jpg","jpeg","png","gif","webp"}
EXT_VIDEOS = {"mp4","mov","avi","mkv"}
EXT_AUDIOS = {"mp3","wav","ogg","m4a"}
EXT_DOCS   = {"pdf","doc","docx","xls","xlsx","ppt","pptx","txt","zip","rar"}


def detect_folder(extension: str):
    """Detecta carpeta según la extensión."""
    ext = extension.lower()
    if ext in EXT_IMAGES:
        return "images"
    if ext in EXT_VIDEOS:
        return "videos"
    if ext in EXT_AUDIOS:
        return "audios"
    if ext in EXT_DOCS:
        return "documents"
    return "others"


def ensure_unique_filename(path: str, filename: str):
    """
    Evita nombres repetidos.
    Si existe "archivo.pdf", crea "archivo (1).pdf", "archivo (2).pdf", etc.
    """
    base, ext = os.path.splitext(filename)
    counter = 1
    final_name = filename

    while os.path.exists(os.path.join(path, final_name)):
        final_name = f"{base} ({counter}){ext}"
        counter += 1

    return final_name


# ============================================================
# 🔥 MÉTODO OFICIAL PARA SUBIR ARCHIVOS (/conversaciones/.../archivo)
# ============================================================
async def upload_file(request: Request, archivo: UploadFile):
    """
    Guarda el archivo respetando el nombre original y evitando colisiones.
    Retorna los campos EXACTOS que espera tu frontend.
    """

    original_name = archivo.filename
    if not original_name:
        raise HTTPException(status_code=400, detail="Archivo inválido")

    # Extraer extensión
    ext = original_name.split(".")[-1].lower()
    folder = detect_folder(ext)

    # Crear carpeta destino
    save_dir = os.path.join(UPLOAD_ROOT, folder)
    os.makedirs(save_dir, exist_ok=True)

    # -----------------------------
    # 🔥 NOMBRE REAL DEL ARCHIVO
    # -----------------------------
    # Limpiar caracteres peligrosos del nombre
    safe_name = original_name.replace("/", "_").replace("\\", "_").strip()

    # Evitar duplicados → archivo.pdf, archivo (1).pdf, archivo (2).pdf...
    final_name = ensure_unique_filename(save_dir, safe_name)

    # -----------------------------
    # GUARDAR ARCHIVO REAL
    # -----------------------------
    full_path = os.path.join(save_dir, final_name)
    content = await archivo.read()

    with open(full_path, "wb") as f:
        f.write(content)

    # -----------------------------
    # URL pública
    # -----------------------------
    base_url = str(request.base_url).rstrip("/")
    file_url = f"{base_url}/uploads/{folder}/{final_name}"

    # -----------------------------
    # RETORNO EXACTO PARA EL FRONT
    # -----------------------------
    return {
        "url": file_url,
        "tipo": ext,
        "tamano": len(content),
        "nombre_archivo": final_name,       # ✔ nombre tal cual
        "nombre_original": original_name,   # ✔ por si lo necesitas
        "categoria": folder,
    }


# ============================================================
# ENDPOINT PÚBLICO (COMPATIBILIDAD)
# ============================================================
@router.post("/upload_file")
async def upload_file_public(request: Request, file: UploadFile = File(...)):
    return await upload_file(request, file)
