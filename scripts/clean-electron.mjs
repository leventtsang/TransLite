import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

await rm(resolve('dist-electron'), { recursive: true, force: true });
