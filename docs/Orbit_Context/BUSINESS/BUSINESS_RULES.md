# BUSINESS_RULES.md — Reglas de negocio Orbit

## A. Reglas generales
RN001. Todo servicio debe estar asociado a un cliente.
RN002. Todo servicio debe estar asociado a una mascota.
RN003. Todo servicio debe estar asociado a un plan o tipo de servicio.
RN004. Todo servicio debe tener fecha y hora de creación.
RN005. Todo servicio debe tener un estado operativo activo.
RN006. Todo servicio debe tener un responsable interno asignado o quedar marcado como pendiente de asignación.
RN007. Todo cambio de estado debe quedar auditado con usuario, fecha, hora y observación opcional.
RN008. Ningún servicio debe cerrarse sin evidencia de entrega o justificación autorizada.
RN009. No se debe eliminar información crítica; debe anularse o archivarse con motivo.
RN010. Los datos capturados en atención deben alimentar operación, diseño, entrega y reportes sin recaptura manual.

## B. Cliente y contacto
RN011. Un cliente puede tener una o varias mascotas.
RN012. Un cliente puede tener uno o varios servicios históricos.
RN013. El teléfono del cliente es un dato crítico para trazabilidad y notificaciones.
RN014. Si el cliente autoriza a un tercero, debe registrarse nombre, teléfono y relación.
RN015. Las direcciones deben quedar asociadas al servicio específico, no únicamente al cliente.
RN016. Las observaciones sensibles del cliente deben ser visibles solo para roles autorizados.

## C. Mascota
RN017. Toda mascota debe tener nombre.
RN018. La especie debe registrarse cuando aplique: perro, gato u otra.
RN019. El peso debe registrarse si afecta precio, logística o proceso.
RN020. La fecha de fallecimiento debe registrarse cuando sea conocida.
RN021. El nombre de la mascota debe mantenerse consistente para recordatorios y mensajes.
RN022. Correcciones de nombre deben quedar auditadas si ya inició diseño o producción.

## D. Planes y devolución
RN023. Los planes grupales no generan devolución individual de cenizas.
RN024. Los planes individuales generan devolución según el tipo de proceso contratado.
RN025. Eco-Grupal corresponde a compostaje grupal sin devolución.
RN026. Básico y Standard son servicios grupales sin devolución, salvo configuración diferente documentada.
RN027. Exclusivo, Compets, Premium y Cementerio deben tratarse como planes individuales o especiales según su configuración.
RN028. Los recordatorios incluidos dependen del plan contratado.
RN029. Los recordatorios adicionales deben registrarse de forma independiente al plan base.
RN030. Un cambio de plan debe recalcular recordatorios, producción, entrega y precio si aplica.

## E. Recolección
RN031. Todo servicio con recolección debe tener dirección, fecha estimada y responsable técnico.
RN032. La asignación del técnico debe registrarse antes de confirmar al cliente, salvo casos urgentes.
RN033. El mensaje de confirmación debe usar datos correctos: técnico, mascota, dirección y hora estimada.
RN034. Si cambia el técnico, debe quedar trazabilidad y debe notificarse si ya se informó al cliente.
RN035. Si cambia la hora estimada, debe registrarse motivo.
RN036. Las recolecciones en periferia pueden generar costo adicional.
RN037. La evidencia de recolección debe quedar asociada al servicio.

## F. Producción
RN038. Un servicio no puede ingresar a producción sin validación mínima de cliente, mascota y plan.
RN039. Cada tipo de producción debe tener estados propios.
RN040. Cremación, aquamación y compostaje deben diferenciarse claramente.
RN041. Los tiempos de proceso deben calcularse desde eventos reales, no solo desde la fecha de venta.
RN042. Cualquier novedad en producción debe quedar registrada.
RN043. La salida de producción debe habilitar etapa de entrega o recordatorios, según aplique.
RN044. Los reportes de cremación, aquamación o compostaje deben asociarse al servicio correspondiente.

