// ==========================
// ⚡ Capturar parámetros de la URL
// ==========================
const urlParams = new URLSearchParams(window.location.search);
const telefonoUsuario = urlParams.get("telefono");
const token = urlParams.get("token"); // Token temporal del backend

// ==========================
// ⚡ Elementos del DOM
// ==========================
const form = document.getElementById("otp-form");
const emailStep = document.getElementById("email-step");
const codeStep = document.getElementById("code-step");
const emailInput = document.getElementById("email-input");
const otpInput = document.getElementById("otp-input");
const messageArea = document.getElementById("message-area");
const sendEmailButton = document.getElementById("send-email-button");
const otpSubmitButton = document.getElementById("otp-submit-button");

let emailGlobal = "";

// ==========================
// 📤 Manejo del formulario principal
// ==========================
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // ==================================================
  // Paso 1️⃣: Enviar código al correo
  // ==================================================
  if (!emailStep.classList.contains("hidden")) {
    const email = emailInput.value.trim();

    if (!email || !email.includes("@")) {
      messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">⚠️ Ingresa un correo válido.</p>`;
      return;
    }

    sendEmailButton.disabled = true;
    sendEmailButton.classList.add("opacity-60", "cursor-not-allowed");

    try {
      const res = await fetch(`/enviar_codigo_correo/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, telefono: telefonoUsuario }),
      });

      if (res.ok) {
        messageArea.innerHTML = `<p class="text-green-600 text-sm mt-2">📩 Código enviado a <b>${email}</b>. Revisa tu correo.</p>`;
        emailGlobal = email;

        // Cambiamos a paso 2
        emailStep.classList.add("hidden");
        codeStep.classList.remove("hidden");
        document.getElementById("instruction-text").innerText =
          "Ingresa el código de verificación recibido:";
      } else {
        const data = await res.json();
        messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">${data.detail || data.mensaje || "Error al enviar código."}</p>`;
        sendEmailButton.disabled = false;
        sendEmailButton.classList.remove("opacity-60", "cursor-not-allowed");
      }
    } catch (err) {
      console.error("❌ Error al enviar código:", err);
      messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">🚨 Error de conexión al servidor.</p>`;
      sendEmailButton.disabled = false;
      sendEmailButton.classList.remove("opacity-60", "cursor-not-allowed");
    }
  }

  // ==================================================
  // Paso 2️⃣: Validar código OTP recibido
  // ==================================================
  else if (!codeStep.classList.contains("hidden")) {
    const codigo = otpInput.value.trim();

    if (codigo.length !== 6) {
      messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">⚠️ Ingresa los 6 dígitos del código.</p>`;
      return;
    }

    otpSubmitButton.disabled = true;
    otpSubmitButton.classList.add("opacity-60", "cursor-not-allowed");

    try {
      const res = await fetch(`/validar_codigo_correo/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailGlobal,
          codigo,
          telefono: telefonoUsuario,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const nuevoToken = data.token || token;

        messageArea.innerHTML = `<p class="text-green-600 text-sm mt-2">✅ Código verificado correctamente. Redirigiendo...</p>`;

        // Redirigir a la página de éxito
        setTimeout(() => {
          window.location.href = `/qr_escaneo_exitoso.html?telefono=${encodeURIComponent(
            telefonoUsuario
          )}&token=${encodeURIComponent(nuevoToken)}&origen=movil`;
        }, 1500);
      } else {
        const data = await res.json();
        messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">${data.detail || data.mensaje || "❌ Código incorrecto o expirado."}</p>`;
        otpSubmitButton.disabled = false;
        otpSubmitButton.classList.remove("opacity-60", "cursor-not-allowed");
      }
    } catch (err) {
      console.error("❌ Error al validar código:", err);
      messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">🚨 Error de conexión al servidor.</p>`;
      otpSubmitButton.disabled = false;
      otpSubmitButton.classList.remove("opacity-60", "cursor-not-allowed");
    }
  }
});
