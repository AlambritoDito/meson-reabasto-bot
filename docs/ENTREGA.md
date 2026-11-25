# Índice de entrega · Reto 2 · Reabastecimiento

**Equipo 3:** Alan Pérez Fernández, Santiago Vázquez Llanes, Santiago Pineda Sotelo y Julián González Lepe.

Proyecto académico de demostración con datos ficticios. El agente propone y redacta; una persona aprueba y es quien enviaría el pedido. El bot nunca envía pedidos.

## Entregables

1. **Hoja de decisiones:** [docs/hoja-decisiones.md](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/docs/hoja-decisiones.md)
2. **agente.md, versión de entrega:** [docs/agente.md](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/docs/agente.md)
3. **Agente configurado:**
   - Bot de Telegram: [t.me/mesondemobot](https://t.me/mesondemobot). Responde solo durante las sesiones de demostración, mientras corre en el equipo de la persona responsable; fuera de ellas el chat abre, pero no hay respuesta.
   - Página explicativa con QR: [alambritodito.github.io/meson-reabasto-bot](https://alambritodito.github.io/meson-reabasto-bot/)
   - Configuración (instrucciones del modelo y qué hace el programa): [docs/configuracion.md](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/docs/configuracion.md)
   - **Capturas:** las aporta el equipo en la entrega.
4. **Registro de pruebas con los cinco casos:** [docs/registro-pruebas.md](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/docs/registro-pruebas.md)
5. **Pendientes y supuestos:** [docs/pendientes.md](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/docs/pendientes.md)

## Datos de muestra

- [fixtures/inventario-muestra.csv](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/fixtures/inventario-muestra.csv): 20 insumos ficticios, al menos cuatro proveedores, seis bajo mínimo y uno con un dato requerido faltante.
- Casos de prueba propuestos: [fixtures/casos-docentes.json](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/fixtures/casos-docentes.json)

## Cómo ejecutarlo

Instrucciones completas en el [README](https://github.com/AlambritoDito/meson-reabasto-bot#readme). Resumen:

```bash
git clone https://github.com/AlambritoDito/meson-reabasto-bot.git
cd meson-reabasto-bot/backend
npm ci
npm test                      # pruebas automáticas
cp .dev.vars.example .dev.vars  # poner token del bot propio, clave de API y demás valores
npm run demo                  # enciende el bot en local; Ctrl+C lo apaga
```

## Código y licencia

Repositorio: [github.com/AlambritoDito/meson-reabasto-bot](https://github.com/AlambritoDito/meson-reabasto-bot) · Licencia MIT ([LICENSE](https://github.com/AlambritoDito/meson-reabasto-bot/blob/main/LICENSE)).
