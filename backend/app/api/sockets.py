# app/api/sockets.py
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import json

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, conversation_id: str):
        await websocket.accept()
        if conversation_id not in self.active_connections:
            self.active_connections[conversation_id] = []
        self.active_connections[conversation_id].append(websocket)
        print(f"Cliente conectado a conversación {conversation_id}")

    def disconnect(self, websocket: WebSocket, conversation_id: str):
        if conversation_id in self.active_connections:
            self.active_connections[conversation_id].remove(websocket)
            if not self.active_connections[conversation_id]:
                del self.active_connections[conversation_id]
        print(f"Cliente desconectado de {conversation_id}")

    async def broadcast_message(self, conversation_id: str, message: dict):
        """Difunde un mensaje JSON a todos los clientes conectados a una conversación."""
        if conversation_id in self.active_connections:
            for ws in self.active_connections[conversation_id]:
                try:
                    await ws.send_text(json.dumps(message))
                except Exception:
                    pass

manager = ConnectionManager()
