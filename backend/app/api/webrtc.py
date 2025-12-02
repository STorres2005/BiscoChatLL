# app/api/webrtc.py
from fastapi import APIRouter, HTTPException
from twilio.rest import Client as TwilioClient
import os
from dotenv import load_dotenv

load_dotenv()  # Carga tu .env

router = APIRouter(prefix="/webrtc", tags=["webrtc"])

# Credenciales desde .env
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")

# Verificación rápida (solo para desarrollo)
if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
    raise RuntimeError("Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en .env")

client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

@router.get("/ice-servers")
async def get_ice_servers():
    try:
        token = client.tokens.create(ttl=86400)  # 24 horas, cambia a 31536000 para 1 año
        return {
            "ice_servers": token.ice_servers,
            "username": token.username,
            "password": token.password,
            "ttl": token.ttl
        }
    except Exception as e:
        print(f"Error Twilio: {e}")
        # Fallback gratuito si Twilio falla
        return {
            "ice_servers": [
                {"urls": "stun:stun.l.google.com:19302"},
                {"urls": "stun:stun1.l.google.com:19302"},
                {
                    "urls": [
                        "turn:openrelay.metered.ca:80",
                        "turn:openrelay.metered.ca:443",
                        "turn:openrelay.metered.ca:443?transport=tcp"
                    ],
                    "username": "openrelayproject",
                    "credential": "openrelayproject"
                }
            ]
        }