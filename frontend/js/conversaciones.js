console.log("✅ conversaciones.js NUEVO cargado - ", new Date().toISOString());

// ====================================================
// CONFIGURACIÓN DE API BASE (localhost / ngrok HTTPS)
// ====================================================
let API = window.location.origin;
if (API.includes("ngrok")) API = API.replace("http://", "https://");
API = API.replace(/\/+$/, "") + "/";
console.log("Usando API base:", API);

// ====================================================
// CAPTURAR JWT DESDE LA URL (si viene por query)
// ====================================================
const params = new URLSearchParams(window.location.search);
const jwtFromUrl = params.get("jwt");
if (jwtFromUrl) {
  document.cookie = `auth_token=${jwtFromUrl}; path=/; SameSite=None; Secure`;
  // localStorage.setItem("jwt_token", jwtFromUrl);
  console.log("JWT guardado manualmente en cookie y localStorage");
}

// ====================================================
// Helpers de cookies/JWT
// ====================================================
function getCookie(name) {
  const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : null;
}
function clearAuthArtifacts() {
  document.cookie = "auth_token=; Max-Age=0; path=/; SameSite=None; Secure";
  localStorage.removeItem("jwt_token");
}
function parseJwt(tkn) {
  try {
    const base = tkn.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ====================================================
// NOMBRE VISIBLE (alias si me tiene, sino teléfono)
// ====================================================
function resolveDisplayName(userId, telefonoFallback = null) {
  const uid = String(userId);

  // 1️⃣ Buscar en contactosGuardados: alias si me tiene
  const contacto = contactosCache.find(
    c => String(c.contacto_id) === uid
  );

  if (contacto) {
    if (contacto.alias && contacto.alias.trim() !== "") {
      return contacto.alias;
    }
    if (contacto.telefono) return contacto.telefono;
  }

  // 2️⃣ Fallback si backend mandó teléfono
  if (telefonoFallback) return telefonoFallback;

  return "Desconocido";
}


// ====================================================
// DATOS DEL USUARIO (meta-tags sobrescriben localStorage)
// ====================================================
let usuarioId = localStorage.getItem("usuario_id") || null;
let usuarioNombre = localStorage.getItem("usuario_nombre");
let usuarioTelefono = localStorage.getItem("usuario_telefono");

const metaId = document.getElementById("meta-usuario-id")?.content?.trim();
const metaNombre = document.getElementById("meta-usuario-nombre")?.content?.trim();
const metaTelefono = document.getElementById("meta-usuario-telefono")?.content?.trim();

if (metaId) {
  usuarioId = metaId;
  usuarioNombre = metaNombre || "Usuario";
  usuarioTelefono = metaTelefono || "";
  localStorage.setItem("usuario_id", usuarioId);
  localStorage.setItem("usuario_nombre", usuarioNombre);
  localStorage.setItem("usuario_telefono", usuarioTelefono);
  console.log("Usuario cargado desde meta-tags (override):", {
    usuarioId,
    usuarioNombre,
    usuarioTelefono,
  });
}

if (!usuarioId) {
  console.warn("No se encontró usuario_id. Redirigiendo...");
  window.location.href = "/";
}

// ====================================================
// TOKEN DE AUTENTICACIÓN
// ====================================================
const cookieToken = getCookie("auth_token");
let tokenValid = null;

if (cookieToken) {
  const sub = parseJwt(cookieToken)?.sub;
  if (sub && sub !== usuarioId) {
    console.warn("Token pertenece a otro usuario. Limpiando cookie…");
    clearAuthArtifacts();   // borra la cookie si es de otra persona
  } else {
    tokenValid = cookieToken;
  }
}

const baseHeaders = tokenValid
  ? { "Content-Type": "application/json", Authorization: `Bearer ${tokenValid}` }
  : { "Content-Type": "application/json" };


// ====================================================
// INICIO RÁPIDO
// ====================================================
const topbarTitle = document.getElementById("topbarTitle");
topbarTitle.textContent = "BiscoChat - " + (usuarioNombre || "Usuario");


// ====================================================
// VARIABLES UI
// ====================================================
const overlay = document.getElementById("profileOverlay");
const modal = document.getElementById("profileModal");
const avatarBtn = document.getElementById("userAvatarBtn");
const btnLogout = document.getElementById("btnLogout");
const chatSection = document.querySelector(".chat");
const messagesDiv = document.getElementById("messages");
const threads = document.getElementById("threads");
const chatHeaderCenter = document.getElementById("chatHeaderCenter");
const groupSubtitle = document.getElementById("groupSubtitle");
const chatHeader = document.getElementById("chatHeader");

const groupInfoOverlay = document.getElementById("groupInfoOverlay");
const groupInfoModal = document.getElementById("groupInfoModal");
const btnCloseGroupInfo = document.getElementById("groupInfoCloseBtn");
const groupInfoName = document.getElementById("groupInfoName");
const groupInfoCount = document.getElementById("groupInfoCount");
const groupMembersList = document.getElementById("groupMembersList");
const groupMemberContextMenu = document.getElementById("groupMemberContextMenu");
const btnRemoveMember = document.getElementById("btnRemoveMember");


// ==========================================
// MENÚ CONTEXTUAL DE MENSAJES
// ==========================================

let msgContextTargetId = null;
let msgContextTargetEsMio = false;

const msgContextMenu = document.getElementById("msgContextMenu");
const deleteMsgOverlay = document.getElementById("deleteMsgOverlay");
const deleteMsgModal = document.getElementById("deleteMsgModal");
const btnConfirmDeleteMsg = document.getElementById("btnConfirmDeleteMsg");
const btnCancelDeleteMsg = document.getElementById("btnCancelDeleteMsg");
const rowEliminarParaTodos = document.getElementById("rowEliminarParaTodos");


let groupMemberContextTargetId = null;

// Botones / menús de la barra lateral
const ajustesBtn = document.querySelector('button[data-action="ajustes"]');
const menuAjustes = document.getElementById("menuAjustes");
const btnPerfil = document.getElementById("btnPerfil");

// Cache de datos para poder resolver nombres en grupos
const chatsMap = new Map();   // conversacion_id -> objeto chat completo
let contactosCache = [];      // lista de contactos del usuario

let currentChatIsGroup = false;
let currentGroupMembers = [];      // [{id, telefono, ...}]
let currentUserIsGroupAdmin = false;
// 🔹 indica si YO sigo siendo miembro de este grupo
let currentUserIsGroupMember = true;


//abrir modal de informacion del grupo//
if (chatHeader) {
  chatHeader.addEventListener("click", () => {
    const chatObj = chatsMap.get(String(currentChatId));
    if (chatObj && chatObj.es_grupo) {
      abrirInfoGrupo(currentChatId);
    }
  });
}


// Helper para saber si un chat es de grupo o individual
function isChatGroup(chat) {
  if (!chat) return false;

  // Tu backend ya manda es_grupo (true/false)
  if (typeof chat.es_grupo !== "undefined") {
    return !!chat.es_grupo;
  }

  // Por si en algún momento usas otro campo
  if (chat.tipo === "grupo" || chat.tipo === "group") {
    return true;
  }

  // Fallback: si tiene más de 2 usuarios, asumimos grupo
  if (Array.isArray(chat.usuarios) && chat.usuarios.length > 2) {
    return true;
  }

  return false;
}


// ==========================================
//   FUNCIÓN PARA ABRIR EL MENÚ DE MIEMBRO
// ==========================================
function openMemberMenu(ev, userId) {
  const menu = document.getElementById("groupMemberContextMenu");

  menu.style.left = ev.pageX + "px";
  menu.style.top = ev.pageY + "px";
  menu.style.display = "block";

  // Guardar usuario seleccionado
  menu.dataset.userId = userId;
}

// Cerrar menú contextual de miembros
document.addEventListener("click", () => {
  const menu = document.getElementById("groupMemberContextMenu");
  menu.style.display = "none";
});


// =========================================
// 💬 MODAL INFO DE GRUPO – MÉTODO DEFINITIVO 2025
// =========================================

// 👉 ABRIR MODAL
function openGroupInfoModal() {
  if (!groupInfoOverlay || !groupInfoModal) return;
  if (!currentChatIsGroup) return;

  const chatObj = chatsMap.get(String(currentChatId));

  // ===============================
  // 📌 Cargar datos del grupo
  // ===============================
  if (chatObj) {
    groupInfoName.textContent = chatObj.titulo || "Grupo";

    const total =
      (Array.isArray(chatObj.usuarios) && chatObj.usuarios.length) ||
      (currentGroupMembers?.length || 0);

    groupInfoCount.textContent = `${total} participantes`;
  } else {
    groupInfoName.textContent = "Grupo";
    groupInfoCount.textContent = "";
  }

  // ===============================
  // 📌 Cargar TAB por defecto
  // ===============================
  renderGroupMembersList();
  switchGroupInfoTab("miembros");

  // ===============================
  // 📌 Mostrar modal (versión segura)
  // ===============================
  groupInfoOverlay.classList.add("visible");

  // El modal NO usa display=none, siempre existe
  groupInfoModal.style.display = "flex";

  // Bloquear scroll de fondo
  document.body.style.overflow = "hidden";

  // Reset visual
  groupInfoOverlay.scrollTop = 0;
  groupInfoOverlay.scrollLeft = 0;
}



// 👉 CERRAR MODAL
function closeGroupInfoModal() {
  if (!groupInfoOverlay || !groupInfoModal) return;

  groupInfoOverlay.classList.remove("visible");

  // Después de la transición, ocultamos la tarjeta
  setTimeout(() => {
    groupInfoModal.style.display = "none";
  }, 200);

  // Restaurar scroll
  document.body.style.overflow = "auto";
}



// 👉 CERRAR HACIENDO CLIC FUERA
if (groupInfoOverlay) {
  groupInfoOverlay.addEventListener("click", (e) => {
    if (e.target === groupInfoOverlay) {
      closeGroupInfoModal();
    }
  });
}



// 👉 CERRAR CON BOTÓN (si existiera)
if (typeof btnCloseGroupInfo !== "undefined" && btnCloseGroupInfo) {
  btnCloseGroupInfo.addEventListener("click", closeGroupInfoModal);
}



// 👉 ABRIR DESDE EL HEADER (único, NO duplicado)
if (chatHeader) {
  chatHeader.addEventListener("click", () => {
    if (currentChatIsGroup) {
      openGroupInfoModal();
    }
  });
}

// ===================================================
// 🔥 FUNCIÓN GLOBAL OFICIAL — NOMBRE PARA GRUPOS
// alias > aliasContacto > teléfono > "Tú" > "Usuario"
// ===================================================
function getGroupMemberDisplayName(userId) {
  try {
    const uid = String(userId);

    // 1) Si es el usuario actual → "Tú"
    if (uid === String(usuarioId)) {
      return "Tú";
    }

    // 2) Buscar alias en contactos guardados
    if (Array.isArray(contactosCache)) {
      const contacto = contactosCache.find(
        c => c.contacto_id && String(c.contacto_id) === uid
      );
      if (contacto?.alias?.trim()) {
        return contacto.alias.trim();
      }
    }

    // 3) Buscar en lista interna del grupo
    if (Array.isArray(currentGroupMembers)) {
      const miembro = currentGroupMembers.find(
        m => String(m.id) === uid
      );

      if (miembro) {
        if (miembro.alias?.trim()) return miembro.alias.trim();
        if (miembro.telefono?.trim()) return miembro.telefono.trim();
      }
    }

    // 4) Fallback
    return "Usuario";

  } catch (err) {
    console.error("Error getGroupMemberDisplayName:", err);
    return "Usuario";
  }
}

// ====================================================
// FIX SCROLL SOLO EN PANELES + RE-CÁLCULO FIABLE DE ALTURAS
// ====================================================
(function setupScrollAndHeights() {
  Object.assign(document.documentElement.style, { height: "100%", overflow: "hidden" });
  Object.assign(document.body.style, { height: "100%", overflow: "hidden", overscrollBehavior: "contain" });

  function ensureScrollable(el) {
    if (!el) return;
    el.style.overflowY = "auto";
    el.style.overflowX = "hidden";
    el.style.webkitOverflowScrolling = "touch";
    el.style.overscrollBehavior = "contain";
    el.style.boxSizing = "border-box";
  }
  ensureScrollable(messagesDiv);
  ensureScrollable(threads);

  // 🔹 NUEVO: scroll en las listas de los modales
  ensureScrollable(document.getElementById("newChatList"));
  ensureScrollable(document.getElementById("newGroupList"));

  function getComposerBlock() {
    const input = document.getElementById("composerInput");
    if (!input) return null;
    return input.closest(".composer") || input.parentElement;
  }

  function setAutoHeight(el, extraBottom = 0) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let available = window.innerHeight - rect.top - extraBottom;
    if (available < 120) available = 120;
    el.style.height = available + "px";
    el.style.maxHeight = available + "px";
  }

  function applyHeights() {
    const composer = getComposerBlock();
    const composerH = composer ? composer.getBoundingClientRect().height : 0;

    // 🔹 barra de respuesta/edición
    const replyBar = document.getElementById("replyPreview");
    let replyH = 0;
    if (replyBar && replyBar.style.display !== "none") {
      replyH = replyBar.getBoundingClientRect().height;
    }

    const bottomBlock = composerH + replyH;

    setAutoHeight(threads, 0);
    setAutoHeight(messagesDiv, bottomBlock);
  }

  window.__reflowPanels = function reflowPanels() {
    requestAnimationFrame(() => {
      applyHeights();
      requestAnimationFrame(applyHeights);
    });
  };

  window.addEventListener("resize", applyHeights);
  const ro = new ResizeObserver(applyHeights);
  ro.observe(document.body);
  window.__reflowPanels();
})();


// ====================================================
// SONIDO DE NOTIFICACIÓN
// ====================================================
let soundReceive;
try {
  soundReceive = new Audio("../assets/notificacion.mp3");
} catch (err) {
  console.warn("Archivo de sonido no encontrado (opcional)", err);
}

// ====================================================
// PERMISO PARA NOTIFICACIONES DEL NAVEGADOR
// ====================================================
if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission().catch(() => { });
}


// ====================================================
// PRELOADER SUAVE
// ====================================================
threads.innerHTML = `
  <div id="loadingChats" style="
      text-align:center;
      color:gray;
      font-style:italic;
      margin-top:40px;
      font-size:15px;
  ">Cargando conversaciones...</div>
`;
chatSection.style.display = "none";

// ====================================================
// TOAST (notificación superior)
// ====================================================
function showToast(message, color = "#3F80C7") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = color;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

// ====================================================
// PERFIL DE USUARIO (se abre desde AJUSTES → Perfil)
// ====================================================
function openProfileModal() {
  document.getElementById("profileName").textContent = usuarioNombre || "Usuario";
  document.getElementById("profilePhone").textContent = usuarioTelefono || "";
  overlay.style.display = "block";
  modal.style.display = "flex";
}

function closeProfileModal() {
  overlay.style.display = "none";
  modal.style.display = "none";
}

// ✅ Al hacer clic en el avatar del header:
//   - si es grupo → abre info del grupo
//   - si es chat individual, por ahora no hace nada
if (avatarBtn) {
  avatarBtn.onclick = () => {
    if (!currentChatIsGroup) return;
    openGroupInfoModal();
  };
}


// ✅ Ahora el perfil se abre desde el menú de AJUSTES → "Perfil"
if (btnPerfil) {
  btnPerfil.onclick = (e) => {
    e.stopPropagation();
    if (menuAjustes) menuAjustes.style.display = "none";
    openProfileModal();
  };
}

overlay.onclick = () => {
  closeProfileModal();
};

btnLogout.onclick = () => {
  clearAuthArtifacts();
  localStorage.removeItem("usuario_id");
  localStorage.removeItem("usuario_nombre");
  localStorage.removeItem("usuario_telefono");
  localStorage.removeItem("current_chat_id");
  window.location.href = "/";
};


// ====================================================
// MENÚ "MÁS" Y MODAL CONTACTO + MENÚ AJUSTES
// ====================================================
const btnMas = document.getElementById("btnMas");
const menuMas = document.getElementById("menuMas");

btnMas.onclick = (e) => {
  e.stopPropagation();
  // cerramos el menú de AJUSTES si estuviera abierto
  if (menuAjustes) menuAjustes.style.display = "none";
  menuMas.style.display = menuMas.style.display === "block" ? "none" : "block";
};

// 🔹 Botón AJUSTES → abre menúAjustes (alineado igual que el de "Más")
if (ajustesBtn && menuAjustes) {
  ajustesBtn.onclick = (e) => {
    e.stopPropagation();
    // cerramos el menú "Más" si estuviera abierto
    menuMas.style.display = "none";

    const rect = ajustesBtn.getBoundingClientRect();

    // Usamos el mismo LEFT que el menú de "Más" para que queden simétricos
    let baseLeft = 80; // valor por defecto
    if (menuMas) {
      const leftStr =
        menuMas.style.left || getComputedStyle(menuMas).left || "80px";
      baseLeft = parseFloat(leftStr);   // ej: "80px" -> 80
    }

    // TOP alineado con el botón de ajustes
    menuAjustes.style.top = (rect.top + window.scrollY) + "px";
    menuAjustes.style.left = baseLeft + "px";

    menuAjustes.style.display =
      menuAjustes.style.display === "block" ? "none" : "block";
  };
}


// 🔹 Cerrar menús al hacer click fuera
document.addEventListener("click", () => {
  menuMas.style.display = "none";
  if (menuAjustes) menuAjustes.style.display = "none";
});

const addContactOverlay = document.getElementById("addContactOverlay");
const addContactModal = document.getElementById("addContactModal");
const saveContactBtn = document.getElementById("saveContactBtn");
const cancelContactBtn = document.getElementById("cancelContactBtn");

document.getElementById("btnAddContact").onclick = () => {
  menuMas.style.display = "none";
  addContactOverlay.style.display = "block";
  addContactModal.style.display = "flex";
};

addContactOverlay.onclick = () => {
  addContactOverlay.style.display = "none";
  addContactModal.style.display = "none";
};
if (cancelContactBtn) {
  cancelContactBtn.onclick = () => {
    addContactOverlay.style.display = "none";
    addContactModal.style.display = "none";
  };
}

// ====================================================
// GUARDAR CONTACTO (Versión PRO - Flujo WhatsApp)
// ====================================================
saveContactBtn.onclick = async () => {
  const phone = document.getElementById("newContactPhone").value.trim();
  const alias = document.getElementById("newContactAlias").value.trim();

  if (!phone) {
    showToast("Ingresa un número válido", "#d94b4b");
    showErrorModal("Ingresa un número válido");
    return;
  }

  if (phone === usuarioTelefono) {
    showErrorModal("No puedes agregarte a ti mismo.");
    return;
  }

  try {
    const resp = await fetch(`${API}contactos`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        contacto_telefono: phone,
        alias: alias,
      }),
    });

    const contentType = resp.headers.get("content-type");
    let data = null;

    if (contentType && contentType.includes("application/json")) {
      data = await resp.json();
    } else {
      const text = await resp.text();
      console.warn("Respuesta no-JSON del servidor:", text.slice(0, 300) + "...");
      data = { detail: "Respuesta inesperada del servidor", raw: text };
    }

    if (resp.ok) {
      addContactOverlay.style.display = "none";
      addContactModal.style.display = "none";
      document.getElementById("newContactPhone").value = "";
      document.getElementById("newContactAlias").value = "";
      await loadChats();
      showSuccessModal("Contacto añadido con éxito");
      return;
    }

    let errMsg = "Error desconocido";
    if (Array.isArray(data.detail)) {
      const primerError = data.detail.find(e => e.msg) || data.detail[0];
      errMsg = primerError?.msg || JSON.stringify(primerError);
    } else if (typeof data.detail === "string") {
      errMsg = data.detail;
    } else if (data.message) {
      errMsg = data.message;
    } else if (data.error) {
      errMsg = data.error;
    } else if (data.detail?.msg) {
      errMsg = data.detail.msg;
    } else {
      errMsg = JSON.stringify(data);
    }

    if (resp.status === 404) errMsg = "El contacto no tiene cuenta en BiscoChat.";
    else if (resp.status === 400 && errMsg.includes("ya está agregado")) errMsg = "Ese contacto ya está en tu lista.";
    else if (resp.status === 400 && errMsg.includes("ti mismo")) errMsg = "No puedes agregarte a ti mismo.";
    else if (resp.status === 422) errMsg = "Número inválido o formato incorrecto.";

    console.group("Error del servidor");
    console.error("Código HTTP:", resp.status);
    console.error("Respuesta completa:", JSON.stringify(data, null, 2));
    console.groupEnd();

    showErrorModal(errMsg);

  } catch (e) {
    console.error("Error de conexión con el servidor:", e);
    showErrorModal("Error de conexión con el servidor");
  }
};

