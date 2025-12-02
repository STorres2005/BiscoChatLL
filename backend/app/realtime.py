# app/realtime.py
import socketio
from datetime import datetime, timezone
from app.db.sesion import SessionLocal
from app.db.modelos import Usuario

# ================================================================
#  SERVIDOR SOCKET.IO
# ================================================================
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    ping_timeout=25,
    ping_interval=10,
)

app_sio = socketio.ASGIApp(sio)

# ================================================================
# HELPERS DE ROOMS
# ================================================================
USER_ROOM = lambda uid: f"user:{uid}"
CONV_ROOM = lambda cid: f"conv:{cid}"

# Memoria local: estado de usuarios
online_users = {}  
# { usuario_id: { "sid": SID, "last_seen": datetime } }


# ================================================================
#  🔵 BROADCAST DE PRESENCIA
# ================================================================
async def broadcast_user_status(usuario_id: str, online: bool):
    payload = {
        "usuario_id": str(usuario_id),
        "online": online,
        "last_seen": datetime.now(timezone.utc).isoformat(),
    }

    await sio.emit("usuario_estado", payload)
    print(f"📡 Estado usuario {usuario_id}: {'ONLINE' if online else 'OFFLINE'}")


# ================================================================
#  🔵 CONEXIÓN SOCKET.IO
# ================================================================
@sio.event
async def connect(sid, environ):
    print(f"🟢 Cliente conectado SID={sid}")


# ================================================================
#  🔴 DESCONEXIÓN
# ================================================================
@sio.event
async def disconnect(sid, reason=None):
    print(f"🔴 Cliente desconectado SID={sid}")

    try:
        session = await sio.get_session(sid)
    except KeyError:
        session = None

    if not session or "usuario_id" not in session:
        return

    uid = session["usuario_id"]
    info = online_users.get(uid)

    # Si el SID no coincide, no marcar offline
    if not info or info.get("sid") != sid:
        return

    now = datetime.utcnow()

    # Guardar en memoria
    online_users[uid] = {"sid": None, "last_seen": now}

    # Guardar en BD
    async with SessionLocal() as db:
        u = await db.get(Usuario, uid)
        if u:
            u.en_linea = False
            u.ultima_conexion = now
            await db.commit()

    await broadcast_user_status(uid, online=False)


# ================================================================
#  👤 REGISTRAR USUARIO
# ================================================================
@sio.event
async def registrar_usuario(sid, data):
    uid = data.get("usuario_id")
    if not uid:
        return

    # Guardar sesión
    await sio.save_session(sid, {"usuario_id": uid})
    await sio.enter_room(sid, USER_ROOM(uid))

    # Memoria
    online_users[uid] = {
        "sid": sid,
        "last_seen": datetime.utcnow(),
    }

    print(f"👤 Usuario {uid} registrado → room {USER_ROOM(uid)}")

    # BD
    async with SessionLocal() as db:
        u = await db.get(Usuario, uid)
        if u:
            u.en_linea = True
            await db.commit()

    await broadcast_user_status(uid, online=True)


# ================================================================
#  💬 SUSCRIBIR A CONVERSACIÓN NORMAL (chat)
# ================================================================
@sio.event
async def suscribir_conversacion(sid, data):
    cid = str(data.get("conversacion_id"))
    if not cid:
        return

    await sio.enter_room(sid, CONV_ROOM(cid))
    print(f"💬 SID={sid} suscrito a conversación {cid}")


# ================================================================
#  ✏️ TYPING
# ================================================================
@sio.event
async def typing(sid, data):
    cid = data.get("conversacion_id")
    if not cid:
        return
    await sio.emit("typing", data, room=CONV_ROOM(cid), skip_sid=sid)


# ================================================================
#  📩 MENSAJES DESDE FASTAPI → SOCKET
# ================================================================
async def emit_mensaje_guardado(mensaje_dict: dict):
    cid = mensaje_dict.get("conversacion_id")
    if not cid:
        print("❌ Falta conversacion_id en emit_mensaje_guardado")
        return

    await sio.emit(
        "mensaje_recibido",
        {
            "id": mensaje_dict.get("id"),
            "cuerpo": mensaje_dict.get("cuerpo"),
            "creado_en": mensaje_dict.get("creado_en"),
            "conversacion_id": mensaje_dict.get("conversacion_id"),
            "usuario_id": mensaje_dict.get("usuario_id") 
                or mensaje_dict.get("remitente_id"),
            "tipo": "mensaje",
        },
        room=CONV_ROOM(str(cid))
    )


# ================================================================
#  🔥🔥🔥 SEÑALIZACIÓN WEBRTC — LLAMADAS / VIDEOLLAMADAS
# ================================================================

# Obtener SID de un usuario
def _get_sid_for_user(user_id: str):
    info = online_users.get(str(user_id))
    return info.get("sid") if info else None

