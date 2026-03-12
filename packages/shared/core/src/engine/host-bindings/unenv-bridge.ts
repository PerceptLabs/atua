/**
 * unenv bridge — Node.js polyfills for AtuaEngine.
 *
 * Replaces hand-rolled stubs with real implementations:
 * - crypto: Real SHA-256/SHA-1/MD5 + HMAC (pure JS, correct output)
 * - os: Browser-appropriate values
 * - stream: Minimal Readable/Writable/Transform/Duplex/PassThrough
 * - http: Stubs pointing users to Hono routes
 * - querystring: parse/stringify
 * - string_decoder: StringDecoder
 * - zlib: Stubs
 *
 * Each function returns a source string eval'd inside QuickJS.
 * Backed by unenv concepts (MIT, UnJS/Nuxt team).
 */

// ---- Crypto module (real SHA-256, SHA-1, MD5, HMAC) ----

export function getUnenvCryptoSource(): string {
  return `
(function() {
  // ---- Utility functions ----

  function _stringToBytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          var cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          bytes.push(0xf0 | (cp >> 18));
          bytes.push(0x80 | ((cp >> 12) & 0x3f));
          bytes.push(0x80 | ((cp >> 6) & 0x3f));
          bytes.push(0x80 | (cp & 0x3f));
          i++;
        } else {
          bytes.push(0xe0 | (code >> 12));
          bytes.push(0x80 | ((code >> 6) & 0x3f));
          bytes.push(0x80 | (code & 0x3f));
        }
      } else {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  function _toByteArray(data) {
    if (typeof data === 'string') return _stringToBytes(data);
    if (data && data._data) return Array.prototype.slice.call(data._data);
    if (data instanceof Uint8Array) return Array.prototype.slice.call(data);
    if (Array.isArray(data)) return data.slice();
    return Array.prototype.slice.call(data);
  }

  function _bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  function _bytesToBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var result = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i];
      var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += chars[(a >> 2) & 0x3f];
      result += chars[((a & 0x03) << 4) | ((b >> 4) & 0x0f)];
      result += i + 1 < bytes.length ? chars[((b & 0x0f) << 2) | ((c >> 6) & 0x03)] : '=';
      result += i + 2 < bytes.length ? chars[c & 0x3f] : '=';
    }
    return result;
  }

  // ---- SHA-256 (FIPS 180-4) ----

  var _sha256K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function _rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function _sha256(bytes) {
    var msgLen = bytes.length;
    var bitLen = msgLen * 8;

    // Padding: append 0x80, zeros, then 64-bit big-endian length
    var padLen = (55 - msgLen % 64 + 64) % 64;
    var totalLen = msgLen + 1 + padLen + 8;
    var padded = new Array(totalLen);
    for (var i = 0; i < msgLen; i++) padded[i] = bytes[i];
    padded[msgLen] = 0x80;
    for (var i = msgLen + 1; i < totalLen - 8; i++) padded[i] = 0;

    // 64-bit big-endian bit length (high 32 bits always 0 for messages < 512MB)
    padded[totalLen - 8] = 0;
    padded[totalLen - 7] = 0;
    padded[totalLen - 6] = 0;
    padded[totalLen - 5] = 0;
    padded[totalLen - 4] = (bitLen >>> 24) & 0xff;
    padded[totalLen - 3] = (bitLen >>> 16) & 0xff;
    padded[totalLen - 2] = (bitLen >>> 8) & 0xff;
    padded[totalLen - 1] = bitLen & 0xff;

    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    for (var offset = 0; offset < totalLen; offset += 64) {
      var W = new Array(64);
      for (var t = 0; t < 16; t++) {
        W[t] = ((padded[offset + t * 4] << 24) |
                (padded[offset + t * 4 + 1] << 16) |
                (padded[offset + t * 4 + 2] << 8) |
                padded[offset + t * 4 + 3]) >>> 0;
      }
      for (var t = 16; t < 64; t++) {
        var s0 = (_rotr(W[t - 15], 7) ^ _rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)) >>> 0;
        var s1 = (_rotr(W[t - 2], 17) ^ _rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)) >>> 0;
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }

      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];

      for (var t = 0; t < 64; t++) {
        var S1 = (_rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ ((~e >>> 0) & g)) >>> 0;
        var temp1 = (h + S1 + ch + _sha256K[t] + W[t]) >>> 0;
        var S0 = (_rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;

        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    var hash = [];
    for (var i = 0; i < 8; i++) {
      hash.push((H[i] >>> 24) & 0xff);
      hash.push((H[i] >>> 16) & 0xff);
      hash.push((H[i] >>> 8) & 0xff);
      hash.push(H[i] & 0xff);
    }
    return hash;
  }

  // ---- SHA-1 (FIPS 180-4) ----

  function _rotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function _sha1(bytes) {
    var msgLen = bytes.length;
    var bitLen = msgLen * 8;
    var padLen = (55 - msgLen % 64 + 64) % 64;
    var totalLen = msgLen + 1 + padLen + 8;
    var padded = new Array(totalLen);
    for (var i = 0; i < msgLen; i++) padded[i] = bytes[i];
    padded[msgLen] = 0x80;
    for (var i = msgLen + 1; i < totalLen - 8; i++) padded[i] = 0;
    padded[totalLen - 8] = 0;
    padded[totalLen - 7] = 0;
    padded[totalLen - 6] = 0;
    padded[totalLen - 5] = 0;
    padded[totalLen - 4] = (bitLen >>> 24) & 0xff;
    padded[totalLen - 3] = (bitLen >>> 16) & 0xff;
    padded[totalLen - 2] = (bitLen >>> 8) & 0xff;
    padded[totalLen - 1] = bitLen & 0xff;

    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

    for (var offset = 0; offset < totalLen; offset += 64) {
      var W = new Array(80);
      for (var t = 0; t < 16; t++) {
        W[t] = ((padded[offset + t * 4] << 24) |
                (padded[offset + t * 4 + 1] << 16) |
                (padded[offset + t * 4 + 2] << 8) |
                padded[offset + t * 4 + 3]) >>> 0;
      }
      for (var t = 16; t < 80; t++) {
        W[t] = _rotl(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);
      }

      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];

      for (var t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) {
          f = ((b & c) | ((~b >>> 0) & d)) >>> 0;
          k = 0x5a827999;
        } else if (t < 40) {
          f = (b ^ c ^ d) >>> 0;
          k = 0x6ed9eba1;
        } else if (t < 60) {
          f = ((b & c) | (b & d) | (c & d)) >>> 0;
          k = 0x8f1bbcdc;
        } else {
          f = (b ^ c ^ d) >>> 0;
          k = 0xca62c1d6;
        }

        var temp = (_rotl(a, 5) + f + e + k + W[t]) >>> 0;
        e = d; d = c; c = _rotl(b, 30); b = a; a = temp;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
    }

    var hash = [];
    for (var i = 0; i < 5; i++) {
      hash.push((H[i] >>> 24) & 0xff);
      hash.push((H[i] >>> 16) & 0xff);
      hash.push((H[i] >>> 8) & 0xff);
      hash.push(H[i] & 0xff);
    }
    return hash;
  }

  // ---- MD5 (RFC 1321) ----

  var _md5T = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];

  var _md5S = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
  ];

  function _md5(bytes) {
    var msgLen = bytes.length;
    var bitLen = msgLen * 8;
    // Padding: append 0x80, zeros, then 64-bit little-endian length
    var padLen = (55 - msgLen % 64 + 64) % 64;
    var totalLen = msgLen + 1 + padLen + 8;
    var padded = new Array(totalLen);
    for (var i = 0; i < msgLen; i++) padded[i] = bytes[i];
    padded[msgLen] = 0x80;
    for (var i = msgLen + 1; i < totalLen - 8; i++) padded[i] = 0;

    // 64-bit little-endian bit length
    padded[totalLen - 8] = bitLen & 0xff;
    padded[totalLen - 7] = (bitLen >>> 8) & 0xff;
    padded[totalLen - 6] = (bitLen >>> 16) & 0xff;
    padded[totalLen - 5] = (bitLen >>> 24) & 0xff;
    padded[totalLen - 4] = 0;
    padded[totalLen - 3] = 0;
    padded[totalLen - 2] = 0;
    padded[totalLen - 1] = 0;

    var a0 = 0x67452301;
    var b0 = 0xefcdab89;
    var c0 = 0x98badcfe;
    var d0 = 0x10325476;

    for (var offset = 0; offset < totalLen; offset += 64) {
      var M = new Array(16);
      for (var j = 0; j < 16; j++) {
        // Little-endian 32-bit words
        M[j] = (padded[offset + j * 4] |
                (padded[offset + j * 4 + 1] << 8) |
                (padded[offset + j * 4 + 2] << 16) |
                (padded[offset + j * 4 + 3] << 24)) >>> 0;
      }

      var A = a0, B = b0, C = c0, D = d0;

      for (var i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) {
          F = ((B & C) | ((~B >>> 0) & D)) >>> 0;
          g = i;
        } else if (i < 32) {
          F = ((D & B) | ((~D >>> 0) & C)) >>> 0;
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          F = (B ^ C ^ D) >>> 0;
          g = (3 * i + 5) % 16;
        } else {
          F = (C ^ (B | (~D >>> 0))) >>> 0;
          g = (7 * i) % 16;
        }

        F = (F + A + _md5T[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + _rotl(F, _md5S[i])) >>> 0;
      }

      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    // Output in little-endian
    var hash = [];
    var vals = [a0, b0, c0, d0];
    for (var i = 0; i < 4; i++) {
      hash.push(vals[i] & 0xff);
      hash.push((vals[i] >>> 8) & 0xff);
      hash.push((vals[i] >>> 16) & 0xff);
      hash.push((vals[i] >>> 24) & 0xff);
    }
    return hash;
  }

  // ---- Hash dispatcher ----

  function _computeHash(algorithm, bytes) {
    switch (algorithm) {
      case 'sha256': return _sha256(bytes);
      case 'sha1': return _sha1(bytes);
      case 'md5': return _md5(bytes);
      default: throw new Error('Unsupported hash algorithm: ' + algorithm);
    }
  }

  function _getBlockSize(algorithm) {
    // SHA-256, SHA-1, MD5 all use 64-byte blocks
    return 64;
  }

  // ---- HMAC (RFC 2104) ----

  function _hmac(algorithm, keyBytes, dataBytes) {
    var blockSize = _getBlockSize(algorithm);

    // If key > blockSize, hash it
    if (keyBytes.length > blockSize) {
      keyBytes = _computeHash(algorithm, keyBytes);
    }

    // Pad key to blockSize
    var paddedKey = new Array(blockSize);
    for (var i = 0; i < blockSize; i++) {
      paddedKey[i] = i < keyBytes.length ? keyBytes[i] : 0;
    }

    // ipad = key XOR 0x36, opad = key XOR 0x5c
    var ipad = new Array(blockSize);
    var opad = new Array(blockSize);
    for (var i = 0; i < blockSize; i++) {
      ipad[i] = paddedKey[i] ^ 0x36;
      opad[i] = paddedKey[i] ^ 0x5c;
    }

    // HMAC = hash(opad || hash(ipad || message))
    var innerData = ipad.concat(dataBytes);
    var innerHash = _computeHash(algorithm, innerData);
    var outerData = opad.concat(innerHash);
    return _computeHash(algorithm, outerData);
  }

  // ---- Hash object ----

  function Hash(algorithm) {
    if (!(this instanceof Hash)) return new Hash(algorithm);
    this._algorithm = algorithm.toLowerCase();
    this._data = [];
    this._finalized = false;
  }

  Hash.prototype.update = function(data, inputEncoding) {
    if (this._finalized) throw new Error('Digest already called');
    var bytes = _toByteArray(data);
    for (var i = 0; i < bytes.length; i++) this._data.push(bytes[i]);
    return this;
  };

  Hash.prototype.digest = function(encoding) {
    if (this._finalized) throw new Error('Digest already called');
    this._finalized = true;
    var hashBytes = _computeHash(this._algorithm, this._data);
    encoding = (encoding || 'hex').toLowerCase();
    if (encoding === 'hex') return _bytesToHex(hashBytes);
    if (encoding === 'base64') return _bytesToBase64(hashBytes);
    return { _data: new Uint8Array(hashBytes), length: hashBytes.length };
  };

  Hash.prototype.copy = function() {
    var h = new Hash(this._algorithm);
    h._data = this._data.slice();
    return h;
  };

  // ---- Hmac object ----

  function Hmac(algorithm, key) {
    if (!(this instanceof Hmac)) return new Hmac(algorithm, key);
    this._algorithm = algorithm.toLowerCase();
    this._key = _toByteArray(key);
    this._data = [];
    this._finalized = false;
  }

  Hmac.prototype.update = function(data, inputEncoding) {
    if (this._finalized) throw new Error('Digest already called');
    var bytes = _toByteArray(data);
    for (var i = 0; i < bytes.length; i++) this._data.push(bytes[i]);
    return this;
  };

  Hmac.prototype.digest = function(encoding) {
    if (this._finalized) throw new Error('Digest already called');
    this._finalized = true;
    var hashBytes = _hmac(this._algorithm, this._key, this._data);
    encoding = (encoding || 'hex').toLowerCase();
    if (encoding === 'hex') return _bytesToHex(hashBytes);
    if (encoding === 'base64') return _bytesToBase64(hashBytes);
    return { _data: new Uint8Array(hashBytes), length: hashBytes.length };
  };

  // ---- Random functions ----

  var _state0 = 0x12345678;
  var _state1 = 0x9abcdef0;

  function _seed(s) {
    _state0 = s | 0;
    _state1 = (s * 0x6c078965 + 1) | 0;
    if (_state0 === 0) _state0 = 1;
    if (_state1 === 0) _state1 = 1;
  }

  _seed(Date.now());

  function _nextRandom() {
    var s1 = _state0;
    var s0 = _state1;
    _state0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >> 17;
    s1 ^= s0;
    s1 ^= s0 >> 26;
    _state1 = s1;
    return ((_state0 + _state1) >>> 0) / 0x100000000;
  }

  function randomBytes(size) {
    if (typeof size !== 'number' || size < 0) {
      throw new RangeError('The value of "size" is out of range.');
    }
    size = Math.floor(size);
    if (typeof __hostRandomBytes === 'function') {
      return __hostRandomBytes(size);
    }
    var bytes = new Uint8Array(size);
    for (var i = 0; i < size; i++) {
      bytes[i] = Math.floor(_nextRandom() * 256);
    }
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(bytes);
    }
    var result = {
      _data: bytes,
      length: size,
      toString: function(encoding) {
        encoding = (encoding || 'hex').toLowerCase();
        if (encoding === 'hex') return _bytesToHex(Array.prototype.slice.call(bytes));
        if (encoding === 'base64') return _bytesToBase64(Array.prototype.slice.call(bytes));
        return String.fromCharCode.apply(null, bytes);
      }
    };
    return result;
  }

  function randomUUID() {
    if (typeof __hostRandomUUID === 'function') return __hostRandomUUID();
    var bytes = new Uint8Array(16);
    for (var i = 0; i < 16; i++) bytes[i] = Math.floor(_nextRandom() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = _bytesToHex(Array.prototype.slice.call(bytes));
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' +
           hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
  }

  function randomInt(min, max) {
    if (max === undefined) { max = min; min = 0; }
    min = Math.ceil(min);
    max = Math.floor(max);
    if (min >= max) throw new RangeError('The value of "max" must be greater than "min".');
    return Math.floor(_nextRandom() * (max - min)) + min;
  }

  function randomFillSync(buffer, offset, size) {
    offset = offset || 0;
    var data = buffer._data || buffer;
    size = size !== undefined ? size : data.length - offset;
    for (var i = 0; i < size; i++) data[offset + i] = Math.floor(_nextRandom() * 256);
    return buffer;
  }

  function timingSafeEqual(a, b) {
    var aData = a._data || a;
    var bData = b._data || b;
    if (aData.length !== bData.length) {
      throw new RangeError('Input buffers must have the same byte length');
    }
    var result = 0;
    for (var i = 0; i < aData.length; i++) result |= aData[i] ^ bData[i];
    return result === 0;
  }

  module.exports = {
    createHash: function(alg) { return new Hash(alg); },
    createHmac: function(alg, key) { return new Hmac(alg, key); },
    randomBytes: randomBytes,
    randomUUID: randomUUID,
    randomInt: randomInt,
    randomFillSync: randomFillSync,
    getHashes: function() { return ['md5', 'sha1', 'sha256']; },
    getCiphers: function() { return []; },
    timingSafeEqual: timingSafeEqual,
    Hash: Hash,
    Hmac: Hmac
  };
})();
`;
}

