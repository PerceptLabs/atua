/**
 * GET / → HTML page
 */
export default defineEventHandler(() => {
  return '<!DOCTYPE html><html><body><h1>Hello from Nitro on Catalyst</h1></body></html>';
});