// ====================================================
// VARIABLES GLOBALES
// ====================================================
let currentChatId = null;
let currentChatUserId = null; // ID del otro usuario en el chat abierto
let currentChatName = "";     // Alias del otro usuario (para responder)
let typingTimeout = null;
let estadosTicker = null;
const mensajesCache = new Map();
const tickNodes = new Map();
const currentUserId = document.getElementById("meta-usuario-id").content;

// RESPUESTA / EDICIÓN
let replyTarget = null;       // { id, esMio, autorNombre, texto }
let isEditing = false;
let editingMessageId = null;

// REACCIONES (solo visual)
const reactionsMap = new Map(); // mensaje_id -> emoji
// 🔥 NUEVO — Anti-duplicados global para mensajes RT
const mensajesRecibidosSet = new Set();

// Cache local de mensajes para poder mostrar respuestas tipo WhatsApp
// mensaje_id -> { id, texto, autorId, borrado }
const messageCache = new Map();


// estado de conexión por usuario (llenado por Socket.IO)
const userStatusMap = {}; // { usuario_id: { online, last_seen } }

// referencia al label del header
const chatStatusLabel = document.getElementById("chatStatus");

// ====================================================
// MENÚ CONTEXTUAL DE CADA CHAT (vaciar / eliminar / grupo)
// ====================================================
const threadContextMenu = document.getElementById("threadContextMenu");
const ctxVaciarChat = document.getElementById("ctxVaciarChat");
const ctxEliminarChat = document.getElementById("ctxEliminarChat");

// 🔹 NUEVOS: opciones específicas para grupos
const ctxEliminarMensajes = document.getElementById("ctxEliminarMensajes");
const ctxSalirGrupo = document.getElementById("ctxSalirGrupo");

const clearChatOverlay = document.getElementById("clearChatOverlay");
const clearChatModal = document.getElementById("clearChatModal");
const confirmClearChat = document.getElementById("confirmClearChat");
const cancelClearChat = document.getElementById("cancelClearChat");

const deleteChatOverlay = document.getElementById("deleteChatOverlay");
const deleteChatModal = document.getElementById("deleteChatModal");
const confirmDeleteChat = document.getElementById("confirmDeleteChat");
const cancelDeleteChat = document.getElementById("cancelDeleteChat");

// 👇 AÑADE ESTO AQUÍ
const leaveGroupOverlay = document.getElementById("leaveGroupOverlay");
const leaveGroupModal = document.getElementById("leaveGroupModal");
const leaveGroupNameSpan = document.getElementById("leaveGroupName");
const confirmLeaveGroup = document.getElementById("confirmLeaveGroup");
const cancelLeaveGroup = document.getElementById("cancelLeaveGroup");

let contextChatId = null;
let contextChatName = "";

// ====================================================
// CHATS OCULTOS (no deben aparecer nunca más en la lista)
// ====================================================
const HIDDEN_CHATS_KEY = "biscochat_hidden_chats";

function getHiddenChats() {
  try {
    const raw = localStorage.getItem(HIDDEN_CHATS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function saveHiddenChats(list) {
  try {
    const uniq = Array.from(new Set(list.map(String)));
    localStorage.setItem(HIDDEN_CHATS_KEY, JSON.stringify(uniq));
  } catch { }
}

function addHiddenChat(chatId) {
  const id = String(chatId);
  const list = getHiddenChats();
  if (!list.includes(id)) {
    list.push(id);
    saveHiddenChats(list);
  }
}

function isChatHidden(chatId) {
  const id = String(chatId);
  const list = getHiddenChats();
  return list.includes(id);
}

// ====================================================
// FUNCIÓN CENTRAL → QUITAR CHAT DE LA LISTA + CACHE
// ====================================================
function removeChatFromUI(chatId) {
  const id = String(chatId);

  // Eliminar tarjeta visual
  const card = document.querySelector(`.thread[data-id="${id}"]`);
  if (card && card.parentNode) card.parentNode.removeChild(card);

  // Eliminar del mapa local
  chatsMap.delete(id);

  // Si era el chat abierto → cerrarlo
  if (String(currentChatId) === id) {
    currentChatId = null;
    messagesDiv.innerHTML = "";
    chatSection.style.display = "none";
  }

  console.log("🗑️ Chat eliminado visualmente:", id);
}

// ====================================================
// ABRIR MODAL "ELIMINAR MENSAJES (solo para mí)"
// ====================================================
ctxEliminarMensajes?.addEventListener("click", () => {
  hideThreadContextMenu();
  if (!contextChatId) return;

  // Abrimos el mismo modal que usas para mensajes individuales
  // pero en modo "para mí" para todo el chat
  deleteMsgOverlay.style.display = "block";
  deleteMsgModal.style.display = "flex";

  // Seleccionar automáticamente "para_mi"
  const radioMi = deleteMsgModal.querySelector('input[value="para_mi"]');
  if (radioMi) {
    radioMi.checked = true;
    msgDeleteMode = "para_mi";
    btnConfirmDeleteMsg.disabled = false;
  }

  // Ocultar "Eliminar para todos"
  if (rowEliminarParaTodos) {
    rowEliminarParaTodos.style.display = "none";
  }

  // Guardamos un modo especial
  msgContextTargetId = null;            // no es mensaje puntual
  deleteMsgModal.dataset.massDelete = contextChatId;
});

// ============================
// SALIR DEL GRUPO (modal)
// ============================
ctxSalirGrupo?.addEventListener("click", () => {
  hideThreadContextMenu();
  if (!contextChatId) return;

  if (leaveGroupNameSpan) {
    leaveGroupNameSpan.textContent = contextChatName || "este grupo";
  }

  if (leaveGroupOverlay) leaveGroupOverlay.style.display = "block";
  if (leaveGroupModal) leaveGroupModal.style.display = "flex";
});

function closeLeaveGroupModal() {
  if (leaveGroupOverlay) leaveGroupOverlay.style.display = "none";
  if (leaveGroupModal) leaveGroupModal.style.display = "none";
}

leaveGroupOverlay?.addEventListener("click", (e) => {
  if (e.target === leaveGroupOverlay) {
    closeLeaveGroupModal();
  }
});

cancelLeaveGroup?.addEventListener("click", () => {
  closeLeaveGroupModal();
});

confirmLeaveGroup?.addEventListener("click", async () => {
  if (!contextChatId) return;

  try {
    // 🔹 Endpoint para sacarme a mí mismo del grupo
    const resp = await fetch(
      `${API}conversaciones/${contextChatId}/miembros/${usuarioId}`,
      {
        method: "DELETE",
        headers: baseHeaders,
      }
    );

    if (!resp.ok) {
      console.error("Error al salir del grupo:", resp.status, await resp.text());
      showErrorModal("No se pudo salir del grupo.");
      return;
    }

    // Actualizar cache del chat → ya no soy miembro
    const chatObj = chatsMap.get(String(contextChatId));
    if (chatObj) {
      chatObj.soy_miembro = false;
    }

    // Si el grupo está abierto, bloquear envío y mostrar mensaje
    if (currentChatId === contextChatId && currentChatIsGroup) {
      currentUserIsGroupMember = false;
      applyGroupMembershipUi();
    }
    updateAddMembersButtonVisibility();
    showSuccessModal("Has salido del grupo.");
  } catch (e) {
    console.error("Error de red al salir del grupo:", e);
    showErrorModal("Error de conexión al salir del grupo.");
  } finally {
    closeLeaveGroupModal();
  }
});

// Mostrar menú contextual junto al mouse
function showThreadContextMenu(e, chatId, chatName) {
  e.preventDefault();
  e.stopPropagation();

  contextChatId = chatId;
  contextChatName = chatName;

  if (!threadContextMenu) return;

  // Obtener objeto completo del chat desde caché
  const chatObj = chatsMap.get(String(chatId));
  const esGrupo = isChatGroup(chatObj);

  // ✅ CORREGIDO → Solo es miembro si viene TRUE del backend
  const soyMiembro = esGrupo ? (chatObj?.soy_miembro === true) : true;

  // Elementos del menú
  const liVaciar = ctxVaciarChat;
  const liEliminarMensajes = ctxEliminarMensajes;
  const liSalirGrupo = ctxSalirGrupo;
  const liEliminarChat = ctxEliminarChat;

  // Ocultar TODOS
  liVaciar.style.display = "none";
  liEliminarMensajes.style.display = "none";
  liSalirGrupo.style.display = "none";
  liEliminarChat.style.display = "none";

  // ===============================
  // 📌 CASO GRUPO
  // ===============================
  if (esGrupo) {
    if (soyMiembro) {
      // Aún soy miembro
      liEliminarMensajes.style.display = "block";
      liSalirGrupo.style.display = "block";
    } else {
      // Ya NO soy miembro → solo "Eliminar chat"
      liEliminarChat.style.display = "block";
    }
  }

  // ===============================
  // 📌 CHAT INDIVIDUAL
  // ===============================
  else {
    liVaciar.style.display = "block";
    liEliminarChat.style.display = "block";
  }

  // ===============================
  // POSICIONAR EL MENÚ
  // ===============================
  const menu = threadContextMenu;
  menu.style.display = "block";

  const mouseX = e.clientX;
  const mouseY = e.clientY;

  const maxLeft = window.innerWidth - menu.offsetWidth - 8;
  const maxTop = window.innerHeight - menu.offsetHeight - 8;

  menu.style.left = Math.min(mouseX + 8, maxLeft) + "px";
  menu.style.top = Math.min(mouseY + 8, maxTop) + "px";
}


function hideThreadContextMenu() {
  if (threadContextMenu) {
    threadContextMenu.style.display = "none";
  }
}

// Cerrar menú contextual al hacer click en cualquier parte
document.addEventListener("click", () => {
  hideThreadContextMenu();
});

function showMsgContextMenu(e, msgId, esMio) {
  // 🚫 Si ya no soy miembro del grupo, no hay menú de mensajes
  if (currentChatIsGroup && !currentUserIsGroupMember) {
    return;
  }
  msgContextTargetId = msgId;
  msgContextTargetEsMio = esMio;

  if (!msgContextMenu) return;

  // ¿El mensaje está eliminado para todos?
  const msgEl = document.querySelector(`.msg[data-msg-id="${msgId}"]`);
  const esEliminadoParaTodos = msgEl?.classList.contains("msg-deleted");

  // Botones del menú
  const botones = msgContextMenu.querySelectorAll("button[data-action]");
  botones.forEach((btn) => {
    const action = btn.dataset.action;

    if (esEliminadoParaTodos) {
      // En mensaje eliminado -> sólo permitimos "delete" (Eliminar para mí)
      if (action === "delete") {
        btn.disabled = false;
        btn.style.opacity = "1";
      } else {
        btn.disabled = true;
        btn.style.opacity = "0.4";
      }
    } else {
      // Mensaje normal -> todo habilitado
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });

  // Fila de reacciones (se oculta si está eliminado)
  const rowReactions = msgContextMenu.querySelector(".msg-reactions-row");
  if (rowReactions) {
    rowReactions.style.display = esEliminadoParaTodos ? "none" : "flex";
  }

  // Posicionar el menú
  msgContextMenu.style.display = "flex";

  const menu = msgContextMenu;
  const mouseX = e.clientX;
  const mouseY = e.clientY;

  const maxLeft = window.innerWidth - menu.offsetWidth - 8;
  const maxTop = window.innerHeight - menu.offsetHeight - 8;

  const left = Math.min(mouseX + 8, maxLeft);
  const top = Math.min(mouseY + 8, maxTop);

  menu.style.left = left + "px";
  menu.style.top = top + "px";
}


// Cerrar menú de mensaje
function hideMsgContextMenu() {
  if (msgContextMenu) msgContextMenu.style.display = "none";
}

// Cerrar menus al hacer click fuera
document.addEventListener("click", () => {
  hideMsgContextMenu();
});

// Gestionar clicks en el menú de mensaje
if (msgContextMenu) {
  msgContextMenu.addEventListener("click", (e) => {
    // 1) Reacciones (emoji)
    const reactionSpan = e.target.closest(".msg-reactions-row span");
    if (reactionSpan && msgContextTargetId) {
      const emoji = reactionSpan.textContent.trim();
      hideMsgContextMenu();
      applyReactionToMessage(msgContextTargetId, emoji);
      return;
    }

    // 2) Botones normales
    const btn = e.target.closest("button");
    if (!btn) return;

    const action = btn.dataset.action;
    hideMsgContextMenu();

    if (!msgContextTargetId) return;

    switch (action) {
      case "reply":
        startReplyToMessage(msgContextTargetId, msgContextTargetEsMio);
        break;

      case "copy":
        handleCopyMessage(msgContextTargetId);
        break;

      case "delete":
        openDeleteMsgModal();
        break;

      case "edit":
        startEditMessage(msgContextTargetId, msgContextTargetEsMio);
        break;

      default:
        console.log("Acción aún no implementada:", action);
    }
  });
}


// Copiar texto del mensaje
async function handleCopyMessage(msgId) {
  try {
    const node = document.querySelector(`.msg[data-msg-id="${msgId}"] .msg-body`);
    const text = node ? node.textContent : "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showToast("Mensaje copiado");
  } catch (e) {
    console.warn("No se pudo copiar:", e);
  }
}

// ==========================================
// MODAL ELIMINAR MENSAJE (para mí / para todos)
// ==========================================
let msgDeleteMode = null; // "para_mi" o "para_todos"

function openDeleteMsgModal() {
  if (!msgContextTargetId) return;

  // Ver si el mensaje ya está marcado como eliminado para todos
  const node = document.querySelector(`.msg[data-msg-id="${msgContextTargetId}"]`);
  const esEliminadoParaTodos = node?.classList.contains("msg-deleted");

  if (deleteMsgOverlay) deleteMsgOverlay.style.display = "block";
  if (deleteMsgModal) deleteMsgModal.style.display = "flex";

  msgDeleteMode = null;
  btnConfirmDeleteMsg.disabled = true;

  // reset radios
  const radios = deleteMsgModal.querySelectorAll('input[name="msgDeleteMode"]');
  radios.forEach((r) => (r.checked = false));

  if (esEliminadoParaTodos) {
    // 🔹 Mensaje eliminado para todos → solo "Eliminar para mí"
    rowEliminarParaTodos.style.display = "none";

    const radioMi = deleteMsgModal.querySelector('input[value="para_mi"]');
    if (radioMi) {
      radioMi.checked = true;
      msgDeleteMode = "para_mi";
      btnConfirmDeleteMsg.disabled = false;
    }
  } else if (msgContextTargetEsMio) {
    // 🔹 Mensaje normal y es mío → ambas opciones
    rowEliminarParaTodos.style.display = "flex";
  } else {
    // 🔹 Mensaje de otro → solo "Eliminar para mí"
    rowEliminarParaTodos.style.display = "none";
    const radioMi = deleteMsgModal.querySelector('input[value="para_mi"]');
    if (radioMi) {
      radioMi.checked = true;
      msgDeleteMode = "para_mi";
      btnConfirmDeleteMsg.disabled = false;
    }
  }
}


function closeDeleteMsgModal() {
  if (deleteMsgOverlay) deleteMsgOverlay.style.display = "none";
  if (deleteMsgModal) deleteMsgModal.style.display = "none";
  msgDeleteMode = null;
}

// Cambios en radios → habilitar botón
deleteMsgModal
  ?.querySelectorAll('input[name="msgDeleteMode"]')
  .forEach((radio) => {
    radio.addEventListener("change", (e) => {
      msgDeleteMode = e.target.value;
      btnConfirmDeleteMsg.disabled = !msgDeleteMode;
    });
  });

btnCancelDeleteMsg?.addEventListener("click", () => {
  closeDeleteMsgModal();
});

deleteMsgOverlay?.addEventListener("click", (e) => {
  if (e.target === deleteMsgOverlay) {
    closeDeleteMsgModal();
  }
});

// Confirmar eliminación
// Confirmar eliminación
btnConfirmDeleteMsg?.addEventListener("click", async () => {
  // 1) MODO BORRADO MASIVO (todos mis mensajes del chat actual)
  if (deleteMsgModal.dataset.massDelete) {
    const chatId = deleteMsgModal.dataset.massDelete;

    try {
      const resp = await fetch(`${API}conversaciones/${chatId}/mensajes`, {
        method: "DELETE",
        headers: baseHeaders,
      });

      if (!resp.ok) {
        showErrorModal("No se pudieron eliminar tus mensajes del chat.");
      } else {
        if (currentChatId === chatId) {
          messagesDiv.innerHTML = "";
        }
        showSuccessModal("Tus mensajes fueron eliminados.");
        // 🔥 FIX: Actualizar la burbuja izquierda después de vaciar tus mensajes
        const card = document.querySelector(`.thread[data-id="${chatId}"]`);
        if (card) {
          const lastNode = card.querySelector(".tlast");
          const horaNode = card.querySelector(".hora");

          if (lastNode) lastNode.textContent = "Sin mensajes";
          if (horaNode) horaNode.textContent = "";
        }

      }
    } catch {
      showErrorModal("Error de conexión.");
    }

    deleteMsgModal.dataset.massDelete = "";
    closeDeleteMsgModal();
    return;
  }

  // 2) MODO NORMAL (un solo mensaje: para mí / para todos)
  if (!msgContextTargetId || !msgDeleteMode) return;

  try {
    const resp = await fetch(
      `${API}conversaciones/mensajes/${msgContextTargetId}?modo=${msgDeleteMode}`,
      {
        method: "DELETE",
        headers: baseHeaders,
      }
    );

    if (!resp.ok) {
      console.error("Error al eliminar mensaje:", resp.status, await resp.text());
      showErrorModal("No se pudo eliminar el mensaje.");
      return;
    }

    aplicarEliminacionMensajeLocal({
      mensaje_id: msgContextTargetId,
      modo: msgDeleteMode,
      usuario_id: usuarioId,
    });
  } catch (e) {
    console.error("Error de red al eliminar mensaje:", e);
    showErrorModal("Error de conexión al eliminar mensaje.");
  } finally {
    closeDeleteMsgModal();
  }
});


// ====================================================
// GUARDAR / RESTAURAR ÚLTIMO CHAT ABIERTO
// ====================================================
function saveCurrentChat(chatId, otherName, otherUserId) {
  try {
    const payload = {
      chatId,
      otherName,
      otherUserId: otherUserId || null,
    };
    localStorage.setItem("biscochat_current_chat", JSON.stringify(payload));
  } catch (e) {
    console.warn("No se pudo guardar current_chat:", e);
  }
}

function getSavedChat() {
  try {
    const raw = localStorage.getItem("biscochat_current_chat");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ====================================================
// FORMATEAR ESTADO “EN LÍNEA / ÚLTIMA VEZ...”
// ====================================================
function formatLastSeen(isoStr) {
  if (!isoStr) return "";

  let iso = String(isoStr).trim();

  // Normalizar microsegundos (Python → 6 dígitos / JS → solo 3)
  iso = iso.replace(/\.(\d{3})\d+/, ".$1");

  // Normalizar zona horaria
  if (!iso.endsWith("Z") && !iso.match(/[\+\-]\d{2}:\d{2}$/)) {
    iso += "Z";
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const ahora = new Date();
  const esHoy = d.toDateString() === ahora.toDateString();

  const hora = d.toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (esHoy) {
    return `última vez hoy a las ${hora}`;
  }

  const fecha = d.toLocaleDateString("es-EC");
  return `última vez el ${fecha} a las ${hora}`;
}



function actualizarChatStatusLabel(usuarioId) {
  if (!chatStatusLabel) return;

  // En grupos no mostrar estado
  if (currentChatIsGroup === true) {
    chatStatusLabel.textContent = "";
    return;
  }

  if (!usuarioId) {
    chatStatusLabel.textContent = "";
    return;
  }

  const st = userStatusMap[String(usuarioId)];

  if (!st) {
    chatStatusLabel.textContent = "";
    return;
  }

  // Mostrar
  chatStatusLabel.textContent = st.online
    ? "en línea"
    : formatLastSeen(st.last_seen);
}



// ====================================================
// Cargar estado inicial del backend
// ====================================================
async function ensurePresenceInfo(usuarioId) {
  if (!usuarioId) return;
  const key = String(usuarioId);

  try {
    const resp = await fetch(`${API}auth/estado_usuario/${usuarioId}`, {
      headers: baseHeaders,
    });

    if (!resp.ok) {
      console.warn("No se pudo obtener estado inicial:", resp.status);
      return;
    }

    const data = await resp.json();

    userStatusMap[key] = {
      online: !!data.en_linea,
      last_seen: data.ultima_conexion,
    };

    // Si este usuario es el chat actual → refrescar
    if (currentChatUserId === key) {
      actualizarChatStatusLabel(key);
    }

  } catch (e) {
    console.warn("Error estado:", e);
  }
}




// ====================================================
// Helpers GENÉRICOS
// ====================================================
async function fetchFirstOk(urls, options) {
  for (const u of urls) {
    try {
      const r = await fetch(u, options);
      if (r.ok) return r;
    } catch { }
  }
  const last = urls[urls.length - 1];
  throw new Error(`No disponible: ${last}`);
}

function updateThreadPreview(chatId, ultimoTexto) {
  const cards = Array.from(document.querySelectorAll(".thread"));
  for (const card of cards) {
    if (card.dataset.id === chatId) {
      const tlast = card.querySelector(".tlast");
      if (tlast) tlast.textContent = ultimoTexto;
      break;
    }
  }
}

// Actualizar la hora que se muestra en la tarjeta
function updateThreadTime(chatId, isoFecha) {
  if (!isoFecha) return;
  const card = document.querySelector(`.thread[data-id="${chatId}"]`);
  if (!card) return;
  const horaNode = card.querySelector(".hora");
  if (!horaNode) return;
  horaNode.textContent = getLocalHourFromISO(isoFecha);
}

// ========================================
// 🟦 CONTACTOS CACHE (seguridad adicional)
// ========================================
if (!window.contactosCache || !(window.contactosCache instanceof Map)) {
  window.contactosCache = new Map();
}


// ======================================================================
// 🔥 NOMBRE PARA CHAT 1 A 1 — VERSIÓN FINAL 2025 (NO DAÑA NADA DE GRUPOS)
// ======================================================================
function getDisplayNameForUser(userId, telefonoFallback = "") {
  try {
    if (!userId) return "";

    // Si soy yo → siempre "Tú"
    if (String(userId) === String(usuarioId)) {
      return "Tú";
    }

    const uid = String(userId);

    // contactosCache = [{ contacto_id, alias, telefono }]
    const contacto = contactosCache.find(
      c => String(c.contacto_id) === uid
    );

    // 1️⃣ Alias si existe
    if (contacto?.alias && contacto.alias.trim() !== "") {
      return contacto.alias.trim();
    }

    // 2️⃣ Teléfono si existe en contactos
    if (contacto?.telefono && contacto.telefono.trim() !== "") {
      return contacto.telefono.trim();
    }

    // 3️⃣ Teléfono que viene del backend
    if (telefonoFallback && telefonoFallback.trim() !== "") {
      return telefonoFallback.trim();
    }

    // 4️⃣ Último recurso → vacío (NUNCA "Contacto", NUNCA "Usuario")
    return "";

  } catch (err) {
    console.error("Error en getDisplayNameForUser:", err);
    return "";
  }
}



// ==========================================================
// 🔥 NOMBRE MOSTRADO PARA CUALQUIER CHAT (1-1 o GRUPO)
// ==========================================================
function getMemberDisplayName(userId) {
  try {
    if (!userId) return "";

    const uid = String(userId);

    // ======================================================
    // 1️⃣ SI ES CHAT INDIVIDUAL → usar el nombre del chat
    // ======================================================
    if (!currentChatIsGroup) {
      // En 1 a 1, el "autor" siempre es la otra persona
      return currentChatName || "Contacto";
    }

    // ======================================================
    // 2️⃣ SI ES GRUPO → buscar en currentGroupMembers
    // ======================================================
    const miembro = currentGroupMembers.find(
      x => String(x.id) === uid
    );

    if (!miembro) {
      return "Usuario";
    }

    // Alias si existe
    if (miembro.alias && miembro.alias.trim() !== "") {
      return miembro.alias.trim();
    }

    // Número si existe
    if (miembro.telefono && miembro.telefono.trim() !== "") {
      return miembro.telefono.trim();
    }

    return "Usuario";

  } catch (err) {
    console.error("Error en getMemberDisplayName:", err);
    return "Usuario";
  }
}


// ===========================================================
// 🔥 SUBTÍTULO DEL GRUPO — alias > número (sin nombres BD)
// ===========================================================
function renderGroupHeaderSubtitle() {
  try {

    // 👉 Si NO es un grupo, limpiar y salir
    if (!currentChatIsGroup) {
      if (groupSubtitle) groupSubtitle.textContent = "";
      return;
    }

    // 👉 Validar que hayan miembros
    if (!Array.isArray(currentGroupMembers) || currentGroupMembers.length === 0) {
      if (groupSubtitle) groupSubtitle.textContent = "Miembros";
      return;
    }

    // 👉 Filtrar solo miembros activos
    const activos = currentGroupMembers.filter(m => m.activo !== false);

    // 👉 Convertir cada miembro en alias > número usando tu función oficial
    const nombres = activos
      .map(m => {
        const nombre = getGroupMemberDisplayName(m.id);

        // evitar casos como null, vacío o “Usuario”
        if (!nombre || nombre.trim() === "" || nombre === "Usuario") {
          return "";
        }

        return nombre.trim();
      })
      .filter(n => n !== "")
      .filter((v, i, arr) => arr.indexOf(v) === i);   // quitar duplicados

    if (!groupSubtitle) return;

    // 👉 Fallback si no hay nombres válidos
    groupSubtitle.textContent =
      nombres.length > 0 ? nombres.join(", ") : "Miembros";

  } catch (err) {
    console.error("Error en renderGroupHeaderSubtitle:", err);

    if (groupSubtitle) {
      groupSubtitle.textContent = "Miembros";
    }
  }
}



// ======================================================
// 🟦 ACTUALIZAR HEADER DEL CHAT (VERSIÓN FINAL PRO)
// ======================================================
function actualizarChatHeader(chatId) {
  const chatObj = chatsMap.get(String(chatId));
  if (!chatObj) return;

  const nameEl = document.getElementById("chatName");
  const statusEl = document.getElementById("chatStatus");
  const groupSubEl = document.getElementById("groupSubtitle");

  if (!nameEl || !statusEl || !groupSubEl) return;

  // Limpiar textos antes de renderizar
  statusEl.textContent = "";
  groupSubEl.textContent = "";

  // -----------------------------------------
  // 🔵 CHAT DE GRUPO
  // -----------------------------------------
  if (chatObj.es_grupo) {
    currentChatIsGroup = true;

    // Nombre
    nameEl.textContent = chatObj.titulo || "Grupo";

    // Lista local de miembros
    currentGroupMembers = (chatObj.usuarios || []).map(u => ({
      id: u.id,
      alias: u.alias || "",
      telefono: u.telefono || "",
      activo: u.activo !== false,
      es_admin: String(u.id) === String(chatObj.creador_id),
    }));

    // Subtítulo del grupo
    renderGroupHeaderSubtitle();

    currentChatUserId = null;
    return;
  }

  // -----------------------------------------
  // 🔵 CHAT INDIVIDUAL
  // -----------------------------------------
  currentChatIsGroup = false;

  const other = (chatObj.usuarios || []).find(
    u => String(u.id) !== String(usuarioId)
  );

  let visibleName = other
    ? getDisplayNameForUser(other.id, other.telefono || "")
    : "Contacto";

  nameEl.textContent = visibleName;

  // Guardar id del otro
  currentChatUserId = other ? String(other.id) : null;

  // Pintar lo que tengamos en cache
  actualizarChatStatusLabel(currentChatUserId);

  // Consultar backend (siempre)
  ensurePresenceInfo(currentChatUserId);
}





// Incrementar el badge de mensajes no leídos
function incrementarBadge(conversacionId) {
  const badge = document.querySelector(
    `.badge-unread[data-chat-id="${conversacionId}"]`
  );
  if (!badge) return;
  let n = parseInt(badge.textContent || "0", 10);
  n = isNaN(n) ? 0 : n;
  n++;
  badge.textContent = String(n);
  badge.style.display = "flex";
}


// Limpiar el badge al abrir el chat
function limpiarBadge(conversacionId) {
  const badge = document.querySelector(
    `.badge-unread[data-chat-id="${conversacionId}"]`
  );
  if (!badge) return;
  badge.textContent = "0";
  badge.style.display = "none";
}

function applyGroupMembershipUi() {
  const input = document.getElementById("composerInput");
  const btnSend = document.getElementById("btnEnviar");
  const btnEmoji = document.getElementById("btnEmoji");
  const btnAdj = document.getElementById("btnAdjuntos");
  const btnVoz = document.getElementById("btnVoz");

  const bloqueado = currentChatIsGroup && !currentUserIsGroupMember;

  const elementos = [input, btnSend, btnEmoji, btnAdj, btnVoz];

  elementos.forEach(el => {
    if (!el) return;
    if (bloqueado) {
      el.disabled = true;
      el.classList.add("disabled");
      el.style.opacity = "0.4";
      el.style.pointerEvents = "none";
    } else {
      el.disabled = false;
      el.classList.remove("disabled");
      el.style.opacity = "1";
      el.style.pointerEvents = "auto";
    }
  });

  // Banner informativo
  let banner = document.getElementById("groupLeftBanner");
  if (!bloqueado) {
    if (banner && banner.parentNode) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement("div");
    banner.id = "groupLeftBanner";
    banner.style.cssText = `
            background:#f8d7da;
            color:#721c24;
            padding:8px 15px;
            border-radius:10px;
            margin:12px auto;
            text-align:center;
            max-width:90%;
            font-size:14px;
            font-weight:500;
        `;
    banner.textContent =
      "No puedes enviar mensajes a este grupo porque ya no eres miembro.";
    messagesDiv.appendChild(banner);
  }

  messagesDiv.scrollTo({ top: messagesDiv.scrollHeight });
}


// ====================================================
// Helpers de ESTADOS (✓, ✓✓, ✓✓ azules)
// ====================================================
function pintarTicks(node, modo) {
  if (!node) return;
  const base = "✓";
  if (modo === "enviado") {
    node.textContent = base;
    node.style.color = "#888";
  } else if (modo === "entregado") {
    node.textContent = base + base;
    node.style.color = "#888";
  } else if (modo === "leido") {
    node.textContent = base + base;
    node.style.color = "#1DA1F2";
  }
}

// =====================================================
// 🟦 Marcar mensajes como LEÍDOS al abrir el chat
// =====================================================
async function esperarMarcarLeido(chatId) {
  try {
    const resp = await fetch(
      `${API}conversaciones/${chatId}/marcar_leidos`,
      {
        method: "PUT",
        headers: baseHeaders,
        credentials: "include"
      }
    );

    if (!resp.ok) {
      console.warn("⚠ Error al marcar leídos:", resp.status);
    }
  } catch (e) {
    console.warn("⚠ Error de red marcando leídos:", e);
  }
}

// =====================================================
// 🔵 Registrar estado individual (entregado / leido)
// =====================================================
async function registrarEstado(mensajeId, estado) {

  if (!mensajeId) return;
  if (!["entregado", "leido"].includes(estado)) return;

  try {
    const resp = await fetch(`${API}estados_mensaje`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        mensaje_id: mensajeId,
        usuario_id: usuarioId,
        estado: estado,   // entregado | leido
      }),
    });

    if (!resp.ok) {
      console.warn(`⚠ No se pudo registrar estado ${estado} para`, mensajeId);
    }
  } catch (e) {
    console.warn("⚠ Error registrando estado:", e);
  }
}



async function consultarEstado(mensajeId) {
  if (!mensajeId) return [];

  try {
    const r = await fetch(`${API}estados_mensaje/mensaje/${mensajeId}`, {
      headers: baseHeaders,
    });

    if (!r.ok) {
      console.warn("No se pudo consultar estados:", r.status);
      return [];
    }

    return await r.json();
  } catch (e) {
    console.warn("Error consultando estados:", e);
    return [];
  }
}


// Refrescar checks de mis mensajes según estados en BD
async function refrescarVistosDeMisMensajes() {
  if (!currentChatId) return;

  try {
    // 1) obtener todos los mensajes del chat actual
    const resp = await fetch(
      `${API}conversaciones/${currentChatId}/estados`,
      { headers: baseHeaders }
    );

    if (!resp.ok) {
      console.warn("No se pudieron obtener estados:", resp.status);
      return;
    }

    const data = await resp.json();
    if (!data || typeof data !== "object") return;

    // data = { mensaje_id : [{usuario_id, estado}, ...], ... }
    for (const mid of Object.keys(data)) {

      const estados = data[mid];
      if (!Array.isArray(estados)) continue;

      const tickNode = tickNodes.get(mid);
      if (!tickNode) continue;   // mensaje no es mío

      // solo estados de otras personas
      const otros = estados.filter(
        e => String(e.usuario_id) !== String(usuarioId)
      );

      if (otros.length === 0) continue;

      const hayLeido = otros.some(e => e.estado === "leido");
      const hayEntregado = otros.some(
        e => e.estado === "entregado" || e.estado === "enviado"
      );
      const soloPendiente = otros.every(e => e.estado === "pendiente");

      if (hayLeido) {
        pintarTicks(tickNode, "leido");
      }
      else if (hayEntregado && !soloPendiente) {
        pintarTicks(tickNode, "entregado");
      }
      else {
        pintarTicks(tickNode, "enviado");
      }
    }

  } catch (e) {
    console.error("Error refrescando vistos:", e);
  }
}



function switchGroupInfoTab(tab) {
  document
    .querySelectorAll(".group-info-sidebar button[data-tab]")
    .forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

  document.querySelectorAll(".group-tab").forEach((tabDiv) => {
    tabDiv.classList.remove("active");
  });

  if (tab === "resumen") {
    document.getElementById("groupTabResumen")?.classList.add("active");
  } else if (tab === "miembros") {
    document.getElementById("groupTabMiembros")?.classList.add("active");
  }
}

document
  .querySelectorAll(".group-info-sidebar button[data-tab]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "multimedia" || tab === "archivos") return; // aún no implementado
      if (tab === "miembros") renderGroupMembersList();
      switchGroupInfoTab(tab);
    });
  });


function renderGroupMembersList() {
  if (!groupMembersList) return;

  groupMembersList.innerHTML = "";

  if (!currentChatIsGroup) {
    groupMembersList.innerHTML =
      '<p style="color:gray;font-style:italic;">No es un grupo</p>';
    return;
  }

  if (!currentGroupMembers || currentGroupMembers.length === 0) {
    groupMembersList.innerHTML =
      '<p style="color:gray;font-style:italic;">Sin miembros</p>';
    return;
  }

  // Solo mostrar miembros activos
  const activos = currentGroupMembers.filter(m => m.activo !== false);

  activos.forEach((m) => {
    const el = document.createElement("div");
    el.className = "group-member";
    el.dataset.userId = m.id;

    const avatarUrl =
      m.foto_perfil && /^https?:\/\//.test(m.foto_perfil)
        ? m.foto_perfil
        : "../assets/usuario_gato.png";

    const nombre = getDisplayNameForUser(m.id, m.telefono || null);

    el.innerHTML = `
      <div class="avatar">
        <img src="${avatarUrl}" alt="avatar">
      </div>

      <div class="group-member-info">
        <div class="group-member-name">${nombre}</div>
        <div class="group-member-phone">${m.telefono || ""}</div>
      </div>

      <div class="group-member-role">
        ${String(m.id) === String(usuarioId)
        ? "Tú"
        : m.es_admin
          ? "Admin"
          : ""
      }
      </div>
    `;

    // Menú contextual al hacer click derecho
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();

      groupMemberContextTargetId = m.id;
      showGroupMemberContextMenu(e.clientX, e.clientY);
    });

    groupMembersList.appendChild(el);
  });
}

