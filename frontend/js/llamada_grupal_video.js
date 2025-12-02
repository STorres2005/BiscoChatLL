/* ============================================================
   LLAMADA GRUPAL VIDEO – WebRTC + Socket.IO (FINAL)
   ============================================================ */

/* -------- PARAMS -------- */
const params = new URLSearchParams(window.location.search);

const CONV_ID = params.get("conversacion_id");
const MY_ID   = params.get("from");
const CALLER  = params.get("caller") === "1";

if (!CONV_ID || !MY_ID) {
  alert("Error: falta conversacion_id o from");
}

/* -------- UI -------- */
const videoGrid = document.getElementById("videoGrid");

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
  transports: ["websocket"],
  path: "/socket.io",
});

/* Todos los peers */
const peers = {};          // peers[userId] = RTCPeerConnection
const videos = {};         // videos[userId] = HTMLVideoElement

/* LOCAL STREAM */
let localStream = null;

/* ======== Obtener audio + video ======== */
async function getMedia() {
  if (localStream) return localStream;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    // Mostrar video local en su propia card
    createVideoCard(MY_ID, "Tú", localStream);

    return localStream;

  } catch (e) {
    console.error("❌ Error cámara/mic:", e);
    alert("No se pudo acceder a cámara/mic");
    throw e;
  }
}

/* ============================================================
   CREAR CARD DE VIDEO PARA CADA USUARIO
   ============================================================ */

function createVideoCard(userId, name="Usuario", stream=null) {
  if (document.getElementById(`card-${userId}`)) return;

  const card = document.createElement("div");
  card.className = "video-card";
  card.id = `card-${userId}`;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.id = `video-${userId}`;

  if (userId === MY_ID) video.muted = true;

  if (stream) video.srcObject = stream;

  const label = document.createElement("div");
  label.className = "name-label";
  label.textContent = name;

  card.appendChild(video);
  card.appendChild(label);

  videoGrid.appendChild(card);

  videos[userId] = video;
}

/* ============================================================
   CREAR PEER POR PARTICIPANTE
   ============================================================ */

function createPeer(userId) {
  if (peers[userId]) return peers[userId];

  const pc = new RTCPeerConnection({
    iceServers: [{ urls:"stun:stun.l.google.com:19302" }],
  });

  /* ICE */
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

  /* Cuando llega video remoto */
  pc.ontrack = (e) => {
    console.log("🎥 Video remoto de:", userId);

    if (!videos[userId]) createVideoCard(userId);

    videos[userId].srcObject = e.streams[0];
  };

  /* Estado */
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected"].includes(pc.connectionState)) {
      console.warn("Usuario desconectado:", userId);
    }
  };

  /* Añadir media local */
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  peers[userId] = pc;
  return pc;
}

/* ============================================================
   SOCKET HANDLERS
   ============================================================ */

socket.on("connect", async () => {

  socket.emit("registrar_usuario", { usuario_id: MY_ID });
  socket.emit("suscribir_conversacion", { conversacion_id: CONV_ID });

  socket.emit("rtc_join_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
  });

  await getMedia();

  if (CALLER) {
    socket.emit("rtc_group_request_participants", {
      conversacion_id: CONV_ID,
      from: MY_ID,
    });
  }
});

/* LISTA DE PARTICIPANTES PARA INICIADOR */
socket.on("rtc_group_participants", async (data) => {
  const users = data.users || [];

  for (const u of users) {
    if (u === MY_ID) continue;

    createVideoCard(u);

    await sendOffer(u);
  }
});

/* ======== SEND OFFER ======== */
async function sendOffer(userId) {
  const pc = createPeer(userId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("rtc_offer_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
    to: userId,
    sdp: offer,
  });
}

/* ======== RECEIVE OFFER ======== */
socket.on("rtc_offer_group", async (data) => {
  if (data.to !== MY_ID) return;

  createVideoCard(data.from);

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
});

/* ======== RECEIVE ANSWER ======== */
socket.on("rtc_answer_group", async (data) => {
  if (data.to !== MY_ID) return;

  const pc = peers[data.from];
  if (!pc) return;

  await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

/* ======== ICE ======== */
socket.on("rtc_ice_candidate_group", async (data) => {
  if (data.to !== MY_ID) return;

  try {
    const pc = peers[data.from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) {
    console.error("ICE ERROR:", e);
  }
});

/* ======== USER LEFT ======== */
socket.on("rtc_group_user_left", (data) => {
  const id = data.user_id;

  if (peers[id]) peers[id].close();
  delete peers[id];

  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();
});

/* ============================================================
   CONTROLES — MIC / CAM / COLGAR
   ============================================================ */

/* MIC */
document.getElementById("btnMic").onclick = () => {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;

  document.getElementById("lblMic").textContent =
    audioTrack.enabled ? "Mic encendido" : "Mic apagado";
};

/* CAM */
document.getElementById("btnCam").onclick = () => {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;

  document.getElementById("lblCam").textContent =
    videoTrack.enabled ? "Cámara encendida" : "Cámara apagada";

  document.getElementById("iconCam").src =
    videoTrack.enabled ? "../assets/camara_activada.png" : "../assets/camara_apagada.png";
};

/* HANG */
document.getElementById("btnHang").onclick = () => endCall();

/* FINALIZAR */
function endCall() {
  for (const id in peers) peers[id].close();

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
  }

  socket.emit("rtc_leave_group", {
    conversacion_id: CONV_ID,
    from: MY_ID,
  });

  window.location.href = "conversaciones.html";
}
