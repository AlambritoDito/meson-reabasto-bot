# agente.md · MesonBot, agente de reabastecimiento

> **Versión de entrega · 2026-11-25.** Equipo 3 [según la descripción pública del bot] · Integrantes: pendiente de añadir por el equipo.

**Etiquetas.** Cada afirmación lleva su origen:

- **[hoja]**: respuesta del equipo en `hoja-decisiones.md`.
- **[confirmado por Alan]**: decisión confirmada el 2026-11-25.
- **[caso]**: consta en el enunciado del reto.
- **[supuesto]**: supuesto de la demo, por confirmar con el cliente. Si además está en el código se marca **[supuesto, implementado]**.
- **Pendiente: sin dato**: no hay información; no se inventa.

Todos los supuestos y pendientes se listan también en `pendientes.md`.

## 1. Propósito y alcance

MesonBot toma el inventario que exporta el sistema, detecta qué insumos quedaron por debajo de su nivel mínimo, arma una propuesta de compra separada por proveedor y deja listo el texto del pedido. La decisión de autorizarlo y de mandarlo al proveedor siempre es de una persona [caso].

- **Opción elegida [hoja]:** generar propuestas de reabastecimiento a partir del inventario, para reducir el trabajo manual y anticipar faltantes sin quitarle al responsable el control sobre las compras.
- **Objetivo [confirmado por Alan]:** automatizar la revisión del inventario y reducir retrabajos y pedidos de último momento.
- **Insumos y proveedores [supuesto]:** todos los insumos del archivo exportado, cada uno con su proveedor asignado.
- **Esta versión:** bot de Telegram con inventario 100 % ficticio. En la demo pública cada visitante tiene una sesión aislada y aprueba o rechaza solo su propia simulación. El bot no envía pedidos a nadie [hoja].

## 2. Problema, evidencia e indicador

- **Problema [hoja]:** detección tardía de faltantes y dependencia de revisiones manuales para hacer pedidos.
- **Evidencia [hoja]:** el módulo de inventarios contratado permite exportar a Excel, pero no tiene API para integrarse con otros sistemas.
- **Contexto [caso]:** los niveles mínimo y máximo de cada insumo los define el restaurante. La demanda sube o baja en ciertas épocas del año (periodos vacacionales, semanas de exámenes, eventos), y eso el agente no puede deducirlo solo: necesita que alguien se lo indique.
- **Indicador principal [hoja]:** cantidad de faltantes de insumos por semana.
- **Indicador secundario [hoja]:** tiempo necesario para revisar el inventario y generar una propuesta de compra.
- **Línea base [hoja]:** no hay línea base cuantificada; se usan datos simulados.
- **Meta numérica:** Pendiente: sin dato. El objetivo cualitativo es el de la sección 1 [confirmado por Alan].

La demo usa datos ficticios y no mide ni acredita mejoras reales.

## 3. Actores y roles

| Actor | Papel | Origen |
|---|---|---|
| Encargado de inventarios | Usa el agente al inicio de su jornada, antes de pedir a proveedores o para consultar existencias; envía el archivo exportado; actualiza el inventario; indica el ajuste por temporada | [hoja]; ajuste por temporada [supuesto] |
| Responsable de compras | Aprueba o rechaza la propuesta con los botones de Telegram (A) | [hoja] |
| Personal de cocina | Consultado (C) | [hoja] |
| Administrador | Informado (I) | [hoja] |
| Cliente (restaurante) | Fija mínimos y máximos por insumo | [caso] |
| Proveedores | Reciben el pedido que envía una persona | [caso]; cuáles: los del archivo [supuesto] |
| Agente (programa + IA) | Lee, compara, calcula, propone, explica, prepara el borrador y registra | [hoja]; reparto programa/IA [supuesto, implementado] |
| Visitante de la demo | Prueba con datos ficticios; aprueba o rechaza solo su simulación; no adquiere permisos de operador | [supuesto, implementado] |

Si «encargado de inventarios o compras» [hoja] y «responsable de compras» [hoja] son la misma persona: Pendiente: sin dato (ver `pendientes.md`).

## 4. Funciones del agente

