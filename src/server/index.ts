import { createApp } from './app.js';

const DEFAULT_PORT = 3000;

const resolvePort = (value: string | undefined): number => {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT;
};

const port = resolvePort(process.env.PORT);
const app = createApp();

app.listen(port, () => {
  console.log(`[stallmate] API listening on http://localhost:${port}`);
});
