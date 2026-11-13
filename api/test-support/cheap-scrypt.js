const crypto = require('node:crypto');

function useCheapScrypt() {
  const real = crypto.scrypt;
  crypto.scrypt = (password, salt, keylen, _options, callback) =>
    real(password, salt, keylen, { N: 16, r: 1, p: 1 }, callback);
}

module.exports = { useCheapScrypt };