// ==========================================================
// 🚀 NUEVO: recargar lista de miembros de un grupo
// ==========================================================
async function actualizarMiembrosGrupo(conversacionId) {
  try {
    const resp = await fetch(`${API}conversaciones/${conversacionId}/miembros`, {
      headers: baseHeaders,
    });

    const miembros = await resp.json();
    const cont = document.getElementById("groupMembersList");

    // 1️⃣ LIMPIAR SIEMPRE
    cont.innerHTML = "";

    // 2️⃣ AGREGAR CADA MIEMBRO
    for (const m of miembros) {
      const item = buildGroupMemberItem(m); // Esta función YA EXISTE en tu archivo
      cont.appendChild(item);
    }

    // 3️⃣ Actualizar contador
    document.getElementById("groupInfoCount").textContent =
      `${miembros.length} participantes`;

  } catch (e) {
    console.error("Error actualizando miembros:", e);
  }
}

function showGroupMemberContextMenu(x, y) {
  if (!groupMemberContextMenu) return;

  // Si NO soy admin → ocultar botón "Eliminar del grupo"
  if (btnRemoveMember) {
    btnRemoveMember.style.display = currentUserIsGroupAdmin ? "block" : "none";
  }

  groupMemberContextMenu.style.display = "block";

  const maxLeft = window.innerWidth - groupMemberContextMenu.offsetWidth - 8;
  const maxTop = window.innerHeight - groupMemberContextMenu.offsetHeight - 8;

  const left = Math.min(x + 8, maxLeft);
  const top = Math.min(y + 8, maxTop);

  groupMemberContextMenu.style.left = left + "px";
  groupMemberContextMenu.style.top = top + "px";
}

function hideGroupMemberContextMenu() {
  if (groupMemberContextMenu) {
    groupMemberContextMenu.style.display = "none";
  }
}

document.addEventListener("click", () => {
  hideGroupMemberContextMenu();
});


groupMemberContextMenu?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || !groupMemberContextTargetId) return;

  const action = btn.dataset.action;
  const userId = groupMemberContextTargetId;
  groupMemberContextTargetId = null;
  hideGroupMemberContextMenu();

  const miembro = currentGroupMembers.find(
    (m) => String(m.id) === String(userId)
  );
  if (!miembro) return;

  if (action === "open-chat") {
    // Abrir conversación individual con ese miembro
    if (miembro.telefono) {
      crearOAbrirChatConContacto(miembro.telefono);
    } else {
      console.warn("Miembro sin teléfono, no se puede abrir chat directo");
    }
  } else if (action === "remove") {
    if (!currentUserIsGroupAdmin) {
      showToast("Solo el administrador puede eliminar miembros", "#d94b4b");
      return;
    }
    removeMemberFromGroup(userId);
  }
});

async function removeMemberFromGroup(userId) {
  try {
    const resp = await fetch(
      `${API}conversaciones/${currentChatId}/miembros/${userId}`,
      {
        method: "DELETE",
        headers: baseHeaders,
      }
    );

    if (!resp.ok) {
      console.error("Error al eliminar miembro:", resp.status, await resp.text());
      showErrorModal("No se pudo eliminar al miembro del grupo.");
      return;
    }

    // Actualizar lista local y UI
    currentGroupMembers = currentGroupMembers.filter(
      (m) => String(m.id) !== String(userId)
    );
    renderGroupMembersList();
    renderGroupHeaderSubtitle();

    showSuccessModal("Miembro eliminado del grupo.");
  } catch (e) {
    console.error("Error de red al eliminar miembro:", e);
    showErrorModal("Error de conexión al eliminar miembro.");
  }
}

// ====================================================
// CARGAR CHATS (VERSIÓN FINAL — COMPATIBLE BACKEND 2025)
// ====================================================
async function loadChats() {
  try {
    const [chatsResp, contactosResp] = await Promise.all([
      fetch(`${API}chats/${usuarioId}`, {
        headers: baseHeaders,
        credentials: "include"
      }),
      fetch(`${API}contactos`, {
        headers: baseHeaders,
        credentials: "include"
      }),
    ]);

    if (!chatsResp.ok) throw new Error(`HTTP ${chatsResp.status}`);
    if (!contactosResp.ok) throw new Error(`HTTP ${contactosResp.status}`);

    const chats = await chatsResp.json();
    const contactos = await contactosResp.json();

    threads.innerHTML = "";
    contactosCache = Array.isArray(contactos) ? contactos : [];
    chatsMap.clear();

    const hiddenSet = new Set(getHiddenChats());

    if (!Array.isArray(chats) || chats.length === 0) {
      threads.innerHTML =
        `<p style="text-align:center;color:gray;margin-top:30px;">Sin conversaciones</p>`;
      return;
    }

    chats.forEach((chat) => {
      if (!chat || !chat.id) return;

      const idStr = String(chat.id);

      if (hiddenSet.has(idStr)) return;

      if (chat.ocultado_para_mi === true) return;

      // 1:1
      if (Array.isArray(chat.usuarios) && chat.usuarios.length === 2) {
        chat.es_grupo = false;
      }

      if (
        chat.es_grupo === false &&
        !chat.usuarios.some((u) => String(u.id) === String(usuarioId))
      ) return;

      chatsMap.set(idStr, chat);

      const esGrupo = !!chat.es_grupo;

      const other = (chat.usuarios || []).find(
        (u) => String(u.id) !== String(usuarioId)
      );

      let displayName = "Chat";

      if (esGrupo) {
        displayName = chat.titulo || "Grupo";
      } else if (other) {
        const contacto = contactos.find(
          (c) =>
            c.contacto_id &&
            String(c.contacto_id) === String(other.id)
        );

        if (contacto?.alias) {
          displayName = contacto.alias;
        } else if (other.telefono) {
          displayName = other.telefono;
        }
      }

      let ultimoMsg = "Sin mensajes";
      let hora = "";

      let mensajesVisibles = [];

      if (Array.isArray(chat.mensajes)) {
        mensajesVisibles = chat.mensajes.filter(
          (m) => !m.ocultado_para_mi
        );
      }

      if (mensajesVisibles.length > 0) {
        const last = mensajesVisibles[mensajesVisibles.length - 1];
        ultimoMsg = last.cuerpo || last.contenido || "";
        const fechaLast = last.editado_en || last.creado_en || last.fecha || null;
        if (fechaLast) hora = getLocalHourFromISO(fechaLast);
      }

      const el = document.createElement("div");
      el.className = "thread";
      el.dataset.id = idStr;

      const avatarSrc = esGrupo
        ? "../assets/grupo_icono.png"
        : "../assets/usuario_gato.png";

      el.innerHTML = `
        <div class="avatar"><img src="${avatarSrc}" alt="avatar"/></div>
        <div class="info">
          <div class="tname">${displayName}</div>
          <div class="tlast">${ultimoMsg}</div>
        </div>
        <div class="right-info">
          <div class="hora">${hora}</div>
          <div class="badge-unread" data-chat-id="${chat.id}" style="display:none;">0</div>
        </div>
      `;

      el.onclick = () =>
        openChat(
          chat.id,
          displayName,
          esGrupo ? null : (other ? other.id : null)
        );

      el.addEventListener("contextmenu", (e) => {
        showThreadContextMenu(e, chat.id, displayName);
      });

      threads.appendChild(el);
    });

    window.__reflowPanels();
  } catch (error) {
    console.error("Error al cargar chats:", error);
    threads.innerHTML =
      `<p style="text-align:center;color:red;">Error al cargar chats</p>`;
  }
}


