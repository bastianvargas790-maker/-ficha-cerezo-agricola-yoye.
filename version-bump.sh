#!/bin/bash
# version-bump.sh — Inyecta timestamps en .html + ambos sw.js antes de push
# Uso: ./version-bump.sh [timestamp]
#      Si no se pasa timestamp, usa fecha-hora actual (YYYYMMDD-HHMMSS)

set -e

TIMESTAMP="${1:-$(date +%Y%m%d-%H%M%S)}"

echo "========================================"
echo "Bumpeando versiones con: $TIMESTAMP"
echo "========================================"

# Validar que estamos en la raíz del repo
if [ ! -f "sw.js" ] || [ ! -f "calicatas/sw.js" ]; then
  echo "❌ Error: No se encontraron sw.js (raíz) o calicatas/sw.js"
  echo "   Ejecuta este script desde la raíz del repo."
  exit 1
fi

BUMPED_COUNT=0

# 1. Todos los .html (en cualquier carpeta) — buscar ?v=
echo ""
echo "📄 Procesando archivos .html..."
while IFS= read -r file; do
  if [ -f "$file" ]; then
    # Reemplazar ?v=YYYYMMDD-sufijo con ?v=TIMESTAMP
    if sed -i "s/?v=[0-9][0-9a-zA-Z-]*/?v=$TIMESTAMP/g" "$file"; then
      echo "   ✓ $file"
      BUMPED_COUNT=$((BUMPED_COUNT+1))
    fi
  fi
done < <(find . -name "*.html" -type f ! -path "./.git/*" ! -path "./node_modules/*" 2>/dev/null)

# 1b. assets/*.js — los ?v= que viven dentro del JS (por ejemplo el logo que
#     inyecta shared-auth.js) deben moverse junto con los del HTML y los sw.
echo ""
echo "📦 Procesando assets/*.js..."
while IFS= read -r file; do
  if grep -q "?v=" "$file"; then
    sed -i "s/?v=[0-9][0-9a-zA-Z-]*/?v=$TIMESTAMP/g" "$file"
    echo "   ✓ $file"
    BUMPED_COUNT=$((BUMPED_COUNT+1))
  fi
done < <(find ./assets -name "*.js" -type f 2>/dev/null)

# 2. sw.js (raíz) — CACHE name específico para shell
echo ""
echo "🔧 Procesando sw.js (raíz) — shell + aforos..."
if grep -q "const CACHE='yoye-shell-v" sw.js; then
  sed -i "s/const CACHE='yoye-shell-v[0-9]*[^']*'/const CACHE='yoye-shell-v$TIMESTAMP'/g" sw.js
  # Los ?v= del precache deben quedar iguales a los del HTML, o el navegador
  # sigue sirviendo la copia vieja aunque el archivo del servidor haya cambiado.
  sed -i "s/?v=[0-9][0-9a-zA-Z-]*/?v=$TIMESTAMP/g" sw.js
  echo "   ✓ sw.js — CACHE actualizado a: yoye-shell-v$TIMESTAMP"
  BUMPED_COUNT=$((BUMPED_COUNT+1))
else
  echo "   ⚠️  sw.js no contiene patrón 'yoye-shell-v' esperado"
fi

# 3. calicatas/sw.js (SEPARADO) — CACHE name específico para calicatas
echo ""
echo "🔧 Procesando calicatas/sw.js — SEPARADO, caché de calicatas..."
if grep -q "const CACHE='calicatas-campo-v" calicatas/sw.js; then
  sed -i "s/const CACHE='calicatas-campo-v[0-9]*[^']*'/const CACHE='calicatas-campo-v$TIMESTAMP'/g" calicatas/sw.js
  sed -i "s/?v=[0-9][0-9a-zA-Z-]*/?v=$TIMESTAMP/g" calicatas/sw.js
  echo "   ✓ calicatas/sw.js — CACHE actualizado a: calicatas-campo-v$TIMESTAMP"
  BUMPED_COUNT=$((BUMPED_COUNT+1))
else
  echo "   ⚠️  calicatas/sw.js no contiene patrón 'calicatas-campo-v' esperado"
fi

# 4. aforo/sw.js — caché de la app de aforo
echo ""
echo "🔧 Procesando aforo/sw.js — caché de la app de aforo..."
if [ -f "aforo/sw.js" ] && grep -q "const CACHE='aforo-campo-v" aforo/sw.js; then
  sed -i "s/const CACHE='aforo-campo-v[0-9]*[^']*'/const CACHE='aforo-campo-v$TIMESTAMP'/g" aforo/sw.js
  sed -i "s/?v=[0-9][0-9a-zA-Z-]*/?v=$TIMESTAMP/g" aforo/sw.js
  echo "   ✓ aforo/sw.js — CACHE actualizado a: aforo-campo-v$TIMESTAMP"
  BUMPED_COUNT=$((BUMPED_COUNT+1))
else
  echo "   ⚠️  aforo/sw.js no encontrado o sin patrón 'aforo-campo-v'"
fi

echo ""
echo "========================================"
if [ $BUMPED_COUNT -gt 0 ]; then
  echo "✅ $BUMPED_COUNT archivo(s) actualizado(s)."
  echo ""
  echo "Próximos pasos:"
  echo "  git status                          # Revisar cambios"
  echo "  git add ."
  echo "  git commit -m 'Bump versiones: $TIMESTAMP'"
  echo "  git push"
else
  echo "⚠️  No se actualizó nada. Revisa los patrones en los sw.js."
  exit 1
fi
