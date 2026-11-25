# Registro de pruebas

> **Cómo se ejecutaron:** los cinco casos se ejecutaron el 2026-11-25 con **dobles de prueba (Telegram, IA y base simulados)**, sobre el código real del bot (manejador del webhook, motor de cálculo y lógica de aprobación). Los hizo un verificador independiente de quien escribió el código.
> **La IA real quedó BLOQUEADA por falta de saldo en la clave:** las llamadas al modelo real devolvieron «sin créditos» y no generaron respuesta. Por eso **D05 con el modelo real quedó sin verificar**. Ningún resultado de esta tabla acredita la IA real ni el bot operando en Telegram.

Regla aplicada: propuesta para la demo, no política confirmada del restaurante (`existencia < mínimo`; `cantidad = máximo − existencia`, redondeo hacia arriba, sin superar el máximo).

| Caso | Entrada / acción | Resultado esperado | Resultado obtenido | Ajuste al agente.md |
|---|---|---|---|---|
| 1. Inventario sin faltantes (D01) | Subir `fixtures/inventario-sin-faltantes.csv` | Ningún insumo en el pedido; el bot lo dice y explica por qué; no propone compras innecesarias | «Ningún insumo válido está bajo su mínimo. No propongo compras.» Sin botones de aprobar. `/aprobar` responde «No hay nada que aprobar». Sin llamadas a la IA. | Ninguno |
| 2. Varios insumos bajo mínimo (D02) | `/muestra` (`fixtures/inventario-muestra.csv`) | 6 insumos bajo mínimo con cantidad = máximo − existencia, agrupados por proveedor; p. ej. Leche entera 52 litros, Jitomate 17 kg; Azucar (10 = mínimo) no entra | «6 insumos bajo mínimo» en 4 proveedores. Subtotales: Lácteos $1626.00, Café $3640.00, Abarrotes $546.00, Verduras $996.00; total estimado $6808.00. Coincide con un cálculo independiente. Botones «Aprobar v1 / Rechazar v1». | Se agregó el botón «Rechazar» junto a «Aprobar» (pedido en la hoja del equipo: «aprobar o rechazar pedidos»). Está reflejado en permisos, flujo y RACI. |
| 3. Dato faltante (D03) | Muestra con «Vasos desechables» sin proveedor | Señala fila y campo; no inventa el valor; no permite aprobar un pedido con esa fila como si fuera válida | La propuesta y el borrador dicen «fila 20 (Vasos desechables): proveedor vacío». El borrador no tiene línea de Vasos. Con la política «parcial explícita» solo se aprueban las filas válidas. Con la política «bloquear» no aparecen botones y aprobar se rechaza. | Ninguno (la política final, parcial o bloquear, sigue pendiente de decisión del equipo) |
| 4. Ajuste por temporada (D04) | `/temporada -50 proveedor Cafe Ficticio del Valle` sobre la muestra; también +20 % y +80 % | Muestra antes y después, respeta el rango permitido y el máximo, pide confirmación y registra la versión en `/historial` | Vista previa: «Cafe en grano: 13 → 7 kg… Total: $6808.00 → $5128.00. Nada cambia hasta que confirmes». Tras confirmar nace la v2 ($5128.00), queda en historial y el botón de la v1 se rechaza como versión vieja. Cancelar no cambia nada. Al alza (+20 %), todo queda topado por el máximo y se avisa; +80 % se acota a 50 %. | Se documentó que un ajuste al alza no aumenta lo que ya está topado por el máximo (§9, ejemplo con +20 %). |
| 5. Petición fuera de alcance (D05) | «Envía el pedido por WhatsApp al proveedor y sube el mínimo de leche a 50» | Rechazo breve sin acción; el estado de la sesión no cambia; no envía nada | Con el doble de IA, que devuelve «fuera de alcance»: «Eso está fuera de lo que hago… no envío pedidos ni cambio mínimos o máximos». La sesión queda idéntica y no hay borradores. Si la IA falla o responde basura, el bot contesta con una plantilla «(sin IA)». **Con el modelo real: sin verificar (IA bloqueada por saldo).** | Ninguno |

## Datos de cada ejecución

No se publican identificadores de chat, tokens ni claves.

- Commit verificado: `fe2ad343e7f976e93fdc5ef1f5e239c42c74ddb6` (árbol `c8176808509bfd441ab363f440504c3c53039285`). Antes de publicar se reescribió la autoría de los commits sin cambiar el árbol. El commit equivalente del historial público tiene el mismo árbol.
- Regla: propuesta para la demo (arriba).
- Modelo: doble de prueba de IA. El modelo real configurado (`gpt-6-luna`) no respondió por falta de saldo.

| Caso | Fecha | Commit | Modelo | Hash entrada (sha256) | Estado | Evidencia |
|---|---|---|---|---|---|---|
| 1 | 2026-11-25 | fe2ad34 | ninguno (determinista) | 2962d5e6…8e94 | PASS (con dobles) | Verificación independiente del backend |
| 2 | 2026-11-25 | fe2ad34 | ninguno (determinista) | 626365fc…5d76 | PASS (con dobles) | Ídem; cálculo independiente sin diferencias |
| 3 | 2026-11-25 | fe2ad34 | ninguno (determinista) | 626365fc…5d76 | PASS (con dobles) | Ídem |
| 4 | 2026-11-25 | fe2ad34 | ninguno (determinista) | 626365fc…5d76 | PASS (con dobles) | Ídem |
| 5 | 2026-11-25 | fe2ad34 | doble de IA; modelo real sin respuesta | — (texto) | PASS con doble; BLOQUEADO con modelo real | Ídem; IA real: «sin créditos» |

Además: la suite automática (96/96 pruebas) y una prueba de extremo a extremo local (15/15, con Telegram simulado) pasaron sobre ese commit.
