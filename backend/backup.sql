-- PostgreSQL database dump compatible version
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET row_security = off;

-- === ENUM TYPES ===
CREATE TYPE public.estado_llamada AS ENUM ('iniciada', 'finalizada', 'fallida');
CREATE TYPE public.estado_mensaje AS ENUM ('enviado', 'entregado', 'leido');
CREATE TYPE public.estado_qr AS ENUM ('pendiente', 'confirmado', 'expirado');
CREATE TYPE public.tipo_llamada AS ENUM ('voz', 'video');

-- === TABLES ===
CREATE TABLE public.alembic_version (
    version_num varchar(32) PRIMARY KEY
);

CREATE TABLE public.usuarios (
    id uuid PRIMARY KEY,
    telefono varchar(20) UNIQUE NOT NULL,
    nombre varchar(50),
    apellido varchar(50),
    foto_perfil varchar(255),
    ultimo_estado varchar(100),
    en_linea boolean,
    ultima_conexion timestamp,
    verificado boolean,
    creado_en timestamp
);

CREATE TABLE public.codigos_otp (
    id uuid PRIMARY KEY,
    telefono varchar(20) NOT NULL,
    codigo_hash varchar(128) NOT NULL,
    expiracion timestamp NOT NULL,
    usado boolean,
    intentos int,
    creado_en timestamp
);

CREATE TABLE public.conversaciones (
    id uuid PRIMARY KEY,
    titulo varchar(200),
    es_grupo boolean,
    creado_en timestamp
);

CREATE TABLE public.contactos (
    id uuid PRIMARY KEY,
    usuario_id uuid NOT NULL,
    contacto_id uuid NOT NULL,
    creado_en timestamp,
    CONSTRAINT uq_contacto_unico UNIQUE (usuario_id, contacto_id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id),
    FOREIGN KEY (contacto_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.mensajes (
    id uuid PRIMARY KEY,
    conversacion_id uuid NOT NULL,
    remitente_id uuid NOT NULL,
    cuerpo text NOT NULL,
    url_adjunto varchar(255),
    tipo_adjunto varchar(50),
    editado_en timestamp,
    borrado_en timestamp,
    creado_en timestamp,
    mensaje_id_respuesta uuid,
    FOREIGN KEY (conversacion_id) REFERENCES public.conversaciones(id),
    FOREIGN KEY (remitente_id) REFERENCES public.usuarios(id),
    FOREIGN KEY (mensaje_id_respuesta) REFERENCES public.mensajes(id)
);

CREATE TABLE public.estados_mensaje (
    id uuid PRIMARY KEY,
    mensaje_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    estado public.estado_mensaje,
    creado_en timestamp,
    FOREIGN KEY (mensaje_id) REFERENCES public.mensajes(id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.menciones (
    id uuid PRIMARY KEY,
    mensaje_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    CONSTRAINT uq_mencion_unica UNIQUE (mensaje_id, usuario_id),
    FOREIGN KEY (mensaje_id) REFERENCES public.mensajes(id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.mensajes_ocultos (
    id uuid PRIMARY KEY,
    mensaje_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    CONSTRAINT uq_mensaje_oculto_unico UNIQUE (mensaje_id, usuario_id),
    FOREIGN KEY (mensaje_id) REFERENCES public.mensajes(id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.miembros_conversacion (
    id uuid PRIMARY KEY,
    conversacion_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    creado_en timestamp,
    CONSTRAINT uq_miembro_unico UNIQUE (conversacion_id, usuario_id),
    FOREIGN KEY (conversacion_id) REFERENCES public.conversaciones(id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.llamadas (
    id uuid PRIMARY KEY,
    conversacion_id uuid NOT NULL,
    tipo public.tipo_llamada NOT NULL,
    estado public.estado_llamada,
    creado_por uuid NOT NULL,
    iniciada_en timestamp,
    finalizada_en timestamp,
    FOREIGN KEY (conversacion_id) REFERENCES public.conversaciones(id),
    FOREIGN KEY (creado_por) REFERENCES public.usuarios(id)
);

CREATE TABLE public.participantes_llamada (
    id uuid PRIMARY KEY,
    llamada_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    unido_en timestamp,
    salido_en timestamp,
    CONSTRAINT uq_participante_unico UNIQUE (llamada_id, usuario_id),
    FOREIGN KEY (llamada_id) REFERENCES public.llamadas(id),
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

CREATE TABLE public.sesiones_qr (
    id uuid PRIMARY KEY,
    token varchar(255) UNIQUE NOT NULL,
    telefono varchar(20),
    estado public.estado_qr,
    creado_en timestamp,
    expiracion timestamp NOT NULL
);

CREATE TABLE public.sesiones_web (
    id uuid PRIMARY KEY,
    usuario_id uuid NOT NULL,
    token_sesion varchar(255) UNIQUE NOT NULL,
    agente varchar(255),
    ip varchar(64),
    activo boolean,
    fecha_inicio timestamp,
    fecha_expiracion timestamp,
    FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id)
);

-- === DATA SEED ===
INSERT INTO public.alembic_version (version_num) VALUES ('8890ddbc3e66');

INSERT INTO public.usuarios (id, telefono, nombre, apellido, foto_perfil, ultimo_estado, en_linea, ultima_conexion, verificado, creado_en) VALUES
('2bd35d01-b3a0-4541-aee7-0c8801660dcb', '0986170583', 'Santiago', 'López', NULL, 'Disponible', false, NULL, true, '2025-10-20 21:24:29.224943'),
('7d69ff00-e844-4221-a955-77fece922ccb', '0980750870', 'Rosa', 'Toapanta', NULL, 'Disponible', false, NULL, true, '2025-10-21 00:22:37.755537'),
('3f2b0c59-caa4-4a2a-9fd3-cb173d2890e0', '0962272005', 'Sebastian', 'Torres', NULL, 'Disponible', false, NULL, true, '2025-10-21 17:45:52.361939');

INSERT INTO public.conversaciones (id, titulo, es_grupo, creado_en) VALUES
('ccc3157a-3a1e-4439-a6a3-2b1a00a81510', 'Chat prueba con Rosa', false, '2025-10-21 11:25:19.31981');

INSERT INTO public.miembros_conversacion (id, conversacion_id, usuario_id, creado_en) VALUES
('268e15e4-c0f6-4d1e-a0b1-09aa81e3000a', 'ccc3157a-3a1e-4439-a6a3-2b1a00a81510', '2bd35d01-b3a0-4541-aee7-0c8801660dcb', '2025-10-21 11:25:19.31981');

-- END DUMP