// ====================================================
// 🚀 ABRIR CHAT (VERSIÓN FINAL DEFINITIVA 2025)
// ====================================================
async function openChat(chatId, otherName, otherUserId = null) {

  currentChatId = chatId;
  currentChatUserId = otherUserId != null ? String(otherUserId) : null;
  currentChatName = otherName || "";

  const chatObj = chatsMap.get(String(chatId));

  // 🔥 DEJAMOS QUE actualizarChatHeader DETECTE SI ES GRUPO
  actualizarChatHeader(chatId);

  // ===============================================
  // 1️⃣ PREPARAR MIEMBROS DEL GRUPO (alias o número)
  // ===============================================
  if (chatObj?.es_grupo && Array.isArray(chatObj.usuarios)) {
    currentGroupMembers = chatObj.usuarios.map(u => {

      const uid = String(u.id);
      let alias = u.alias || null;
      let telefono = u.telefono || null;

      // Si existe contacto guardado
      if (Array.isArray(contactosCache)) {
        const contacto = contactosCache.find(
          c => c.contacto_id && String(c.contacto_id) === uid
        );

        if (contacto) {
          if (contacto.alias?.trim()) alias = contacto.alias.trim();
          if (!telefono && contacto.telefono) telefono = contacto.telefono;
        }
      }

      return {
        id: u.id,
        telefono,
        alias,
        es_admin: String(u.id) === String(chatObj.creador_id),
        activo: u.activo !== false,
      };
    });
  }
  else {
    currentGroupMembers = [];
  }

  // Roles usuario
  currentChatIsGroup = !!chatObj?.es_grupo;
  currentUserIsGroupAdmin =
    currentChatIsGroup &&
    String(chatObj.creador_id) === String(usuarioId);

  currentUserIsGroupMember =
    currentChatIsGroup ? chatObj?.soy_miembro === true : true;

  updateAddMembersButtonVisibility();
  applyGroupMembershipUi();

  limpiarBadge(chatId);
  marcarMensajesLeidos(chatId);
  saveCurrentChat(chatId, otherName, currentChatUserId);

  messagesDiv.innerHTML = "";
  chatSection.style.display = "flex";

  tickNodes.clear();
  if (estadosTicker) clearInterval(estadosTicker);

  // ===============================================
  // 2️⃣ BLOQUEAR SI YA NO SOY MIEMBRO
  // ===============================================
  if (currentChatIsGroup && !currentUserIsGroupMember) {

    renderSystemMessage(
      "Ya no eres miembro de este grupo. No recibirás mensajes nuevos.",
      null
    );

    ["composerInput", "btnEnviar", "btnEmoji", "btnAdjuntos", "btnVoz"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.disabled = true;
          el.style.opacity = "0.4";
          el.style.pointerEvents = "none";
        }
      });

    if (window.socket?.connected) {
      window.socket.emit("desuscribir_conversacion", { conversacion_id: chatId });
    }
    return;
  }

  // ===============================================
  // 3️⃣ CARGAR MENSAJES
  // ===============================================
  try {
    const r = await fetch(`${API}conversaciones/${chatId}/mensajes`, {
      headers: baseHeaders
    });

    if (!r.ok) {
      showErrorModal("No se pudieron cargar los mensajes.");
      return;
    }

    let msgs = await r.json();

    for (const m of msgs) {
      const esMio = (m.remitente_id || m.usuario_id) === usuarioId;
      renderMessageFromObj(m, esMio);

      if (!esMio && m.id) {
        registrarEstado(m.id, "entregado");
      }
    }

    if (msgs.length === 0) {
      renderSystemMessage("Aún no hay mensajes.", null);
    }

    refrescarVistosDeMisMensajes();
    estadosTicker = setInterval(refrescarVistosDeMisMensajes, 4000);

    // Marcar leídos al abrir
    await fetch(`${API}conversaciones/${chatId}/marcar_leidos`, {
      method: "PUT",
      headers: baseHeaders,
      credentials: "include"
    });

    if (window.socket?.connected) {
      window.socket.emit("suscribir_conversacion", { conversacion_id: chatId });
    }

  } catch (err) {
    console.error("❌ Error openChat:", err);
  }

  applyGroupMembershipUi();
}



// ======================================================
// 📌 ABRIR INFO DEL GRUPO – VERSIÓN FINAL 100% FUNCIONAL
// ======================================================
async function abrirInfoGrupo(chatId) {
  try {

    const resp = await fetch(
      `${API}conversaciones/${chatId}/info_grupo`,
      {
        method: "GET",
        headers: baseHeaders
      }
    );

    if (!resp.ok) {
      throw new Error("Error al cargar grupo");
    }

    const data = await resp.json();

    // ======================================================
    // 1. TÍTULO Y CANTIDAD
    // ======================================================
    const nameEl = document.getElementById("groupInfoName");
    const countEl = document.getElementById("groupInfoCount");

    nameEl.textContent = data.titulo || "Grupo";
    countEl.textContent = `${data.miembros.length} participantes`;


    // ======================================================
    // 2. LISTA DE MIEMBROS – DISEÑO COMPLETO
    // ======================================================
    const cont = document.getElementById("groupMembersList");
    cont.innerHTML = "";

    data.miembros.forEach(m => {
      // contenedor principal
      const item = document.createElement("div");
      item.className = "group-member";

      // avatar
      const avatar = document.createElement("div");
      avatar.className = "member-avatar";
      const img = document.createElement("img");
      img.src = "/assets/usuario_gato.png";
      img.alt = "avatar";
      avatar.appendChild(img);

      // info contenedor
      const info = document.createElement("div");
      info.className = "member-info";

      // fila nombre + admin badge
      const row1 = document.createElement("div");
      row1.className = "member-name-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "member-name";
      nameSpan.textContent =
        m.nombre || m.alias || m.telefono || "Desconocido";

      row1.appendChild(nameSpan);

      if (m.es_admin) {
        const adminBadge = document.createElement("span");
        adminBadge.className = "member-admin";
        adminBadge.textContent = "admin";
        row1.appendChild(adminBadge);
      }

      // fila teléfono
      const row2 = document.createElement("div");
      row2.className = "member-phone";
      row2.textContent = m.telefono || "";

      info.appendChild(row1);
      info.appendChild(row2);

      // ensamblar
      item.appendChild(avatar);
      item.appendChild(info);

      cont.appendChild(item);
    });


    // ======================================================
    // 3. MOSTRAR MODAL (DISEÑO CORRECTO)
    // ======================================================
    const overlay = document.getElementById("groupInfoOverlay");
    const modal = document.getElementById("groupInfoModal");

    overlay.classList.add("visible");
    modal.style.display = "flex";

    document.body.style.overflow = "hidden";

  } catch (err) {
    console.error("❌ Error abriendo info grupo:", err);
    showErrorModal("No se pudo abrir la información del grupo.");
  }
}




// ======================================================
//  📌 CONTROL DE TABS DEL MODAL DE INFO DE GRUPO
// ======================================================
function setGroupInfoTabs() {
  const tabs = document.querySelectorAll("#groupInfoModal .group-info-sidebar button");
  const contents = document.querySelectorAll("#groupInfoModal .group-tab");

  tabs.forEach(btn => {
    btn.onclick = () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const tabId = "groupTab" + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);

      contents.forEach(c => c.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");
    };
  });
}

// ======================================================
//  📌 MENÚ CONTEXTUAL DE MIEMBRO DEL GRUPO
// ======================================================
function openGroupMemberMenu(x, y, miembro) {
  const menu = document.getElementById("groupMemberContextMenu");

  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.style.display = "block";

  // Abrir chat con ese usuario
  menu.querySelector("[data-action='open-chat']").onclick = () => {
    openChatConUsuario(miembro.id);
    menu.style.display = "none";
  };

  // Eliminar del grupo
  menu.querySelector("[data-action='remove']").onclick = () => {
    confirmarExpulsion(miembro.id);
    menu.style.display = "none";
  };
}

// ====================================================
// 🔵 MARCAR MENSAJES COMO LEÍDOS (WhatsApp real)
// ====================================================
async function marcarMensajesLeidos(chatId) {
  if (!chatId) return;

  try {
    await fetch(`${API}conversaciones/${chatId}/marcar_leidos`, {
      method: "PUT",
      headers: baseHeaders
    });

    // Quitar el badge visual
    limpiarBadge(chatId);

  } catch (e) {
    console.warn("No se pudo marcar mensajes como leídos:", e);
  }
}


// ====================================================
// PRESENCIA BÁSICA (HTTP) → ONLINE
// ====================================================
(async function marcarOnlineInicio() {
  try {
    const resp = await fetch(`${API}auth/marcar_online/${usuarioId}`, {
      method: "POST",
      headers: baseHeaders,
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("❌ No se pudo marcar ONLINE:", resp.status, txt);
      return;
    }

    console.log("✅ Presencia: usuario marcado ONLINE");
  } catch (e) {
    console.warn("❌ Error de red al marcar ONLINE:", e);
  }
})();

// ===========================================================
// 🔥 SUBTÍTULO DEL GRUPO — alias > número + “…” si son muchos
// ===========================================================
function renderGroupHeaderSubtitle() {
  try {
    // Si no es grupo → limpiar
    if (!currentChatIsGroup) {
      if (groupSubtitle) groupSubtitle.textContent = "";
      return;
    }

    if (!Array.isArray(currentGroupMembers)) {
      if (groupSubtitle) groupSubtitle.textContent = "";
      return;
    }

    // 1️⃣ Miembros activos
    const activos = currentGroupMembers.filter(m => m.activo !== false);

    // 2️⃣ Obtener los nombres finales desde tu función oficial
    let nombres = activos
      .map(m => {
        const n = getGroupMemberDisplayName(m.id);
        if (!n || n.trim() === "" || n === "Usuario") return "";
        return n.trim();
      })
      .filter(n => n !== "")
      .filter((v, i, arr) => arr.indexOf(v) === i); // quitar duplicados

    if (!groupSubtitle) return;

    // 3️⃣ Aplicar límite (como Microsoft Teams)
    const LIMITE = 5;   // 👈 puedes cambiarlo si quieres

    if (nombres.length > LIMITE) {
      const visibles = nombres.slice(0, LIMITE).join(", ");
      const restantes = nombres.length - LIMITE;

      groupSubtitle.textContent = `${visibles}, …`;
    } else {
      groupSubtitle.textContent =
        nombres.length > 0 ? nombres.join(", ") : "Miembros";
    }

  } catch (err) {
    console.error("Error en renderGroupHeaderSubtitle:", err);
    if (groupSubtitle) groupSubtitle.textContent = "Miembros";
  }
}



// ========== SISTEMA DE MENSAJERIA ====== //

// Helper para parsear fecha siempre como UTC
function getLocalHourFromISO(theFecha) {
  if (!theFecha) return "";

  let iso = String(theFecha).trim();

  // 1) Normalizar microsegundos (Python manda 6 dígitos → JS solo acepta 3)
  iso = iso.replace(/\.(\d{3})\d+/, ".$1");

  // 2) Asegurar que sea UTC si no tiene zona
  if (!iso.endsWith("Z") && !iso.match(/[\+\-]\d{2}:\d{2}$/)) {
    iso += "Z";
  }

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  // 3) Convertir a hora local automáticamente (Ecuador -05:00)
  return d.toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

// ========================================================
// 🔄 BLOQUE DE RESPUESTA INLINE — VERSIÓN FINAL 2025 LIMPIA
// ========================================================
function buildInlineReplyBlock(m) {
  try {
    if (!m.mensaje_id_respuesta) return null;

    const replyId = String(m.mensaje_id_respuesta);

    // ============================================
    // 1) OBTENER MENSAJE ORIGINAL DE CACHE O DOM
    // ============================================
    let original = mensajesCache.get(replyId);
    let originalTexto = "";
    let originalAutorId = null;

    if (original) {
      // ⚡ Cache del backend
      originalTexto = original.cuerpo || "(archivo)";
      originalAutorId = original.remitente_id || original.usuario_id || null;
    } else {
      const node = document.querySelector(`.msg[data-msg-id="${replyId}"]`);

      if (node) {
        // ⚡ SOLO EL TEXTO LIMPIO → .msg-text-modern
        const textNode = node.querySelector(".msg-text-modern");
        if (textNode) {
          originalTexto = textNode.textContent.trim();
        } else {
          originalTexto = "(mensaje)";
        }

        originalAutorId = node.dataset.authorId || null;
      } else {
        originalTexto = "(mensaje)";
      }
    }

    if (!originalTexto.trim()) originalTexto = "(sin texto)";
    if (originalTexto.length > 120) originalTexto = originalTexto.slice(0, 120) + "…";

    // ============================================
    // 2) NOMBRE DEL AUTOR (GRUPO vs 1 A 1)
    // ============================================
    const convId = m.conversacion_id || currentChatId;
    const chatObj = chatsMap.get(String(convId));
    const esGrupo = !!chatObj?.es_grupo;

    let autorNombre = "";

    if (originalAutorId) {
      const esMio = String(originalAutorId) === String(usuarioId);

      if (esGrupo) {
        autorNombre = esMio ? "Tú" : getGroupMemberDisplayName(originalAutorId);
      } else {
        autorNombre = esMio ? "Tú" : (chatObj?.titulo || "Contacto");
      }
    }

    // ============================================
    // 3) ARMAR EL BLOQUE VISUAL
    // ============================================
    const cont = document.createElement("div");
    cont.className = "msg-reply-inline";

    const bar = document.createElement("div");
    bar.className = "msg-reply-bar";

    const content = document.createElement("div");
    content.className = "msg-reply-content";

    const author = document.createElement("div");
    author.className = "msg-reply-author";
    author.textContent = autorNombre || "";

    const snippet = document.createElement("div");
    snippet.className = "msg-reply-text";
    snippet.textContent = originalTexto;

    content.appendChild(author);
    content.appendChild(snippet);
    cont.appendChild(bar);
    cont.appendChild(content);

    return cont;

  } catch (err) {
    console.error("Error buildInlineReplyBlock:", err);
    return null;
  }
}



// ====================================================
// RENDER MENSAJE (VERSIÓN FINAL 2025 PRO + ARCHIVOS MODERNOS)
// ====================================================
function renderMessageFromObj(m, esMio) {
  try {
    if (!m) return;
    if (!messagesDiv) return;

    // ========== BASE ==========
    const textOriginal = m.cuerpo || m.contenido || "";
    const editadoEn = m.editado_en || null;
    const theFecha = m.creado_en || m.fecha || null;
    const estaBorradoParaTodos = !!m.borrado_en;

    const horaBase = editadoEn || theFecha || new Date().toISOString();
    const hora = getLocalHourFromISO(horaBase);

    // ========== MENSAJE DE SISTEMA ==========
    if (m.tipo === "sistema") {
      renderSystemMessage(textOriginal, theFecha || horaBase);
      return;
    }

    // ========== WRAPPER ==========
    const wrap = document.createElement("div");
    wrap.className = esMio ? "msg me" : "msg you";
    if (estaBorradoParaTodos) wrap.classList.add("msg-deleted");

    // ID de autor para replies
    const autorId = m.remitente_id || m.usuario_id || null;

    // Guardamos datos en data-* para que buildInlineReplyBlock pueda leerlos
    if (m.id) wrap.dataset.msgId = m.id;
    if (m.conversacion_id) wrap.dataset.convId = m.conversacion_id;
    if (autorId) wrap.dataset.authorId = String(autorId);
    wrap.dataset.esMio = esMio ? "1" : "0";

    // =========================================
    // 🔥 FUNCIÓN LOCAL – OBTENER NOMBRE (GRUPO / 1 A 1)
    // =========================================
    function getMemberDisplayName(userId) {
      try {
        if (!userId) return "";

        const uid = String(userId);

        // Si NO es grupo → nombre del chat 1 a 1
        if (!currentChatIsGroup) {
          // aquí usas el alias/número que ya tiene cargado el chat
          return currentChatName || currentChatAlias || currentChatNumber || "Contacto";
        }

        // Si es grupo → buscar alias/número en currentGroupMembers
        const miembro = currentGroupMembers.find(x => String(x.id) === uid);
        if (!miembro) return "Usuario";

        if (miembro.alias && miembro.alias.trim() !== "") {
          return miembro.alias.trim();
        }
        if (miembro.telefono && miembro.telefono.trim() !== "") {
          return miembro.telefono.trim();
        }
        return "Usuario";

      } catch (err) {
        console.error("Error en getMemberDisplayName:", err);
        return "Usuario";
      }
    }

    // ======================================================
    // 🔥 MOSTRAR AUTOR (solo grupos)
    // ======================================================
    const convId = m.conversacion_id || currentChatId;
    const chatObj = chatsMap.get(String(convId));
    const esGrupo = !!(chatObj && chatObj.es_grupo);

    if (esGrupo) {
      const label = document.createElement("div");
      label.className = "msg-author-label";

      let nombreVisible = esMio ? "Tú" : getMemberDisplayName(autorId);
      label.textContent = nombreVisible || "Usuario";

      wrap.appendChild(label);
    }

    // ======================================================
    // 🔥 ARCHIVOS MODERNOS (WhatsApp Style)
    // ======================================================
    if (!estaBorradoParaTodos && (m.url_adjunto || m.tipo === "archivo")) {
      const fileBox = document.createElement("div");
      fileBox.className = "msg-file-box";

      const url = m.url_adjunto;
      const nombre = m.nombre_archivo || "archivo";
      const ext = (nombre.split(".").pop() || "").toLowerCase();

      // ===== IMAGEN =====
      if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
        const img = document.createElement("img");
        img.src = url;
        img.className = "msg-img-modern";
        img.loading = "lazy";
        fileBox.appendChild(img);
      }

      // ===== VIDEO =====
      else if (["mp4", "mov", "avi", "mkv"].includes(ext)) {
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.className = "msg-video-modern";
        fileBox.appendChild(video);
      }

      // ===== AUDIO =====
      else if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
        const audio = document.createElement("audio");
        audio.src = url;
        audio.controls = true;
        audio.className = "msg-audio-modern";
        fileBox.appendChild(audio);
      }

      // ===== DOCUMENTOS =====
      else {
        const icon = obtenerIconoDeArchivo(ext);

        const doc = document.createElement("div");
        doc.className = "msg-doc-modern";

        doc.innerHTML = `
          <div class="doc-left">
            <img src="${icon}" class="doc-icon-modern">
          </div>
          <div class="doc-right">
            <div class="doc-name-modern">${nombre}</div>
            <a href="${url}" target="_blank" class="doc-open-modern">Abrir</a>
          </div>
        `;

        fileBox.appendChild(doc);
      }

      wrap.appendChild(fileBox);
    }

    // ======================================================
    // 🔥 CUERPO DEL MENSAJE (reply + texto)
    // ======================================================
    const body = document.createElement("div");
    body.className = "msg-body";

    // --- REPLY INLINE (primero dentro del body) ---
    if (!estaBorradoParaTodos) {
      const inlineReply = buildInlineReplyBlock(m);
      if (inlineReply) {
        // lo insertamos al inicio del body
        body.appendChild(inlineReply);
      }
    }

    // --- TEXTO ---
    let text = textOriginal;
    if (estaBorradoParaTodos) {
      text = esMio
        ? "Eliminaste este mensaje."
        : "Este mensaje fue eliminado";
    }

    if (text && text.trim() !== "") {
      const textDiv = document.createElement("div");
      textDiv.className = "msg-text-modern";
      textDiv.textContent = text;
      body.appendChild(textDiv);
    }

    wrap.appendChild(body);

    // ======================================================
    // 🔥 FOOTER (HORA + TICKS)
    // ======================================================
    const footer = document.createElement("div");
    footer.className = "msg-footer-modern";

    const horaSpan = document.createElement("span");
    horaSpan.className = "msg-time";
    horaSpan.textContent =
      !estaBorradoParaTodos && editadoEn ? `Editado ${hora}` : hora;

    footer.appendChild(horaSpan);

    if (esMio) {
      const ticks = document.createElement("span");
      ticks.className = "ticks";
      pintarTicks(ticks, "enviado");
      footer.appendChild(ticks);
      if (m.id) tickNodes.set(m.id, ticks);
    }

    wrap.appendChild(footer);

    // ======================================================
    // 🔥 CONTEXT MENU
    // ======================================================
    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMsgContextMenu(e, wrap.dataset.msgId, wrap.dataset.esMio === "1");
    });

    // ======================================================
    // 🔥 AGREGAR AL DOM + SCROLL
    // ======================================================
    messagesDiv.appendChild(wrap);

    messagesDiv.scrollTo({
      top: messagesDiv.scrollHeight,
      behavior: "smooth",
    });

  } catch (err) {
    console.error("Error renderizando mensaje:", err);
  }
}




