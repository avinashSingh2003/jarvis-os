#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cli_1 = require("./cli");
(0, cli_1.main)().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Fatal error:', error);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map