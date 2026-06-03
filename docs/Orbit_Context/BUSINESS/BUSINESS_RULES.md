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

## L. Reglas pendientes por validar
- Estados exactos por plan.
- Lista definitiva de recordatorios incluidos por plan.
- Fórmula final de comisiones.
- Integración con facturación.
- Reglas de precios por peso, zona y urgencia.
- Tiempos SLA por proceso.
