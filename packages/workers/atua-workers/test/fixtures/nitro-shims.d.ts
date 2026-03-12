/**
 * Type shims for Nitro/Nuxt globals used in test fixtures.
 * These fixtures simulate framework output and don't need real packages installed.
 */
declare function defineEventHandler(handler: (event: any) => any): any;
declare function readBody(event: any): Promise<any>;
declare function defineNuxtConfig(config: any): any;
