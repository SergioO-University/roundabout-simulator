# Simulador de cuellos de botella en glorietas · Santa Marta

Reto No. 3 · Introducción a la Ingeniería de Sistemas 2026-2 · Universidad del Magdalena

> ⚠️ **Estado actual: datos de prueba.** Los conteos, la geometría y los giros son inventados para poder
> construir y probar el simulador. Hay que reemplazarlos con lo medido en campo antes de sacar conclusiones.

**Equipo:** _(nombre del equipo)_
**Integrantes y rol:** _(completar)_
**Prototipo publicado:** _(enlace de GitHub Pages)_

## Cómo abrirlo

- **Sin internet:** descargar el repositorio y abrir `index.html` con doble clic. Usa la copia `data/embedded-data.js`.
- **Con servidor** (Live Server de VS Code o GitHub Pages): lee directamente los `.json` de `data/`.

Después de editar cualquier `.json`, regenerar la copia para el modo sin internet:

```bash
node tools/embed-data.js
```

## Geometría real (OpenStreetMap)

Las tres glorietas se dibujan y se simulan con su **forma real**, tomada de OpenStreetMap (© colaboradores de OpenStreetMap, licencia ODbL):

| Punto | Nombre en OpenStreetMap | Brazos |
|---|---|---|
| La Lucha | Rotonda de La Lucha (la Troncal pasa por encima en puente) | Av. del Ferrocarril, Calle 31 (sur), Calle 31 (oriente), Conector Troncal (nororiente) y Salida a Troncal hacia Ciénaga (solo salida) |
| Mamatoco | Rotonda Mamatoco | Troncal del Caribe (oriente y occidente), Vía Alterna al Puerto, Av. Calle 29 |
| La Piragua | Rotonda José Benito Barrios | Troncal (hacia Mamatoco y hacia La Lucha), Av. del Libertador, Carrera 35 |

Los vehículos recorren las trayectorias reales de cada entrada y salida y la forma real del anillo. Algunos brazos son **solo de salida**.

Cómo se genera:

1. `data/osm/*.json` tiene las vías descargadas de OpenStreetMap alrededor de cada glorieta.
2. `data/osm/sites.json` dice qué vías forman la entrada y la salida de cada brazo, cuántos carriles tiene y su capacidad de salida. **Aquí se corrigen los nombres, carriles y capacidades con lo visto en campo.**
3. `node tools/build-geometry.js` genera `data/geometry.json` (no editarlo a mano: se sobrescribe).
4. `node tools/embed-data.js` actualiza la copia para usar sin internet.

⚠ La Piragua está en obra (intercambiador en construcción desde 2026); OpenStreetMap puede mostrar la forma anterior.

**En pantalla:** la rueda del mouse (o pellizcar en el teléfono) hace zoom y arrastrar mueve la vista; "Encuadrar" vuelve a la vista inicial. En teléfonos el diseño pasa a una sola columna con scroll.
Con internet se puede activar **Mapa de fondo** (teselas de CARTO / OpenStreetMap) para ver la glorieta sobre el mapa.
Sin internet el simulador funciona igual, solo sin el mapa de fondo.

## Cargar los datos de campo

Todo el equipo llena la misma **Planilla de campo** (hoja de cálculo con pestañas Conteos, Giros, Bloqueos, Tiempos, Brazos y Fallos IA). Después:

1. Descargarla como Excel y guardarla como `data/field/planilla-campo.xlsx`.
2. `node tools/import-field-data.js` — revisa errores y escribe `data/counts.json` (conteos, giros y bloqueos). También imprime las velocidades promedio medidas y las diferencias de carriles o nombres con `data/osm/sites.json`, para corregirlas a mano.
3. `node tools/embed-data.js` y `node tests/engine.test.js`.

Con `--dry-run` revisa la planilla sin escribir nada.

## Qué hace

Modela **una** glorieta con su geometría y la opera de tres formas, siempre con **las mismas llegadas**
(misma semilla):

