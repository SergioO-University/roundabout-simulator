# Muestras de campo

Cada archivo `.json` de esta carpeta es **una toma de campo** (un punto de la glorieta, una ventana de tiempo). Los archivos **no se editan**: si una toma tiene un error, se corrige y se vuelve a guardar completa.

```
data/samples/<punto>/AAAA-MM-DD_HHMM_<perfil>_<lugar>.json
```

Ejemplo: `data/samples/la_lucha/2026-11-24_1637_offpeak_conector_troncal.json`

## Cómo se cargan

**Lo normal:** guarden el archivo aquí y hagan commit y push a `main`, o súbanlo desde la web de GitHub. GitHub Actions regenera la calibración, corre las pruebas, compara con lo medido y publica la página. No hay que correr nada.

**Para probar antes de subir:** en el simulador, tarjeta **Datos reales → Probar muestras sin subirlas**, arrastren el `.json`. Se recalcula en el navegador y no se guarda.

**A mano**, por ejemplo sin internet:
```bash
node tools/build-calibration.js   # combina todas las muestras en data/calibration.json
node tools/embed-data.js          # actualiza la copia para usar sin internet
node tools/check-calibration.js   # compara lo que simula el modelo con lo medido
node tests/engine.test.js         # pruebas
```

`index.json` en esta carpeta es generado; no lo editen.

**Revisiones automáticas** (aparecen en la tarjeta "Datos reales", en el script y como advertencia en GitHub Actions; la muestra se usa igual):
- fecha en sábado o domingo (el modelo es de un día entre semana);
- un acceso con más de unos 1.900 vehículos-equivalentes por hora por carril (motos 0,4; busetas 2), que es más de lo que pasa por un carril;
- un archivo con "salida" en el nombre pero con los números en `approaches` (entradas) y no en `exits`.

`build-calibration.js` nunca inventa datos dentro de una muestra; lo que una muestra no trae, o trae en `null`, se trata así:
- Varias muestras del mismo acceso y perfil se promedian.
- **Conteos:** cada uno se ubica en su hora (`time`) y se convierte en vehículos por día con el perfil de 24 horas (`data/daily-profile.json`). Por eso la hora de inicio y fin es indispensable.
- **Accesos sin conteo:** se **estiman** con lo medido: el flujo por carril de los accesos medidos o, si la glorieta no tiene tomas, el de otras glorietas. Luego se bajan hasta que los accesos medidos logren entrar lo que se contó (el detalle está en el README principal).
- **Otros campos:** siguen con el valor supuesto de `data/counts.json` o `data/parameters.json`.
- En pantalla, todo queda marcado como medido, estimado o supuesto.

El acceso que más mejora la estimación es el siguiente que midan: cada conteo nuevo reemplaza una estimación y afina el tope de los demás.

## Formato

Todo es opcional salvo `profiles`; pongan `null` en lo que no midieron.

| Campo | Qué es |
|---|---|
| `profiles.peak` / `profiles.offpeak` | `time` (`"HH:MM-HH:MM"`), `date` (`"AAAA-MM-DD"`) y `approaches.<acceso>` con `motorcycle`, `car`, `bus`: vehículos que **entraron** en esa ventana. La ventana puede durar lo que sea (15, 20, 60 min…). La etiqueta pico o valle es informativa: lo que cuenta es la hora. |
| `profiles.*.exits.<salida>` | Opcional: vehículos que **salen** de la glorieta por esa salida en la misma ventana (`motorcycle`, `car`, `bus`). No se usan como demanda: `tools/check-calibration.js` los compara con lo simulado. |
| `turning.<acceso de entrada>.<salida>` | Vehículos que entraron por ese acceso y salieron por esa salida, **en la misma toma**. Se convierte en proporción usando el conteo de entrada de la misma toma. |
| `observed_speeds_kmh.ring` | Velocidad promedio en el anillo por tipo (`motorcycle`, `car`, `bus`), en km/h. |
| `observed_speeds_kmh.exit_<salida>` | Velocidad promedio en esa salida por tipo, en km/h. Ejemplo: `exit_ferrocarril`. |
| `observed_entry_headway_s` | `approach`, `profile`, `median` (tiempo mediano entre vehículos que entran, en s) y `queue_discharge_p15` (percentil 15 cuando hay cola). |
| `observed_blockages` | Bloqueos vistos (ver `data/field/instrucciones-para-ia.md`). |

**Desvíos de La Lucha** (no entran al anillo):
- **Ferrocarril → Troncal (Ciénaga):** el conteo de `ferrocarril` los incluye, y el giro `ferrocarril → troncal_cienaga` es cuántos tomaron el desvío.
- **Conector → Av. del Ferrocarril:** el conteo de `conector_troncal` los incluye, y el giro `conector_troncal → ferrocarril` es cuántos tomaron el desvío.

Identificadores de La Lucha:
- **Entradas:** `ferrocarril`, `calle31_sur`, `calle31_oriente`, `conector_troncal`.
- **Salidas:** las mismas, más `troncal_cienaga`.