## G. Diseños y recordatorios
RN045. Los diseños personalizados requieren fotografías o autorización para usar material disponible.
RN046. Si el cliente no elige fotos, debe registrarse si autoriza elección interna.
RN047. Cada recordatorio debe tener estado propio: pendiente, en diseño, enviado a aprobación, aprobado, rechazado, en producción, finalizado.
RN048. Un diseño no puede marcarse como aprobado sin confirmación del cliente o autorización interna documentada.
RN049. Cambios solicitados por el cliente deben quedar como versión o comentario del diseño.
RN050. Los cristales tienen medida base de 11 cm x 16 cm vertical.
RN051. Los cojines se manejan en formato A4 vertical.
RN052. Los recordatorios deben heredar el nombre correcto de la mascota.
RN053. Un servicio puede tener varios recordatorios.
RN054. Un recordatorio adicional debe poder facturarse o cobrarse aparte si aplica.

## H. Entregas
RN055. Toda entrega debe tener dirección o método de entrega.
RN056. Toda entrega debe tener responsable o empresa transportadora, según aplique.
RN057. Una entrega no puede cerrarse sin evidencia o confirmación.
RN058. Si hay devolución de cenizas, la entrega debe validar que el componente correspondiente esté listo.
RN059. Si hay recordatorios personalizados, la entrega debe validar que estén completos o documentar entrega parcial.
RN060. Una entrega parcial debe quedar registrada con pendientes claros.

## I. Veterinarias aliadas
RN061. Una veterinaria puede referir múltiples servicios.
RN062. Cada servicio referido debe quedar asociado a la veterinaria correspondiente.
RN063. Las comisiones se calculan según plan, cantidad de servicios y reglas vigentes.
RN064. El estado VIP de una veterinaria depende del volumen de servicios referidos según política activa.
RN065. Los beneficios VIP deben registrarse para evitar entregas o comisiones inconsistentes.
RN066. Los materiales entregados a veterinarias deben quedar registrados.

## J. Comisiones
RN067. Toda comisión debe estar asociada a un servicio, veterinaria o aliado.
RN068. El porcentaje de comisión depende del tipo de plan y regla comercial vigente.
RN069. Una comisión no debe pagarse dos veces.
RN070. Toda comisión debe tener estado: pendiente, aprobada, pagada, anulada.
RN071. Cualquier ajuste de comisión debe tener motivo y usuario responsable.

## K. Auditoría y calidad
RN072. Todo cambio crítico debe quedar auditado.
RN073. Los campos críticos son: cliente, mascota, plan, estado, precio, técnico, dirección, veterinaria, entrega y cierre.
RN074. El sistema debe permitir consultar historial completo por servicio.
RN075. Las excepciones operativas deben clasificarse para análisis posterior.
RN076. Los tiempos reales deben medirse para detectar cuellos de botella.

## M. Cobro en la entrega (2026-09-10, migraciones 151/152)
RN077. Si el servicio tiene saldo, el mensajero **debe resolver el dinero antes de cerrar la
       entrega**: o registra el cobro, o deja por escrito por qué no le pagaron. No puede
       completarla dejando el tema en blanco.
RN078. Se cobra el **saldo completo o nada**: no hay abono parcial en la puerta.
RN079. Un cobro que **no sea en efectivo exige comprobante** adjunto (front y CHECK en DB).
RN080. Nunca se cobra sin cobrar: **el saldo se relee de la base al confirmar**. Si ya está en
       cero no se vuelve a sumar al servicio — pero el monto sí se le anota al mensajero, que
       tiene el efectivo en la mano, y queda aviso de posible doble cobro.
RN081. Puede entregarse **sin cobrar** dejando el motivo. El saldo sigue vivo en la cartera:
       el cuadre no es donde se persigue un cobro pendiente.
RN082. El efectivo cobrado en la entrega entra al cuadre del mensajero **fechado por el día del
       cobro**, no por el ingreso del servicio (una entrega ocurre semanas después, y ese
       período suele estar cerrado).
