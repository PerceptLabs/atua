/**
 * Type shim for SvelteKit $types used in test fixtures.
 */
export interface RequestHandler {
  (event: { platform: any; request: Request; [key: string]: any }): Response | Promise<Response>;
}