| Modo | Qué representa |
|---|---|
| **Actual** (`current`) | Prelación: quien circula por el anillo tiene la vía y quien entra espera un hueco. Nadie revisa si su salida está libre, así que un vehículo puede quedar **atravesado** y bloquear a todos. |
| **Semáforo** (`signal`) | Fases verde, amarillo y todo rojo, ajustables con controles deslizantes. Con verde en un acceso, el anillo se detiene antes de ese acceso. Nunca hay dos verdes en conflicto (accesos vecinos). |
| **Agente** (`officer`, la "alternativa") | Turnos fijos de un agente de tránsito, un acceso a la vez, con tiempo de transición. Opcionalmente, el agente no deja entrar a quien no tiene espacio en su salida. |

Las motos son más cortas, aceleran más y **filtran entre las filas** detenidas. Los carros y las busetas no filtran.

En pantalla cada vehículo se dibuja con un ícono visto desde arriba. Las **luces de freno** se encienden cuando frena o está detenido, la **direccional naranja** parpadea cuando va a tomar su salida, y un **círculo rojo con "!"** marca a los vehículos atravesados que bloquean el anillo.

La interfaz y la documentación están en español. El código (archivos, variables, comentarios y claves de los JSON) está en inglés.

## Ciclo del motor

Cada 0,1 s simulados, siempre en el mismo orden:

1. **Llegadas** (`arrivals.js`): crea los vehículos cuyo instante ya se cumplió.
2. **Control** (`control.js`): actualiza el semáforo o los turnos y decide quién puede entrar.
3. **Movimiento** (`vehicles.js`): *si el de adelante está muy cerca, frena; si no, acelera.*
4. **Métricas** (`metrics.js`): cruces, colas y esperas.
5. **Dibujo** (`renderer.js`): pinta el estado en el lienzo. El motor no conoce el lienzo.

## Archivos

El documento del reto sugiere nombres en español; esta tabla muestra a qué archivo corresponde cada uno.

| Archivo | Nombre en el reto | Responsabilidad |
|---|---|---|
| `index.html` | `index.html` | Lienzo, panel de control, tablero de métricas y comparador. |
| `styles.css` | — | Presentación. |
| `js/engine.js` | `motor.js` | Reloj y ciclo de cinco pasos. Reinicia con una semilla. |
| `js/arrivals.js` | `llegadas.js` | Generador con semilla (mulberry32) y creación de vehículos según los conteos. |
| `js/control.js` | `control.js` | Quién puede entrar según el modo: prelación, fases del semáforo o turnos del agente. |
| `js/vehicles.js` | `vehiculos.js` | Avance de cada vehículo, regla de frenado, entrada al anillo, filtrado de motos. |
| `js/metrics.js` | `metricas.js` | Evacuación, colas, esperas, bloqueos y verificación de verdes en conflicto. |
| `js/renderer.js` | `dibujo.js` | Dibuja vías reales, anillo, puentes, señales, vehículos y el mapa de fondo opcional; zoom y desplazamiento. |
| `js/geometry.js` | — | Convierte `geometry.json` en trayectorias: anillo, entradas y salidas con su forma real. |
| `js/icons.js` | — | Íconos de los vehículos vistos desde arriba (moto con piloto, carro o taxi, buseta), con luces de freno y direccional. |
| `js/data.js` | — | Carga los `.json` (o la copia embebida si no hay servidor). |
| `js/app.js` | — | Conecta los botones y el tablero con el motor. |
| `data/geometry.json` | `geometria.json` | Forma del anillo y de cada entrada y salida (generado desde OpenStreetMap), carriles, capacidad de las salidas. |
| `data/osm/sites.json` | — | Qué vías de OpenStreetMap forman cada brazo, nombres, carriles y capacidades (editable). |
| `data/osm/*.json` | — | Vías descargadas de OpenStreetMap. |
| `data/counts.json` | `conteos.json` | Conteos de 15 min por acceso y tipo (pico y valle) y proporción de giros. |
| `data/parameters.json` | `parametros.json` | Velocidad, largo, aceleración y brecha de cada tipo; tiempos del semáforo y del agente; semilla. |
| `data/embedded-data.js` | — | Copia generada de los tres `.json` para usar sin internet. |
| `tests/engine.test.js` | — | Pruebas automáticas del motor. |
| `tools/embed-data.js` | — | Regenera `data/embedded-data.js`. |
| `tools/import-field-data.js` | — | Importa la planilla de campo (.xlsx) a `data/counts.json`. |
| `data/field/` | — | Aquí va `planilla-campo.xlsx`. |
| `tools/build-geometry.js` | — | Genera `data/geometry.json` desde OpenStreetMap y `data/osm/sites.json`. |
| `docs/` | `documentos/` | PDF de la entrega. |

