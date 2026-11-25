# Simulador de cuellos de botella en glorietas · Santa Marta

Reto No. 3 · Introducción a la Ingeniería de Sistemas 2026-2 · Universidad del Magdalena

> ⚠️ **Estado actual: una muestra real.** La geometría es la real (OpenStreetMap). De La Lucha hay un conteo de campo
> (Conector Troncal, 16:37–16:52); los demás accesos y las otras dos glorietas están **estimados** a partir de él.
> Cada toma nueva reemplaza una estimación. Ver "Datos reales" y "Un día completo".

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

## Datos reales (muestras de campo)

Cada toma de campo se guarda como un archivo en `data/samples/<glorieta>/` y no se edita.

### Agregar una muestra (sin correr nada)

1. Guarden el `.json` en `data/samples/la_lucha/` con el nombre `AAAA-MM-DD_HHMM_<perfil>_<lugar>.json`.
2. Hagan commit y push a `main`. También pueden subirlo desde la web de GitHub con *Add file → Upload files*.

GitHub Actions (`.github/workflows/calibration.yml`) hace el resto en un par de minutos:
- regenera la calibración y la guarda en el repo con un commit automático;
- corre las pruebas;
- compara con lo medido (en la pestaña *Actions*, dentro de la ejecución; lo que pase de ±15 % aparece como advertencia);
- publica la página.

Para ver los cambios en su computador, hagan `git pull`.

**Configuración única:** en el repo, *Settings → Pages → Build and deployment → Source*, elijan **GitHub Actions**. Antes se publicaba desde la rama, y eso no se entera de los commits automáticos.

### Probar una muestra sin subirla

En la tarjeta **Datos reales** del simulador, arrastren los `.json` o usen **Elegir archivos .json**:
- La calibración se recalcula en el navegador, con las mismas reglas del repo (`js/calibration.js`).
- Las muestras locales aparecen marcadas como "local, sin guardar".
- **Quitar muestras locales** vuelve a dejar solo las del repo.
- Nada de esto se guarda: para que quede, hay que subir el archivo.

### Cómo se combinan

`js/calibration.js` combina todas las muestras en `data/calibration.json`, que es lo que usa el simulador. Lo corre GitHub Actions, el botón de la página o, a mano, `node tools/build-calibration.js`.

- **Conteos medidos:** cada conteo se ubica en su hora real (`time`, por ejemplo `16:37-16:52`) y se convierte en **vehículos por día** con el perfil de 24 horas (ver "Un día completo"). Si hay varias tomas del mismo acceso, se promedian.
- **Conteos estimados:** los accesos que aún no tienen toma se estiman a partir de lo medido. En orden de preferencia:
  1. El flujo diario medido por carril de entrada en la misma glorieta × los carriles del acceso (`entry_lanes` en `data/osm/sites.json`).
  2. El flujo típico por carril de las otras glorietas con datos. Así se estiman Mamatoco y La Piragua mientras no tengan tomas propias.
- **Tope de la estimación:** el script simula la ventana del conteo (modo actual, como en campo) y baja los accesos estimados hasta que el acceso medido logra entrar lo que se contó. Hoy ese tope deja los accesos sin conteo de La Lucha en el 53 % del flujo por carril del Conector. Es un límite superior: dice cuánto tráfico cabe como máximo, no cuánto hay; si traen más, a las 16:37 el anillo se llena y el Conector ya no alcanza a descargar sus 336 vehículos.
- **Giros:** la proporción medida se respeta, y lo que falta se reparte según los giros supuestos.
- **Velocidades:** las medidas en el anillo y en las salidas, por tipo de vehículo, fijan la velocidad que usa el simulador en esos tramos.
- **En pantalla:** cada conteo aparece como **medido**, **estimado** o **supuesto**, en la tarjeta "Datos reales" y en la tabla de accesos.

`node tools/check-calibration.js` simula cada ventana medida, en su hora real y con 10 minutos previos para que la glorieta no arranque vacía, y compara con lo medido:
- velocidades;
- tiempos entre vehículos que entran;
- vehículos que logran entrar al anillo en esa ventana.

El formato de las muestras está en `data/samples/README.md`.

### Parámetros calibrados con la primera muestra

