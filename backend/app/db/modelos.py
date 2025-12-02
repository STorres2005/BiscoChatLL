# app/db/modelos.py
from __future__ import annotations
import datetime
import uuid
from sqlalchemy import Integer  
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
    Enum,
    UniqueConstraint,
    Index
)
from sqlalchemy.orm import relationship
from .base import Base

# -----------------------------
# USUARIOS
# -----------------------------
class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    telefono = Column(String(20), unique=True, nullable=False)
    nombre = Column(String(50), nullable=True)
    apellido = Column(String(50), nullable=True)

    # Presencia / perfil
    foto_perfil = Column(String(255), nullable=True)
    ultimo_estado = Column(String(100), default='Disponible')
    en_linea = Column(Boolean, default=False)
    ultima_conexion = Column(DateTime, nullable=True)

    verificado = Column(Boolean, default=False)  # verificación por OTP
    creado_en = Column(DateTime, default=func.now())

    # Relaciones
    contactos_creados = relationship(
        "Contacto",
        back_populates="creador_del_contacto",
        foreign_keys="Contacto.usuario_id",
        cascade="all, delete-orphan"
    )
    contactos_recibidos = relationship(
        "Contacto",
        back_populates="contacto_agregado",
        foreign_keys="Contacto.contacto_id",
        cascade="all, delete-orphan"
    )
    miembro_en_conversaciones = relationship(
        "MiembroConversacion",
        back_populates="usuario",
        cascade="all, delete-orphan"
    )
    mensajes_enviados = relationship(
        "Mensaje",
        back_populates="remitente",
        foreign_keys="Mensaje.remitente_id",
        cascade="all, delete-orphan"
    )
    mensajes_ocultos = relationship(
        "MensajeOculto",
        back_populates="usuario",
        cascade="all, delete-orphan"
    )
    estados_mensaje = relationship(
        "EstadoMensaje",
        back_populates="usuario",
        cascade="all, delete-orphan"
    )
    llamadas_creadas = relationship(
        "Llamada",
        back_populates="creador",
        foreign_keys="Llamada.creado_por",
        cascade="all, delete-orphan"
    )
    participaciones_en_llamadas = relationship(
        "ParticipanteLlamada",
        back_populates="usuario",
        cascade="all, delete-orphan"
    )
    sesiones_web = relationship(
        "SesionWeb",
        back_populates="usuario",
        cascade="all, delete-orphan"
    )


# -----------------------------
# CONTACTOS
# -----------------------------
class Contacto(Base):
    __tablename__ = "contactos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    contacto_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    alias = Column(String(100), nullable=True) 
    creado_en = Column(DateTime, default=func.now())

    creador_del_contacto = relationship(
        "Usuario",
        back_populates="contactos_creados",
        foreign_keys=[usuario_id]
    )
    contacto_agregado = relationship(
        "Usuario",
        back_populates="contactos_recibidos",
        foreign_keys=[contacto_id]
    )

    __table_args__ = (
        UniqueConstraint('usuario_id', 'contacto_id', name='uq_contacto_unico'),
        Index('ix_contactos_usuario', 'usuario_id'),
    )


# -----------------------------
# CONVERSACIONES
# -----------------------------
class Conversacion(Base):
    __tablename__ = "conversaciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    titulo = Column(String(200), nullable=True)
    es_grupo = Column(Boolean, default=False)
    creado_en = Column(DateTime, default=func.now())

    # 👇 NUEVO CAMPO para guardar quién la creó
    creador_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    # Relaciones
    creador = relationship("Usuario", backref="conversaciones_creadas", foreign_keys=[creador_id])
    miembros = relationship("MiembroConversacion", back_populates="conversacion", cascade="all, delete-orphan")
    mensajes = relationship("Mensaje", back_populates="conversacion", cascade="all, delete-orphan")
    llamadas = relationship("Llamada", back_populates="conversacion", cascade="all, delete-orphan")



class MiembroConversacion(Base):
    __tablename__ = "miembros_conversacion"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversacion_id = Column(UUID(as_uuid=True), ForeignKey("conversaciones.id"), nullable=False)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    creado_en = Column(DateTime, default=func.now())

    # 🔵 Indica si el usuario sigue siendo miembro
    activo = Column(Boolean, default=True, nullable=False)

    # 🆕 Fecha exacta cuando salió del grupo (para limitar historial)
    fecha_salida = Column(DateTime, nullable=True)

    usuario = relationship(
        "Usuario",
        back_populates="miembro_en_conversaciones",
        foreign_keys=[usuario_id]
    )

    conversacion = relationship(
        "Conversacion",
        back_populates="miembros",
        foreign_keys=[conversacion_id]
    )

    __table_args__ = (
        UniqueConstraint('conversacion_id', 'usuario_id', name='uq_miembro_unico'),
        Index('ix_miembros_conversacion_conv', 'conversacion_id'),
        Index('ix_miembros_conversacion_usuario_activo', 'usuario_id', 'activo'),
    )

