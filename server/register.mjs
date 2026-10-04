// Lets the server import the app's TypeScript data files (src/data/*.ts) whose imports have no file extension.
import { register } from 'node:module';
register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        try { return await next(spec, ctx); }
        catch (e) {
          if ((spec.startsWith('./') || spec.startsWith('../')) && !/\\.[cm]?[jt]sx?$/.test(spec)) return next(spec + '.ts', ctx);
          throw e;
        }
      }`),
);