RN083. Solo el **EFECTIVO** se le atribuye a quien cobra; transferencia, Nequi, Daviplata y
       tarjeta entraron directo a la cuenta de la empresa.
RN084. **Al mensajero se le paga por HORAS, por fuera de Orbit.** Su cuadre responde una sola
       pregunta: qué recaudó, cuánto de eso es efectivo que debe entregar y cuánto se fue a la
       cuenta de la empresa. Las filas de entrega **no llevan transporte, recargos ni pago al
       técnico**, y esos lápices están cerrados: como `dinero_a_entregar = efectivo −
       reconocido`, cualquier valor ahí le bajaría en silencio el efectivo que se le pide.

RN085. **En el compostaje individual, el reloj de entrega de los recordatorios arranca cuando la
       mascota SALE del cubículo**, no cuando la familia manda las fotos — salvo que haya pedido
       expresamente recibirlos anticipados (`servicios.recordatorios_anticipados = true`). Quien
       dijo "todos al final", y quien no contestó, cuenta desde `lotes_tenjo_items.cubiculo_salida`
       + los días hábiles del plan. Mientras siga en el cubículo, `fecha_limite_entrega` es NULL:
       todavía no hay compromiso que medir. Contarlo desde las fotos hacía nacer la fecha ya
       vencida y pintaba de rojo dos meses de Kanban y Producción (migración 155).
RN086. La fecha de salida del cubículo es **corregible** y al corregirla se recalcula sola la
       fecha máxima de entrega. Se registra el día en que la mascota salió de verdad, no el día
       en que alguien lo apuntó.
RN087. Un cubículo puede alojar **más de una mascota**: su `capacidad` la fija a mano el
       coordinador, cubículo por cubículo (por defecto 1). La base rechaza pasarse del cupo.

## N. La entrega sigue al servicio (2026-09-24, migración 173)
RN088. **Si el servicio queda `ENTREGADO` por cualquier vía** (el Tablero, el cliente recogió en
       sede, un cierre manual), **su entrega publicada o asignada se cierra sola**. Una entrega
       abierta de algo ya entregado no es trabajo pendiente: ensucia el pool y tapa lo real.
       La excepción es la que está `EN_CAMINO`: un mensajero la tiene en la calle y la cierra él,
       porque puede traer dinero cobrado en la puerta (RN077).

## O. Alerta de coordinación en WhatsApp (migración 171 del 23-sep, recortada el 24-sep)
RN089. Cuando el agente de **veterinarias** le promete a alguien que coordinación le responde, o
       pone una etiqueta que avisa, se abre una alerta que **solo se apaga respondiendo en el hilo**
       o con "Ya lo resolví por teléfono" (queda quién y cuándo). No tiene botón de cerrar.
RN090. La alerta **solo se muestra en el Tablero (`/kanban`)**, donde trabaja quien coordina, y
       **nunca por la línea de familias**. Salir en cualquier pantalla bloqueó a producción en
       pleno trabajo (David, 24-sep).

## P. Concepto del abono en la cartera (2026-09-25, migración 174)
RN091. Al registrar un pago en Finanzas se dice **a qué corresponde**: el saldo general (lo de
       siempre), un **adicional** del servicio o **otro concepto** escrito a mano. Queda en la
       novedad `PAGO_RECIBIDO` (`concepto_pago` y, si es un ítem, `servicio_recordatorio_id`).
RN092. Un abono a un adicional **no pasa de lo que le falta a ese adicional**. Si el cliente pagó
       más, lo demás es de otro concepto: se registra como saldo general o en dos abonos.
RN093. Lo abonado a cada adicional **se deriva** sumando sus novedades de pago; no se marca en el
       ítem. El adicional vendido como "ya pagado" en el Tablero queda atado a su pago igual.

## L. Reglas pendientes por validar
- Estados exactos por plan.
- Lista definitiva de recordatorios incluidos por plan.
- Fórmula final de comisiones.
- Integración con facturación.
- Reglas de precios por peso, zona y urgencia.
- Tiempos SLA por proceso.