| Función | Quién la realiza | Origen |
|---|---|---|
| **Lee** el inventario (CSV/XLSX o `/muestra`) | Programa | [supuesto, implementado] |
| **Valida** columnas y datos (vacíos, no numéricos, negativos, mínimo > máximo, duplicados) | Programa | [supuesto, implementado] |
| **Compara** existencia contra mínimo e **identifica** faltantes | Programa | [hoja] |
| **Calcula** cantidades y **agrupa** por proveedor | Programa | [hoja] |
| **Alerta** insumos bajo mínimo y datos faltantes, con fila y campo | Programa | [supuesto, implementado] |
| **Interpreta** texto libre (clasifica la intención en una lista cerrada; la salida se valida) | IA | [supuesto, implementado] |
| **Explica** por qué entra cada insumo, solo con cifras del programa | IA | [supuesto, implementado] |
| **Redacta** el borrador del pedido (archivo de texto) | Programa, con plantilla fija; la IA no interviene | [hoja] redacta pedidos; plantilla [supuesto, implementado] |
| **Registra** versiones, ajustes, aprobaciones y rechazos | Programa | [supuesto, implementado] |

## 5. Permisos: hace solo, con autorización, no hace

| Nivel | Acciones | Origen |
|---|---|---|
| Hace solo | Consulta el inventario; identifica faltantes; calcula cantidades de reabastecimiento; redacta pedidos | [hoja] |
| | Valida el archivo, alerta datos faltantes, explica, registra historial | [supuesto, implementado] |
| Con autorización de una persona | Confirma propuestas de compra; ajusta cantidades por temporada; autoriza el pedido | [hoja] |
| No hace nunca | Pagos; modificar mínimos y máximos; seleccionar nuevos proveedores; compras sin autorización | [hoja] |
| | Enviar el pedido al proveedor (fuera de alcance [hoja]); inventar cantidades o datos faltantes | [supuesto, implementado] |

## 6. Matriz RACI

RACI general **[hoja]**: R = agente de IA y encargado de inventarios; A = responsable de compras; C = personal de cocina; I = administrador.

Desglose por función **[supuesto]**, con un solo A por función:

| Función | R | A | C | I |
|---|---|---|---|---|
| Exportar y enviar el inventario al bot | Encargado de inventarios | Responsable de compras | — | — |
| Comparar y calcular la propuesta | Agente (programa) | Responsable de compras | — | Encargado de inventarios |
| Ajuste por temporada | Encargado de inventarios | Responsable de compras | Personal de cocina | Administrador |
| Aprobar o rechazar el pedido | Responsable de compras | Responsable de compras | Personal de cocina | Administrador |
| Preparar el borrador | Agente (programa, plantilla) | Responsable de compras | — | Encargado de inventarios |
| Enviar el pedido al proveedor | Una persona (fuera del bot) | Responsable de compras | — | Administrador |
| Fijar mínimos y máximos | Cliente [caso] | Cliente | Responsable de compras | Encargado de inventarios |

**Autorización:** el responsable de compras aprueba o rechaza con los botones «Aprobar» / «Rechazar» en Telegram [hoja]. Si no responde, la propuesta queda sin aprobar y no ocurre nada más [supuesto]. Plazo de respuesta: Pendiente: sin dato.

## 7. Flujo paso a paso

Secuencia general del reto [caso]: se exporta el inventario, se detectan los insumos bajo su mínimo, se arma una propuesta, una persona la autoriza y el pedido llega al proveedor.

**Activación [hoja, precisado]:** el encargado envía al bot el archivo exportado (en la demo, también `/muestra`) para pedir la revisión.

1. El encargado abre el bot (`/start`) y envía el archivo CSV/XLSX o usa `/muestra`.
2. El programa valida y señala por fila y campo los datos faltantes o inválidos.
3. El programa marca los insumos bajo mínimo, calcula las cantidades y las agrupa por proveedor.
4. Opcional: `/explicar` o texto libre; la IA explica con las cifras calculadas.
5. Opcional: `/temporada` con un porcentaje; el bot muestra antes y después y aplica el ajuste solo si se confirma. Cada ajuste crea una nueva versión e invalida una aprobación anterior.
6. `/aprobar` muestra la propuesta vigente con los botones **Aprobar** y **Rechazar**.
7. Si se aprueba, el bot envía el borrador como archivo de texto (también con `/borrador`). Si se rechaza, no genera borrador y sugiere ajustar o cargar otro inventario.
8. Una persona revisa el borrador y, si procede, lo envía al proveedor por su cuenta.
9. `/historial` muestra versiones, ajustes, aprobaciones y rechazos; `/borrar` elimina la sesión.

Recepción del pedido y actualización de existencias: fuera de alcance [hoja].

## 8. Datos: columnas, origen y frecuencia