### Equivalencias en los datos

| En el código y los JSON | Significado |
|---|---|
| `current` / `signal` / `officer` | Modo actual / semáforo / agente |
| `peak` / `offpeak` / `test` | Perfil pico / valle / caso de prueba |
| `ferrocarril`, `calle31_sur`, `troncal_oriente`, … | Identificador de cada brazo (ver `data/osm/sites.json`) |
| `motorcycle` / `car` / `bus` | Moto / carro / buseta |
| `approaching` / `queued` / `crossing` / `exited` | Estado aproximando / en cola / cruzando / salió |
| `turning` | Proporción de giros de cada acceso hacia cada salida |
| `exit_capacity_vph` | Capacidad de cada salida en vehículos por hora |

## Métricas

| Métrica | Cálculo |
|---|---|
| Capacidad de evacuación | Vehículos que pasaron a estado `exited` (salió) durante el último minuto simulado. |
| Cola máxima por acceso | Mayor número de vehículos en estado `queued` (en cola) en ese acceso durante la corrida. |
| Tiempo promedio de espera | Promedio de `t_cross − t_queue` de los vehículos que ya cruzaron. |

Un vehículo pasa a `queued` cuando su velocidad baja de 1,5 m/s antes de entrar a la glorieta,
o cuando llega y no cabe en el tramo de acceso. `t_cross` es el instante en que entra al anillo.
Ojo: los vehículos que siguen en cola al final no cuentan en la espera promedio. Por eso el comparador
muestra también "vehículos aún en cola al final".

**Comprobación a mano:** perfil "Caso de prueba (3 vehículos)" + modo Semáforo, y luego
"Exportar vehículos de la corrida actual". Con los datos actuales:
(24,9 + 26,2 + 26,5) / 3 = 25,9 s, igual a lo que muestra el tablero.

## Simplificaciones del modelo

- Cada acceso se modela con **un carril lógico** más un carril de filtrado para motos. El dibujo muestra el ancho real según el número de carriles.
- El anillo se modela con **un carril lógico** que sigue la línea central real del anillo.
- Se modelan unos 130 m de cada entrada y 90 m de cada salida.
- La **capacidad de salida** (`exit_capacity_vph`) representa un trancón aguas abajo. Si una salida se llena, el vehículo
  que va hacia ella se queda quieto en el anillo y bloquea a los demás. Este valor se calibra con los bloqueos observados en campo.
- Las llegadas usan `arrival_mode: "exact_count"`: en cada bloque de 15 min llegan exactamente los vehículos contados,
  en instantes al azar con la semilla. Con `"poisson"` el total varía un poco alrededor del conteo.

## Pruebas

```bash
node tests/engine.test.js
```

Revisa que la misma semilla dé las mismas métricas, que las llegadas queden dentro del 10 % de lo contado,
que ningún vehículo se monte sobre otro, que nunca haya verdes en conflicto, y el caso de tres vehículos.

## Pendiente con los datos reales

- [ ] Elegir **un** punto (recomendado: La Lucha) y dejarlo en `active_site` de `data/osm/sites.json`.
- [ ] Croquis → revisar en `data/osm/sites.json` que los brazos, nombres y carriles coincidan con lo visto en campo; regenerar con `node tools/build-geometry.js`.
- [ ] Llenar la planilla de campo e importarla con `node tools/import-field-data.js` (conteos, giros y bloqueos).
- [ ] Bloqueos observados → ajustar `exit_capacity_vph` (en `data/osm/sites.json`) hasta que el modo Actual reproduzca lo visto.
- [ ] Revisar y justificar `parameters.json`, y observar si el agente da paso a dos accesos a la vez (`officer.groups`).
- [ ] `node tools/build-geometry.js`, `node tools/embed-data.js` y `node tests/engine.test.js`.
- [ ] Comparación final y conclusión con cifras en la bitácora.
