#!/usr/bin/env bash
# Sustituye los marcadores del sitio y genera el código QR.
#
# Uso (desde cualquier carpeta; cada opción se puede usar sola o combinada):
#   tools/sitio/configurar-sitio.sh --bot NombreDelBot_bot
#   tools/sitio/configurar-sitio.sh --repo https://github.com/usuario/repositorio
#   tools/sitio/configurar-sitio.sh --mostrar-repo
#   tools/sitio/configurar-sitio.sh --modelo "id-del-modelo-de-OpenAI"
#   tools/sitio/configurar-sitio.sh --ia-verificada
#
# --bot          sustituye __BOT_USERNAME__, muestra QR/botón/enlace, oculta el aviso de
#                "pendiente" y genera site/qr.svg desde https://t.me/<usuario>.
# --repo         sustituye __REPO_URL__ pero DEJA OCULTOS los enlaces al repositorio.
# --mostrar-repo muestra los enlaces al repositorio (solo cuando ya sea público).
# --modelo       sustituye __AI_MODEL__ y muestra la línea que nombra el modelo.
# --ia-verificada oculta el aviso «la conexión real con la IA aún no está verificada».
#                Úsala SOLO cuando exista evidencia real de una respuesta del modelo.
#
# Requisitos: bash, perl y uv (segno se ejecuta de forma puntual con `uvx`; no se añade
# al proyecto ni al sitio publicado). Usa --bot solo con un usuario VERIFICADO en Telegram.
# Cada marcador se sustituye una vez: después ya no existe en index.html.
set -euo pipefail

SEGNO_VERSION="1.6.6"
DIR_SITIO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../site" && pwd)"
HTML="$DIR_SITIO/index.html"
BOT="" REPO="" MOSTRAR_REPO="" MODELO="" IA_VERIFICADA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bot)          BOT="${2:-}"; shift 2 ;;
    --repo)         REPO="${2:-}"; shift 2 ;;
    --mostrar-repo) MOSTRAR_REPO=1; shift ;;
    --modelo)       MODELO="${2:-}"; shift 2 ;;
    --ia-verificada) IA_VERIFICADA=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$BOT$REPO$MOSTRAR_REPO$MODELO$IA_VERIFICADA" ]]; then
  echo "Indica al menos una opción. Usa --help para ver ejemplos." >&2
  exit 2
fi

exige_marcador() {
  if ! grep -q "$1" "$HTML"; then
    echo "index.html ya no contiene $1 (¿ya se configuró?)." >&2
    exit 3
  fi
}

if [[ -n "$BOT" ]]; then
  BOT="${BOT#@}"
  # Telegram: 5-32 caracteres, letras, números y guion bajo; los bots terminan en "bot".
  if ! [[ "$BOT" =~ ^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$ ]]; then
    echo "Nombre de usuario de bot no válido: $BOT" >&2
    exit 2
  fi
  exige_marcador "__BOT_USERNAME__"
  ENLACE="https://t.me/$BOT"
  uvx --from "segno==$SEGNO_VERSION" segno \
    --error M --scale 8 --border 4 --no-size \
    --title "QR para abrir @$BOT en Telegram" \
    --output "$DIR_SITIO/qr.svg" "$ENLACE"
  BOT="$BOT" perl -pi -e '
    s/__BOT_USERNAME__/$ENV{BOT}/g;
    s/data-bloque="enlace-bot" hidden/data-bloque="enlace-bot"/g;
    s/data-bloque="aviso-pendiente"(?! hidden)/data-bloque="aviso-pendiente" hidden/g;
  ' "$HTML"
  echo "Bot: $ENLACE; QR en $DIR_SITIO/qr.svg"
fi

if [[ -n "$REPO" ]]; then
  REPO="${REPO%/}"
  if ! [[ "$REPO" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    echo "URL de repositorio no válida (se espera https://github.com/usuario/repositorio): $REPO" >&2
    exit 2
  fi
  exige_marcador "__REPO_URL__"
  REPO="$REPO" perl -pi -e 's/__REPO_URL__/$ENV{REPO}/g;' "$HTML"
  echo "Repositorio: $REPO (enlaces aún ocultos; usa --mostrar-repo cuando sea público)"
fi

if [[ -n "$MOSTRAR_REPO" ]]; then
  if grep -q "__REPO_URL__" "$HTML"; then
    echo "Primero sustituye __REPO_URL__ con --repo." >&2
    exit 3
  fi
  perl -pi -e '
    s/data-bloque="enlace-repo" hidden/data-bloque="enlace-repo"/g;
    s/data-bloque="aviso-repo"(?! hidden)/data-bloque="aviso-repo" hidden/g;
  ' "$HTML"
  echo "Enlaces al repositorio visibles."
fi

if [[ -n "$MODELO" ]]; then
  if ! [[ "$MODELO" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "ID de modelo con caracteres no permitidos: $MODELO" >&2
    exit 2
  fi
  exige_marcador "__AI_MODEL__"
  MODELO="$MODELO" perl -pi -e '
    s/__AI_MODEL__/$ENV{MODELO}/g;
    s/data-bloque="detalle-ia" hidden/data-bloque="detalle-ia"/g;
  ' "$HTML"
  echo "Modelo de IA: $MODELO"
fi

if [[ -n "$IA_VERIFICADA" ]]; then
  if ! grep -q 'data-bloque="aviso-ia"' "$HTML"; then
    echo "index.html no contiene el bloque aviso-ia." >&2
    exit 3
  fi
  perl -pi -e 's/data-bloque="aviso-ia"(?! hidden)/data-bloque="aviso-ia" hidden/g;' "$HTML"
  echo "Aviso de IA no verificada oculto."
fi

echo "Antes de publicar: escanea qr.svg con un teléfono y abre cada enlace."
