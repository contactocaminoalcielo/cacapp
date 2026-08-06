# Base de conocimiento — Planes y tarifas

Pieza tipo **TABLA** para la base de conocimiento del agente.
Precios extraídos de `v_precios_por_peso` el **2026-08-06**.

⚠️ **Estos precios envejecen.** Cuando cambien en el catálogo, hay que actualizar esta pieza
a mano — el agente no consulta la base de datos, solo lee lo que está aquí escrito.

---

## Cómo se calcula el precio

El precio depende de **dos cosas**: el plan y el **rango de peso de la mascota**.

Y el rango de peso se decide por especie:

| Especie | Se cobra por |
|---|---|
| Perro, Ave, Hámster, Pez, otras | **rango de peso** (ver tablas) |
| Gato, Conejo, Cobayo, Reptil | **tarifa FELINO** — una sola, sin importar el peso |
| Cualquier especie de menos de 1 kg | **tarifa PETIT** |

Es decir: un gato de 3 kg y un gato de 7 kg pagan lo mismo. Un perro de 3 kg y uno de 7 kg
también (ambos caen en 1–10 kg), pero uno de 15 kg paga más.

---

## Tarifas por plan

Todos los valores en pesos colombianos.

### Eco-grupal

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 79.000 |
| Felino / conejo / cobayo / reptil | 99.000 |
| 1 – 10 kg | 109.000 |
| 11 – 20 kg | 139.000 |
| 21 – 35 kg | 169.000 |
| 36 – 60 kg | 229.000 |

### Básico

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 139.000 |
| Felino / conejo / cobayo / reptil | 169.000 |
| 1 – 10 kg | 189.000 |
| 11 – 20 kg | 219.000 |
| 21 – 35 kg | 289.000 |
| 36 – 60 kg | 389.000 |

### Standard

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 209.000 |
| Felino / conejo / cobayo / reptil | 269.000 |
| 1 – 10 kg | 319.000 |
| 11 – 20 kg | 359.000 |
| 21 – 35 kg | 419.000 |
| 36 – 60 kg | 539.000 |

### Compets sin recordatorios

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 339.000 |
| Felino / conejo / cobayo / reptil | 409.000 |
| 1 – 10 kg | 499.000 |
| 11 – 20 kg | 499.000 |
| 21 – 35 kg | 579.000 |
| 36 – 60 kg | 659.000 |

### Compets evidencia

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 429.000 |
| Felino / conejo / cobayo / reptil | 509.000 |
| 1 – 10 kg | 629.000 |
| 11 – 20 kg | 629.000 |
| 21 – 35 kg | 729.000 |
| 36 – 60 kg | 819.000 |

### Compets presencial

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 479.000 |
| Felino / conejo / cobayo / reptil | 559.000 |
| 1 – 10 kg | 699.000 |
| 11 – 20 kg | 699.000 |
| 21 – 35 kg | 839.000 |
| 36 – 60 kg | 879.000 |

### Exclusivo videollamada

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 579.000 |
| Felino / conejo / cobayo / reptil | 669.000 |
| 1 – 10 kg | 819.000 |
| 11 – 20 kg | 899.000 |
| 21 – 35 kg | 939.000 |
| 36 – 60 kg | 1.049.000 |

### Exclusivo presencial

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 629.000 |
| Felino / conejo / cobayo / reptil | 729.000 |
| 1 – 10 kg | 879.000 |
| 11 – 20 kg | 939.000 |
| 21 – 35 kg | 989.000 |
| 36 – 60 kg | 1.119.000 |

### Premium

| Rango | Precio |
|---|---|
| Menos de 1 kg (PETIT) | 719.000 |
| Felino / conejo / cobayo / reptil | 829.000 |
| 1 – 10 kg | 1.049.000 |
| 11 – 20 kg | 1.139.000 |
| 21 – 35 kg | 1.209.000 |
| 36 – 60 kg | 1.319.000 |

---

## Planes que NO debe cotizar el agente

Existen en el catálogo pero no son de venta abierta. Si preguntan por ellos, pasar a
coordinación:

- **Plan Ángel** y **Desamparado** — casos especiales
- **Bronce**, **Plata**, **Oro exclusivo** — planes antiguos
- Las variantes **"sin recordatorios"** de Básico y Exclusivo presencial
- **Exclusivo videollamada sin recordatorios**

---

## ⚠️ Lo que falta y solo tú puedes escribir

Esta pieza tiene los **precios**, pero el agente no sabe **qué incluye cada plan**, que es lo
que más van a preguntar. Hace falta una pieza aparte, tipo TEXTO, con:

- Qué incluye cada plan (cremación individual o grupal, cenizas, urna, recordatorios,
  certificado, acompañamiento presencial o por videollamada…)
- En qué se diferencian Compets y Exclusivo
- Qué son los "recordatorios" y por qué hay versiones sin ellos
- Cobertura geográfica y si hay costo de transporte por zona
- Tiempos: cuánto tarda la recogida, cuánto la entrega de cenizas
- Horarios de atención y si hay servicio nocturno o festivo
- Cómo se factura a una veterinaria aliada y qué comisión aplica

Sin eso el agente va a saber cuánto cuesta pero no qué está vendiendo, y va a escalar casi
todo a coordinación.