// ---- OS module ----

export function getUnenvOsSource(): string {
  return `
(function() {
  var os = {
    platform: function() { return 'browser'; },
    type: function() { return 'Browser'; },
    arch: function() { return 'wasm32'; },
    release: function() { return '0.0.0'; },
    tmpdir: function() { return '/tmp'; },
    homedir: function() { return '/home'; },
    hostname: function() { return 'atua'; },
    cpus: function() { return [{ model: 'browser', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }]; },
    totalmem: function() { return 4 * 1024 * 1024 * 1024; },
    freemem: function() { return 2 * 1024 * 1024 * 1024; },
    uptime: function() { return Math.floor(Date.now() / 1000); },
    loadavg: function() { return [0, 0, 0]; },
    networkInterfaces: function() { return {}; },
    userInfo: function() { return { uid: 1000, gid: 1000, username: 'atua', homedir: '/home', shell: '/bin/sh' }; },
    endianness: function() { return 'LE'; },
    EOL: '\\n'
  };
  module.exports = os;
})();
`;
}

// ---- Stream module (minimal working implementation) ----

export function getUnenvStreamSource(): string {
  return `
(function() {
  var EventEmitter = require('events');

  function Stream() {
    EventEmitter.call(this);
  }
  Stream.prototype = Object.create(EventEmitter.prototype);
  Stream.prototype.constructor = Stream;

  Stream.prototype.pipe = function(dest) {
    var source = this;
    source.on('data', function(chunk) {
      if (dest.write) dest.write(chunk);
    });
    source.on('end', function() {
      if (dest.end) dest.end();
    });
    source.on('error', function(err) {
      dest.emit('error', err);
    });
    return dest;
  };

  // ---- Readable ----

  function Readable(options) {
    if (!(this instanceof Readable)) return new Readable(options);
    Stream.call(this);
    this._readableState = {
      buffer: [],
      ended: false,
      flowing: false,
      reading: false
    };
    if (options && typeof options.read === 'function') {
      this._read = options.read;
    }
  }
  Readable.prototype = Object.create(Stream.prototype);
  Readable.prototype.constructor = Readable;

  Readable.prototype._read = function(size) {};

  Readable.prototype.push = function(chunk) {
    if (chunk === null) {
      this._readableState.ended = true;
      this.emit('end');
      return false;
    }
    this._readableState.buffer.push(chunk);
    this.emit('data', chunk);
    return true;
  };

  Readable.prototype.read = function(size) {
    if (this._readableState.buffer.length === 0) {
      this._read(size || 16384);
    }
    if (this._readableState.buffer.length === 0) return null;
    return this._readableState.buffer.shift();
  };

  Readable.prototype.resume = function() {
    this._readableState.flowing = true;
    return this;
  };

  Readable.prototype.pause = function() {
    this._readableState.flowing = false;
    return this;
  };

  Readable.prototype.setEncoding = function(enc) {
    this._encoding = enc;
    return this;
  };

  Readable.prototype.destroy = function() {
    this.emit('close');
    return this;
  };

  // ---- Writable ----

  function Writable(options) {
    if (!(this instanceof Writable)) return new Writable(options);
    Stream.call(this);
    this._writableState = { ended: false, chunks: [] };
    if (options && typeof options.write === 'function') {
      this._write = options.write;
    }
  }
  Writable.prototype = Object.create(Stream.prototype);
  Writable.prototype.constructor = Writable;

  Writable.prototype._write = function(chunk, encoding, callback) {
    callback();
  };

  Writable.prototype.write = function(chunk, encoding, callback) {
    if (typeof encoding === 'function') { callback = encoding; encoding = 'utf-8'; }
    this._writableState.chunks.push(chunk);
    var self = this;
    this._write(chunk, encoding || 'utf-8', function(err) {
      if (err) self.emit('error', err);
      if (typeof callback === 'function') callback(err);
    });
    return true;
  };

  Writable.prototype.end = function(chunk, encoding, callback) {
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    if (chunk !== undefined && chunk !== null) this.write(chunk, encoding);
    this._writableState.ended = true;
    this.emit('finish');
    if (typeof callback === 'function') callback();
    return this;
  };

  Writable.prototype.destroy = function() {
    this.emit('close');
    return this;
  };

  // ---- Duplex ----

  function Duplex(options) {
    if (!(this instanceof Duplex)) return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    this._writableState = this._writableState || { ended: false, chunks: [] };
  }
  Duplex.prototype = Object.create(Readable.prototype);
  // Mix in Writable methods
  var writableMethods = ['write', 'end', '_write', 'destroy'];
  for (var i = 0; i < writableMethods.length; i++) {
    var m = writableMethods[i];
    if (!Duplex.prototype[m]) Duplex.prototype[m] = Writable.prototype[m];
  }
  Duplex.prototype.constructor = Duplex;

  // ---- Transform ----

  function Transform(options) {
    if (!(this instanceof Transform)) return new Transform(options);
    Duplex.call(this, options);
    if (options && typeof options.transform === 'function') {
      this._transform = options.transform;
    }
  }
  Transform.prototype = Object.create(Duplex.prototype);
  Transform.prototype.constructor = Transform;

  Transform.prototype._transform = function(chunk, encoding, callback) {
    this.push(chunk);
    callback();
  };

  Transform.prototype._write = function(chunk, encoding, callback) {
    var self = this;
    this._transform(chunk, encoding, function(err, data) {
      if (data !== undefined && data !== null) self.push(data);
      callback(err);
    });
  };

  // ---- PassThrough ----

  function PassThrough(options) {
    if (!(this instanceof PassThrough)) return new PassThrough(options);
    Transform.call(this, options);
  }
  PassThrough.prototype = Object.create(Transform.prototype);
  PassThrough.prototype.constructor = PassThrough;

  PassThrough.prototype._transform = function(chunk, encoding, callback) {
    this.push(chunk);
    callback();
  };

  module.exports = {
    Stream: Stream,
    Readable: Readable,
    Writable: Writable,
    Duplex: Duplex,
    Transform: Transform,
    PassThrough: PassThrough
  };
})();
`;
}

