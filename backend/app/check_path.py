from pathlib import Path

# Obtiene la ruta base de tu proyecto
base_dir = Path(__file__).resolve().parent.parent

# Define la ruta completa donde debería estar la plantilla
templates_dir = base_dir / "templates"
template_path = templates_dir / "qr_escaneo_exitoso.html"

# Imprime las rutas para que las puedas ver
print(f"Ruta de la aplicación: {Path(__file__).resolve()}")
print(f"Directorio de plantillas esperado: {templates_dir}")
print(f"Ruta del archivo de plantilla: {template_path}")

# Verifica si la carpeta y el archivo existen
print("\n--- Verificación ---")
if templates_dir.exists() and templates_dir.is_dir():
    print(f"¡Éxito! El directorio de plantillas existe: {templates_dir}")
else:
    print(f"Error: El directorio de plantillas NO existe en: {templates_dir}")

if template_path.exists() and template_path.is_file():
    print(f"¡Éxito! El archivo 'qr_escaneo_exitoso.html' existe en: {template_path}")
else:
    print(f"Error: El archivo 'qr_escaneo_exitoso.html' NO existe en: {template_path}")
