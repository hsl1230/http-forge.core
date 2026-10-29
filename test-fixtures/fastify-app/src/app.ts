import Fastify from 'fastify';

const app = Fastify({ logger: false });

const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
];

app.get('/health', async () => {
  return { status: 'ok' };
});

app.get('/users', async () => {
  return users;
});

app.get('/users/:id', async (req) => {
  return users.find((u) => u.id === Number(req.params.id));
});

app.post('/users', {
  schema: {
    body: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' }
      }
    }
  }
}, async (req) => {
  return { id: 3, ...req.body };
});

app.delete('/users/:id', async () => {
  return { status: 'deleted' };
});

export default app;
