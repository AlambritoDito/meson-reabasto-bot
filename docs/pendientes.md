# Pendientes y supuestos por confirmar

Acompaña a `agente.md` (versión de entrega, 2026-11-25). Aquí se reúnen todos los supuestos y pendientes que se marcan en ese documento.

## Supuestos de la demo, por confirmar con el cliente

| # | Supuesto | Dónde (agente.md) |
|---|---|---|
| S1 | Cubre todos los insumos del archivo exportado, cada uno con su proveedor asignado | §1, §3 |
| S2 | Alerta si `existencia < mínimo` | §9 |
| S3 | Cantidad = `máximo − existencia`, redondeada hacia arriba, sin superar el máximo | §9 |
| S4 | Temporada: el encargado indica un porcentaje (global, por proveedor o por insumo), limitado a −50 %…+50 %, que se aplica solo tras confirmar y sin superar el máximo. Consecuencia: un ajuste al alza no aumenta lo que ya está topado | §3, §9 |
| S5 | La columna `costo` se pide porque la menciona el formato del reto; la hoja no la lista | §8 |
| S6 | Dato faltante o inválido: la fila se excluye y se señala, nunca se inventa; se aprueban solo las filas válidas («parcial explícita») | §8, §12 |
| S7 | Si el aprobador no responde, la propuesta queda sin aprobar y no ocurre nada más | §6, §12 |
| S8 | Desglose de la RACI por función a partir de la RACI general de la hoja, con un solo A por función | §6 |
| S9 | Reparto interno: el programa calcula y prepara el borrador con plantilla fija; la IA solo interpreta y explica | §3, §4 |
| S10 | Identidad «MesonBot», asistente automático de demostración; tono de tú, mensajes cortos, emojis moderados con significado fijo [confirmado por Alan] | §11, §13 |
| S11 | Paleta inspirada en la identidad pública del Mesón [confirmado por Alan como dirección; códigos exactos y uso de marca por confirmar con el cliente]. Tipografía del sistema. En Telegram la apariencia es nativa | §13 |
| S12 | Retención de 7 días, base local, `/borrar`; no se guardan nombre ni usuario | §8 |
| S13 | Exclusiones adicionales de la demo: porciones por platillo, OCR/voz, otros canales, datos reales, disponibilidad permanente | §15 |
| S14 | Cada insumo tiene un solo proveedor y una sola unidad; los mínimos y máximos del archivo son los vigentes | §8, §9 |
| S15 | Valor actual: no medido (sin línea base). Meta propuesta [supuesto de la demo, no medido, por confirmar con el cliente]: 0 faltantes críticos por semana y revisión del inventario con propuesta lista en menos de 10 minutos. No es un resultado ni una promesa; «faltante crítico» depende de P9 | §2, §14 |

## Pendientes: sin dato

| # | Pendiente | Dónde (agente.md) |
|---|---|---|
| P1 | Fórmula exacta del indicador y frecuencia de revisión (la meta quedó como supuesto S15) | §2, §14 |
| P2 | Si «encargado de inventarios o compras» y «responsable de compras» son la misma persona | §3 |
| P3 | Plazo de respuesta del aprobador | §6 |
| P4 | Hora exacta de exportación del inventario | §8 |
| P5 | Unidades, redondeos finales y pedidos en tránsito | §9 |
| P6 | Días y horarios en que cada proveedor recibe pedidos | §10 |
| P7 | Tiempos de entrega de cada proveedor | §10 |
| P8 | Proveedor que no surte o pedido parcial | §10, §12 |
| P9 | Faltante crítico y a quién se alerta | §12 |
| P10 | Formato definitivo del mensaje al proveedor | §11 |

## Tensiones de la hoja y cómo quedaron en la entrega

- **a) Columna «costo»:** se incluye como supuesto S5.
- **b) Activación:** la hoja dice «mensaje al bot». La entrega lo precisa como enviar el archivo exportado (o `/muestra`) [hoja, precisado].
- **c) Usuario frente a aprobador:** sigue abierto (P2).
- **d) Indicador sin línea base:** se mantiene; la meta numérica se añadió como supuesto S15. El objetivo cualitativo fue confirmado por Alan y la fórmula sigue pendiente (P1).
- **e) Temporada al alza topada por el máximo:** consecuencia documentada en S4.

## Operación de la demo (Alan)

- **Publicado:** repositorio <https://github.com/AlambritoDito/meson-reabasto-bot> y página <https://alambritodito.github.io/meson-reabasto-bot/>.
- **Bot:** corre en el equipo del responsable (el dueño del repositorio) solo durante las sesiones de demostración, hasta el 10 de diciembre de 2026. Después hay que revocar token y clave según `README.md`.
- **Gasto de IA:** el código limita a 1000 consultas totales (`MAX_AI_CALLS_TOTAL`), 3 por minuto y 20 por día por chat, y 300 por día en total. Se recomienda además un tope duro del proyecto en el panel del proveedor (US$5 aprobado por Alan); su configuración la confirma el responsable.
- **Horario de las sesiones:** sin dato.
- **Licencia:** MIT; titulares: los cuatro integrantes del Equipo 3 (ver `LICENSE`).