# -----------------------------
# CONVERSACIONES OCULTAS (ELIMINAR CHAT SOLO PARA MÍ)
# -----------------------------
class ConversacionOculta(Base):
    __tablename__ = "conversaciones_ocultas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    conversacion_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversaciones.id", ondelete="CASCADE"),
        nullable=False
    )

    usuario_id = Column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False
    )

    creado_en = Column(DateTime, default=func.now())

    # Opcional: relaciones
    conversacion = relationship("Conversacion", foreign_keys=[conversacion_id])
    usuario = relationship("Usuario", foreign_keys=[usuario_id])

    __table_args__ = (
        UniqueConstraint(
            "conversacion_id",
            "usuario_id",
            name="uq_conversacion_oculta_unica"
        ),
        Index("ix_conversacion_oculta_usuario", "usuario_id"),
    )

# -----------------------------
# MENSAJES
# -----------------------------
class Mensaje(Base):
    __tablename__ = "mensajes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversacion_id = Column(UUID(as_uuid=True), ForeignKey("conversaciones.id"), nullable=False)
    remitente_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True)
    cuerpo = Column(Text, nullable=False)
    tipo = Column(String(20), default="normal")
    url_adjunto = Column(String(255), nullable=True)
    tipo_adjunto = Column(String(50), nullable=True)
    # 🔽 NUEVOS CAMPOS
    tamano_adjunto = Column(Integer, nullable=True)
    nombre_archivo = Column(String(255), nullable=True)
    editado_en = Column(DateTime, nullable=True)
    borrado_en = Column(DateTime, nullable=True)
    creado_en = Column(DateTime, default=func.now())
    mensaje_id_respuesta = Column(UUID(as_uuid=True), ForeignKey("mensajes.id"), nullable=True)

    conversacion = relationship("Conversacion", back_populates="mensajes", foreign_keys=[conversacion_id])
    remitente = relationship("Usuario", back_populates="mensajes_enviados", foreign_keys=[remitente_id])

    mensaje_respuesta = relationship(
        "Mensaje",
        remote_side=[id],
        back_populates="respuestas",
        foreign_keys=[mensaje_id_respuesta]
    )
    respuestas = relationship(
        "Mensaje",
        back_populates="mensaje_respuesta",
        cascade="all, delete-orphan",
        foreign_keys=[mensaje_id_respuesta]
    )

    mensajes_ocultos = relationship("MensajeOculto", back_populates="mensaje", cascade="all, delete-orphan")
    estados_mensaje = relationship("EstadoMensaje", back_populates="mensaje", cascade="all, delete-orphan")
    menciones = relationship("Mencion", back_populates="mensaje", cascade="all, delete-orphan")

    reacciones = relationship(
        "ReaccionMensaje",
        back_populates="mensaje",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index('ix_mensajes_conversacion_creado', 'conversacion_id', 'creado_en'),
    )


class Mencion(Base):
    __tablename__ = "menciones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mensaje_id = Column(UUID(as_uuid=True), ForeignKey("mensajes.id"), nullable=False)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    mensaje = relationship("Mensaje", back_populates="menciones", foreign_keys=[mensaje_id])
    usuario = relationship("Usuario", foreign_keys=[usuario_id])

    __table_args__ = (
        UniqueConstraint('mensaje_id', 'usuario_id', name='uq_mencion_unica'),
        Index('ix_menciones_mensaje', 'mensaje_id'),
    )


class MensajeOculto(Base):
    __tablename__ = "mensajes_ocultos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mensaje_id = Column(UUID(as_uuid=True), ForeignKey("mensajes.id"), nullable=False)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    mensaje = relationship("Mensaje", back_populates="mensajes_ocultos", foreign_keys=[mensaje_id])
    usuario = relationship("Usuario", back_populates="mensajes_ocultos", foreign_keys=[usuario_id])

    __table_args__ = (
        UniqueConstraint('mensaje_id', 'usuario_id', name='uq_mensaje_oculto_unico'),
    )


