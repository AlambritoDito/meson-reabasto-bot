# Hoja de decisiones del equipo

> Respuestas del equipo tal como las entregó. No se han corregido ni completado. Las tensiones entre respuestas están en `pendientes.md` para que el equipo decida.

Reto: **Reto 2 · Reabastecimiento** · Equipo: Equipo 3 · Integrantes: Alan Pérez Fernández, Santiago Vázquez Llanes, Santiago Pineda Sotelo y Julián González Lepe

## 1. Posibilidades
Tres posibles usos de un agente para este problema, y cuál escogió el equipo y por qué.

- Detectar automáticamente los insumos por debajo de su inventario mínimo.
- Generar propuestas de pedidos a proveedores.
- Predecir el consumo de insumos según la temporada.

«Elegimos generar propuestas de reabastecimiento a partir del inventario, ya que permite reducir el trabajo manual y anticipar faltantes sin quitarle al responsable el control sobre las compras.»

## 2. Problema
Qué falla de la operación busca resolver y qué se vio en la visita al restaurante que lo confirme.

«La detección tardía de faltantes y la dependencia de revisiones manuales para realizar pedidos. Durante la visita se identificó que el Mesón contrató un módulo de inventarios que permite exportar información a Excel, pero no cuenta con una API para integrarse directamente con otros sistemas.»

## 3. Indicador
Con qué número se sabría que el agente sirve y cuánto vale ese número ahora.

«El principal indicador será la cantidad de faltantes de insumos por semana. Como indicador secundario, se medirá el tiempo necesario para revisar el inventario y generar una propuesta de compra. Actualmente no contamos con una línea base cuantificada, por lo que se utilizarán datos simulados para demostrar el funcionamiento del agente.»

## 4. Usuario
La persona que lo usaría y en qué parte de su día.

«El encargado de inventarios o compras del Mesón utilizará el agente al inicio de su jornada, antes de realizar los pedidos a proveedores o cuando necesite consultar las existencias de algún insumo.»

## 5. Activación
Lo que tiene que pasar para que el agente empiece a trabajar.

«El agente se activa cuando el encargado envía un mensaje al bot de Telegram solicitando una revisión del inventario. A partir de esa solicitud, analiza las existencias y genera una propuesta de reabastecimiento cuando sea necesario.»

## 6. Permisos
Qué puede hacer sin pedir permiso, qué requiere el visto bueno de alguien y qué tiene prohibido.

| Autónomamente | Con autorización | No realiza |
|---|---|---|
| Consulta el inventario | Confirma propuestas de compra | Pagos |
| Identifica faltantes | Ajusta cantidades por temporada | Modificar mínimos y máximos |
| Calcula cantidades de reabastecimiento | Autoriza el pedido | Seleccionar nuevos proveedores |
| Redacta pedidos | | Compras sin autorización |

## 7. Datos
Con qué información trabaja, de dónde sale y quién la mantiene actualizada.

«El agente trabaja con un archivo Excel que contiene el nombre del insumo, existencias actuales, inventario mínimo, inventario máximo, unidad de medida y proveedor asignado. En una implementación real, esta información sería exportada del sistema de inventarios del Mesón y actualizada por el encargado. Para el prototipo se utilizarán datos ficticios.»

## 8. Responsables
Los papeles de cada persona: quién hace el trabajo, quién da la aprobación final, a quién se le pide opinión y a quién solo se le notifica.

| R (ejecuta) | A (aprueba) | C (consultado) | I (informado) |
|---|---|---|---|
| Agente de IA y encargado de inventarios | Responsable de compras del Mesón | Personal de cocina | Administrador del Mesón |

## 9. Canal
Por qué medio se comunica la gente con el agente.

«El agente funciona mediante un bot de Telegram, desde el cual el usuario puede consultar inventarios, solicitar propuestas de reabastecimiento y aprobar o rechazar pedidos, sin necesidad de instalar una aplicación adicional si ya utiliza Telegram.»

## 10. Alcance
Lo que esta primera versión no va a cubrir.

«Quedan fuera la integración directa con el sistema de inventarios del Mesón, la predicción de demanda, los pagos automáticos, el envío real de pedidos a proveedores y la actualización automática de existencias. El prototipo se enfoca en demostrar el flujo completo de consulta, análisis, propuesta y autorización humana.»

---

Decisión técnica adicional (Alan): la IA se usa por API oficial. Proveedor: OpenAI; modelo: `gpt-6-luna` (Responses API).