// ---- HTTP module (stubs pointing to Hono) ----

export function getUnenvHttpSource(): string {
  return `
(function() {
  function IncomingMessage() {}
  function ServerResponse() {}

  var STATUS_CODES = {
    100: 'Continue', 101: 'Switching Protocols',
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
  };

  module.exports = {
    createServer: function() {
      throw new Error(
        'http.createServer() is not available in browser. ' +
        'Use Hono routes in /src/api/ instead. ' +
        'See: atua-spec.md Phase 12.'
      );
    },
    request: function() {
      throw new Error('[atua] http.request() is not available in browser. Use fetch() instead.');
    },
    get: function() {
      throw new Error('[atua] http.get() is not available in browser. Use fetch() instead.');
    },
    IncomingMessage: IncomingMessage,
    ServerResponse: ServerResponse,
    STATUS_CODES: STATUS_CODES,
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
  };
})();
`;
}

// ---- Querystring module ----

export function getUnenvQuerystringSource(): string {
  return `
(function() {
  function parse(str, sep, eq) {
    sep = sep || '&';
    eq = eq || '=';
    var result = {};
    if (typeof str !== 'string' || str.length === 0) return result;
    var pairs = str.split(sep);
    for (var i = 0; i < pairs.length; i++) {
      var idx = pairs[i].indexOf(eq);
      var key, value;
      if (idx >= 0) {
        key = decodeURIComponent(pairs[i].substring(0, idx).replace(/\\+/g, ' '));
        value = decodeURIComponent(pairs[i].substring(idx + 1).replace(/\\+/g, ' '));
      } else {
        key = decodeURIComponent(pairs[i].replace(/\\+/g, ' '));
        value = '';
      }
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) {
          result[key].push(value);
        } else {
          result[key] = [result[key], value];
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function stringify(obj, sep, eq) {
    sep = sep || '&';
    eq = eq || '=';
    if (!obj || typeof obj !== 'object') return '';
    var pairs = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      if (Array.isArray(v)) {
        for (var j = 0; j < v.length; j++) {
          pairs.push(encodeURIComponent(k) + eq + encodeURIComponent(v[j]));
        }
      } else {
        pairs.push(encodeURIComponent(k) + eq + encodeURIComponent(v));
      }
    }
    return pairs.join(sep);
  }

  module.exports = {
    parse: parse,
    decode: parse,
    stringify: stringify,
    encode: stringify,
    escape: encodeURIComponent,
    unescape: decodeURIComponent
  };
})();
`;
}

