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

## Qué hace

Modela **una** glorieta con su geometría y la opera de tres formas, siempre con **las mismas llegadas**
(misma semilla):

| Modo | Qué representa |
|---|---|
| **Actual** (`current`) | Prelación: quien circula por el anillo tiene la vía y quien entra espera un hueco. Nadie revisa si su salida está libre, así que un vehículo puede quedar **atravesado** y bloquear a todos. |
| **Semáforo** (`signal`) | Fases verde, amarillo y todo rojo, ajustables con controles deslizantes. Con verde en un acceso, el anillo se detiene antes de ese acceso. Nunca hay dos verdes en conflicto (accesos vecinos). |
| **Agente** (`officer`, la "alternativa") | Turnos fijos de un agente de tránsito, un acceso a la vez, con tiempo de transición. Opcionalmente, el agente no deja entrar a quien no tiene espacio en su salida. |

Las motos son más cortas, aceleran más y **filtran entre las filas** detenidas. Los carros y las busetas no filtran.

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
| `js/renderer.js` | `dibujo.js` | Dibuja vías, anillo, señales y vehículos. |
| `js/geometry.js` | — | Convierte `geometry.json` en medidas: puntos de entrada y salida del anillo. |
| `js/data.js` | — | Carga los `.json` (o la copia embebida si no hay servidor). |
| `js/app.js` | — | Conecta los botones y el tablero con el motor. |
| `data/geometry.json` | `geometria.json` | Radio, carriles, ángulo y largo de cada acceso, capacidad de las salidas, fases del semáforo. |
| `data/counts.json` | `conteos.json` | Conteos de 15 min por acceso y tipo (pico y valle) y proporción de giros. |
| `data/parameters.json` | `parametros.json` | Velocidad, largo, aceleración y brecha de cada tipo; tiempos del semáforo y del agente; semilla. |
| `data/embedded-data.js` | — | Copia generada de los tres `.json` para usar sin internet. |
| `tests/engine.test.js` | — | Pruebas automáticas del motor. |
| `tools/embed-data.js` | — | Regenera `data/embedded-data.js`. |
| `docs/` | `documentos/` | PDF de la entrega. |

### Equivalencias en los datos

| En el código y los JSON | Significado |
|---|---|
| `current` / `signal` / `officer` | Modo actual / semáforo / agente |
| `peak` / `offpeak` / `test` | Perfil pico / valle / caso de prueba |
| `north` / `east` / `south` / `west` | Acceso norte / oriente / sur / occidente |
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

- Cada acceso se modela con **un carril lógico** más un carril de filtrado para motos. El dibujo muestra los carriles reales.
- El anillo se modela con **un carril lógico** de circulación.
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

- [ ] Elegir **un** punto (recomendado: La Lucha) y dejarlo en `active_site`.
- [ ] Croquis → `geometry.json`: ángulos, carriles, radio, largos, nombres reales de las vías, coordenadas GPS.
- [ ] Conteos pico y valle → `counts.json` (quitar `"is_test_data": true`).
- [ ] Giros estimados del video → `turning`.
- [ ] Bloqueos observados → ajustar `exit_capacity_vph` hasta que el modo Actual reproduzca lo visto.
- [ ] Revisar y justificar `parameters.json`, y observar si el agente da paso a dos accesos a la vez (`officer.groups`).
- [ ] `node tools/embed-data.js` y `node tests/engine.test.js`.
- [ ] Comparación final y conclusión con cifras en la bitácora.
