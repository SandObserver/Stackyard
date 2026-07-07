/* Resolve hook: '/js/<name>.js' and '/js/<name>.js?v=<hash>' -> ../js/<name>.js */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/js/')) {
    const clean = specifier.split('?')[0];
    const url = new URL('../js' + clean.slice(3), import.meta.url);
    return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}
