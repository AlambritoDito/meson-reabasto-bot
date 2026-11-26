# Página explicativa (`site/`)

Página estática en español que explica la demo y enlaza al bot de Telegram. Se publica en <https://alambritodito.github.io/meson-reabasto-bot/>.

- No usa build, frameworks, CDNs, fuentes externas, rastreadores ni cookies.
- Usa las fuentes del sistema y un solo archivo de JavaScript propio, que es una mejora progresiva.
- GitHub Pages publica solo `site/`.

| Archivo | Uso |
|---|---|
| `site/index.html` | Contenido de la página |
| `site/estilos.css` | Estilos: paleta, modo claro/oscuro según el sistema y movimiento |
| `site/app.js` | Entradas al hacer scroll, secuencia del chat de ejemplo y contadores (mejora progresiva) |
| `site/qr.svg` | QR de `https://t.me/mesondemobot`, generado con `tools/sitio/configurar-sitio.sh` |
| `site/img/` | Tres capturas reales del recorrido en vivo del 25-nov-2026, copiadas de `docs/capturas/` |
| `tools/sitio/configurar-sitio.sh` | Sustituye marcadores, alterna avisos y genera el QR (no se publica) |

## Diseño y movimiento

- **Portada.** Bloque terracota con un patrón de puntos y dos halos que se desplazan despacio. Incluye:
  - botón «Abrir en Telegram», QR y aviso de sesiones de demostración;
  - una maqueta de chat hecha en HTML/CSS, rotulada «Ejemplo ilustrativo con datos ficticios (no es una captura)», con el flujo menú → propuesta → aprobar y cifras del inventario de muestra.
- **Capturas reales.** La sección «El bot en Telegram» muestra tres capturas reales con su fecha.
- **Movimiento:**
  - entradas suaves al hacer scroll (IntersectionObserver), escalonadas en tarjetas y pasos;
  - línea de tiempo del recorrido que se dibuja paso a paso;
  - contadores de la muestra (20 insumos, 5 proveedores, 6 bajo mínimo, 1 fila excluida);
  - mensajes del chat que aparecen en orden;
  - elevación de botones y tarjetas al pasar el cursor o enfocar;
  - transición del tema claro/oscuro.
- **Reglas:**
  - solo se animan `transform` y `opacity`, con duraciones de 150 a 500 ms;
  - con `prefers-reduced-motion: reduce` no hay movimiento;
  - sin JavaScript (o si `app.js` falla) todo el contenido queda visible, porque las clases que ocultan algo solo las pone `app.js` cuando el movimiento está permitido;
  - un temporizador de seguridad devuelve la visibilidad si la inicialización no termina.

## Marcadores y avisos (estado actual)

| Marcador / bloque | Estado | Cómo se cambia |
|---|---|---|
| `__BOT_USERNAME__` | Sustituido por `mesondemobot` | `--bot` |
| `__REPO_URL__` | Sustituido por `https://github.com/AlambritoDito/meson-reabasto-bot`; los enlaces al repositorio están visibles | `--repo`, `--mostrar-repo` |
| `__AI_MODEL__` | Sustituido por `gpt-6-luna` | `--modelo` |
| `data-bloque="aviso-ia"` | Oculto: la conexión con la IA se verificó el 2026-11-25 (ver `registro-pruebas.md`) | `--ia-verificada` |

Los bloques se muestran u ocultan con el atributo `hidden` y se identifican con `data-bloque`: `aviso-pendiente`, `enlace-bot`, `aviso-repo`, `enlace-repo`, `detalle-ia` y `aviso-ia`. Los enlaces al repositorio asumen la rama `main`.

## Configurar

Requisitos: `bash`, `perl` y [`uv`](https://docs.astral.sh/uv/). El QR se genera con [segno](https://pypi.org/project/segno/) 1.6.6, que se ejecuta de forma puntual con `uvx`. Desde la raíz del repositorio:

```bash
tools/sitio/configurar-sitio.sh --bot NombreDelBot_bot
tools/sitio/configurar-sitio.sh --repo https://github.com/usuario/repositorio
tools/sitio/configurar-sitio.sh --mostrar-repo
tools/sitio/configurar-sitio.sh --modelo id-del-modelo
tools/sitio/configurar-sitio.sh --ia-verificada
```

Cada marcador se sustituye una sola vez. Antes de publicar, escanea el QR con un teléfono y abre el botón y el enlace de texto. No pongas tokens ni claves en `site/`.

## Probar en local

```bash
cd site
python3 -m http.server 8080   # abrir http://localhost:8080 (no uses el 8787, que es el de la demo del bot)
```

## Paleta y tipografía

- **Paleta:** inspirada en la identidad pública del Mesón. La dirección la confirmó Alan; los códigos exactos y el uso de marca están por confirmar con el cliente.
  - terracota `#b5501a` / `#a3440f`;
  - crema `#f6efe4`;
  - carbón `#3f3a36`;
  - café `#5a3a25`;
  - dorado `#e7b55a`, solo decorativo.
- **Lo que no se usa:** logotipos, fotos, iconos ni lemas del Mesón. La página aclara que no es un sitio oficial.
- **Tipografía:** la del sistema, con `ui-rounded` en los titulares.
- **Objetivos de diseño:** contraste de texto de nivel WCAG AA en ambos modos, alertas con texto e icono, y foco visible.
- **Alcance:** la paleta aplica solo a la página. Dentro de Telegram la apariencia es la de la aplicación de cada persona.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica `site/`. Se ejecuta al hacer push a `main` con cambios en `site/**`, o a mano.

Que la página esté publicada no prueba que el bot esté encendido: solo responde durante las sesiones de demostración.
