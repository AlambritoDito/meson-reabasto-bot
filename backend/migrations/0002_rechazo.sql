-- Rechazo humano de una versión de propuesta (hoja del equipo: «aprobar o rechazar pedidos»).
ALTER TABLE sessions ADD COLUMN rejected_version INTEGER;
