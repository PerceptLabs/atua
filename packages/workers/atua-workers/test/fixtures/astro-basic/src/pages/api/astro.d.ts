/**
 * Type shim for Astro module used in test fixtures.
 */
declare module 'astro' {
  export interface APIRoute {
    (context: { locals: any; request: Request; [key: string]: any }): Response | Promise<Response>;
  }
}