- **Columnas [hoja]:** insumo, unidad, existencia, mínimo, máximo, proveedor.
- **Costo [supuesto]:** el bot también pide `costo`, porque lo menciona el formato del reto; la hoja no lo lista. Encabezados exactos: `insumo, unidad, existencia, minimo, maximo, proveedor, costo`.
- **Origen [hoja]:** archivo Excel exportado del sistema de inventarios y actualizado por el encargado. En la demo se usan archivos ficticios.
- **Muestra:** `fixtures/inventario-muestra.csv`, con 20 insumos ficticios de 5 proveedores ficticios, 6 bajo mínimo y 1 sin proveedor.
- **Frecuencia [hoja]:** al inicio de la jornada del encargado o cuando necesite consultar. Hora exacta de exportación: Pendiente: sin dato.
- **Dato faltante o inválido [supuesto, implementado]:** la fila se excluye y se señala con fila y campo, y nunca se inventa el valor. Se aprueban solo las filas válidas («parcial explícita»).
- **Resguardo [supuesto, implementado]:** base de datos local en el equipo que corre la demo, separada por chat. Retención de 7 días, `/borrar` disponible, sin guardar nombre ni usuario de Telegram. Se envían a la API de OpenAI el texto del usuario (hasta 500 caracteres) y las cifras del pedido calculado.

## 9. Reglas de negocio: alerta, cantidad y ajuste por temporada

Todas son **[supuesto, implementado]**, por confirmar con el cliente.

- **Alerta:** el insumo entra al pedido si `existencia < mínimo`.
- **Cantidad:** `cantidad = máximo − existencia`, redondeada hacia arriba a la unidad. Nunca supera el máximo.
- **Temporada:** el encargado indica un porcentaje (global, por proveedor o por insumo), limitado a −50 % … +50 %. Solo se aplica tras confirmarlo. El resultado se redondea hacia arriba y nunca supera `máximo − existencia`.
- Unidades, redondeos finales y pedidos en tránsito: Pendiente: sin dato.

**Ejemplo numérico** (filas reales de `fixtures/inventario-muestra.csv`, datos ficticios):

| Insumo | Existencia | Mínimo | Máximo | ¿Alerta? | Cantidad |
|---|---:|---:|---:|---|---:|
| Leche entera | 8 | 20 | 60 | Sí (8 < 20) | 60 − 8 = **52** |
| Azucar | 10 | 10 | 30 | No (10 no es < 10) | 0 |
| Jitomate | 3 | 8 | 20 | Sí (3 < 8) | 20 − 3 = **17** |
| Vasos desechables | 6 | 4 | 15 | — | Fila excluida: proveedor vacío |

Temporada sobre Jitomate:

- Con −20 %: 17 × 0.8 = 13.6 → **14**.
- Con +20 %: 17 × 1.2 = 20.4 → 21, pero el tope es 17 → **17**.

**Consecuencia:** como la cantidad base ya llega al máximo, un ajuste al alza no aumenta lo que ya está topado; solo los ajustes a la baja cambian el pedido.

## 10. Proveedores: agrupación, horarios y tiempos de entrega

- **Agrupación [supuesto, implementado]:** por la columna `proveedor` del archivo. Un insumo sin proveedor se señala y no se asigna a ninguno.
- **Elección de proveedor [hoja]:** el agente no selecciona proveedores nuevos.
- Días y horarios en que cada proveedor recibe pedidos: Pendiente: sin dato.
- Tiempos de entrega: Pendiente: sin dato.
- Proveedor que no surte o pedido parcial: Pendiente: sin dato.

## 11. Mensajes tipo y tono de voz

- **Identidad [supuesto]:** «MesonBot» (nombre visible del bot en Telegram). En `/start` se presenta como asistente automático de demostración.
- **Tono [supuesto]:** de tú, mensajes cortos, sin emojis.
- **Borrador al proveedor [supuesto, implementado]:** archivo `borrador-pedido-vN.txt` generado con plantilla fija.
  - Encabezado «BORRADOR DE PEDIDO — DEMOSTRACIÓN CON DATOS FICTICIOS» y aviso de que el bot no envía nada.
  - Por proveedor: «PARA:», saludo, insumos con cantidad, unidad, costo unitario y subtotal, y petición de confirmar disponibilidad y fecha.
  - Al final: total, filas excluidas e historial.
  - Canal de envío real: lo decide la persona que envía. Formato definitivo: Pendiente: sin dato.
- **Mensajes tipo [supuesto, implementado]**, textuales del código:
  - Bienvenida: «Hola. Soy un asistente automático de DEMOSTRACIÓN para reabastecimiento con datos ficticios. […] Tú apruebas; yo nunca envío nada a proveedores.»
  - Datos inválidos: «Filas excluidas por datos inválidos (N); no invento valores:» y luego fila y campo.
  - Sin faltantes: «Ningún insumo válido está bajo su mínimo. No propongo compras.»
  - Aprobación: «Aprobaste la propuesta vN. Te envío el borrador. Recuerda: yo no envío nada a proveedores; tú decides si lo mandas.»
  - Rechazo: «Rechazaste la propuesta vN. No genero borrador. Para una nueva propuesta: ajusta con /temporada, carga /muestra o sube otro inventario.»
  - Límite: «(sin IA) Llegaste al límite de IA (…). Usa los comandos: /ayuda»

