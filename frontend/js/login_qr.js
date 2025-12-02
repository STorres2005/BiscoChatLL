// ======================================================
// BiscoChat - Generación y validación del código QR
// Compatible con HTTPS (ngrok) y HTTP local
// ======================================================

const statusMessage = document.getElementById("status-message");
const qrImage = document.getElementById("qr-image");

const TTL = 600; // segundos de validez del QR
const INTERVALO_VERIFICACION = 3000; // cada 3 segundos
const ESPERA_REGENERACION = 2000; // 2 segundos antes de regenerar

let tokenGenerado = null;
let cuentaInterval = null;
let verificacionIntervalo = null;

// ======================================================
// CONFIGURAR URL BASE DE LA API (100 % robusto)
// ======================================================
let API = "{{ api_url }}" || "";  // valor que viene de FastAPI

// Si Jinja no reemplazó api_url (por fallo de contexto), usar la URL actual
if (API.includes("{{") || API.trim() === "") {
  API = window.location.origin;
}

// Si ngrok sirve HTTPS pero la API vino en http:// → forzar https://
if (API.startsWith("http://") && window.location.protocol === "https:") {
  API = API.replace("http://", "https://");
}

// Asegurar formato correcto con / final
if (!API.endsWith("/")) API += "/";

// ======================================================
// FUNCIÓN PRINCIPAL → Generar QR
// ======================================================
async function generarQR() {
  console.log("🌐 Usando API base:", API); // 🧭 Debug para confirmar
  qrImage.src = "";
  qrImage.style.display = "none";
  tokenGenerado = null;
  statusMessage.textContent = "Generando código QR...";

  try {
    const response = await fetch(`${API}generar_token_qr`);
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();

    tokenGenerado = data.token;
    qrImage.src = `data:image/png;base64,${data.qr_code}`;
    qrImage.style.display = "block";
    statusMessage.textContent = `El QR expira en ${TTL} s`;

    iniciarVerificacion();
    iniciarCuentaRegresiva();
  } catch (error) {
    console.error("❌ Error al generar QR:", error);
    statusMessage.textContent = "⚠️ Error al generar QR. Intenta nuevamente.";
  }
}

// ======================================================
// Verificación periódica del estado del token QR
// ======================================================
function iniciarVerificacion() {
  if (verificacionIntervalo) clearInterval(verificacionIntervalo);

  verificacionIntervalo = setInterval(async () => {
    if (!tokenGenerado) return;

    try {
      const response = await fetch(`${API}verificar_estado_qr/${tokenGenerado}`);
      if (response.status === 404) return;
      if (!response.ok) throw new Error("Error verificando estado del QR");

      const data = await response.json();
      if (data.estado === "autenticado") {
        clearInterval(verificacionIntervalo);
        clearInterval(cuentaInterval);
        statusMessage.textContent = "✅ Sesión iniciada. Redirigiendo...";
        window.location.href = `${API}iniciar_sesion_con_token/${tokenGenerado}`;
      }
    } catch (error) {
      console.error("Error al verificar estado del QR:", error);
    }
  }, INTERVALO_VERIFICACION);
}

// ======================================================
// Cuenta regresiva y regeneración automática del QR
// ======================================================
function iniciarCuentaRegresiva() {
  let segundos = TTL;
  if (cuentaInterval) clearInterval(cuentaInterval);

  cuentaInterval = setInterval(() => {
    segundos--;
    if (segundos > 0) {
      statusMessage.textContent = `El QR expira en ${segundos} s`;
    } else {
      clearInterval(cuentaInterval);
      clearInterval(verificacionIntervalo);
      statusMessage.textContent = "⏳ QR expirado. Generando uno nuevo...";
      setTimeout(generarQR, ESPERA_REGENERACION);
    }
  }, 1000);
}

// ======================================================
// Inicio automático al cargar la página
// ======================================================
window.onload = generarQR;

// ======================================================
// 🔒 Limpieza inmediata del token al cerrar pestaña/navegador
// ======================================================
window.addEventListener("beforeunload", () => {
  try {
    const token = localStorage.getItem("token_qr");
    if (token) {
      // Enviar notificación al backend incluso si la pestaña se cierra
      const url = `${API}cerrar_sesion/${token}`;
      navigator.sendBeacon(url);

      // Limpiar inmediatamente del almacenamiento local
      localStorage.removeItem("token_qr");
      console.log("🧹 Token eliminado (sendBeacon) al cerrar pestaña o navegador.");
    }
  } catch (err) {
    console.warn("No se pudo eliminar el token al cerrar:", err);
  }
});