function obtenerIconoDeArchivo(ext) {
  if (["pdf"].includes(ext)) return "/assets/icons/pdf.png";
  if (["doc", "docx"].includes(ext)) return "/assets/icons/doc.png";
  if (["xls", "xlsx"].includes(ext)) return "/assets/icons/xls.png";
  if (["zip", "rar", "7z"].includes(ext)) return "/assets/icons/zip.png";
  return "/assets/icons/file.png";
}


// ==========================================================
// 🔥 RENDER DE MENSAJES DE ARCHIVO (tipo WhatsApp Web)
// ==========================================================
function renderFileMessage(msgObj, isMine) {
  const box = document.createElement("div");
  box.className = `msg ${isMine ? "me" : "you"}`;

  const ext = msgObj.nombre_archivo.split(".").pop().toLowerCase();
  let icon = "/static/icons/file.png";

  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext))
    icon = "/static/icons/image.png";
  if (["pdf"].includes(ext))
    icon = "/static/icons/pdf.png";
  if (["doc", "docx"].includes(ext))
    icon = "/static/icons/doc.png";
  if (["xls", "xlsx"].includes(ext))
    icon = "/static/icons/xls.png";
  if (["zip", "rar", "7z"].includes(ext))
    icon = "/static/icons/zip.png";

  box.innerHTML = `
        <div class="file-msg">
            <div class="file-left">
                <img src="${icon}" class="file-icon">
            </div>
            <div class="file-right">
                <div class="file-name">${msgObj.nombre_archivo}</div>
                <a href="${msgObj.ruta_archivo}" target="_blank" class="file-open">Abrir</a>
            </div>
        </div>
        <div class="msg-time">${formatHora(msgObj.fecha)}</div>
    `;

  return box;
}


function renderSystemMessage(texto, fechaIso) {
  if (!messagesDiv) return;

  const wrap = document.createElement("div");
  wrap.className = "msg-system";
  wrap.style.cssText =
    "align-self:center;margin:8px auto;padding:4px 8px;border-radius:8px;" +
    "font-size:12px;color:#fff;background:#3b3b3b;max-width:80%;text-align:center;";

  const textNode = document.createElement("div");
  textNode.textContent = texto;
  wrap.appendChild(textNode);

  if (fechaIso) {
    const timeNode = document.createElement("div");
    timeNode.style.fontSize = "11px";
    timeNode.style.opacity = "0.7";
    timeNode.textContent = getLocalHourFromISO(fechaIso);
    wrap.appendChild(timeNode);
  }

  messagesDiv.appendChild(wrap);
  messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: "smooth" });
}

// ====================================================
// RESPONDER MENSAJE
// ====================================================
const replyPreview = document.getElementById("replyPreview");
const replyTitle = document.getElementById("replyTitle");
const replySnippet = document.getElementById("replySnippet");
const replyCloseBtn = document.getElementById("replyCloseBtn");

function clearReply() {
  // 🔹 Limpia tanto la respuesta como la edición
  replyTarget = null;
  isEditing = false;
  editingMessageId = null;

  if (replyPreview) replyPreview.style.display = "none";

  // Recalcular alturas para que el chat no se descuadre
  if (window.__reflowPanels) window.__reflowPanels();
}

function startReplyToMessage(msgId, esMio) {
  const node = document.querySelector(`.msg[data-msg-id="${msgId}"]`);
  if (!node || !replyPreview) return;

  // Si estaba en modo edición, lo cancelamos
  isEditing = false;
  editingMessageId = null;

  const bodyNode = node.querySelector(".msg-body");
  const text = bodyNode ? bodyNode.textContent.trim() : "";

  const autorId = node.dataset.authorId;
  const soyYo = esMio || String(autorId) === String(usuarioId);

  // ============================================================
  // 🔥 DETERMINAR TÍTULO CORRECTO (alias > número > fallback)
  // ============================================================
  let titulo = "Contacto";

  if (soyYo) {
    // Si el mensaje es mío → "Tú"
    titulo = "Tú";

  } else if (currentChatIsGroup && autorId) {
    // 🟦 Estamos en grupo → buscar alias o número del autor
    let visible = getGroupMemberDisplayName(autorId);

    // Si vino vacío desde el map del grupo, intentamos leer del nodo
    if (!visible || visible.trim() === "") {
      const labelNode = node.querySelector(".msg-author-label");
      if (labelNode) visible = labelNode.textContent.trim();
    }

    titulo = visible || "Contacto";

  } else if (autorId) {
    // 🟩 Chat individual → alias si está en contactosCache, si no teléfono
    titulo =
      getDisplayNameForUser(autorId) ||
      currentChatName ||
      "Contacto";
  }

  // Guardamos datos del mensaje que vamos a responder
  replyTarget = {
    id: msgId,
    esMio: soyYo,
    autorNombre: titulo,
    texto: text,
  };

  // Reducir tamaño del snippet si es muy largo
  let snippet = text;
  if (snippet.length > 120) snippet = snippet.slice(0, 120) + "…";

  // Insertar visualmente
  replyTitle.textContent = titulo;
  replySnippet.textContent = snippet;

  replyPreview.style.display = "flex";

  // Recalcular alturas del layout
  if (window.__reflowPanels) window.__reflowPanels();
}

replyCloseBtn?.addEventListener("click", () => {
  clearReply();
});



// ====================================================
// REACCIONES A MENSAJES (solo visual, sin backend)
// ====================================================
function applyReactionToMessage(msgId, emoji) {
  if (!msgId || !emoji || emoji === "+") return;

  const node = document.querySelector(`.msg[data-msg-id="${msgId}"]`);
  if (!node) return;

  // No permitir reacciones en mensajes eliminados para todos
  if (node.classList.contains("msg-deleted")) return;

  let badge =
    node.querySelector(".msg-reaction-badge") ||
    node.querySelector(".msg-reaction");

  if (!badge) {
    badge = document.createElement("div");
    badge.className = "msg-reaction-badge";
    node.appendChild(badge);
  }

  badge.textContent = emoji;
  reactionsMap.set(msgId, emoji);
}

// bandera para evitar doble envío
let isSendingMessage = false;

// ===========================================================
// 🚀 ENVIAR MENSAJE (VERSIÓN FINAL PRO 2025 + FIX EDICIÓN)
// ===========================================================
async function sendMessage() {
  const input = document.getElementById("composerInput");
  if (!input) return;

  // ⛔ Bloqueo si ya no pertenece a un grupo
  if (currentChatIsGroup && !currentUserIsGroupMember) {
    showToast("No puedes enviar mensajes porque ya no eres miembro del grupo.", "#d94b4b");
    return;
  }

  const texto = input.value.trim();
  if (!texto || !currentChatId) return;

  if (isSendingMessage) return;
  isSendingMessage = true;

  // ===========================================================
  // ✏️ MODO EDICIÓN DE MENSAJE
  // ===========================================================
  if (isEditing && editingMessageId) {
    try {
      const resp = await fetch(`${API}mensajes/${editingMessageId}`, {
        method: "PUT",
        headers: baseHeaders,
        body: JSON.stringify({ cuerpo: texto }),
        credentials: "include"
      });

      if (!resp.ok) {
        showToast("No se pudo editar el mensaje.", "#d94b4b");
      } else {
        const data = await resp.json();

        // 🔥 Actualizar mensaje directamente en el DOM
        applyEditToDom(
          editingMessageId,
          data.cuerpo,
          data.editado_en || new Date().toISOString()
        );

        // 🧊 Actualizar preview del chat
        updateThreadPreview(String(currentChatId), data.cuerpo);
        updateThreadTime(
          String(currentChatId),
          data.editado_en || new Date().toISOString()
        );
        moveChatToTop(String(currentChatId));
      }
    } catch (err) {
      console.error("Error al editar:", err);
      showToast("Error de red al editar.", "#d94b4b");
    }

    isEditing = false;
    editingMessageId = null;
    clearReply();
    input.value = "";
    input.focus();
    isSendingMessage = false;
    return;
  }

  // ===========================================================
  // 🟢 ENVIAR NUEVO MENSAJE
  // ===========================================================
  const payload = {
    cuerpo: texto,
    mensaje_id_respuesta: replyTarget ? replyTarget.id : null,
    mencionados: []
  };

  input.value = "";
  input.disabled = true;

  try {
    const resp = await fetch(
      `${API}conversaciones/${currentChatId}/mensajes`,
      {
        method: "POST",
        headers: baseHeaders,
        credentials: "include",
        body: JSON.stringify(payload)
      }
    );

    if (!resp.ok) {
      console.error("Error al enviar:", resp.status, await resp.text());
      showToast("No se pudo enviar el mensaje.", "#d94b4b");
      return;
    }

    let creado = await resp.json();
    if (creado && creado.mensaje) creado = creado.mensaje;

    // 🔥 OBJETO FINAL PARA RENDER
    const msgFinal = {
      ...creado,
      cuerpo: creado.cuerpo || payload.cuerpo,
      conversacion_id: String(currentChatId),
      usuario_id: creado.usuario_id || usuarioId,
      creado_en: creado.creado_en || new Date().toISOString(),
      tipo: creado.tipo || "normal"
    };

    // 🟢 Pintar instantáneo en pantalla
    renderMessageFromObj(msgFinal, true);

    // 🧊 Actualizar preview en la lista de chats
    const horaIso = msgFinal.editado_en || msgFinal.creado_en;
    updateThreadPreview(String(currentChatId), msgFinal.cuerpo);
    updateThreadTime(String(currentChatId), horaIso);
    moveChatToTop(String(currentChatId));

    // 🔒 Anti-duplicados
    const uniqueKey = msgFinal.id
      ? `id_${msgFinal.id}`
      : `ts_${msgFinal.creado_en}_${msgFinal.usuario_id}_${currentChatId}`;

    if (!window.mensajesRecibidosSet) window.mensajesRecibidosSet = new Set();
    mensajesRecibidosSet.add(uniqueKey);

  } catch (err) {
    console.error("Error al enviar:", err);
    showToast("Error de red al enviar.", "#d94b4b");

  } finally {
    input.disabled = false;
    input.focus();
    clearReply();
    isSendingMessage = false;
  }
}





// ====================================================
// INDICADOR "ESCRIBIENDO..."
// ====================================================
function showTypingIndicator(name = "Escribiendo...") {
  let typing = document.getElementById("typingIndicator");
  if (!typing) {
    typing = document.createElement("div");
    typing.id = "typingIndicator";
    typing.className = "msg you";
    typing.style.fontStyle = "italic";
    typing.style.color = "#666";
    typing.style.background = "#e7ebf0";
    typing.style.padding = "8px 12px";
    typing.style.borderRadius = "12px";
    messagesDiv.appendChild(typing);
  }
  typing.textContent = `${name} está escribiendo...`;
  messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: "smooth" });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    // ✅ Verificar que el nodo aún exista antes de eliminarlo
    if (typing && typing.parentNode === messagesDiv) {
      typing.remove();
    }
  }, 2000);
}

// ====================================================
// EVENTOS (typing + enviar mensaje)
// ====================================================
const inputMsg = document.getElementById("composerInput");

inputMsg.addEventListener("keydown", (e) => {

  // Enviar evento "typing" correctamente
  if (window.socket && window.socket.connected && currentChatId) {
    window.socket.emit("typing", {
      tipo: "typing",
      nombre: usuarioNombre,
      conversacion_id: currentChatId,
    });
  }

  // Enviar mensaje con Enter
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});




const btnEnviar = document.getElementById("btnEnviar");
btnEnviar.innerHTML = `<img src="../assets/enviar_mensaje.png" alt="Enviar" />`;
btnEnviar.onclick = sendMessage;

document.getElementById("btnEmoji").onclick = () => alert("Selector de emoji (demo)");



// =============================================
// 🔵 Render adjuntos en mensajes (IMÁGENES/VIDEO/AUDIO/DOCS)
// =============================================
function renderAdjunto(msg) {
  if (!msg.url_adjunto) return "";

  const url = msg.url_adjunto;
  const tipo = msg.tipo_adjunto ? msg.tipo_adjunto.toLowerCase() : "";

  // IMÁGENES
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(tipo)) {
    return `
      <div class="msg-image">
        <img src="${url}" alt="imagen" onclick="window.open('${url}', '_blank')" />
      </div>
    `;
  }

  // VIDEOS
  if (["mp4", "mov", "avi", "mkv"].includes(tipo)) {
    return `
      <div class="msg-video">
        <video controls>
          <source src="${url}" type="video/${tipo}">
        </video>
      </div>
    `;
  }

  // AUDIOS
  if (["mp3", "wav", "ogg", "m4a"].includes(tipo)) {
    return `
      <div class="msg-audio">
        <audio controls src="${url}"></audio>
      </div>
    `;
  }

  // DOCUMENTOS Y OTROS
  return `
    <div class="msg-doc" onclick="window.open('${url}', '_blank')">
      📄 ${msg.nombre_archivo || "Archivo"}
    </div>
  `;
}

function scrollToBottom() {
  try {
    const messages = document.querySelector(".messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  } catch (e) {
    console.error("scrollToBottom error:", e);
  }
}

// ====================================================
// SUBIR ARCHIVO AL CHAT (VERSIÓN FINAL 2025)
// ====================================================
async function subirArchivoYEnviarMensaje(file) {
  if (!currentChatId || !file) return;

  try {
    const formData = new FormData();
    formData.append("file", file);                 // 👈 NOMBRE IGUAL QUE EN PY
    formData.append("usuario_id", currentUserId);  // 👈 lo que espera el backend

    // 👉 Solo mandamos Authorization si tenemos token
    const uploadHeaders = {};
    if (typeof tokenValid === "string" && tokenValid) {
      uploadHeaders["Authorization"] = `Bearer ${tokenValid}`;
    }

    const resp = await fetch(`${API}conversaciones/${currentChatId}/archivo`, {
      method: "POST",
      headers: uploadHeaders,   // 👈 sin Content-Type
      body: formData,
      credentials: "include",   // 👈 manda la cookie auth_token también
    });

    if (!resp.ok) {
      console.error(
        "upload_file error:",
        resp.status,
        await resp.json().catch(() => ({}))
      );
      showErrorModal("Error subiendo el archivo");
      return;
    }

    const mensaje = await resp.json();

    // 👉 Pinta el mensaje en el chat como propio
    scrollToBottom();
  } catch (err) {
    console.error("Error subiendo archivo:", err);
    showErrorModal("Error subiendo el archivo");
  }
}



// 📎 BOTÓN DE ADJUNTOS + INPUT FILE REAL (VERSIÓN FINAL)
const btnAdjuntos = document.getElementById("btnAdjuntos");

// input real oculto
const realFileInput = document.createElement("input");
realFileInput.type = "file";
realFileInput.accept = "*/*"; // acepta cualquier tipo
realFileInput.style.display = "none";
document.body.appendChild(realFileInput);

// Al hacer clic en el clip se abre el selector
if (btnAdjuntos) {
  btnAdjuntos.onclick = () => {
    if (!currentChatId) {
      showToast("Abre un chat para adjuntar archivos", "#d94b4b");
      return;
    }
    realFileInput.click();
  };
}

// Cuando el usuario selecciona el archivo
realFileInput.onchange = async () => {
  if (!realFileInput.files.length) return;
  const file = realFileInput.files[0];

  await subirArchivoYEnviarMensaje(file);

  // limpiar para poder volver a escoger el mismo archivo si quiere
  realFileInput.value = "";
};



// ====================================================
// ENVIAR MENSAJE DE ARCHIVO (USA EL MISMO SISTEMA DE MENSAJES)
// ====================================================
async function sendFileMessage({ tipo, url_adjunto, tipo_adjunto, nombre_archivo, tamano_adjunto }) {
  if (!currentChatId) return;

  const payload = {
    cuerpo: "",                           // cuerpo vacío, todo va en el adjunto
    tipo: tipo || "archivo",              // "archivo" | "imagen" | "video" | "audio"
    url_adjunto,
    tipo_adjunto: tipo_adjunto || "",
    nombre_archivo: nombre_archivo || "archivo",
    tamano_adjunto: tamano_adjunto || null,
    mensaje_id_respuesta: replyTarget ? replyTarget.id : null,
  };

  try {
    const r = await fetch(
      `${API}conversaciones/${currentChatId}/mensajes`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(payload),
        credentials: "include",
      }
    );

    if (!r.ok) {
      console.error("Error al enviar archivo:", r.status, await r.text());
      showErrorModal("No se pudo enviar el archivo");
      return;
    }

    let msg = await r.json();
    if (msg && msg.mensaje) msg = msg.mensaje; // por si el backend envía {mensaje: {...}}

    // Mensaje final con todos los campos asegurados
    const msgFinal = {
      ...msg,
      tipo: msg.tipo || payload.tipo,
      url_adjunto: msg.url_adjunto || payload.url_adjunto,
      tipo_adjunto: msg.tipo_adjunto || payload.tipo_adjunto,
      nombre_archivo: msg.nombre_archivo || payload.nombre_archivo,
      tamano_adjunto: msg.tamano_adjunto ?? payload.tamano_adjunto,
      conversacion_id: msg.conversacion_id || currentChatId,
      usuario_id: msg.usuario_id || usuarioId,
      creado_en: msg.creado_en || new Date().toISOString(),
    };

    // Pintar en el chat como cualquier mensaje
    renderMessageFromObj(msgFinal, true);

    // Actualizar tarjeta de la izquierda (preview y hora)
    const chatIdStr = String(currentChatId);
    const horaIso = msgFinal.editado_en || msgFinal.creado_en || new Date().toISOString();
    updateThreadPreview(chatIdStr, msgFinal.nombre_archivo || "Archivo");
    updateThreadTime(chatIdStr, horaIso);
    moveChatToTop(chatIdStr);

    // Anti-duplicados por si llega también por socket
    const uniqueKey = msgFinal.id
      ? `id_${msgFinal.id}`
      : `ts_${msgFinal.creado_en}_${msgFinal.usuario_id}_${chatIdStr}`;

    if (!window.mensajesRecibidosSet) window.mensajesRecibidosSet = new Set();
    mensajesRecibidosSet.add(uniqueKey);

  } catch (e) {
    console.error("Error de red al enviar archivo:", e);
    showErrorModal("Error de conexión al enviar archivo");
  } finally {
    clearReply();  // limpiar barra de respuesta si estaba citando
  }
}

document.getElementById("btnVoz").onclick = () => alert("Grabar/Enviar audio (demo)");

// 📞 BOTÓN DE LLAMADA (AUDIO 1 A 1 REAL)
document.getElementById("btnCall").addEventListener("click", () => {
  iniciarLlamadaAudio();
});

// 🎥 BOTÓN DE VIDEOLLAMADA (1 A 1 REAL)
document.getElementById("btnVideoCall").addEventListener("click", () => {
  iniciarVideoLlamada();
});



// ====================================================
// BÚSQUEDA
// ====================================================
document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll(".thread").forEach((t) => {
    const name = t.querySelector(".tname").textContent.toLowerCase();
    t.style.display = name.includes(term) ? "flex" : "none";
  });
});


// ====================================================
// INICIO (VERSIÓN FINAL) – cargar chats + restaurar
// ====================================================
(async () => {
  await loadChats();

  const saved = getSavedChat();

  if (saved && saved.chatId && !currentChatId) {
    const idStr = String(saved.chatId);
    const chatObj = chatsMap.get(idStr);

    // todos los chats ocultos localmente
    const ocultos = new Set(getHiddenChats());

    if (ocultos.has(idStr)) {
      console.warn("⛔ Chat guardado estaba oculto. No se abrirá.");
      localStorage.removeItem("biscochat_current_chat");
    } else if (!chatObj) {
      console.warn("⛔ Chat guardado ya no existe. No se abrirá.");
      localStorage.removeItem("biscochat_current_chat");
    } else if (chatObj.es_grupo && chatObj.soy_miembro === false) {
      console.warn("⛔ Chat guardado es grupo y ya NO eres miembro. No se abrirá.");
      localStorage.removeItem("biscochat_current_chat");
    } else if (chatObj.ocultado_para_mi) {
      console.warn("⛔ Backend marcó chat oculto. No abrir.");
      localStorage.removeItem("biscochat_current_chat");
    } else {
      // ✅ Chat válido → se abre normalmente
      openChat(saved.chatId, saved.otherName, saved.otherUserId || null);
    }
  }
})();