- **Tiempo de seguimiento (`follow_up_s`):** 1,8 s para motos, 2,8 s para carros y 3,8 s para busetas. Es el tiempo mínimo que deja un conductor en fila después de que entra el de adelante, y se reduce para los conductores más agresivos. Con estos valores, la mediana simulada del tiempo entre entradas (2,4 s) es igual a la medida.
- **Entrada en paralelo (`roundabout.parallel_motorcycle_entry` y `parallel_entry_delay_s`):** si en la línea hay una moto al lado de un carro, la moto entra entre 0,3 y 0,8 s después y circulan lado a lado hasta separarse. Con esto el percentil 15 simulado (0,7 s) es igual al medido.

## Un día completo

La simulación recorre **las 24 horas** de un día entre semana:
- **Reloj:** la barra de arriba muestra la hora del día. Debajo del mapa aparece la franja actual (por ejemplo "Hora pico de la tarde · pico y placa").
- **Velocidades:** ×1 (tiempo real), ×10, ×60 (1 minuto por segundo), ×300 y ×1200 (el día completo en unos 72 s).
- **Ir a una hora:** el selector **Ir a** o un clic en el gráfico del día. Se simulan antes los 30 minutos previos, sin contarlos, para que la glorieta no arranque vacía.
- **Gráfico del día:**
  - barras grises: demanda esperada por hora;
  - barras de color: vehículos que ya llegaron;
  - línea roja: espera promedio de cada hora;
  - franjas naranjas: horas pico.
- **Comparador:** compara dos o tres modos en el día completo o en una franja (pico de la mañana, del mediodía, de la tarde o valle), con las mismas llegadas. Ver "Comparar escenarios".
- **Exportar:** el resumen por hora de la corrida actual (CSV).

### Cómo se reparte la demanda en el día (`data/daily-profile.json`)

Cada acceso tiene un total de **vehículos por día**. El perfil dice qué porcentaje del día pasa en cada hora, por tipo de vehículo:
- **Uso:** con el perfil, un conteo de 15 minutos a cualquier hora se convierte en total diario.
- **Reparto:** el total diario se reparte en los 96 bloques de 15 minutos del día. Dentro de cada hora el ritmo cambia de forma gradual, sin saltos en punto.
- **Redondeo:** se acumula a lo largo del día, de modo que los bloques suman exactamente el total diario.

