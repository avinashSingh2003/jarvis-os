#!/usr/bin/env node
import { main } from './cli';

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
