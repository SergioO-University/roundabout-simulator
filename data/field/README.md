# Datos de campo

Aquí va la planilla de campo descargada como Excel, con este nombre exacto:

```
data/field/planilla-campo.xlsx
```

Luego, desde la raíz del repo:

```bash
node tools/import-field-data.js      # revisa la planilla y escribe data/counts.json
node tools/embed-data.js             # actualiza la copia para usar sin internet
node tests/engine.test.js            # confirma que todo sigue funcionando
```

Con `--dry-run` el script revisa la planilla sin escribir nada. Si encuentra errores (un acceso mal escrito, un intervalo sin contar), dice la fila exacta y no escribe nada.

No cambien los nombres de las pestañas (Conteos, Giros, Bloqueos, Tiempos, Brazos) ni los encabezados de las columnas: el script los busca tal cual.

## Usar una IA para armar los datos

Si prefieren no llenar la planilla, pueden adjuntar `instrucciones-para-ia.md` a ChatGPT, Claude o Gemini junto con sus datos (notas, tabla, Excel o foto). La IA pregunta lo que falte y devuelve el bloque JSON de `la_lucha` para `data/counts.json`. Lo que no tengan queda vacío (`null`); no inventa datos.
