const form = document.getElementById('validation-form');
const telefonoInput = document.getElementById('telefono-input');
const nombreInput = document.getElementById('nombre-input');
const apellidoInput = document.getElementById('apellido-input');
const extraFields = document.getElementById('extra-fields');
const messageArea = document.getElementById('message-area');
const submitButton = document.getElementById('submit-button');
const token = window.location.pathname.split('/').pop();

// ==========================
// 📞 VALIDACIÓN SILENCIOSA EN TIEMPO REAL DEL NÚMERO
// ==========================
telefonoInput.addEventListener('input', async () => {
  const numero = telefonoInput.value.trim();

  if (numero.length !== 10) {
    submitButton.disabled = true;
    submitButton.classList.add("opacity-60", "cursor-not-allowed");
    return;
  }

  try {
    const resp = await fetch(`/validar_numero/${encodeURIComponent(numero)}`);
    const data = await resp.json();

    if (resp.ok && data.valido) {
      submitButton.disabled = false;
      submitButton.classList.remove("opacity-60", "cursor-not-allowed");
      messageArea.innerHTML = "";
    } else {
      submitButton.disabled = true;
      submitButton.classList.add("opacity-60", "cursor-not-allowed");
    }
  } catch (err) {
    console.error("Error validando número:", err);
    submitButton.disabled = true;
    submitButton.classList.add("opacity-60", "cursor-not-allowed");
  }
});

// ==========================
// 📤 ENVÍO DEL FORMULARIO
// ==========================
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const telefono = telefonoInput.value.trim();
  const nombre = nombreInput.value.trim();
  const apellido = apellidoInput.value.trim();

  if (submitButton.disabled) return;

  submitButton.disabled = true;
  submitButton.classList.add("opacity-60", "cursor-not-allowed");

  try {
    const response = await fetch(`/validar_escaneo/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono, nombre, apellido }),
    });

    if (response.status === 404) {
      const data = await response.json();
      if (data.detalle === "nuevo_usuario") {
        extraFields.classList.remove("hidden");
        messageArea.innerHTML = `<p class="text-yellow-600 text-sm mt-2">${data.mensaje}</p>`;
        submitButton.disabled = false;
        submitButton.classList.remove("opacity-60", "cursor-not-allowed");
        return;
      } else {
        messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">${data.detail || "Error de validación."}</p>`;
      }
    } 
    else if (response.ok) {
      const data = await response.json();
      console.log("Respuesta del backend:", data);
      const esCreacion = nombre !== "" && apellido !== "";

      if (esCreacion) {
        messageArea.innerHTML = `<p class="text-green-600 text-sm font-medium mt-2">✅ Cuenta creada correctamente. Redirigiendo a verificación por correo...</p>`;
      } else {
        messageArea.innerHTML = `<p class="text-green-600 text-sm font-medium mt-2">✅ Bienvenido de nuevo, ${nombre || "usuario"}. Redirigiendo a verificación por correo...</p>`;
      }

      // 🔹 Redirigir automáticamente a validacion_dos_pasos.html
      setTimeout(() => {
        window.location.href = `/validacion_dos_pasos.html?telefono=${encodeURIComponent(telefono)}&token=${encodeURIComponent(token)}`;
      }, 1000);
    } 
    else {
      const errorText = await response.text();
      console.error("BACKEND ERROR 500:", errorText);
      messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">Error del servidor.</p>`;
    }
  } catch (err) {
    console.error("Error al validar:", err);
    messageArea.innerHTML = `<p class="text-red-500 text-sm mt-2">⚠️ Error de conexión con el servidor.</p>`;
  } finally {
    // Revalidar número antes de reactivar botón
    const numero = telefonoInput.value.trim();
    if (numero.length === 10) {
      try {
        const resp = await fetch(`/validar_numero/${encodeURIComponent(numero)}`);
        const data = await resp.json();
        if (resp.ok && data.valido) {
          submitButton.disabled = false;
          submitButton.classList.remove("opacity-60", "cursor-not-allowed");
        }
      } catch {}
    }
  }
});
