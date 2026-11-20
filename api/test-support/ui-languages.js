const path = require('node:path');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

const UI_JS = path.join(__dirname, '..', '..', 'ui', 'js');

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith('/js/')) return next(specifier, context);
    const file = path.join(UI_JS, specifier.split('?')[0].slice('/js/'.length));
    return { url: pathToFileURL(file).href, shortCircuit: true };
  },
});

const { LANGUAGES } = require(path.join(UI_JS, 'i18n.js'));

module.exports = { LANGUAGE_CODES: Object.freeze(LANGUAGES.map(l => l.code)) };