// ====================================================
// PRESENCIA BÁSICA (HTTP) → OFFLINE al cerrar pestaña
// ====================================================
window.addEventListener("beforeunload", () => {
  try {
    // sendBeacon no bloquea el cierre de la pestaña
    navigator.sendBeacon(`${API}auth/marcar_offline/${usuarioId}`);
    console.log("Presencia: beacon OFFLINE enviado");
  } catch (e) {
    console.warn("No se pudo marcar offline:", e);
  }
});

// ==========================================
// SOCKET.IO (versión FINAL CORREGIDA y SIN ERRORES)
// ==========================================

if (!window.socket) {
  window.socket = io(API, {
    transports: ["websocket"],
    secure: true,
    path: "/socket.io",


  });

  // Mapa global de estados ✓ / ✓✓
  window.mensajesRecibidosSet = new Set();  // evita duplicados
  window.estadoMensajesMap = new Map();     // controla ✓ estados

  // ===========================================
  // 🔵 ESTADO INICIAL DEL MENSAJE
  // ===========================================
  window.socket.on("estado_mensaje_inicial", (p) => {
    if (!p || !p.estados) return;

    const { mensaje_id, estados } = p;

    estados.forEach(est => {
      const key = `${mensaje_id}_${est.usuario_id}`;
      estadoMensajesMap.set(key, est.estado);
    });

    refrescarVistosDeMisMensajes();
  });

  //Responde SMS
  window.socket.on("mensaje_nuevo", (m) => {
    if (!m || !m.id) return;

    // 👉 importante
    mensajesCache.set(m.id, m);

    if (String(m.conversacion_id) === String(currentChatId)) {
      renderMessageFromObj(m, String(m.remitente_id) === String(usuarioId));
    }

    actualizarOrdenListaChats(m.conversacion_id, m);
  });

// ======================================================
// 📞 INCOMING CALL — handler cliente (REEMPLAZAR / MEJORAR)
// ======================================================
socket.on("incoming_call", (payload) => {
  try {
    if (!payload) return;

    const { conversacion_id, from, to, tipo, nombre, foto } = payload;

    // Solo si yo soy el destinatario (evita que otros vean)
    if (String(to) !== String(currentUserId)) return;

    console.log("📞 incoming_call recibido (cliente):", payload);

    // Si la conversación es grupo: ignorar (llamadas 1 a 1 únicamente)
    // Puedes quitar esta comprobación si quieres soportar llamadas grupales.
    if (currentChatIsGroup && String(conversacion_id) === String(currentChatId)) {
      console.warn("⚠ incoming_call de grupo ignorado.");
      return;
    }

    // Mostrar modal (independiente de si el usuario está viendo esa conversación)
    mostrarModalLlamada(nombre, tipo, foto);

    // Guardar global para acciones aceptar/rechazar
    window.llamadaEntrante = { conversacion_id, from, tipo, nombre, foto };

    // Configurar botones (asegura elementos existan)
    const btnRechazar = document.getElementById("btnRechazar");
    const btnAceptar = document.getElementById("btnAceptar");

    if (btnRechazar) {
      btnRechazar.onclick = () => {
        ocultarModalLlamada();
        socket.emit("call_reject", {
          conversacion_id,
          from,
          to: currentUserId,
        });
        console.log("❌ Llamada rechazada (cliente)");
      };
    }

    if (btnAceptar) {
      btnAceptar.onclick = () => {
        ocultarModalLlamada();

        const html = tipo === "video" ? "llamada_video.html" : "llamada_audio.html";
        const url = new URL(`${window.location.origin}/frontend/html/${html}`);

        url.searchParams.set("conversacion_id", conversacion_id);
        url.searchParams.set("from", currentUserId);
        url.searchParams.set("to", from);
        url.searchParams.set("caller", "0"); // receptor
        url.searchParams.set("nombre_peer", nombre);

        console.log("📞 Abriendo pantalla de llamada (cliente):", url.toString());
        window.location.href = url.toString();
      };
    }

  } catch (err) {
    console.error("❌ Error procesando incoming_call (cliente):", err);
  }
});

/* ============================================================
   🎨 MOSTRAR MODAL DE LLAMADA ENTRANTE — VERSIÓN COMPLETA
   ============================================================ */
function mostrarModalLlamada(nombre, tipo, foto_url) {
  const modal = document.getElementById("modalLlamada");
  const nombreEl = document.getElementById("callNombre");
  const tipoEl = document.getElementById("callTipo");
  const fotoEl = document.getElementById("callFoto");
  const ringtone = document.getElementById("ringtone");

  if (!modal) {
    console.error("❌ ERROR: modalLlamada NO existe en el DOM.");
    return;
  }

  nombreEl.textContent = nombre || "Contacto";

  tipoEl.textContent =
    tipo === "video" ? "Videollamada entrante..." : "Llamada entrante...";

  fotoEl.src = foto_url || "../assets/usuario_gato.png";
  fotoEl.onerror = () => (fotoEl.src = "../assets/usuario_gato.png");

  modal.classList.remove("hidden");

  if (ringtone) {
    ringtone.currentTime = 0;
    ringtone.loop = true;
    ringtone.play().catch(() => {});
  }
}


/* ============================================================
   ❌ OCULTAR MODAL DE LLAMADA — VERSIÓN COMPLETA
   ============================================================ */
function ocultarModalLlamada() {
  const modal = document.getElementById("modalLlamada");
  const ringtone = document.getElementById("ringtone");

  if (modal) {
    modal.classList.add("hidden");
  }

  // Detener sonido
  if (ringtone) {
    try {
      ringtone.pause();
      ringtone.currentTime = 0;
    } catch {}
  }
}

  // ===========================
  // CONVERSACIÓN CREADA (grupo o individual)
  // ===========================
  window.socket.on("conversacion_creada", async (payload) => {
    if (!payload || !payload.conversacion) return;

    // solo refrescamos la lista de chats
    await loadChats();

    // no abrimos nada aquí; el creador ya lo abre con crearGrupoEnBackend()
  });

// ======================================================
// 🧩 CARGAR DATOS DEL USUARIO DESDE EL HTML
// ======================================================
const usuarioId = document.getElementById("meta-usuario-id")?.content || null;
const usuarioNombre = document.getElementById("meta-usuario-nombre")?.content || null;
const usuarioTelefono = document.getElementById("meta-usuario-telefono")?.content || null;

console.log("🧩 Datos usuario cargados:", { usuarioId, usuarioNombre, usuarioTelefono });

  // ===========================
  // CUANDO CONECTA
  // ===========================
  window.socket.on("connect", () => {
    console.log("🔵 Socket conectado:", window.socket.id);

    console.log("📤 Enviando registrar_usuario:", usuarioId);

    // registrar usuario
    window.socket.emit("registrar_usuario", {
      usuario_id: usuarioId,
    });

    // si estaba chat abierto, re-suscribir
    if (currentChatId) {
      window.socket.emit("suscribir_conversacion", {
        conversacion_id: currentChatId,
      });
    }
  });

// ==========================================================
// LLAMADA ENTRANTE – EL TIMBRE SUENA SÍ O SÍ, 100% DE LAS VECES (2025)
// VERSIÓN FINAL DEFINITIVA – FUNCIONA COMO WHATSAPP REAL
// ==========================================================
socket.on("incoming_call", (data) => {
  // Solo procesar si la llamada es para mí
  if (data.to !== usuarioId) return;

  console.log("LLAMADA ENTRANTE:", data);

  // Mostrar modal
  const modal = document.getElementById("modalLlamada");
  if (!modal) return;
  modal.classList.remove("hidden");

  // Nombre y tipo
  document.getElementById("callNombre").textContent = data.nombre || "Contacto";
  document.getElementById("callTipo").textContent = 
    data.tipo === "video" ? "Videollamada entrante..." : "Llamada entrante...";

  // Foto
  const fotoEl = document.getElementById("callFoto");
  if (fotoEl) fotoEl.src = data.foto || "../assets/usuario_gato.png";

  // REPRODUCIR TONO DE LLAMADA – SUENA SÍ O SÍ (TRUCO INFALIBLE 2025)
  const ringtone = document.getElementById("ringtone");
  if (ringtone) {
    ringtone.currentTime = 0;
    ringtone.volume = 1.0;
    ringtone.loop = true;

    // Función para forzar el sonido
    const forzarSonido = () => {
      ringtone.play().catch(() => {
        // Si falla, creamos un botón invisible y le damos click automático
        const btnInvisible = document.createElement("button");
        btnInvisible.style.position = "fixed";
        btnInvisible.style.opacity = "0";
        btnInvisible.style.width = "1px";
        btnInvisible.style.height = "1px";
        btnInvisible.style.left = "-100px";
        document.body.appendChild(btnInvisible);

        btnInvisible.addEventListener("click", () => {
          ringtone.play();
          document.body.removeChild(btnInvisible);
        }, { once: true });

        btnInvisible.click();
      });
    };

    // Intentamos normal
    forzarSonido();

    // Si en 500ms no suena, lo forzamos de nuevo (por si acaso)
    setTimeout(() => {
      if (ringtone.paused) {
        console.log("Forzando timbre por segunda vez...");
        forzarSonido();
      }
    }, 500);
  }

  // BOTÓN ACEPTAR
  document.getElementById("btnAceptar").onclick = () => {
    if (ringtone) {
      ringtone.pause();
      ringtone.currentTime = 0;
      ringtone.loop = false;
    }
    modal.classList.add("hidden");

    const htmlFile = data.tipo === "video" ? "llamada_video.html" : "llamada_audio.html";
    const url = new URL(window.location.origin + `/frontend/html/${htmlFile}`);

    url.searchParams.set("conversacion_id", data.conversacion_id);
    url.searchParams.set("from", usuarioId);
    url.searchParams.set("to", data.from);
    url.searchParams.set("caller", "0");
    url.searchParams.set("nombre_peer", data.nombre || "Contacto");

    window.location.href = url.toString();
  };

  // BOTÓN RECHAZAR
  document.getElementById("btnRechazar").onclick = () => {
    if (ringtone) {
      ringtone.pause();
      ringtone.currentTime = 0;
      ringtone.loop = false;
    }
    modal.classList.add("hidden");
  };
});

  // ====================================================
  // 🔵 EVENTO: ESTADO EN TIEMPO REAL
  // ====================================================
  window.socket.on("usuario_estado", (payload) => {
    if (!payload || !payload.usuario_id) return;

    const uid = String(payload.usuario_id);

    // Actualizar mapa de estados
    userStatusMap[uid] = {
      online: !!payload.en_linea,
      last_seen: payload.ultima_conexion || null,
    };

    // Si es el chat que tienes abierto → actualizar UI
    if (currentChatUserId === uid) {
      actualizarChatStatusLabel(uid);
    }
  });


  // =========================================================
  // 🔵 EVENTO: alguien está escribiendo (VERSIÓN FINAL 2025)
  // =========================================================
  window.socket.on("typing", (payload) => {
    if (!payload || !payload.conversacion_id) return;

    const convId = String(payload.conversacion_id);
    if (convId !== String(currentChatId)) return;

    const fromId = String(payload.usuario_id);
    if (fromId === String(usuarioId)) return;

    // 1️⃣ Obtener nombre visible
    let nombreVisible = "";

    if (currentChatIsGroup) {
      const miembro = currentGroupMembers.find(m => String(m.id) === fromId);

      if (miembro) {
        nombreVisible = miembro.alias?.trim()
          ? miembro.alias.trim()
          : (miembro.telefono || "");
      }
    } else {
      const contacto = contactosCache.find(
        c => String(c.contacto_id) === fromId
      );

      if (contacto?.alias?.trim()) {
        nombreVisible = contacto.alias;
      } else {
        const chatObj = chatsMap.get(String(currentChatId));
        const other = chatObj?.usuarios?.find(u => String(u.id) === fromId);
        nombreVisible = other?.telefono || "";
      }
    }

    if (!nombreVisible.trim()) return;

    // 2️⃣ Mostrar “está escribiendo…”
    if (currentChatIsGroup) {
      if (groupSubtitle) groupSubtitle.textContent =
        `${nombreVisible} está escribiendo…`;
    } else {
      if (chatStatusLabel) chatStatusLabel.textContent =
        `${nombreVisible} está escribiendo…`;
    }

    // 3️⃣ Restaurar después de 1.2s
    clearTimeout(window.__typingTimer);
    window.__typingTimer = setTimeout(() => {

      if (currentChatIsGroup) {
        renderGroupHeaderSubtitle();
      } else {
        actualizarChatStatusLabel(currentChatUserId);
      }

    }, 1200);
  });



  function saveChatOrder() {
    const order = Array.from(chatsMap.keys());
    localStorage.setItem("chatOrder", JSON.stringify(order));
  }

  function loadChatOrder() {
    try {
      const data = localStorage.getItem("chatOrder");
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ==========================================================
  // 🚀 NUEVO: cuando un usuario es agregado a un grupo
  // ==========================================================
  socket.on("nuevo_chat", async (data) => {
    console.log("📥 Evento nuevo_chat recibido:", data);

    if (!data || !data.id) return;

    try {
      // 1️⃣ Recargar todas las conversaciones desde el backend
      await loadChats(); // ← ESTA FUNCIÓN YA EXISTE EN TU ARCHIVO

      // 2️⃣ Si el chat estaba abierto y pertenece a este grupo → refrescar header
      if (currentChatId === String(data.id)) {
        actualizarChatHeader(data.id);
      }

      // 3️⃣ Mostrar notificación
      showToast(`Te agregaron al grupo: ${data.titulo}`, "#2ecc71");

    } catch (e) {
      console.error("Error procesando nuevo_chat:", e);
    }
  });


  // ====================================================================
  // 🔵 MENSAJE RECIBIDO (REAL-TIME • VERSIÓN FINAL 2025)
  // ====================================================================
  window.socket.on("mensaje_recibido", async (msg) => {
    if (!msg) return;

    const chatId = String(msg.conversacion_id);
    const chatObj = chatsMap.get(chatId);

    const esGrupo = !!chatObj?.es_grupo;
    const esMio = String(msg.usuario_id) === String(usuarioId);
    const soyMiembro = esGrupo ? (chatObj?.soy_miembro !== false) : true;

    if (!soyMiembro) return;

    // ======================================================
    // 🔥 ANTI DUPLICADOS
    // ======================================================
    const uniqueKey = msg.id
      ? `id_${msg.id}`
      : `ts_${msg.creado_en}_${msg.usuario_id}_${chatId}`;

    if (!window.mensajesRecibidosSet) window.mensajesRecibidosSet = new Set();
    if (mensajesRecibidosSet.has(uniqueKey)) return;
    mensajesRecibidosSet.add(uniqueKey);

    if (mensajesRecibidosSet.size > 3000) mensajesRecibidosSet.clear();

    // ======================================================
    // 🧊 PREVIEW + ORDENAR CHAT
    // ======================================================
    const texto = msg.cuerpo || "";
    const horaIso = msg.editado_en || msg.creado_en || new Date().toISOString();

    updateThreadPreview(chatId, texto);
    updateThreadTime(chatId, horaIso);
    moveChatToTop(chatId);

    // ======================================================
    // 🔊 SONIDO PARA CUALQUIER CHAT (GRUPO O 1:1)
    // ======================================================
    if (!esMio && soundReceive) {
      soundReceive.play().catch(() => { });
    }

    // ======================================================
    // 🔔 CHAT NO ABIERTO → badge
    // ======================================================
    if (chatId !== String(currentChatId)) {
      if (!esMio) {
        incrementarBadge(chatId);
      }

      // ENTREGADO cuando llega (no leído)
      if (!esMio && msg.id) registrarEstado(msg.id, "entregado");
      return;
    }

    // ======================================================
    // 🏆 CHAT ABIERTO → RENDER instantáneo
    // ======================================================
    renderMessageFromObj(msg, esMio);

    // ======================================================
    // 📌 ENTREGADO SOLO (NO LEIDO)
    // ======================================================
    if (!esMio && msg.id) {
      registrarEstado(msg.id, "entregado");
    }
  });
}

//-----------------------------------------------
// CERRAR MODAL AÑADIR MIEMBROS
//-----------------------------------------------
function closeAddMembersModal() {
  newChatOverlay.style.display = "none";
  newGroupModal.style.display = "none";
  resetNewGroupState();
}

// ====================================================
// EVENTOS SOCKET – BLOQUE COMPLETO Y FUNCIONAL
// ====================================================

if (window.socket) {

  // ====================================================
  // 📝 MENSAJE EDITADO (REAL-TIME)
  // ====================================================
  window.socket.on("mensaje_editado", (payload) => {
    if (!payload || !payload.mensaje_id) return;

    if (String(payload.conversacion_id) !== String(currentChatId)) {
      updateThreadPreview(
        payload.conversacion_id,
        payload.cuerpo || "Mensaje editado"
      );
      return;
    }

    applyEditToDom(
      payload.mensaje_id,
      payload.cuerpo || "",
      payload.editado_en || null
    );

    updateThreadPreview(
      payload.conversacion_id,
      payload.cuerpo || "Mensaje editado"
    );
  });


  // ====================================================
  // ❌ MENSAJE ELIMINADO (REAL-TIME)
  // ====================================================
  window.socket.on("mensaje_eliminado", (payload) => {
    if (!payload || !payload.mensaje_id) return;
    aplicarEliminacionMensajeLocal(payload);
  });

  // ====================================================
  // 🚪 USUARIO SALIÓ DEL GRUPO — VERSIÓN FINAL 2025
  // ====================================================
  window.socket.on("usuario_salio_grupo", (payload) => {
    try {
      if (!payload || !payload.conversacion_id || !payload.usuario_id) return;

      const convId = String(payload.conversacion_id);
      const userId = String(payload.usuario_id);

      const chatObj = chatsMap.get(convId);
      if (!chatObj || !chatObj.es_grupo) return;

      if (chatObj.__lastExitEvent === userId) return;
      chatObj.__lastExitEvent = userId;

      let nombreSalida = payload.nombre_salida || "Miembro";

      if (Array.isArray(chatObj.usuarios)) {
        chatObj.usuarios = chatObj.usuarios.filter(u => String(u.id) !== userId);
      }

      const esChatAbierto = String(currentChatId) === convId;
      const soyYo = userId === String(usuarioId);

      // ===============================
      // 🟦 YO salgo
      // ===============================
      if (soyYo) {
        chatObj.soy_miembro = false;
        currentUserIsGroupMember = false;
        applyGroupMembershipUi();
        updateAddMembersButtonVisibility();

        if (esChatAbierto) {
          renderSystemMessage(
            "Has salido del grupo. Puedes eliminar esta conversación desde el menú.",
            new Date().toISOString()
          );
        }

        loadChats();
        return;
      }

      // ===============================
      // 🟪 OTRO miembro sale
      // ===============================
      if (esChatAbierto) {
        currentGroupMembers = currentGroupMembers.filter(
          m => String(m.id) !== userId
        );

        renderGroupMembersList();
        renderGroupHeaderSubtitle();

        renderSystemMessage(
          `${nombreSalida} salió del grupo.`,
          new Date().toISOString()
        );
      }

      loadChats();
    } catch (e) {
      console.error("Error usuario_salio_grupo:", e);
    }
  });
}

// ==========================================================
// 🚀 Evento: un usuario fue agregado a un grupo
// ==========================================================
socket.on("grupo_usuario_agregado", async (data) => {
  console.log("📥 grupo_usuario_agregado:", data);

  const conversacionId = String(data.conversacion_id);
  if (!conversacionId) return;

  // 1️⃣ Volver a cargar miembros del grupo
  await actualizarMiembrosGrupo(conversacionId);

  // 2️⃣ Recargar también lista de chats
  await loadChats();

  // 3️⃣ Si estamos dentro del chat → actualizar encabezado
  if (currentChatId === conversacionId) {
    actualizarChatHeader(conversacionId);
  }
});

// ====================================================
// 🚀 MIEMBRO AGREGADO (REAL-TIME) — VERSIÓN PERFECTA
// ====================================================
window.socket.on("miembro_agregado", (payload) => {
  if (!payload || !payload.conversacion_id || !payload.nuevo_id) return;

  const convId = String(payload.conversacion_id);
  const nuevoId = String(payload.nuevo_id);
  const adminId = String(payload.admin_id);

  const chatObj = chatsMap.get(convId);
  if (!chatObj || !chatObj.es_grupo) return;

  // evitar duplicados
  if (chatObj.usuarios?.some(u => String(u.id) === nuevoId)) return;

  const miembro = {
    id: nuevoId,
    alias: payload.nuevo_visible || "Miembro",
    nombre: payload.nuevo_visible || null,
    telefono: null,
    activo: true,
    es_admin: false
  };

  if (!Array.isArray(chatObj.usuarios)) chatObj.usuarios = [];
  chatObj.usuarios.push(miembro);

  const esChatAbierto = String(currentChatId) === convId;

  if (esChatAbierto && currentChatIsGroup) {
    currentGroupMembers.push(miembro);
    renderGroupMembersList();
    renderGroupHeaderSubtitle();

    let texto = "";

    if (String(usuarioId) === adminId) {
      texto = `Has agregado a ${payload.nuevo_visible}`;
    } else {
      texto = `${payload.admin_visible} agregó a ${payload.nuevo_visible}`;
    }

    renderSystemMessage(texto, new Date().toISOString());
  }

  loadChats();
});



// ====================================================
// 👑 NUEVO ADMIN ASIGNADO (REAL-TIME) – VERSIÓN PRO
// ====================================================
window.socket.on("admin_cambiado", (payload) => {
  if (!payload || !payload.conversacion_id || !payload.nuevo_admin_id) return;

  const convId = String(payload.conversacion_id);
  const chatObj = chatsMap.get(convId);
  if (!chatObj || chatObj.es_grupo !== true) return;

  // actualizar creador
  chatObj.creador_id = payload.nuevo_admin_id;

  // si el chat está abierto, refrescar todo
  const esAbierto = String(currentChatId) === convId;

  if (esAbierto) {
    currentUserIsGroupAdmin = (String(usuarioId) === String(payload.nuevo_admin_id));
    updateAddMembersButtonVisibility();

    // actualizar miembro admin
    currentGroupMembers = currentGroupMembers.map(m => ({
      ...m,
      es_admin: String(m.id) === String(payload.nuevo_admin_id)
    }));

    renderGroupMembersList();
    renderGroupHeaderSubtitle();
  }

  // obtener nombre real del nuevo admin
  let nombreNuevo = "";
  const miembro = chatObj.usuarios?.find(u => String(u.id) === String(payload.nuevo_admin_id));

  if (payload.usuario_data_nuevo) {
    nombreNuevo =
      payload.usuario_data_nuevo.alias ||
      payload.usuario_data_nuevo.nombre ||
      payload.usuario_data_nuevo.telefono ||
      "Miembro";
  } else if (miembro) {
    nombreNuevo =
      miembro.alias || miembro.nombre || miembro.telefono || "Miembro";
  } else {
    nombreNuevo = "Miembro";
  }

  // 🟢 MENSAJE DE SISTEMA EN TIEMPO REAL
  if (esAbierto) {
    renderSystemMessage(
      `${nombreNuevo} ahora es administrador`,
      payload.fecha || new Date().toISOString()
    );
  }

  // refrescar lista lateral
  setTimeout(() => loadChats(), 200);
});

// ====================================================
// FUNCION: APLICAR ELIMINACIÓN EN DOM (NO TOCAR)
// ====================================================
function aplicarEliminacionMensajeLocal(payload) {
  const mid = payload.mensaje_id;
  const modo = payload.modo;
  const targetUser = payload.usuario_id;

  const node = document.querySelector(`.msg[data-msg-id="${mid}"]`);
  if (!node) return;

  // 🔹 SOLO PARA MÍ
  if (modo === "para_mi") {
    if (targetUser && String(targetUser) !== String(usuarioId)) return;
    node.remove();
    return;
  }

  // 🔹 PARA TODOS
  if (modo === "para_todos") {
    node.classList.add("msg-deleted");

    const esMio = node.classList.contains("me");
    const body = node.querySelector(".msg-body") || node.firstChild;

    if (body) {
      body.textContent = esMio
        ? "Eliminaste este mensaje."
        : "Este mensaje fue eliminado";
    }

    node.querySelectorAll(
      ".msg-reply, .msg-reply-inline, .msg-reply-bar, .msg-reply-content"
    ).forEach((n) => n.remove());

    const reactionEl =
      node.querySelector(".msg-reaction-badge") ||
      node.querySelector(".msg-reaction");
    if (reactionEl) reactionEl.remove();

    const timeSpan = node.querySelector(".msg-time");
    if (timeSpan) {
      const txt = timeSpan.textContent || "";
      const match = txt.match(/(\d{2}:\d{2})$/);
      timeSpan.textContent = match ? match[1] : getLocalHourFromISO(new Date().toISOString());
    }

    const cache = messageCache.get(mid);
    if (cache) {
      cache.texto = body ? body.textContent : "Este mensaje fue eliminado";
      cache.borrado = true;
      messageCache.set(mid, cache);
    }
  }
}


// ==========================================
// MOVER CHAT A LA PARTE SUPERIOR
// ==========================================
function moveChatToTop(conversacionId) {
  const item = document.querySelector(`.thread[data-id="${conversacionId}"]`);
  if (item) {
    item.parentNode.prepend(item);
  }
  saveChatOrder();
}


// ====================================================
// ABRIR MODAL "VACIAR CHAT" / "ELIMINAR CHAT"
// ====================================================

// Abrir modal de "vaciar chat"
ctxVaciarChat?.addEventListener("click", () => {
  hideThreadContextMenu();
  if (!contextChatId) return;

  const title = clearChatModal.querySelector("h3");
  if (title) {
    title.textContent = `¿Deseas vaciar el chat con ${contextChatName}?`;
  }

  const p = clearChatModal.querySelector("p");
  if (p) {
    p.textContent = "Se eliminarán todos los mensajes de esta conversación.";
  }

  clearChatOverlay.style.display = "block";
  clearChatModal.style.display = "flex";
});

// Abrir modal de "eliminar chat"
ctxEliminarChat?.addEventListener("click", () => {
  hideThreadContextMenu();
  if (!contextChatId) return;

  const title = deleteChatModal.querySelector("h3");
  if (title) {
    title.textContent = `¿Deseas eliminar el chat con ${contextChatName}?`;
  }

  const p = deleteChatModal.querySelector("p");
  if (p) {
    p.textContent = "Se eliminarán los mensajes de todos tus dispositivos.";
  }

  deleteChatOverlay.style.display = "block";
  deleteChatModal.style.display = "flex";
});

// Helpers para cerrar modales
function closeClearChatModal() {
  clearChatOverlay.style.display = "none";
  clearChatModal.style.display = "none";
}

function closeDeleteChatModal() {
  deleteChatOverlay.style.display = "none";
  deleteChatModal.style.display = "none";
}

clearChatOverlay?.addEventListener("click", closeClearChatModal);
cancelClearChat?.addEventListener("click", closeClearChatModal);

deleteChatOverlay?.addEventListener("click", closeDeleteChatModal);
cancelDeleteChat?.addEventListener("click", closeDeleteChatModal);

// ====================================================
// CONFIRMAR "VACIAR CHAT" (solo eliminar mis mensajes,
// pero SIN ocultar el chat y SIN eliminarlo del listado)
// ====================================================
confirmClearChat?.addEventListener("click", async () => {
  if (!contextChatId) return;

  const chatIdStr = String(contextChatId);

  try {
    // 🔹 1) Eliminar SOLO mis mensajes de este chat
    const resp = await fetch(`${API}conversaciones/${chatIdStr}/mensajes`, {
      method: "DELETE",
      headers: baseHeaders,
    });

    if (!resp.ok) {
      console.error("Error al vaciar chat:", resp.status, await resp.text());
      showErrorModal("No se pudieron eliminar los mensajes.");
      closeClearChatModal();
      return;
    }

    // 🔹 2) Si ese chat está abierto → limpiar mensajes
    if (currentChatId === chatIdStr) {
      messagesDiv.innerHTML = "";
      renderSystemMessage("Aún no hay mensajes. ¡Escribe algo!", null);
    }

    // 🔹 3) ACTUALIZAR la tarjeta del chat a "Sin mensajes"
    const card = document.querySelector(`.thread[data-id="${chatIdStr}"]`);
    if (card) {
      const lastNode = card.querySelector(".tlast");
      const horaNode = card.querySelector(".hora");
      if (lastNode) lastNode.textContent = "Sin mensajes";
      if (horaNode) horaNode.textContent = "";
    }

    showSuccessModal("Mensajes eliminados.");

  } catch (e) {
    console.error("Error de red al vaciar chat:", e);
    showErrorModal("Error de conexión al vaciar chat.");
  } finally {
    closeClearChatModal();
  }
});



// ====================================================
// CONFIRMAR "ELIMINAR CHAT" (quitar conversación y ocultarla para siempre)
// ====================================================
confirmDeleteChat?.addEventListener("click", async () => {
  if (!contextChatId) return;

  const chatIdStr = String(contextChatId);

  // 1) Marcar como oculto LOCALMENTE (no vuelve a salir en esta cuenta)
  addHiddenChat(chatIdStr);

  // 2) Quitar inmediatamente de la UI
  removeChatFromUI(chatIdStr);

  try {
    // 3) Avisar al backend (best effort)
    const resp = await fetch(`${API}conversaciones/${chatIdStr}`, {
      method: "DELETE",
      headers: baseHeaders,
    });

    if (!resp.ok) {
      console.error("Error al eliminar chat:", resp.status, await resp.text());
      showErrorModal(
        "No se pudo eliminar el chat en el servidor, " +
        "pero ya no aparecerá en tu lista."
      );
    } else {
      showSuccessModal("Chat eliminado correctamente.");
    }
  } catch (e) {
    console.error("Error de red al eliminar chat:", e);
    showErrorModal(
      "Error de conexión al eliminar el chat, " +
      "pero ya no aparecerá en tu lista."
    );
  } finally {
    closeDeleteChatModal();
  }
});


// ====================================================
// EDICIÓN DE MENSAJES (solo visual / local)
// ====================================================
function startEditMessage(msgId, esMio) {
  if (!esMio) {
    showToast("Solo puedes editar tus propios mensajes", "#d94b4b");
    return;
  }

  const node = document.querySelector(`.msg[data-msg-id="${msgId}"]`);
  if (!node) return;

  const bodyNode = node.querySelector(".msg-body");
  if (!bodyNode) return;

  const text = bodyNode.textContent;
  const input = document.getElementById("composerInput");
  if (!input) return;

  isEditing = true;
  editingMessageId = msgId;

  // Usamos la barra de respuesta como barra de edición
  replyTitle.textContent = "Edita el mensaje";
  replySnippet.textContent = text;
  replyPreview.style.display = "flex";

  input.value = text;
  input.focus();
  if (window.__reflowPanels) {
    window.__reflowPanels();   // 👈 igual al responder
  }
}

function applyEditToDom(msgId, newText, editadoEn) {
  const node = document.querySelector(`.msg[data-msg-id="${msgId}"]`);
  if (!node) return;

  const bodyNode = node.querySelector(".msg-body");
  if (bodyNode) bodyNode.textContent = newText;

  const timeSpan = node.querySelector(".msg-time");
  if (timeSpan) {
    const hora = editadoEn
      ? getLocalHourFromISO(editadoEn)
      : getLocalHourFromISO(new Date().toISOString());
    timeSpan.textContent = `Editado ${hora}`;
  }
}


// ====================================================
// MODAL DE ERROR
// ====================================================
function showErrorModal(message) {
  const overlay = document.getElementById("errorOverlay");
  const modal = document.getElementById("errorModal");
  const msg = document.getElementById("errorMessage");
  if (msg) msg.textContent = message || "Error desconocido";
  if (overlay) overlay.style.display = "block";
  if (modal) modal.style.display = "flex";
}

function closeErrorModal() {
  const overlay = document.getElementById("errorOverlay");
  const modal = document.getElementById("errorModal");
  if (overlay) overlay.style.display = "none";
  if (modal) modal.style.display = "none";
}

// ====================================================
// MODAL DE ÉXITO
// ====================================================
function showSuccessModal(message) {
  const overlay = document.getElementById("successOverlay");
  const modal = document.getElementById("successModal");
  const msg = document.getElementById("successMessage");
  if (msg) msg.textContent = message || "Operación exitosa";
  if (overlay) overlay.style.display = "block";
  if (modal) modal.style.display = "flex";
}

function closeSuccessModal() {
  const overlay = document.getElementById("successOverlay");
  const modal = document.getElementById("successModal");
  if (overlay) overlay.style.display = "none";
  if (modal) modal.style.display = "none";
  loadChats(); // Recarga por si cerraron rápido
}

// // ======================================================
// // LIMPIEZA AUTOMÁTICA DE SESIÓN
// // ======================================================
// sessionStorage.setItem("biscochat_tab_active", "true");

// window.addEventListener("beforeunload", () => {
//   try {
//     clearAuthArtifacts();
//     localStorage.removeItem("usuario_id");
//     localStorage.removeItem("usuario_nombre");
//     localStorage.removeItem("usuario_telefono");
//     localStorage.removeItem("current_chat_id");
//     console.log("Limpieza de sesión ejecutada antes de cerrar pestaña");
//   } catch (e) {
//     console.warn("No se pudo limpiar sesión antes de cerrar:", e);
//   }
// });

// window.addEventListener("load", () => {
//   if (!sessionStorage.getItem("biscochat_tab_active")) {
//     console.log("Nueva sesión detectada → limpieza preventiva");
//     clearAuthArtifacts();
//     localStorage.removeItem("usuario_id");
//     localStorage.removeItem("usuario_nombre");
//     localStorage.removeItem("usuario_telefono");
//     localStorage.removeItem("current_chat_id");
//   }
// });

// ====================================================
// CIERRE DE MODALES - VERSIÓN FINAL PRO 2025
// ====================================================
document.addEventListener("DOMContentLoaded", () => {

  // =============================
  // MODAL ERROR
  // =============================
  const errorOverlay = document.getElementById("errorOverlay");
  const errorModal = document.getElementById("errorModal");
  const closeErrorBtn = document.getElementById("closeErrorBtn");

  function closeErrorModal() {
    if (errorOverlay) errorOverlay.style.display = "none";
    if (errorModal) errorModal.style.display = "none";
  }

  errorOverlay?.addEventListener("click", closeErrorModal);
  errorModal?.addEventListener("click", (e) => e.stopPropagation());
  closeErrorBtn?.addEventListener("click", closeErrorModal);


  // =============================
  // MODAL ÉXITO
  // =============================
  const successOverlay = document.getElementById("successOverlay");
  const successModal = document.getElementById("successModal");
  const closeSuccessBtn = document.getElementById("closeSuccessBtn");

  function closeSuccessModal() {
    if (successOverlay) successOverlay.style.display = "none";
    if (successModal) successModal.style.display = "none";
  }

  successOverlay?.addEventListener("click", closeSuccessModal);
  successModal?.addEventListener("click", (e) => e.stopPropagation());
  closeSuccessBtn?.addEventListener("click", closeSuccessModal);


  // =============================
  // PERFIL
  // =============================
  const overlay = document.getElementById("profileOverlay");
  const profileModal = document.getElementById("profileModal");

  function closeProfileModal() {
    if (overlay) overlay.style.display = "none";
    if (profileModal) profileModal.style.display = "none";
  }


  // =============================
  // AÑADIR CONTACTO
  // =============================
  const addContactOverlay = document.getElementById("addContactOverlay");
  const addContactModal = document.getElementById("addContactModal");


  // =============================
  // NUEVO CHAT / NUEVO GRUPO
  // =============================
  const newChatOverlay = document.getElementById("newChatOverlay");
  const newChatModal = document.getElementById("newChatModal");
  const newGroupModal = document.getElementById("newGroupModal");


  // =============================
  // CHAT PRINCIPAL
  // =============================
  const chatSection = document.querySelector(".chat");
  const messagesDiv = document.getElementById("messages");



  // =============================
  // ESC: Cierra modales, luego chat
  // =============================
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    // 1) PERFIL
    if (overlay && overlay.style.display === "block") {
      closeProfileModal();
      return;
    }

    // 2) AÑADIR CONTACTO
    if (addContactOverlay && addContactOverlay.style.display === "block") {
      addContactOverlay.style.display = "none";
      addContactModal.style.display = "none";
      return;
    }

    // 3) NUEVO CHAT / GRUPO
    if (newChatOverlay && newChatOverlay.style.display === "block") {
      newChatOverlay.style.display = "none";
      newChatModal.style.display = "none";
      if (newGroupModal) newGroupModal.style.display = "none";
      return;
    }

    // 4) ERROR
    if (errorOverlay && errorOverlay.style.display === "block") {
      closeErrorModal();
      return;
    }

    // 5) ÉXITO
    if (successOverlay && successOverlay.style.display === "block") {
      closeSuccessModal();
      return;
    }

    // 6) CERRAR CHAT (si no hay modales abiertos)
    if (chatSection && chatSection.style.display !== "none") {
      chatSection.style.display = "none";

      // limpiar chat
      if (typeof currentChatId !== "undefined") currentChatId = null;
      if (messagesDiv) messagesDiv.innerHTML = "";

      // limpiar ✓✓ si el systema lo usa
      if (typeof tickNodes !== "undefined") tickNodes.clear?.();
      if (typeof estadosTicker !== "undefined") clearInterval(estadosTicker);

      return;
    }
  });

});



