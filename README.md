# meson-reabasto-bot · Bot de reabastecimiento (demo con datos ficticios)

Bot de Telegram de demostración para el reabastecimiento de un restaurante, hecho como proyecto escolar. Revisa un inventario **100 % ficticio** contra mínimos, propone un pedido agrupado por proveedor y genera un borrador descargable del mensaje. Una persona ajusta por temporada, aprueba y es quien enviaría el pedido: **el bot nunca envía pedidos**.

- Bot de la demo: [t.me/mesondemobot](https://t.me/mesondemobot). Solo responde durante las sesiones de demostración (hasta el 10 de diciembre de 2026), mientras corre en el equipo de la persona responsable. Fuera de ellas el chat abre, pero no hay respuesta.
- Página explicativa: `site/` (para GitHub Pages; URL pendiente).
- Documentación del agente: `docs/` (`agente.md` en versión de entrega del 2026-11-25; supuestos y pendientes en `docs/pendientes.md`).

Este README está pensado para que cualquiera lo reproduzca en su computadora, a mano o con un asistente de programación (por ejemplo Claude Code o Codex): los pasos son comandos explícitos y no hay servicios ocultos.

## Reparto de responsabilidades

| Parte | Hace | No hace |
|---|---|---|
| Programa (código) | Valida el archivo, compara existencia contra mínimo, calcula cantidades, agrupa por proveedor, genera el borrador con una plantilla fija, aplica límites, guarda estados e historial | Decidir por la persona |
| IA (OpenAI por API oficial con clave, modelo `gpt-6-luna`) | Clasifica la intención del texto libre (lista cerrada) y explica la propuesta con las cifras del programa | Calcular o cambiar cantidades, aprobar, escribir el borrador, enviar |

> **La conexión real con la IA aún no está verificada; si no responde, verás plantillas «(sin IA)».** Los cálculos, la aprobación y el borrador no dependen de la IA.
| Persona | Informa la temporada, revisa, aprueba o rechaza con botones, y enviaría el pedido | — |

La regla de cálculo es una **propuesta para la demo, no política confirmada del restaurante**: un insumo entra al pedido si `existencia < mínimo`; cantidad = `máximo − existencia`, redondeada hacia arriba; el ajuste por temporada (−50 % a +50 %, global, por proveedor o por insumo) se redondea hacia arriba y nunca supera el máximo. Está en `backend/src/config.ts` y `backend/src/engine.ts`.

Si la IA no está configurada, falla o se agota el cupo, el bot sigue funcionando con plantillas marcadas «(sin IA)».

## Arquitectura

```
 Tu teléfono (Telegram)                     Página estática (GitHub Pages, opcional)
        │  mensajes, archivos CSV/XLSX        site/: explicación + QR + enlace
        ▼
 API de Telegram  ◄── long polling (getUpdates) ──  Poller local (en tu computadora)
                                                       │ reenvía cada update
                                                       ▼
                                          wrangler dev (runtime local, TypeScript)
                                            ├─ deduplica el update
                                            ├─ lee CSV/XLSX con límites de tamaño
                                            ├─ motor de reglas (cálculo determinista)
                                            ├─ límites de uso de IA
                                            ├──► D1 local (SQLite en disco): sesiones,
                                            │     inventarios, pedidos, historial, uso
                                            └──► API de OpenAI (Responses API): clasifica y explica
```

El poller es `backend/scripts/poll.mjs`: es el único consumidor de `getUpdates`, reenvía cada update a `POST /tg` del Worker local con el encabezado de `WEBHOOK_SECRET` y solo avanza cuando el Worker responde 2xx. `npm run demo` (`backend/scripts/demo.mjs`) aplica migraciones, levanta `wrangler dev` en `127.0.0.1:8787` y arranca el poller.

No hay servidor permanente: el bot existe mientras el proceso corre. Al cerrarlo, deja de responder. El token y la clave viven solo en `backend/.dev.vars` (ignorado por Git); nunca en la página, el QR, el repositorio ni los mensajes de error.

## Requisitos

- Node.js: requiere Node ≥ 22.13, y npm.
- Git.
- Telegram en el teléfono y un **bot propio** creado con @BotFather (`/newbot`), que te da su token. No reutilices el token de otro bot ni el de la demo.
- Una **clave de API de OpenAI** de un proyecto con **tope duro de gasto** configurado en el panel de OpenAI. Las consultas se cobran por uso a quien pone la clave. El bot usa el modelo `gpt-6-luna` mediante la Responses API; se cambia con `OPENAI_MODEL` en `.dev.vars`.
  La conexión real con la IA aún no está verificada; si no responde, verás plantillas «(sin IA)».
- No hace falta cuenta de Cloudflare para correrlo en local.

## Arranque local

```bash
git clone https://github.com/AlambritoDito/meson-reabasto-bot.git
cd meson-reabasto-bot/backend
npm ci

cp .dev.vars.example .dev.vars
# Edita .dev.vars (ignorado por Git):
#   TELEGRAM_BOT_TOKEN=        token de tu bot de @BotFather (obligatorio)
#   OPENAI_API_KEY=            tu clave de OpenAI con tope de gasto (sin ella, el bot responde «sin IA»)
#   WEBHOOK_SECRET=            cadena aleatoria larga; la usan el poller y el Worker local entre sí (obligatorio)
#   OPENAI_MODEL=gpt-6-luna    (obligatorio; vacío = sin IA)
#   OPENAI_REASONING_EFFORT=low
#   DEMO_UNTIL=2026-12-10      fecha fin de la demo (hasta el final de ese día, hora de CDMX; obligatorio)
#   MAX_AI_CALLS_TOTAL=1000    tope total de consultas a la IA de toda la demo

npm test                            # suite automatizada (no consume IA)
npm run typecheck
npm run e2e:local                   # recorrido local con un Telegram FALSO y sin IA (no contacta servicios reales)
npm run demo                        # aplica migraciones D1 locales, levanta wrangler dev y el poller
```

Con la demo encendida, abre tu bot en Telegram, escribe `/start` y luego `/muestra`. `/aprobar` muestra los botones «Aprobar» y «Rechazar»: aprobar envía el borrador como archivo de texto; rechazar lo registra y no genera borrador.

Solo un proceso puede leer las actualizaciones de un bot a la vez: `npm run demo` se niega a arrancar si ya hay otra demo registrada, y el poller elimina cualquier webhook previo del bot al iniciar. `npm run db:migrate:local` aplica las migraciones por separado si lo necesitas.

## Apagado

- **Al terminar cada sesión:** `Ctrl+C` en la terminal de `npm run demo`. El bot deja de responder de inmediato. Si la terminal se cerró o quedó algo vivo: `npm run stop` (desde `backend/`).
- **Al terminar el proyecto** (la demo pública termina el 10 de diciembre de 2026):
  1. Revoca el token en @BotFather (`/revoke`) o elimina el bot (`/deletebot`).
  2. Revoca la clave de API en la consola de OpenAI.
  3. Borra la base local `backend/.wrangler/state/` y el archivo `backend/.dev.vars`.
  4. Actualiza la página para indicar que la demo terminó, o despublícala.

## Límites de la demo

| Límite | Valor |
|---|---|
| Consultas a la IA por chat | 3 por minuto, 20 por día |
| Consultas a la IA en total | 300 por día |
| Archivos por chat | 5 por día |
| Archivos | `.csv` o `.xlsx`; máximo 200 KB y 500 filas; XLSX máximo 4 MB descomprimido |
| IA por consulta | entrada recortada a 4000 caracteres (el texto del usuario a 500); salida máxima 800 tokens; espera máxima 20 s |
| Consultas a la IA en toda la demo | 1000 (`MAX_AI_CALLS_TOTAL`) |
| Retención de datos | 7 días; `/borrar` elimina antes |
| Ajuste por temporada | entre −50 % y +50 %, sin superar el máximo |

Los cupos diarios (por chat, global y de archivos) se cuentan por **día UTC**: se reinician a las 00:00 UTC (18:00 en Ciudad de México). El límite por minuto es una ventana de un minuto.

La retención es «perezosa»: en local no hay tareas programadas, así que lo que tiene más de 7 días se elimina al procesar el siguiente update. Si nadie escribe, los datos quedan en la base local hasta que llegue actividad o se borre la base.

Los límites están en `backend/src/config.ts`. Si un dato requerido falta o es inválido, el bot señala fila y campo y no inventa valores. Política implementada: **parcial explícita** — esas filas se excluyen y se listan, y solo se aprueban las filas válidas (la alternativa «bloquear» existe en el código pero no es la predeterminada; la decisión final es del equipo).

## Costos

- **IA:** OpenAI cobra por uso a quien pone la clave. Consulta las tarifas vigentes en la [página oficial de precios de OpenAI](https://openai.com/api/pricing/) antes de usar; pueden cambiar.
  - **Estimación del proyecto (no es gasto medido):** unos US$0.18 por 300 llamadas cortas, que es el límite diario global del código.
  - El código limita el número de consultas y el largo de las respuestas; el **tope duro de gasto por proyecto** en el panel de OpenAI es la protección final. Configúralo antes de arrancar.
  - Tope de gasto de la demo pública aprobado por Alan: **US$5 en total**, como tope duro del proyecto en el panel de OpenAI, más `MAX_AI_CALLS_TOTAL=1000` en el código. Gasto estimado ≈ US$0.18 (estimación, no gasto medido).
- **Telegram Bot API:** sin costo.
- **Ejecución local:** sin costo de hosting; el bot depende de que tu computadora esté encendida y conectada.
- **GitHub Pages:** sin costo para repositorios públicos.

## Responsable operativo de la demo pública

Responsable operativo: el dueño del repositorio enciende y apaga la demo en su equipo.

## Privacidad

- Usa solo datos ficticios. Tu texto (máx. 500 caracteres) y los datos del pedido calculado, incluidos nombres de insumos y proveedores, cifras y filas excluidas, se envían a la API de OpenAI para clasificar la intención y generar explicaciones. El borrador no pasa por la IA.
- Se guarda en la base local de quien corre el bot: identificador numérico del chat, inventarios cargados, pedidos calculados, ajustes, aprobaciones y conteo de uso. No se pide teléfono ni nombre.
- Retención: 7 días (limpieza al procesar el siguiente update). `/borrar` elimina los datos de la sesión. No se guardan nombre ni usuario de Telegram.
- Cada chat tiene su sesión aislada; aprobar solo afecta la simulación propia.
- La página no usa cookies, rastreadores ni recursos externos.

## Estructura

```
backend/    runtime local (wrangler), motor de reglas, migraciones D1, poller y pruebas
fixtures/   inventarios ficticios de muestra y de prueba
site/       página estática publicada en GitHub Pages (solo index.html, estilos.css, qr.svg)
tools/sitio/ script para configurar la página y generar el QR; ver docs/sitio.md
docs/       agente.md, configuración, registro de pruebas, pendientes, hoja de decisiones, sitio.md
```

## Nota opcional: despliegue en Cloudflare (no probado)

El código corre sobre el runtime de Cloudflare Workers, así que en principio podría desplegarse con `wrangler deploy`, una base D1 remota, *secrets* y un webhook de Telegram en lugar del poller. **Esta ruta no se ha probado ni se usa en la demo**; si alguien la sigue, debe revisar las cuotas de Cloudflare, autenticar el webhook con un secreto y eliminar el webhook (`deleteWebhook`) y el Worker (`wrangler delete`) al terminar.

## Licencia

MIT. Ver `LICENSE`. Los datos de `fixtures/` son inventados. Las dependencias conservan sus propias licencias (SheetJS, Apache-2.0; wrangler, vitest y typescript, las suyas).