El perfil no es un conteo de 24 horas en La Lucha, porque no encontramos uno público. Se armó con lo siguiente:
- **Tres picos:** coinciden con las franjas del **pico y placa de Santa Marta** (7:00–9:00, 11:30–14:00 y 17:00–20:00). La Secretaría de Movilidad las fijó tras aforar la Av. del Libertador y la Av. del Ferrocarril ([El Informador](https://www.elinformador.com.co/index.php/distrito/314147-asi-funcionara-el-nuevo-pico-y-placa-para-carros-particulares-en-santa-marta)).
- **Pico de la tarde (17:00–19:00):** es el más alto. En la Troncal (Mamatoco–Bonda), la congestión se reporta entre 5:30 y 8:00 p. m. ([El Informador](https://www.elinformador.com.co/index.php/general/365-tema-del-dia/320579-pasar-por-la-troncal-del-caribe-es-transitar-por-un-calvario)).
- **Volumen:** en la Troncal del Caribe pasan más de 1.300 vehículos cada media hora ([El Espectador](https://www.elespectador.com/colombia/mas-regiones/nuevas-medidas-de-movilidad-en-santa-marta-asi-funcionara-el-pico-y-placa/)). Con el perfil, el Conector da unos 430 por cuarto de hora en el pico de la tarde, el mismo orden de magnitud.
- **Picos de viajes en Colombia:** 6:00, 12:00 y 17:00 según la Encuesta de Movilidad de Bogotá 2023 ([Portafolio](https://www.portafolio.co/economia/regiones/en-transporte-publico-y-a-pie-asi-se-transportaron-los-bogotanos-en-2023-606118)).
- **Diferencias por tipo:** las motos (63 % del parque nacional según el [RUNT](https://www.runt.gov.co/sites/default/files/documentos/Balance%20del%20Sector%20Tr%C3%A1nsito%20y%20Transporte%202025%20%281%29_0.pdf)) arrancan más temprano. Las busetas circulan más o menos de 5:00 a 22:00.
- **Hora pico:** el 7,6 % del día, dentro del 7–10 % habitual en puntos urbanos (supuesto).

**Si miden un día completo** (o varias horas seguidas), reemplacen los porcentajes de `hourly_share_pct`, con 24 valores por tipo que sumen 100.

### Lo que muestra hoy (La Lucha, día completo, semilla 2026)

| Modo | Espera promedio | Se fueron por otra ruta | En cola a medianoche |
|---|---|---|---|
| Actual | 174 s | 2.695 | 0 |
| Semáforo | 443 s | 8.274 | 2 |
| Agente | 813 s | 26.453 | 3 |

- **Los desvíos pesan mucho.** Unos 21.700 vehículos al día pasan sin entrar al anillo: 11.000 por el desvío Conector → Av. del Ferrocarril y 10.700 por el desvío Av. del Ferrocarril → Troncal (Ciénaga).
- **Hoy la espera más alta está en la Av. del Ferrocarril**, pero es un acceso *estimado* al tope máximo (53 % del flujo por carril del Conector). Es el acceso que más urge contar.
- **Semáforo y agente** usan tiempos pensados para los volúmenes de prueba. Ajustar los verdes y los turnos a la demanda del día es parte del análisis del equipo.

### Desvío por congestión

Un conductor que llega y ve una fila que le tomaría más de 15 minutos (`simulation.divert_after_wait_s` en `data/parameters.json`) se va por otra ruta y no entra a la fila.
- **Cálculo de la espera esperada:** vehículos en cola en ese acceso ÷ cuántos ha dejado entrar el acceso en los últimos 5 minutos.
- **Dónde se ven:** en la tabla de accesos (entre paréntesis), en el comparador y en el CSV por hora.
- **Por qué existe:** sin esto, cuando la demanda supera la capacidad la fila crece sin fin y a medianoche siguen miles de vehículos esperando. En la realidad la gente cambia de ruta. Con `null` nadie se desvía.

## Comparar escenarios

En la pestaña **Comparar escenarios** se eligen los modos (dos o tres) y la franja. El simulador corre cada modo sin dibujar, con las mismas llegadas, y abre una vista con gráficas:

- **Tarjetas por métrica:** espera, vehículos que se fueron, que cruzaron, evacuación, cola máxima y anillo bloqueado. Cada modo trae ▲/▼ y el % de diferencia contra el primero (verde: mejor; rojo: peor).
- **A lo largo del tiempo:** una línea por modo cada 15 minutos (espera, cola promedio, se fueron o evacuados), con las horas pico sombreadas. Al pasar el mouse se ven los valores de ese momento.
- **Por acceso:** barras agrupadas de espera, se fueron o cola máxima. Muestran *dónde* está la diferencia.
- **Mapa de escenarios (PCA):** cada punto es un bloque de 15 minutos de un modo, descrito por cinco métricas a la vez:
  - espera;
  - cola promedio;
  - vehículos que se fueron;
  - atendidos por cada vehículo que llegó;
  - tiempo con el anillo bloqueado.

  Cómo funciona:
  - **Cálculo:** el análisis de componentes principales (`js/pca.js`) estandariza esas métricas y las proyecta en los dos ejes que conservan más variación.
  - **Lectura:** las flechas dicen hacia dónde crece cada métrica, y el círculo grande es el promedio de cada modo. Si las nubes se separan, los modos se comportan distinto.
  - **En palabras:** el texto de arriba del mapa explica qué significa cada eje y qué modo queda mejor ubicado.
  - **Qué quedó por fuera:** la evacuación bruta. Mide sobre todo qué tan cargada está la hora, no qué tan bien responde el modo.
- **Tabla completa** (plegada) y exportación a CSV o JSON.

Colores fijos por modo: Actual azul, Semáforo naranja y Agente aqua. La paleta pasa el validador de daltonismo para gráficos de dispersión con tres series.

## Qué hace

Modela **una** glorieta con su geometría, durante un día completo, y la opera de tres formas, siempre con **las mismas llegadas**
(misma semilla):

| Modo | Qué representa |
|---|---|
| **Actual** (`current`) | Prelación: quien circula por el anillo tiene la vía y quien entra espera un hueco. Nadie revisa si su salida está libre, así que un vehículo puede quedar **atravesado** y bloquear a todos. |
| **Semáforo** (`signal`) | Fases verde, amarillo y todo rojo, ajustables con controles deslizantes. Con verde en un acceso, el anillo se detiene antes de ese acceso. Nunca hay dos verdes en conflicto (accesos vecinos). |
| **Agente** (`officer`, la "alternativa") | Turnos fijos de un agente de tránsito, un acceso a la vez, con tiempo de transición. Opcionalmente, el agente no deja entrar a quien no tiene espacio en su salida. |

Las motos son más cortas, aceleran más, **filtran entre las filas** detenidas y pueden **entrar al anillo al lado de un carro**. Los carros y las busetas no filtran.

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
| `js/demand.js` | — | Demanda del día: convierte conteos en vehículos por día y los reparte en bloques de 15 min con el perfil de 24 h. |
| `js/pca.js` | — | Análisis de componentes principales (PCA) para el mapa de escenarios del comparador. |
| `js/charts.js` | — | Gráficas SVG del comparador: líneas en el tiempo, barras por acceso y mapa PCA. |
| `js/calibration.js` | — | Reglas de calibración: medido, estimado y supuesto. Lo usan el script, GitHub Actions y el botón "Probar muestras". |
| `js/app.js` | — | Conecta los botones y el tablero con el motor. |
| `data/geometry.json` | `geometria.json` | Forma del anillo y de cada entrada y salida (generado desde OpenStreetMap), carriles y capacidad de las salidas (hoy sin límite). |
| `data/osm/sites.json` | — | Qué vías de OpenStreetMap forman cada brazo, nombres, carriles y capacidades (editable). |
| `data/osm/*.json` | — | Vías descargadas de OpenStreetMap. |
| `data/counts.json` | `conteos.json` | Conteos de prueba (pico y valle) y giros supuestos; se usan solo donde no hay datos reales. |
| `data/daily-profile.json` | — | Porcentaje del día en cada hora, por tipo de vehículo, y franjas del día (pico y valle), con sus fuentes. |
| `data/parameters.json` | `parametros.json` | Velocidad, largo, aceleración y brecha de cada tipo; tiempos del semáforo y del agente; semilla. |
| `data/embedded-data.js` | — | Copia generada de los `.json` (incluidas calibración y muestras) para usar sin internet. |
| `tests/engine.test.js` | — | Pruebas automáticas del motor. |
| `tools/embed-data.js` | — | Regenera `data/embedded-data.js`. |
| `tools/build-calibration.js` | — | Combina las muestras reales de `data/samples/` en `data/calibration.json` y `data/samples/index.json`. |
| `tools/check-calibration.js` | — | Compara la simulación con lo medido (velocidades, tiempos entre vehículos y vehículos que entran) y marca lo que pase de ±15 %. |
| `.github/workflows/calibration.yml` | — | GitHub Actions: con cada push regenera la calibración, corre pruebas y publica la página. |
| `data/samples/` | — | Una carpeta por punto con las tomas de campo, una por archivo. |
| `data/calibration.json` | — | Generado: datos reales combinados con los estimados y los supuestos. |
| `data/samples/index.json` | — | Generado: todas las muestras juntas, para que la página pueda recalcular. |
| `tools/import-field-data.js` | — | Importa la planilla de campo (.xlsx) a `data/counts.json`. |
| `data/field/` | — | Aquí va `planilla-campo.xlsx`. |
| `tools/build-geometry.js` | — | Genera `data/geometry.json` desde OpenStreetMap y `data/osm/sites.json`. |
| `docs/` | `documentos/` | PDF de la entrega. |

### Equivalencias en los datos

| En el código y los JSON | Significado |
|---|---|
| `current` / `signal` / `officer` | Modo actual / semáforo / agente |
| `day` / `test` | Día completo / caso de prueba |
| `peak` / `offpeak` | Franja pico / valle (etiqueta de cada conteo; lo que cuenta es su hora) |
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
| Por hora | Las mismas métricas para cada hora del día (gráfico del día y CSV "Resumen por hora"). |

Un vehículo pasa a `queued` cuando su velocidad baja de 1,5 m/s antes de entrar a la glorieta,
o cuando llega y no cabe en el tramo de acceso. `t_cross` es el instante en que entra al anillo.
Ojo: los vehículos que siguen en cola al final no cuentan en la espera promedio. Por eso el comparador
muestra también "vehículos aún en cola al final".

**Comprobación a mano:** perfil "Caso de prueba (3 vehículos)" + modo Semáforo, y luego
"Exportar vehículos de la corrida actual". Con los datos actuales:
(21,4 + 22,6 + 23,6) / 3 = 22,5 s, igual a lo que muestra el tablero. Si cambian los datos reales, el número cambia: corran `node tests/engine.test.js`, que imprime la tabla del caso.

## Simplificaciones del modelo

- **Anillo de 2 carriles** (`ring_lanes`):
  - el que va a salir pronto (menos del 40 % de la vuelta) usa el carril externo; el resto usa el interno;
  - cada vehículo sigue al de adelante en su carril;
  - quien entra al carril externo espera hueco solo en ese carril; quien va al interno, en los dos;
  - los vehículos del carril interno salen directo: el cruce con el carril externo al salir no se modela.
- **Accesos de 2 carriles** (como la Av. del Ferrocarril): dos filas independientes. La derecha entra al carril externo y la izquierda al interno, y pueden entrar a la vez.
- **Accesos de 1 carril:** una fila más un carril de filtrado para motos. Una moto puede entrar al lado de un carro, y en el anillo van lado a lado hasta separarse.
- Se modelan unos 130 m de cada entrada y 90 m de cada salida.
- **Desvíos** (`bypasses` en `data/osm/sites.json`). En La Lucha hay dos vías que salen antes de la glorieta y nunca entran al anillo:
  - **Av. del Ferrocarril → Troncal (Ciénaga)** (OpenStreetMap, vía 153685974);
  - **Conector Troncal → Av. del Ferrocarril** hacia el norte (vía 549555145), desde el tramo de doble sentido del Conector.

  Cómo se modelan:
  - quien va de ese acceso a esa salida recorre el desvío y sale;
  - no cuenta en la espera ni en las colas del anillo, pero sí en las llegadas y en la evacuación;
  - en la calibración, el conteo de un acceso incluye a los que toman su desvío;
  - la unión del desvío con la vía de destino no se modela.
- La **capacidad de salida** (`exit_capacity_vph` en `data/osm/sites.json`) representa un trancón aguas abajo. Si una salida se llena, el vehículo
  que va hacia ella se queda quieto en el anillo y bloquea a los demás. Hoy no tiene límite: los valores anteriores eran de prueba y, con la demanda de un día real, bloqueaban la glorieta sin respaldo en datos. Se fija cuando se observe un trancón a la salida (valor `peak` para las horas pico y `offpeak` para el resto).
- La demanda es la de un **día entre semana**; no se modelan fines de semana ni festivos.
- **Conteos y capacidad:** un conteo mide los vehículos que lograron pasar, no los que querían pasar. Si el acceso estaba en cola durante el conteo, la demanda real era mayor que lo contado.
- Las llegadas usan `arrival_mode: "exact_count"`: en cada bloque de 15 min llegan exactamente los vehículos que le tocan,
  en instantes al azar con la semilla. Con `"poisson"` el total varía un poco alrededor de ese número.

## Pruebas

```bash
node tests/engine.test.js
```

Revisa lo siguiente:
- que la misma semilla dé las mismas métricas;
- que el perfil de 24 h sume el día completo;
- que las llegadas de un día sean exactamente la demanda diaria;
- que el acceso medido entre lo que se contó;
- que ningún vehículo se monte sobre otro y que nunca haya verdes en conflicto;
- el caso de tres vehículos.

Al final compara los tres modos en el día completo de cada glorieta (unos 40 s en total).

## Pendiente con los datos reales

- [ ] Elegir **un** punto (recomendado: La Lucha) y dejarlo en `active_site` de `data/osm/sites.json`.
- [ ] Croquis → revisar en `data/osm/sites.json` que los brazos, nombres y carriles coincidan con lo visto en campo; regenerar con `node tools/build-geometry.js`.
- [ ] Llenar la planilla de campo e importarla con `node tools/import-field-data.js` (conteos, giros y bloqueos).
- [ ] Bloqueos observados → fijar `exit_capacity_vph` (en `data/osm/sites.json`) hasta que el modo Actual reproduzca lo visto.
- [ ] Contar al menos otro acceso de La Lucha (idealmente Av. del Ferrocarril) y, si se puede, una hora pico, para afinar el perfil del día.
- [ ] Ajustar los verdes del semáforo y los turnos del agente a la demanda del día antes de comparar.
- [ ] Revisar y justificar `parameters.json`, y observar si el agente da paso a dos accesos a la vez (`officer.groups`).
- [ ] `node tools/build-geometry.js`, `node tools/embed-data.js` y `node tests/engine.test.js`.
- [ ] Comparación final y conclusión con cifras en la bitácora.