class EstadoMensaje(Base):
    __tablename__ = "estados_mensaje"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mensaje_id = Column(UUID(as_uuid=True), ForeignKey("mensajes.id"), nullable=False)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)

    # 👇 ENUM ALINEADO CON EL FRONT: enviado | entregado | leido
    estado = Column(
        Enum('pendiente', 'enviado', 'entregado', 'leido', name='estado_mensaje'),
        nullable=False,
        default='pendiente'
    )


    creado_en = Column(DateTime, default=func.now())

    mensaje = relationship("Mensaje", back_populates="estados_mensaje", foreign_keys=[mensaje_id])
    usuario = relationship("Usuario", back_populates="estados_mensaje", foreign_keys=[usuario_id])

    __table_args__ = (
        # 👇 Evita duplicar el mismo estado para el mismo mensaje y usuario
        Index('ix_estado_mensaje_mensaje', 'mensaje_id'),
    )



# -----------------------------
# LLAMADAS
# -----------------------------
class Llamada(Base):
    __tablename__ = "llamadas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversacion_id = Column(UUID(as_uuid=True), ForeignKey("conversaciones.id"), nullable=False)
    tipo = Column(Enum('voz', 'video', name='tipo_llamada'), nullable=False)
    estado = Column(Enum('iniciada', 'finalizada', 'fallida', name='estado_llamada'), default='iniciada')
    creado_por = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    iniciada_en = Column(DateTime, default=func.now())
    finalizada_en = Column(DateTime, nullable=True)

    participantes = relationship("ParticipanteLlamada", back_populates="llamada", cascade="all, delete-orphan")
    conversacion = relationship("Conversacion", back_populates="llamadas", foreign_keys=[conversacion_id])
    creador = relationship("Usuario", back_populates="llamadas_creadas", foreign_keys=[creado_por])


class ParticipanteLlamada(Base):
    __tablename__ = "participantes_llamada"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    llamada_id = Column(UUID(as_uuid=True), ForeignKey("llamadas.id"), nullable=False)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    unido_en = Column(DateTime, default=func.now())
    salido_en = Column(DateTime, nullable=True)

    llamada = relationship("Llamada", back_populates="participantes", foreign_keys=[llamada_id])
    usuario = relationship("Usuario", back_populates="participaciones_en_llamadas", foreign_keys=[usuario_id])

    __table_args__ = (
        UniqueConstraint('llamada_id', 'usuario_id', name='uq_participante_unico'),
    )

class ReaccionMensaje(Base):
    __tablename__ = "reacciones_mensaje"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    mensaje_id = Column(
        UUID(as_uuid=True),
        ForeignKey("mensajes.id", ondelete="CASCADE"),
        nullable=False
    )

    usuario_id = Column(
        UUID(as_uuid=True),
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        nullable=False
    )

    emoji = Column(String(20), nullable=False)  # 👈 soporta cualquier emoji

    creado_en = Column(DateTime, default=func.now())

    # Relaciones
    mensaje = relationship("Mensaje", back_populates="reacciones", foreign_keys=[mensaje_id])
    usuario = relationship("Usuario", foreign_keys=[usuario_id])

    __table_args__ = (
        UniqueConstraint(
            "mensaje_id",
            "usuario_id",
            name="uq_reaccion_unica"
        ),
        Index("ix_reacciones_mensaje_mensaje", "mensaje_id"),
    )

# -----------------------------
# OTP, QR y SESIONES WEB
# -----------------------------
class CodigoOTP(Base):
    __tablename__ = "codigos_otp"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    telefono = Column(String(20), nullable=False)
    codigo_hash = Column(String(128), nullable=False)  # hash del OTP
    expiracion = Column(DateTime, nullable=False)
    usado = Column(Boolean, default=False)
    intentos = Column(Integer, default=0)
    creado_en = Column(DateTime, default=func.now())

    __table_args__ = (
        Index('ix_otp_telefono', 'telefono'),
    )


class SesionQR(Base):
    __tablename__ = "sesiones_qr"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(String(255), unique=True, nullable=False)
    telefono = Column(String(20), nullable=True)  # se asigna al confirmar
    estado = Column(Enum('pendiente', 'confirmado', 'expirado', name='estado_qr'), default='pendiente')
    creado_en = Column(DateTime, default=func.now())
    expiracion = Column(DateTime, nullable=False)  # p. ej. ahora()+2min


class SesionWeb(Base):
    __tablename__ = "sesiones_web"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    usuario_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    token_sesion = Column(String(255), unique=True, nullable=False)
    agente = Column(String(255), nullable=True)  # user-agent opcional
    ip = Column(String(64), nullable=True)
    activo = Column(Boolean, default=True)
    fecha_inicio = Column(DateTime, default=func.now())
    fecha_expiracion = Column(DateTime, nullable=True)

    usuario = relationship("Usuario", back_populates="sesiones_web", foreign_keys=[usuario_id])

    __table_args__ = (
        Index('ix_sesion_web_usuario', 'usuario_id'),
    )