// ====================================================
// NUEVO CHAT - MODAL COMO WHATSAPP (AGREGADO AL FINAL)
// ====================================================
const newChatOverlay = document.getElementById("newChatOverlay");
const newChatModal = document.getElementById("newChatModal");
const backFromNewChat = document.getElementById("backFromNewChat");
const searchNewChat = document.getElementById("searchNewChat");
const newChatList = document.getElementById("newChatList");
// === NUEVO GRUPO ===
const newGroupModal = document.getElementById("newGroupModal");
const groupStep1 = document.getElementById("groupStep1");
const groupStep2 = document.getElementById("groupStep2");
const backFromNewGroup = document.getElementById("backFromNewGroup");
const backToStep1 = document.getElementById("backToStep1");
const searchNewGroup = document.getElementById("searchNewGroup");
const newGroupList = document.getElementById("newGroupList");
const groupSelectedBar = document.getElementById("groupSelectedBar");
const groupCount = document.getElementById("groupCount");
const groupNextBtn = document.getElementById("groupNextBtn");
const groupCancelBtn = document.getElementById("groupCancelBtn");
const groupCancel2Btn = document.getElementById("groupCancel2Btn");
const groupNameInput = document.getElementById("groupNameInput");
const groupCreateBtn = document.getElementById("groupCreateBtn");

// estado interno de selección
const groupSelected = new Map(); // contacto_id -> contacto (objeto)


// Abrir modal
document.getElementById("btnNewChat")?.addEventListener("click", () => {
  menuMas.style.display = "none";
  newChatOverlay.style.display = "block";
  newChatModal.style.display = "flex";
  loadContactsForNewChat();
});

// Cerrar modales de nuevo chat / nuevo grupo
newChatOverlay.onclick = () => {
  newChatOverlay.style.display = "none";
  newChatModal.style.display = "none";
  if (newGroupModal) newGroupModal.style.display = "none";
};

backFromNewChat.onclick = () => {
  newChatOverlay.style.display = "none";
  newChatModal.style.display = "none";
};

// Abrir modal "Nuevo grupo"
document.getElementById("btnNewGroup")?.addEventListener("click", () => {
  // 1) Cerrar el modal de "Nuevo chat" si está abierto
  if (newChatModal) newChatModal.style.display = "none";

  // 2) Asegurar que el overlay esté visible
  if (newChatOverlay) newChatOverlay.style.display = "block";

  // 3) Resetear estado del asistente de grupo y abrirlo
  resetNewGroupState();
  if (newGroupModal) newGroupModal.style.display = "flex";
  loadContactsForNewGroup();
});


// Cerrar desde botón "←" del step1
backFromNewGroup?.addEventListener("click", () => {
  newChatOverlay.style.display = "none";
  newGroupModal.style.display = "none";
});

// Botón "Cancelar" del step1
groupCancelBtn?.addEventListener("click", () => {
  newChatOverlay.style.display = "none";
  newGroupModal.style.display = "none";
});

// Search en lista de contactos de grupo
searchNewGroup?.addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  newGroupList
    ?.querySelectorAll(".group-contact")
    .forEach((item) => {
      const name = item.querySelector("h4")?.textContent.toLowerCase() || "";
      const phone = item.querySelector("p")?.textContent.toLowerCase() || "";
      item.style.display =
        name.includes(term) || phone.includes(term) ? "flex" : "none";
    });
});

// Botón "Siguiente" → mostrar step2
groupNextBtn?.addEventListener("click", () => {
  if (groupSelected.size === 0) return;
  groupStep1.style.display = "none";
  groupStep2.style.display = "flex";

  // sugerir nombre por defecto "Nombre del primer contacto"
  const primero = Array.from(groupSelected.values())[0];
  if (primero && !groupNameInput.value.trim()) {
    groupNameInput.value =
      primero.alias || primero.nombre_mostrar || "Nuevo grupo";
  }
  groupCreateBtn.disabled = !groupNameInput.value.trim();
  groupNameInput.focus();
});

