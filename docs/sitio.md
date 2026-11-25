# Página explicativa (`site/`)

Página estática en español que explica la demo y enlaza al bot de Telegram. No usa build, frameworks, JavaScript, CDNs, rastreadores ni cookies, y emplea las fuentes del sistema. GitHub Pages publica solo `site/`.

| Archivo | Uso |
|---|---|
| `site/index.html` | Contenido de la página |
| `site/estilos.css` | Estilos (modo claro/oscuro según la preferencia del sistema) |
| `site/qr.svg` | QR de `https://t.me/mesondemobot`, generado con `tools/sitio/configurar-sitio.sh` |
| `tools/sitio/configurar-sitio.sh` | Sustituye los marcadores, alterna los avisos y genera el QR (no se publica) |

## Marcadores y avisos

| Marcador / bloque | Estado actual | Cómo se cambia |
|---|---|---|
| `__BOT_USERNAME__` | Sustituido por `mesondemobot`; el QR y el botón están en la tarjeta de la portada | `--bot` |
| `__REPO_URL__` | Sustituido por `https://github.com/AlambritoDito/meson-reabasto-bot`; los enlaces siguen ocultos hasta que el repositorio sea público | `--repo`, después `--mostrar-repo` |
| `__AI_MODEL__` | Sustituido por `gpt-6-luna` | `--modelo` |
| `data-bloque="aviso-ia"` | Visible: «La conexión real con la IA aún no está verificada» | `--ia-verificada`, solo con evidencia real de una respuesta del modelo |

Los bloques se muestran u ocultan con el atributo `hidden` y se identifican con `data-bloque`: `aviso-pendiente`, `enlace-bot`, `aviso-repo`, `enlace-repo`, `detalle-ia` y `aviso-ia`. Los enlaces al repositorio asumen la rama `main`.

## Configurar

Requisitos: `bash`, `perl` y [`uv`](https://docs.astral.sh/uv/). El QR se genera con [segno](https://pypi.org/project/segno/) 1.6.6, que se ejecuta de forma puntual con `uvx` y no se añade al proyecto. Desde la raíz del repositorio:

```bash
tools/sitio/configurar-sitio.sh --bot NombreDelBot_bot      # solo con un bot que exista
tools/sitio/configurar-sitio.sh --repo https://github.com/usuario/repositorio
tools/sitio/configurar-sitio.sh --mostrar-repo              # cuando el repositorio sea público
tools/sitio/configurar-sitio.sh --modelo id-del-modelo
tools/sitio/configurar-sitio.sh --ia-verificada             # solo con evidencia real
```

Cada marcador se sustituye una sola vez. Antes de publicar, comprueba a mano:

- escanea el QR con un teléfono;
- abre el botón y el enlace de texto;
- confirma que abren el bot correcto.

No pongas tokens ni claves en `site/`: todo lo que contiene es público.

## Probar en local

```bash
cd site
python3 -m http.server 8080   # abrir http://localhost:8080
```

## Paleta y tipografía

La paleta está inspirada en la identidad pública del Mesón (dirección confirmada por Alan; códigos exactos y uso de marca por confirmar con el cliente). Tonos: terracota, crema, carbón cálido, café y dorado solo decorativo. No se usan logotipos, fotos, iconos ni lemas del Mesón, y la página aclara que no es un sitio oficial. La tipografía es la del sistema (`ui-rounded` en los titulares). Objetivos de diseño:

- contraste de texto de nivel WCAG AA en ambos modos;
- alertas con texto e icono, no solo color;
- foco visible al navegar con teclado.

La paleta aplica solo a la página. Dentro de Telegram, la fuente, los colores y las burbujas los define la aplicación de cada persona.

## Publicar en GitHub Pages

El workflow `.github/workflows/pages.yml` publica solo la carpeta `site/`. Se ejecuta al hacer push a `main` con cambios en `site/**`, o a mano con *workflow_dispatch*.

En el repositorio hay que activar Settings → Pages → Source: GitHub Actions. Después de publicar, abre la URL pública y repite la prueba del QR.

Que la página esté publicada no prueba que el bot esté encendido: solo responde durante las sesiones de demostración.