// ---- StringDecoder module ----

export function getUnenvStringDecoderSource(): string {
  return `
(function() {
  function StringDecoder(encoding) {
    this.encoding = (encoding || 'utf-8').toLowerCase();
    if (this.encoding === 'utf8') this.encoding = 'utf-8';
  }

  StringDecoder.prototype.write = function(buffer) {
    if (typeof buffer === 'string') return buffer;
    var data = buffer._data || buffer;
    if (data instanceof Uint8Array || Array.isArray(data)) {
      var result = '';
      for (var i = 0; i < data.length; i++) {
        result += String.fromCharCode(data[i]);
      }
      return result;
    }
    return String(buffer);
  };

  StringDecoder.prototype.end = function(buffer) {
    return buffer ? this.write(buffer) : '';
  };

  module.exports = { StringDecoder: StringDecoder };
})();
`;
}

// ---- Zlib module (stubs) ----

export function getUnenvZlibSource(): string {
  return `
(function() {
  function notAvailable(name) {
    return function() {
      throw new Error('[atua] zlib.' + name + '() is not available in QuickJS sandbox. Use the browser CompressionStream API from host context.');
    };
  }

  module.exports = {
    gzip: notAvailable('gzip'),
    gunzip: notAvailable('gunzip'),
    deflate: notAvailable('deflate'),
    inflate: notAvailable('inflate'),
    createGzip: notAvailable('createGzip'),
    createGunzip: notAvailable('createGunzip'),
    createDeflate: notAvailable('createDeflate'),
    createInflate: notAvailable('createInflate'),
    constants: { Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1 }
  };
})();
`;
}

