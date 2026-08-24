# Orbit Agent Kit

Esta carpeta es el esqueleto portable. No contiene bases de datos, credenciales,
canales ni acciones de Orbit. Puede copiarse a otro proyecto junto con el archivo
`*.orbit-agent.json` exportado desde la pantalla **Agentes**.

`orbit-agent-v1.schema.json` es el contrato público del archivo. El sistema
destino debe validarlo antes de instalar la definición.

## Instalación en otro proyecto

1. Copiar esta carpeta al proyecto destino o publicarla como paquete privado.
2. Copiar la definición exportada del agente.
3. Implementar un adaptador para el proveedor de IA usado por ese proyecto.
4. Mapear solamente las capacidades que el nuevo sistema decida conceder.
5. Conectar el almacenamiento de conversaciones y el canal local.
6. Ejecutar `compatibility()` y pruebas antes de atender usuarios reales.

```js
import definition from './ventas_b2b.orbit-agent.json' with { type: 'json' }
import { AgentRuntime } from './orbit-agent-kit/src/index.js'
import { myModelAdapter } from './adapters/model.js'

const agent = new AgentRuntime({
  definition,
  modelAdapter: myModelAdapter,
  tools: {
    buscar_cliente: {
      description: 'Busca un cliente en el sistema local.',
      inputSchema: {
        type: 'object',
        properties: { identificacion: { type: 'string' } },
        required: ['identificacion'],
      },
      execute: ({ identificacion }) => localCrm.findCustomer(identificacion),
    },
  },
})

console.log(agent.compatibility())
const response = await agent.run({
  conversationId: 'conversation-123',
  input: 'Quiero conocer sus planes',
})
```

Las credenciales del modelo y de las herramientas pertenecen al proyecto destino.
Nunca deben agregarse al JSON del agente.
