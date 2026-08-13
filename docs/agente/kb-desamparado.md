# Base de conocimiento — Plan Desamparado

Pieza tipo **TEXTO** para el agente. Reglas dictadas por David el 2026-08-13.

⚠️ **Todo lo que va debajo del `---` se le pega al agente y lo lee como si se lo dijeras a la
cara.** Escríbelo en segunda persona; nunca "el agente hace tal cosa" (lo repite tal cual a la
veterinaria).

⚠️ El precio de aquí es el que calcula `src/lib/precios.js` (`DESAMPARADO`), verificado contra
los 72 servicios con peso registrado. **Si se cambia esa fórmula en el código, hay que
cambiarla también aquí**: el agente no consulta la base de datos.

---

## Qué es y para quién

El **Desamparado** es un plan de **apoyo a las veterinarias aliadas**, no un producto de venta
al público. Existe para una situación concreta: a la clínica **le dejan una mascota
abandonada** y queda con el cuerpo sin nadie que responda por él.

Solo lo pide la clínica. Si quien escribe es un dueño de mascota, este plan no aplica.

Las veterinarias no siempre lo llaman así. También le dicen **"el plan de ayuda"**, **"el de
los abandonados"**, **"Abandonado"** o **"el plan de apoyo"**. Todos son el mismo: Desamparado.

## Precio

- **Hasta 10 kg: $46.000.**
- **Más de 10 kg: $44.000 + $4.000 por cada kilo**, contando desde el kilo 10.

Ejemplos, para que no te equivoques:

| Peso | Cuenta | Precio |
|---|---|---|
| 3 kg | tarifa base | 46.000 |
| 10 kg | tarifa base | 46.000 |
| 15 kg | 44.000 + (5 × 4.000) | 64.000 |
| 18 kg | 44.000 + (8 × 4.000) | 76.000 |
| 25 kg | 44.000 + (15 × 4.000) | 104.000 |
| 33 kg | 44.000 + (23 × 4.000) | 136.000 |

Los kilos con decimales cuentan igual: 15,86 kg = 44.000 + (5,86 × 4.000) = **67.440**.

Este precio **no depende de la especie**: aquí no aplican la tarifa FELINO ni la PETIT, que
son de los planes de venta. Es el peso y ya.

## Tiempo de recogida — es distinto y hay que decirlo

Es un plan de ayuda y no deja rentabilidad, así que **se acomoda dentro de la ruta**: la
recogida va **entre 24 y 48 horas**, no en las 2 a 3 horas de los demás planes. **Dilo desde
el principio**, sin que te lo pregunten: una clínica que espera un carro esa misma tarde y se
entera al día siguiente es un problema, y de los que se recuerdan.

**Si necesitan que sea antes, existe la prioridad:**

- **$16.000 adicionales** → la recogida entra **dentro de las primeras 24 horas**.
- **$20.000** si esa prioridad cae en **domingo o festivo**.

La prioridad es un cobro adicional que se suma al valor del plan. **Ni con prioridad se
promete la franja de 2 a 3 horas**: eso es de los planes de venta.

## Qué proceso hace

**Cremación grupal.** Como todos los grupales, **no devuelve las cenizas** de esa mascota, y
no lleva recordatorios: el único comprobante es el **reporte de cremación**.

Si te preguntan por cenizas, huellas o memorial en un Desamparado, la respuesta es que ese
plan no los incluye. Es preferible decirlo de entrada que dejar a la clínica esperando algo
que no va a llegar.

## Comisión

**El Desamparado no genera comisión para la veterinaria.** No es un descuido ni algo que
coordinación pueda ajustar: es un plan de ayuda, la clínica no está vendiendo un servicio.

Si te preguntan por la comisión de un Desamparado, dilo claro y sin rodeos. No lo pases a
coordinación como si fuera negociable, y no lo dejes en el aire para que aparezca después en
la factura.

## Cómo lo tomas

Igual que cualquier otra recogida: mándales primero el enlace de registro. Si prefieren
dictártelo, necesitas lo mismo de siempre (mascota, especie, peso, dónde se recoge,
refrigeración, si fue por cáncer) **más dos cosas propias de este plan**:

1. **Si quieren prioridad**, con el costo dicho de antemano.
2. **Quién paga.** Aquí no hay familia dueña: normalmente paga la clínica. Confírmalo.

En este plan **no preguntes por la familia ni por su WhatsApp**: la mascota está abandonada,
no hay a quién mandarle fotos ni memorial. Si la clínica te da un contacto igual, tómalo, pero
no lo exijas.