// ---- Stub module source for truly unavailable modules ----

export function getStubModuleSource(name: string): string {
  return `
(function() {
  function notAvailable(method) {
    return function() {
      throw new Error('[atua] ' + '${name}' + '.' + method + '() is not available in browser sandbox.');
    };
  }

  var stub = {};
  var methods = {
    net: ['connect', 'createServer', 'createConnection', 'Socket', 'Server'],
    tls: ['connect', 'createServer', 'createSecureContext', 'TLSSocket'],
    dns: ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse'],
    dgram: ['createSocket', 'Socket'],
    cluster: ['fork', 'isMaster', 'isWorker', 'workers'],
    worker_threads: ['Worker', 'isMainThread', 'parentPort', 'workerData'],
    v8: ['getHeapStatistics', 'getHeapSpaceStatistics', 'serialize', 'deserialize'],
    child_process: ['exec', 'execSync', 'spawn', 'spawnSync', 'fork', 'execFile']
  };

  var moduleMethods = methods['${name}'] || ['default'];
  for (var i = 0; i < moduleMethods.length; i++) {
    stub[moduleMethods[i]] = notAvailable(moduleMethods[i]);
  }
  module.exports = stub;
})();
`;
}

// ---- Module registries ----

/** Modules backed by unenv-style polyfills (source strings for QuickJS) */
export const UNENV_MODULES: Record<string, () => string> = {
  crypto: getUnenvCryptoSource,
  os: getUnenvOsSource,
  stream: getUnenvStreamSource,
  http: getUnenvHttpSource,
  querystring: getUnenvQuerystringSource,
  string_decoder: getUnenvStringDecoderSource,
  zlib: getUnenvZlibSource,
};

