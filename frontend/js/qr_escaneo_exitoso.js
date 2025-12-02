// ==========================
// ⚡ Captura del token desde el backend o la URL
// ==========================
const token = "{{ token }}"; // Token inyectado por el backend si aplica
const urlParams = new URLSearchParams(window.location.search);
const tokenFromUrl = urlParams.get("token");
const origen = urlParams.get("origen"); // 👈 Detecta si viene de 'movil' o 'pc'

// Usar el token válido
const tokenFinal = token && token !== "{{ token }}" ? token : tokenFromUrl;

// ==========================
// 📢 Referencias del DOM
// ==========================
const mensajeTexto = document.getElementById("mensaje-texto");

// ==========================
// ⚡ Lógica principal
// ==========================
if (!tokenFinal) {
  // ❌ No hay token válido
  mensajeTexto.innerHTML = `
    <span class="text-red-600 font-semibold">❌ Error:</span> 
    No se recibió ningún token. Por favor, vuelve a escanear el código QR.
  `;
  console.error("❌ No se recibió token. No se puede continuar.");
} else {
  console.log("✅ Token capturado correctamente:", tokenFinal);
  console.log("📡 Origen detectado:", origen || "no especificado");

  // ==========================
  // 📱 CASO MÓVIL: Validación por correo
  // ==========================
  if (origen === "movil") {
    mensajeTexto.innerHTML = `
      <span class="text-green-600 font-semibold">✅ Verificación exitosa.</span><br>
      Tu identidad fue confirmada correctamente.
    `;
    console.log("📱 Modo móvil: se muestra mensaje pero no se redirige.");
    return; // ✅ No redirige
  }

  // ==========================
  // 💻 CASO PC: Login con QR
  // ==========================
  mensajeTexto.innerHTML = `
    <span class="text-green-600 font-semibold">✅ Escaneo exitoso.</span><br>
    Redirigiendo a tus conversaciones...
  `;

  console.log("💻 Modo PC: Redirigiendo a conversaciones.html...");

  // Redirigir a la sesión del usuario
  setTimeout(() => {
    window.location.href = `/iniciar_sesion_con_token/${encodeURIComponent(tokenFinal)}`;
  }, 2000);
}