## 12. Casos difíciles y escalamiento

| Caso | Respuesta | Origen |
|---|---|---|
| Dato requerido vacío | Fila excluida y señalada; no se inventa ni se aprueba como válida | [supuesto, implementado] |
| Existencia negativa o no numérica, mínimo > máximo, duplicado | Fila marcada como inválida con fila y campo | [supuesto, implementado] |
| Insumo sin proveedor | Se señala; no se agrupa ni se inventa proveedor | [supuesto, implementado] |
| Instrucciones dentro de celdas | Se tratan como datos; la salida de la IA se valida; las celdas que empiezan con = + - @ se neutralizan | [supuesto, implementado] |
| IA agotada o con error | Plantilla «(sin IA)»; cálculo, aprobación y borrador siguen funcionando | [supuesto, implementado] |
| Pedido rechazado | Se registra el rechazo y no se genera borrador; se puede ajustar o cargar otro inventario | [hoja] aprobar o rechazar; comportamiento [supuesto, implementado] |
| Sin respuesta del aprobador | La propuesta queda sin aprobar; no ocurre nada más | [supuesto] |
| Petición fuera de alcance | Rechazo breve, sin acción | [supuesto, implementado] |
| Proveedor que no surte | — | Pendiente: sin dato |
| Faltante crítico y a quién se alerta | — | Pendiente: sin dato |

## 13. Interfaz: canal, pantallas, identidad, colores y tipografía

- **Canal [hoja]:** bot de Telegram para consultar inventarios, solicitar propuestas y aprobar o rechazar pedidos, sin instalar otra aplicación. Usuario: `@mesondemobot`. Página explicativa con QR en `site/`.
- **Disponibilidad [confirmado por Alan]:** el bot corre en el equipo del responsable solo durante las sesiones de demostración, hasta el 10 de diciembre de 2026.
- **Vistas en el chat [supuesto, implementado]:**
  - carga del inventario;
  - alertas y datos faltantes;
  - propuesta por proveedor;
  - ajuste por temporada con confirmación;
  - aprobación o rechazo con botones;
  - borrador descargable;
  - historial.
- **Identidad [supuesto]:** «MesonBot», asistente automático de demostración.
- **Colores [confirmado por Alan como dirección; códigos exactos y uso de marca por confirmar con el cliente]:** paleta inspirada en la identidad pública del Mesón.
  - Terracota `#b5501a` en bloques con texto blanco, y `#a3440f` en botones.
  - Crema `#f6efe4` de fondo, carbón cálido `#3f3a36` para texto y café `#5a3a25` en títulos.
  - Dorado `#e7b55a` solo decorativo.
  - Hay modo oscuro.
  - No se usan logotipos, fotos, iconos ni lemas del Mesón. La página aclara que es un proyecto académico independiente y no un sitio oficial.
- **Tipografía [supuesto]:** fuentes del sistema, sin fuentes externas. Titulares gruesos con `ui-rounded` y respaldo; texto base de 17 px.
- **Objetivos de diseño:** contraste de nivel AA; alertas con texto e icono, no solo color.
- **Límite de lo controlable:** en Telegram la fuente, los colores, el tema y las burbujas son nativos de la aplicación de cada persona. El bot solo controla texto, botones y archivos.

## 14. Indicadores de seguimiento

- **Principal [hoja]:** faltantes de insumos por semana.
- **Secundario [hoja]:** tiempo de revisión del inventario y de generación de la propuesta.
- **Línea base [hoja]:** no cuantificada.
- **Meta numérica, fórmula exacta y frecuencia de revisión:** Pendiente: sin dato.
- La demo no produce indicadores reales. Los conteos de uso de IA sirven solo para operar los límites.

## 15. Fuera de alcance

Definido por el equipo [hoja]:

- Integración directa con el sistema de inventarios.
- Predicción de demanda.
- Pagos automáticos.
- Envío real de pedidos a proveedores.
- Actualización automática de existencias.

El prototipo se enfoca en demostrar el flujo de consulta, análisis, propuesta y autorización humana [hoja].

Además, en esta demo [supuesto]:

- Porciones por platillo.
- Lectura de fotos, OCR o voz.
- Otros canales y multiempresa.
- Datos reales o personales.
- Disponibilidad permanente.
