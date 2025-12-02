/* ============================================================
   LLAMADA GRUPAL SOLO AUDIO — WebRTC + Socket.IO (FINAL)
   ============================================================ */

/* -------- PARAMETROS URL -------- */
const params = new URLSearchParams(window.location.search);

const CONV_ID = params.get("conversacion_id");
const MY_ID   = params.get("from");
const CALLER  = params.get("caller") === "1";

/* Validación */
if (!CONV_ID || !MY_ID) {
  alert("Error: faltan parámetros.");
}

/* -------- UI -------- */
const participantsContainer = document.getElementById("participantsContainer");

/* -------- TEMPORIZADOR -------- */
let sec = 0;
setInterval(() => {
  sec++;
  const mm = String(Math.floor(sec/60)).padStart(2,"0");
  const ss = String(sec%60).padStart(2,"0");
  document.getElementById("callTime").textContent = `${mm}:${ss}`;
}, 1000);

/* ============================================================
   SOCKET.IO
   ============================================================ */

const socket = io("/", {
  transports:["websocket"],
  path:"/socket.io",
});

/* MÁS IMPORTANTE: mapa de peers */
const peers = {};       // peers[userId] = RTCPeerConnection
const audioElements = {}; // audioElements[userId] = HTMLAudioElement

/* Al conectar */
socket.on("connect", async () => {

  socket.emit("registrar_usuario", { usuario_id: MY_ID });
  socket.emit("suscribir_conversacion", { conversacion_id: CONV_ID });

  socket.emit("rtc_join_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
  });

  localStream = await getAudio();

  if (CALLER) {
    socket.emit("rtc_group_request_participants", {
      conversacion_id: CONV_ID,
      from: MY_ID,
    });
  }
});

/* ============================================================
   MEDIA LOCAL (AUDIO)
   ============================================================ */

let localStream = null;

async function getAudio() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    return localStream;

  } catch (e) {
    console.error("❌ No se pudo acceder al micrófono", e);
    alert("Error al acceder al micrófono.");
    throw e;
  }
}

/* ============================================================
   CREAR TARJETA PARA CADA PARTICIPANTE
   ============================================================ */

function createParticipantCard(userId, name="Participante") {

  const card = document.createElement("div");
  card.className = "participant-card";
  card.id = `card-${userId}`;

  card.innerHTML = `
    <div class="avatar"></div>
    <div class="p-name">${name}</div>
    <div class="p-state" id="state-${userId}">Conectando...</div>
  `;

  participantsContainer.appendChild(card);
}

/* Cambiar estado */
function setState(userId, text) {
  const el = document.getElementById(`state-${userId}`);
  if (el) el.textContent = text;
}

/* ============================================================
   CREAR PEER PARA CADA USUARIO
   ============================================================ */

function createPeer(userId) {

  if (peers[userId]) return peers[userId];

  const pc = new RTCPeerConnection({
    iceServers: [{ urls:"stun:stun.l.google.com:19302" }],
  });

  /* Al obtener ICE */
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("rtc_ice_candidate_group", {
        conversacion_id: CONV_ID,
        from: MY_ID,
        to: userId,
        candidate: e.candidate,
      });
    }
  };

  /* Cuando recibe audio remoto */
  pc.ontrack = (e) => {
    console.log("🔊 AUDIO de", userId);

    if (!audioElements[userId]) {
      audioElements[userId] = new Audio();
      audioElements[userId].autoplay = true;
    }

    audioElements[userId].srcObject = e.streams[0];
    setState(userId, "En llamada");
  };

  /* Estado de conexión */
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      setState(userId, "Desconectado");
    }
  };

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  peers[userId] = pc;
  return pc;
}

/* ============================================================
   RECIBE LISTA DE PARTICIPANTES
   ============================================================ */

socket.on("rtc_group_participants", async (data) => {
  const users = data.users || [];

  for (const u of users) {
    if (u === MY_ID) continue;

    createParticipantCard(u);
    await createAndSendOffer(u);
  }
});

/* ============================================================
   SENDER: Enviar Offer
   ============================================================ */
async function createAndSendOffer(userId) {
  const pc = createPeer(userId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("rtc_offer_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
    to: userId,
    sdp: offer,
  });

  setState(userId, "Llamando...");
}

/* ============================================================
   RECEIVER: Recibir OFFER
   ============================================================ */

socket.on("rtc_offer_group", async (data) => {
  if (data.to !== MY_ID) return;

  createParticipantCard(data.from);

  const pc = createPeer(data.from);

  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("rtc_answer_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
    to: data.from,
    sdp: answer,
  });

  setState(data.from, "Conectando...");
});

/* ============================================================
   Recibir ANSWER
   ============================================================ */

socket.on("rtc_answer_group", async (data) => {
  if (data.to !== MY_ID) return;

  const pc = peers[data.from];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  setState(data.from, "En llamada");
});

/* ============================================================
   ICE CANDIDATES
   ============================================================ */

socket.on("rtc_ice_candidate_group", async (data) => {
  if (data.to !== MY_ID) return;

  const pc = peers[data.from];
  if (!pc) return;

  try {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) {
    console.error("❌ ICE error:", e);
  }
});

/* ============================================================
   CUANDO ALGUIEN SE SALE
   ============================================================ */

socket.on("rtc_group_user_left", (data) => {
  const id = data.user_id;

  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }

  if (audioElements[id]) {
    audioElements[id].pause();
    delete audioElements[id];
  }

  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();
});

/* ============================================================
   COLGAR
   ============================================================ */

function endCall() {
  for (const id in peers) {
    peers[id].close();
  }
  for (const id in audioElements) {
    audioElements[id].pause();
  }

  socket.emit("rtc_leave_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
  });

  window.location.href = "conversaciones.html";
}

document.getElementById("btnHang").onclick = () => endCall();

/* ============================================================
   MIC / ALTAVOZ
   ============================================================ */

document.getElementById("btnMic").onclick = () => {
  const track = localStream.getAudioTracks()[0];
  track.enabled = !track.enabled;

  document.getElementById("lblMic").textContent =
    track.enabled ? "Mic encendido" : "Mic apagado";
};

document.getElementById("btnSpk").onclick = () => {
  for (const id in audioElements) {
    audioElements[id].muted = !audioElements[id].muted;
  }

  document.getElementById("lblSpk").textContent =
    audioElements[Object.keys(audioElements)[0]].muted
      ? "Altavoz off"
      : "Altavoz";
};
