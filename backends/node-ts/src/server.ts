import { createServer } from './http.ts';
import { openStore } from './store.ts';

const port = Number(process.env.PORT ?? 3001);
const store = openStore(process.env.DB_PATH ?? ':memory:');
createServer(store).listen(port, () => console.log(`team-notes listening on :${port}`));
