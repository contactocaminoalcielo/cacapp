# PROJECT_CONTEXT.md — Orbit

## 1. Descripción general
Orbit es el sistema integral de gestión operativa de Camino al Cielo, funeraria para mascotas. Su objetivo es centralizar, controlar y optimizar todo el proceso desde la solicitud del servicio hasta la entrega final, incluyendo atención al cliente, recolección, producción, diseño de recordatorios, entregas, reportes, veterinarias aliadas, comisiones y trazabilidad administrativa.

Orbit debe ser un sistema escalable, auditable y orientado a procesos. No debe ser únicamente un CRM ni una agenda; debe convertirse en el núcleo operativo de la empresa.

## 2. Objetivos del sistema
1. Centralizar la información operativa y comercial.
2. Reducir errores humanos por manejo manual.
3. Eliminar reprocesos entre atención, operación, diseño y entrega.
4. Garantizar trazabilidad por servicio, mascota, cliente y responsable.
5. Controlar tiempos de recolección, producción, personalización y entrega.
6. Automatizar seguimientos y alertas operativas.
7. Medir indicadores en tiempo real.
8. Facilitar auditoría interna y toma de decisiones.
9. Integrar progresivamente canales, formularios, WhatsApp, facturación y reportes.

## 3. Principios de diseño
- La información debe capturarse una sola vez.
- Toda acción relevante debe dejar trazabilidad.
- Todo servicio debe tener estado, responsable y fechas clave.
- Ningún proceso crítico debe depender únicamente de memoria humana o chats sueltos.
- Los módulos deben compartir una misma fuente de datos.
- Las excepciones deben quedar registradas, no resueltas informalmente.
- El sistema debe apoyar la operación real, no imponer flujos irreales.

## 4. Módulos principales
1. CRM y clientes.
2. Mascotas.
3. Servicios funerarios.
4. Recolecciones y técnicos.
5. Producción: cremación, aquamación, compostaje.
6. Diseños y recordatorios personalizados.
7. Entregas.
8. Veterinarias aliadas.
9. Comisiones.
10. Reportes operativos.
11. Usuarios, roles y permisos.
12. Auditoría.
13. Integraciones.

## 5. Flujo macro del servicio
Solicitud del servicio → Registro del cliente → Registro de mascota → Selección de plan → Confirmación de datos → Programación de recolección → Asignación de técnico → Recolección → Ingreso a operación → Producción → Gestión de fotos y diseños → Aprobación de recordatorios → Preparación de entrega → Entrega final → Evidencia → Cierre → Seguimiento.

## 6. Tipos generales de servicio
- Cremación grupal sin devolución.
- Cremación individual con devolución.
- Aquamación.
- Compostaje grupal.
- Compostaje individual.
- Cementerio.
- Eutanasia compasiva.
- Recordatorios adicionales.
- Afiliaciones preexequiales.
- Cédulas para mascotas.

## 7. Necesidad crítica
La lógica del negocio es más importante que la pantalla. Antes de desarrollar cada módulo se deben validar:
- entidades involucradas;
- estados;
- responsables;
- entradas y salidas;
- reglas de negocio;
- excepciones;
- permisos;
- reportes necesarios;
- integraciones futuras.