// Volver a step1 desde step2
backToStep1?.addEventListener("click", () => {
  groupStep2.style.display = "none";
  groupStep1.style.display = "flex";
});

// Habilitar botón Crear cuando hay nombre
groupNameInput?.addEventListener("input", () => {
  groupCreateBtn.disabled = !groupNameInput.value.trim();
});

// Botón "Crear" (un solo handler para los dos casos)
groupCreateBtn?.addEventListener("click", () => {
  if (currentChatIsGroup) {
    // ya estás dentro de un grupo → agregar miembros
    addSelectedMembersToGroup();
  } else {
    // estás en "Nuevo grupo" → crear grupo
    crearGrupoEnBackend();
  }
});

// Botón "Cancelar" en step2
groupCancel2Btn?.addEventListener("click", () => {
  newChatOverlay.style.display = "none";
  newGroupModal.style.display = "none";
  resetNewGroupState();
});

// Búsqueda en tiempo real
searchNewChat.addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll(".contact-item").forEach(item => {
    const name = item.querySelector("h4").textContent.toLowerCase();
    const phone = item.querySelector("p").textContent.toLowerCase();
    item.style.display = (name.includes(term) || phone.includes(term)) ? "flex" : "none";
  });
});

// Cargar contactos - VERSIÓN FINAL QUE FUNCIONA CON TU BACKEND
async function loadContactsForNewChat() {
  try {
    const resp = await fetch(`${API}contactos`, { headers: baseHeaders });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("Error HTTP:", resp.status, err);
      throw new Error(`HTTP ${resp.status}`);
    }

    const contactos = await resp.json();
    newChatList.innerHTML = "";

    if (!contactos || contactos.length === 0) {
      newChatList.innerHTML = `
        <div style="text-align:center;padding:40px;color:gray;font-style:italic;">
          Aún no tienes contactos guardados
        </div>`;
      return;
    }

    contactos.forEach((c) => {
      const el = document.createElement("div");
      el.className = "contact-item";
      el.style.cssText =
        "display:flex;align-items:center;padding:12px 16px;cursor:pointer;border-bottom:1px solid #eee;";

      // Avatar: gatito salvo que sea URL real
      const avatarUrl =
        (c.foto_perfil && /^https?:\/\//.test(c.foto_perfil))
          ? c.foto_perfil
          : "../assets/usuario_gato.png";

      // 👉 SOLO estas dos opciones: alias o teléfono
      const nombreContacto = c.alias || c.telefono;

      el.innerHTML = `
        <div class="avatar" style="margin-right:12px;">
          <img src="${avatarUrl}"
               alt="avatar"
               style="width:50px;height:50px;border-radius:50%;object-fit:cover;">
        </div>
        <div class="contact-info" style="flex:1;">
          <h4 style="margin:0;font-size:16px;font-weight:600;color:#111;">
            ${nombreContacto}
          </h4>
          <p style="margin:4px 0 0;font-size:14px;color:#666;">
            ${c.telefono || ""}
          </p>
        </div>
      `;

      el.onclick = () => {
        newChatOverlay.style.display = "none";
        newChatModal.style.display = "none";
        crearOAbrirChatConContacto(c.telefono);
      };

      newChatList.appendChild(el);
    });
  } catch (e) {
    console.error("Error cargando contactos:", e);
    newChatList.innerHTML = `
      <div style="text-align:center;padding:40px;color:#d94b4b;">
        <strong>Error al cargar contactos</strong><br>
        <small>Revisa la consola (F12)</small>
      </div>`;
  }
}

// ===================================================
// NUEVO GRUPO - helpers
// ===================================================

function resetNewGroupState() {
  groupSelected.clear();
  if (groupSelectedBar) {
    groupSelectedBar.innerHTML = "";
    groupSelectedBar.style.display = "none";
  }
  if (groupCount) groupCount.textContent = "0 participantes";
  if (groupNextBtn) groupNextBtn.disabled = true;
  if (groupNameInput) groupNameInput.value = "";
  if (groupCreateBtn) groupCreateBtn.disabled = true;

  if (groupStep1) groupStep1.style.display = "flex";
  if (groupStep2) groupStep2.style.display = "none";

  if (newGroupList) {
    newGroupList.innerHTML = `
      <div style="text-align:center;padding:40px;color:gray;font-style:italic;">
        Cargando contactos...
      </div>`;
  }
}

// pintar chips + contador + habilitar botón
function renderGroupSelected() {
  const arr = Array.from(groupSelected.values());
  if (!groupSelectedBar || !groupCount || !groupNextBtn) return;

  groupSelectedBar.innerHTML = "";
  if (arr.length === 0) {
    groupSelectedBar.style.display = "none";
  } else {
    groupSelectedBar.style.display = "flex";
    arr.forEach((c) => {
      const chip = document.createElement("div");
      chip.className = "group-chip";
      chip.textContent =
        c.alias || c.telefono || "Contacto";
      chip.dataset.contactId = c.contacto_id;

      // al hacer click en el chip, se desmarca
      chip.addEventListener("click", () => {
        groupSelected.delete(String(c.contacto_id));
        const chk = newGroupList.querySelector(
          `input[data-contact-id="${c.contacto_id}"]`
        );
        if (chk) chk.checked = false;
        renderGroupSelected();
      });

      groupSelectedBar.appendChild(chip);
    });
  }

  groupCount.textContent =
    arr.length === 1
      ? "1 participante"
      : `${arr.length} participantes`;

  groupNextBtn.disabled = arr.length === 0;
}

// Carga de contactos para el modal de grupo
async function loadContactsForNewGroup() {
  try {
    const resp = await fetch(`${API}contactos`, { headers: baseHeaders });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Error HTTP contactos grupo:", resp.status, txt);
      throw new Error("HTTP " + resp.status);
    }

    const contactos = await resp.json();
    newGroupList.innerHTML = "";

    if (!contactos || contactos.length === 0) {
      newGroupList.innerHTML = `
        <div style="text-align:center;padding:40px;color:gray;font-style:italic;">
          Aún no tienes contactos guardados
        </div>`;
      return;
    }

    contactos.forEach((c) => {
      const item = document.createElement("div");
      item.className = "contact-item group-contact";

      const avatarUrl =
        (c.foto_perfil && /^https?:\/\//.test(c.foto_perfil))
          ? c.foto_perfil
          : "../assets/usuario_gato.png";

      // 🔹 AQUÍ: alias o teléfono, igual que en "Nuevo chat"
      const nombreContacto = c.alias || c.telefono || "Contacto";

      item.innerHTML = `
        <div class="avatar" style="margin-right:12px;">
          <img src="${avatarUrl}" alt="avatar">
        </div>
        <div class="contact-info" style="flex:1;">
          <h4 style="margin:0;font-size:15px;font-weight:600;">
            ${nombreContacto}
          </h4>
          <p style="margin:4px 0 0;font-size:13px;color:#666;">
            ${c.telefono || ""}
          </p>
        </div>
        <div class="group-check">
          <input type="checkbox" data-contact-id="${c.contacto_id}">
        </div>
      `;

      newGroupList.appendChild(item);
    });


    // listeners de los check
    newGroupList
      .querySelectorAll('input[type="checkbox"][data-contact-id]')
      .forEach((chk) => {
        chk.addEventListener("change", () => {
          const id = chk.dataset.contactId;
          const contacto = contactos.find(
            (c) => String(c.contacto_id) === String(id)
          );
          if (!contacto) return;

          if (chk.checked) {
            groupSelected.set(String(id), contacto);
          } else {
            groupSelected.delete(String(id));
          }
          renderGroupSelected();
        });
      });
  } catch (e) {
    console.error("Error cargando contactos grupo:", e);
    newGroupList.innerHTML = `
      <div style="text-align:center;padding:40px;color:#d94b4b;">
        Error al cargar contactos
      </div>`;
  }
}

// Crear la conversación de grupo en backend
async function crearGrupoEnBackend() {
  const nombre = groupNameInput.value.trim();
  if (!nombre) return;
  if (groupSelected.size === 0) return;

  const miembros = [usuarioId, ...Array.from(groupSelected.keys())];

  try {
    const resp = await fetch(`${API}conversaciones`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        es_grupo: true,
        miembros: miembros,
        titulo: nombre,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Error creando grupo:", resp.status, txt);
      showErrorModal("No se pudo crear el grupo.");
      return;
    }

    const nuevoChat = await resp.json();

    // Opcional: aquí podrías mandar un mensaje de sistema "Creaste este grupo."
    // await fetch(`${API}conversaciones/${nuevoChat.id}/mensajes`, { ... })

    // Cerramos modal y limpiamos
    newChatOverlay.style.display = "none";
    newGroupModal.style.display = "none";
    resetNewGroupState();

    // Refrescamos lista y abrimos el grupo
    await loadChats();
    openChat(nuevoChat.id, nuevoChat.titulo || nombre, null);
    moveChatToTop(nuevoChat.id);
  } catch (e) {
    console.error("Error de red al crear grupo:", e);
    showErrorModal("Error de conexión al crear el grupo.");
  }
}


// ===================================================
// CREAR O ABRIR CHAT CON CONTACTO (versión reparada)
// ===================================================
async function crearOAbrirChatConContacto(telefono) {
  try {
    const telefonoNormalizado = telefono.replace(/\D/g, "");

    // Obtener chats + contactos
    const [resp, contactosResp] = await Promise.all([
      fetch(`${API}chats/${usuarioId}`, { headers: baseHeaders }),
      fetch(`${API}contactos`, { headers: baseHeaders })
    ]);

    if (!resp.ok || !contactosResp.ok) {
      showErrorModal("No se pudieron obtener los datos del usuario.");
      return;
    }

    const conversaciones = await resp.json();
    const contactosUsuario = await contactosResp.json();

    // Encontrar el contacto real
    const contacto = contactosUsuario.find(c => {
      if (!c.telefono) return false;
      return c.telefono.replace(/\D/g, "") === telefonoNormalizado;
    });

    if (!contacto) {
      showErrorModal("No se encontró el contacto en tu lista.");
      return;
    }

    // ======================================================
    // 🔍 DETECTAR CHAT INDIVIDUAL REAL (FIX DEFINITIVO)
    // ======================================================
    let chatEncontrado = null;

    for (const chat of conversaciones) {

      // ❌ 1) DESCARTAR GRUPOS
      if (chat.es_grupo === true) continue;

      // ❌ 2) DESCARTAR listas inválidas
      if (!Array.isArray(chat.usuarios)) continue;

      // ❌ 3) SOLO TOMAR EXACTAMENTE 2 USUARIOS
      if (chat.usuarios.length !== 2) continue;

      // Buscar coincidencia EXACTA con contacto
      const coincide = chat.usuarios.some(u => {
        const mismoId = String(u.id) === String(contacto.contacto_id);
        const mismoTel = u.telefono && u.telefono.replace(/\D/g, "") === telefonoNormalizado;
        return mismoId || mismoTel;
      });

      if (coincide) {
        chatEncontrado = chat;
        break;
      }
    }

    // ======================================================
    // 👉 SI YA EXISTE EL CHAT DIRECTO — ABRIRLO
    // ======================================================
    if (chatEncontrado) {
      const nombre = contacto.alias || contacto.telefono || "Contacto";
      openChat(chatEncontrado.id, nombre, contacto.contacto_id);
      return;
    }

    // ======================================================
    // 👉 NO EXISTE → CREAR NUEVO CHAT 1-A-1
    // ======================================================
    const crearResp = await fetch(`${API}conversaciones`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        es_grupo: false,
        miembros: [usuarioId, contacto.contacto_id],
        titulo: null
      })
    });

    if (crearResp.ok) {
      const nuevoChat = await crearResp.json();
      await loadChats();

      const nombre = contacto.alias || contacto.nombre_mostrar || contacto.telefono;
      openChat(nuevoChat.id, nombre, contacto.contacto_id);
      return;
    }

    if (crearResp.status === 409) {
      // Backend dice: el chat YA existe → recargar y abrir
      await loadChats();
      return;
    }

    showErrorModal("No se pudo crear la conversación.");
  } catch (e) {
    console.error(e);
    showErrorModal("Error al conectar con el servidor.");
  }
}

//-----------------------------------------------
// BOTÓN “AGREGAR MIEMBROS” (solo admin)
//-----------------------------------------------
const btnAddMembers = document.getElementById("btnAddMembers");
const addMembersOverlay = document.getElementById("addMembersOverlay");
const addMembersModal = document.getElementById("addMembersModal");

if (btnAddMembers) {
  btnAddMembers.addEventListener("click", (e) => {
    e.stopPropagation();

    if (!currentChatIsGroup) {
      showToast("Solo disponible en grupos", "#d94b4b");
      return;
    }

    if (!currentUserIsGroupAdmin) {
      showToast("Solo el administrador puede agregar miembros", "#d94b4b");
      return;
    }

    openAddMembersModal();
  });
}

// Muestra / oculta el botón de agregar miembros según el contexto
function updateAddMembersButtonVisibility() {
  if (!btnAddMembers) return;

  const visible =
    currentChatIsGroup &&
    currentUserIsGroupAdmin &&
    currentUserIsGroupMember;

  btnAddMembers.style.display = visible ? "flex" : "none";
}

//-----------------------------------------------
// ABRIR MODAL PARA AÑADIR MIEMBROS
//-----------------------------------------------
function openAddMembersModal() {
  loadContactsForAddMembers();
  addMembersOverlay.style.display = "block";
  addMembersModal.style.display = "flex";
}

//-----------------------------------------------
// CERRAR MODAL
//-----------------------------------------------
document.getElementById("backFromAddMembers").onclick = () => {
  addMembersOverlay.style.display = "none";
  addMembersModal.style.display = "none";
};


//-----------------------------------------------
// CARGAR CONTACTOS EN EL MODAL
//-----------------------------------------------
function loadContactsForAddMembers() {
  const cont = document.getElementById("addMembersList");
  cont.innerHTML = "<p style='padding:40px;text-align:center;color:gray;'>Cargando...</p>";

  fetch(`${API}contactos`, { headers: baseHeaders })
    .then(r => r.json())
    .then(contactos => {

      cont.innerHTML = "";

      // Excluir los que ya están en el grupo
      const actuales = currentGroupMembers.map(m => String(m.id));

      contactos
        .filter(c => !actuales.includes(String(c.contacto_id)))
        .forEach(c => {

          const el = document.createElement("div");
          el.className = "contact-item";

          el.innerHTML = `
            <div class="avatar"><img src="../assets/usuario_gato.png"></div>
            <div class="contact-info">
              <h4>${c.alias || c.telefono}</h4>
              <p>${c.telefono}</p>
            </div>
          `;

          el.onclick = () => addMemberToGroup(c.contacto_id);
          cont.appendChild(el);
        });

      if (cont.innerHTML.trim() === "") {
        cont.innerHTML = "<p style='padding:40px;text-align:center;color:gray;'>No hay más contactos disponibles.</p>";
      }
    });
}

function getChatMemberAvatar(userId) {
  try {
    // 1 a 1 (no grupo)
    if (!currentChatIsGroup) {
      const el = currentChatUserData || null;
      return el?.avatar || "/frontend/assets/usuario_gato.png";
    }

    // Grupo
    const miembro = currentGroupMembers?.find(m => m.id === userId);
    return miembro?.avatar || "/frontend/assets/usuario_gato.png";
  } catch {
    return "/frontend/assets/usuario_gato.png";
  }
}

//-----------------------------------------------
// ENVIAR AL BACKEND PARA AGREGAR UN MIEMBRO
//-----------------------------------------------
async function addMemberToGroup(memberId) {
  try {
    const resp = await fetch(
      `${API}conversaciones/${currentChatId}/miembros/agregar`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ miembros: [memberId] }),
      }
    );

    if (!resp.ok) {
      console.error("Error al agregar miembro:", resp.status, await resp.text());
      showErrorModal("No se pudo agregar el miembro al grupo.");
      return;
    }

    // Cerrar modal
    addMembersOverlay.style.display = "none";
    addMembersModal.style.display = "none";
    showToast("Miembro agregado ✔️");

    // 🔹 Actualizar estado local INMEDIATAMENTE
    const convId = String(currentChatId);
    const chatObj = chatsMap.get(convId);

    if (chatObj && chatObj.es_grupo) {
      if (!Array.isArray(chatObj.usuarios)) chatObj.usuarios = [];

      // evitar duplicados
      if (!chatObj.usuarios.some(u => String(u.id) === String(memberId))) {

        // buscar datos del contacto en la caché de contactos
        const contacto = contactosCache.find(
          c => String(c.contacto_id) === String(memberId)
        );

        const nuevoMiembro = {
          id: memberId,
          nombre: contacto?.alias || contacto?.nombre_mostrar || null,
          telefono: contacto?.telefono || null,
          alias: contacto?.alias || contacto?.telefono || "Miembro",
          activo: true,
          es_admin: false
        };

        chatObj.usuarios.push(nuevoMiembro);

        if (currentChatIsGroup && String(currentChatId) === convId) {
          currentGroupMembers.push(nuevoMiembro);
          renderGroupMembersList();
          renderGroupHeaderSubtitle();
          renderSystemMessage(
            `${nuevoMiembro.alias} se unió al grupo.`,
            new Date().toISOString()
          );
        }
      }
    }

    // refrescar tarjetas de la izquierda
    loadChats();

  } catch (err) {
    console.error("Error de red al agregar miembro:", err);
    showErrorModal("Error de conexión al agregar el miembro.");
  }
}

////// SISTEMA DE LLAMADAS //////

// ==========================================================
// 🚀 INICIAR LLAMADA DE AUDIO 1 A 1 (WebRTC) — VERSIÓN FINAL
// ==========================================================
function iniciarLlamadaAudio() {

  // Solo chats individuales
  if (currentChatIsGroup) {
    alert("Solo se puede llamar en chats 1 a 1.");
    return;
  }

  if (!currentChatId || !currentChatUserId) {
    console.error("❌ No hay conversación 1 a 1 abierta.");
    return;
  }

  // Nombre visible (NO se envía al backend)
  const peerName =
    currentChatName ||
    (typeof getChatMemberDisplayName === "function"
      ? getChatMemberDisplayName(currentChatUserId)
      : "Contacto");

  // Foto (si no existe, avatar genérico)
  const peerFoto = "/frontend/assets/usuario_gato.png";

  // ===============================================
  // 1️⃣ ENVIAR NOTIFICACIÓN DE LLAMADA
  //     El backend generará el alias FINAL
  // ===============================================
  try {
    if (window.socket) {
      window.socket.emit("incoming_call", {
        conversacion_id: currentChatId, // id conversación
        from: currentUserId,           // yo
        to: currentChatUserId,         // destinatario
        tipo: "audio",
        foto: peerFoto                 // opcional
      });

      console.log("📤 incoming_call enviado:", {
        conversacion_id: currentChatId,
        from: currentUserId,
        to: currentChatUserId,
        tipo: "audio",
        foto: peerFoto,
      });
    }
  } catch (e) {
    console.error("❌ Error emitiendo incoming_call:", e);
  }

  // ===============================================
  // 2️⃣ ABRIR PANTALLA DEL QUE LLAMA
  // ===============================================
  const url = new URL(
    window.location.origin + "/frontend/html/llamada_audio.html"
  );

  url.searchParams.set("conversacion_id", currentChatId);
  url.searchParams.set("from", currentUserId);
  url.searchParams.set("to", currentChatUserId);
  url.searchParams.set("caller", "1"); // marcamos que YO llamo
  url.searchParams.set("nombre_peer", peerName);

  console.log("📞 Abriendo mi pantalla de llamada:", url.toString());

  window.location.href = url.toString();
}



// ==========================================================
// 🚀 INICIAR VIDEOLLAMADA 1 A 1 (WebRTC)
// ==========================================================
function iniciarVideoLlamada() {
  if (currentChatIsGroup) {
    alert("Solo se puede videollamar en chats 1 a 1.");
    return;
  }

  if (!currentChatId || !currentChatUserId) {
    console.error("No hay conversación 1 a 1 abierta.");
    return;
  }

  const peerName =
    currentChatName ||
    getChatMemberDisplayName?.(currentChatUserId) ||
    "Contacto";

  // 1️⃣ Avisar al servidor que estoy iniciando VIDEOLLAMADA
  try {
    if (window.socket) {
      window.socket.emit("incoming_call", {
        conversacion_id: currentChatId,
        from: currentUserId,
        to: currentChatUserId,
        nombre: peerName,
        tipo: "video",             // clave para saber que es VIDEO
      });
    }
  } catch (e) {
    console.error("Error emitiendo incoming_call (video):", e);
  }

  // 2️⃣ Abrir MI pantalla de VIDEOLLAMADA
  const url = new URL(
    window.location.origin + "/frontend/html/llamada_video.html"
  );

  url.searchParams.set("conversacion_id", currentChatId);
  url.searchParams.set("from", currentUserId);
  url.searchParams.set("to", currentChatUserId);
  url.searchParams.set("caller", "1");
  url.searchParams.set("nombre_peer", peerName);

  window.location.href = url.toString();
}