# 🔔 LLAMADA ENTRANTE (notificación 1 a 1) — VERSIÓN COMPATIBLE (REEMPLAZAR)
@sio.event
async def incoming_call(sid, data):
    """
    data = {
      "conversacion_id": "...",
      "from": "<id quien llama>",
      "to": "<id receptor>",
      "tipo": "audio" | "video",
      "foto": "url opcional"
    }
    """
    try:
        to_uid = str(data.get("to"))
        from_uid = str(data.get("from"))
        conv_id = str(data.get("conversacion_id"))

        if not to_uid or not from_uid or not conv_id:
            print("❌ incoming_call: falta 'to' o 'from' o 'conversacion_id'")
            return

        # 1️⃣ Obtener alias o teléfono DEL LLAMANTE (según contactos del receptor)
        async with SessionLocal() as db:
            receptor = await db.get(Usuario, to_uid)     # el que recibe
            llamante = await db.get(Usuario, from_uid)   # el que llama

            alias_final = None
            telefono_final = None

            if receptor and hasattr(receptor, "contactos"):
                for c in receptor.contactos:
                    if str(c.contacto_id) == from_uid:
                        if c.alias and c.alias.strip():
                            alias_final = c.alias.strip()
                        if c.telefono:
                            telefono_final = c.telefono
                        break

            if alias_final:
                nombre_final = alias_final
            elif telefono_final:
                nombre_final = telefono_final
            else:
                nombre_final = llamante.telefono if llamante else "Contacto"

        # 2️⃣ Construir payload
        payload = {
            "conversacion_id": conv_id,
            "from": from_uid,
            "to": to_uid,
            "tipo": data.get("tipo"),
            "foto": data.get("foto"),
            "nombre": nombre_final
        }

        print("📡 incoming_call payload FINAL:", payload)

        # 3️⃣ Emitir a LOS DOS sitios:
        # - room del usuario (user:ID) -> para clientes conectados en general
        # - room de la conversación (conv:ID) -> para clientes suscritos a la conversación
        room_user = USER_ROOM(to_uid)
        room_conv = CONV_ROOM(conv_id)

        await sio.emit("incoming_call", payload, room=room_user)
        await sio.emit("incoming_call", payload, room=room_conv)

        print(f"📞 incoming_call enviado a {room_user} y {room_conv}")

    except Exception as e:
        print("❌ Error en incoming_call:", e)


# 1️⃣ JOIN - VERSIÓN FINAL 100% LIMPIA Y FUNCIONAL (NO ROMPE NADA)
@sio.event
async def rtc_join(sid, data):
    cid = data.get("conversacion_id")
    uid = data.get("from")
    
    if not cid or not uid:
        return

    cid = str(cid)
    uid = str(uid)

    # Unir al usuario a la room de la conversación (una sola vez)
    await sio.enter_room(sid, CONV_ROOM(cid))

    print(f"rtc_join → usuario {uid} entró a llamada conv:{cid}")

    # Emitimos AMBOS eventos para máxima compatibilidad:
    # - rtc_peer_joined → usado por el nuevo código de video (llamada_video.js)
    # - rtc_user_joined  → usado por el viejo código de audio (llamada_audio.js)
    
    await sio.emit(
        "rtc_peer_joined",
        {"conversacion_id": cid, "user_id": uid},
        room=CONV_ROOM(cid),
        skip_sid=sid
    )

    await sio.emit(
        "rtc_user_joined",
        {"conversacion_id": cid, "user_id": uid},
        room=CONV_ROOM(cid),
        skip_sid=sid
    )
# 2️⃣ OFFER
@sio.event
async def rtc_offer(sid, data):
    to_uid = data.get("to")
    if not to_uid:
        return

    target = _get_sid_for_user(to_uid)
    if not target:
        print(f"⚠️ rtc_offer: destino {to_uid} no disponible")
        return

    await sio.emit("rtc_offer", data, room=target)


# 3️⃣ ANSWER
@sio.event
async def rtc_answer(sid, data):
    to_uid = data.get("to")
    if not to_uid:
        return

    target = _get_sid_for_user(to_uid)
    if not target:
        print(f"⚠️ rtc_answer: destino {to_uid} no disponible")
        return

    await sio.emit("rtc_answer", data, room=target)


# 4️⃣ ICE
@sio.event
async def rtc_ice_candidate(sid, data):
    to_uid = data.get("to")
    if not to_uid:
        return

    target = _get_sid_for_user(to_uid)
    if not target:
        print(f"⚠️ rtc_ice_candidate: usuario {to_uid} no conectado")
        return

    await sio.emit("rtc_ice_candidate", data, room=target)


# 5️⃣ LEAVE
@sio.event
async def rtc_leave(sid, data):
    cid = data.get("conversacion_id")
    uid = data.get("from")

    await sio.emit(
        "rtc_user_left",
        {"conversacion_id": str(cid), "user_id": str(uid)},
        room=CONV_ROOM(str(cid)),
        skip_sid=sid
    )

    print(f"📞 rtc_leave → usuario {uid} salió de conv:{cid}")