/** Modules that cannot work in browser — stub with clear errors */
export const STUB_MODULES = [
  'net', 'tls', 'dns', 'dgram', 'cluster', 'worker_threads', 'v8', 'child_process',
];

/** Provider attribution for each module.method — powers the compat report */
export const PROVIDER_REGISTRY: Record<string, Record<string, string>> = {
  fs: {
    readFileSync: 'atua', writeFileSync: 'atua', existsSync: 'atua',
    mkdirSync: 'atua', readdirSync: 'atua', statSync: 'atua',
    unlinkSync: 'atua', renameSync: 'atua', copyFileSync: 'atua',
    appendFileSync: 'atua', rmdirSync: 'atua',
  },
  path: {
    join: 'atua', resolve: 'atua', basename: 'atua',
    dirname: 'atua', extname: 'atua', normalize: 'atua',
    isAbsolute: 'atua', sep: 'atua', parse: 'atua',
  },
  buffer: {
    'Buffer.from(string)': 'atua', 'Buffer.alloc': 'atua',
    'Buffer.isBuffer': 'atua', 'Buffer.concat': 'atua',
  },
  events: {
    'on/emit': 'atua', once: 'atua',
    removeAllListeners: 'atua', listenerCount: 'atua',
  },
  process: {
    env: 'atua', 'cwd()': 'atua', platform: 'atua', version: 'atua',
  },
  console: {
    log: 'atua', error: 'atua', warn: 'atua',
  },
  assert: {
    ok: 'atua', equal: 'atua', strictEqual: 'atua', deepEqual: 'atua',
  },
  util: {
    format: 'atua', inspect: 'atua',
  },
  url: {
    URL: 'atua', URLSearchParams: 'atua',
  },
  crypto: {
    createHash: 'unenv', createHmac: 'unenv', randomBytes: 'unenv',
    randomUUID: 'unenv', randomInt: 'unenv', getHashes: 'unenv',
    timingSafeEqual: 'unenv',
  },
  os: {
    platform: 'unenv', type: 'unenv', arch: 'unenv', tmpdir: 'unenv',
    homedir: 'unenv', hostname: 'unenv', cpus: 'unenv', totalmem: 'unenv',
    freemem: 'unenv', uptime: 'unenv', EOL: 'unenv',
  },
  stream: {
    Readable: 'unenv', Writable: 'unenv', Transform: 'unenv',
    Duplex: 'unenv', PassThrough: 'unenv', Stream: 'unenv',
  },
  http: {
    createServer: 'unenv', IncomingMessage: 'unenv',
    ServerResponse: 'unenv', STATUS_CODES: 'unenv',
  },
  querystring: {
    parse: 'unenv', stringify: 'unenv', escape: 'unenv', unescape: 'unenv',
  },
  string_decoder: {
    StringDecoder: 'unenv',
  },
  zlib: {
    gzip: 'stub', gunzip: 'stub', createGzip: 'stub', createGunzip: 'stub',
  },
  net: {
    connect: 'not_possible', createServer: 'not_possible', Socket: 'not_possible',
  },
  tls: {
    connect: 'not_possible', createServer: 'not_possible', TLSSocket: 'not_possible',
  },
  dns: {
    lookup: 'not_possible', resolve: 'not_possible', resolve4: 'not_possible',
  },
  child_process: {
    exec: 'not_possible', spawn: 'not_possible', fork: 'not_possible',
  },
};
