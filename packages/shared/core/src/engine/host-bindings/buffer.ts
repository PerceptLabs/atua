/**
 * Buffer polyfill for QuickJS.
 * Implements Buffer as a Uint8Array wrapper with encoding support.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getBufferSource(): string {
  return `
(function() {
  // Simple base64 encode/decode (pure JS, no browser APIs)
  var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64Encode(bytes) {
    var result = '';
    var i;
    for (i = 0; i < bytes.length - 2; i += 3) {
      result += BASE64_CHARS[(bytes[i] >> 2) & 0x3f];
      result += BASE64_CHARS[((bytes[i] & 0x03) << 4) | ((bytes[i + 1] >> 4) & 0x0f)];
      result += BASE64_CHARS[((bytes[i + 1] & 0x0f) << 2) | ((bytes[i + 2] >> 6) & 0x03)];
      result += BASE64_CHARS[bytes[i + 2] & 0x3f];
    }
    if (i === bytes.length - 1) {
      result += BASE64_CHARS[(bytes[i] >> 2) & 0x3f];
      result += BASE64_CHARS[(bytes[i] & 0x03) << 4];
      result += '==';
    } else if (i === bytes.length - 2) {
      result += BASE64_CHARS[(bytes[i] >> 2) & 0x3f];
      result += BASE64_CHARS[((bytes[i] & 0x03) << 4) | ((bytes[i + 1] >> 4) & 0x0f)];
      result += BASE64_CHARS[(bytes[i + 1] & 0x0f) << 2];
      result += '=';
    }
    return result;
  }

  function base64Decode(str) {
    str = str.replace(/[^A-Za-z0-9+/]/g, '');
    var bytes = [];
    var i;
    for (i = 0; i < str.length; i += 4) {
      var a = BASE64_CHARS.indexOf(str[i]);
      var b = BASE64_CHARS.indexOf(str[i + 1]);
      var c = BASE64_CHARS.indexOf(str[i + 2]);
      var d = BASE64_CHARS.indexOf(str[i + 3]);
      bytes.push((a << 2) | (b >> 4));
      if (c !== -1) bytes.push(((b & 0x0f) << 4) | (c >> 2));
      if (d !== -1) bytes.push(((c & 0x03) << 6) | d);
    }
    return new Uint8Array(bytes);
  }

  function hexEncode(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  function hexDecode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i += 2) {
      bytes.push(parseInt(str.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  }

  function utf8Encode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code < 0xdc00) {
        // Surrogate pair
        var next = str.charCodeAt(++i);
        var cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        bytes.push(0xf0 | (cp >> 18));
        bytes.push(0x80 | ((cp >> 12) & 0x3f));
        bytes.push(0x80 | ((cp >> 6) & 0x3f));
        bytes.push(0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  function utf8Decode(bytes, start, end) {
    start = start || 0;
    end = end !== undefined ? end : bytes.length;
    var result = '';
    var i = start;
    while (i < end) {
      var byte1 = bytes[i++];
      if (byte1 < 0x80) {
        result += String.fromCharCode(byte1);
      } else if (byte1 < 0xe0) {
        var byte2 = bytes[i++];
        result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      } else if (byte1 < 0xf0) {
        var byte2 = bytes[i++];
        var byte3 = bytes[i++];
        result += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      } else {
        var byte2 = bytes[i++];
        var byte3 = bytes[i++];
        var byte4 = bytes[i++];
        var cp = ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
        cp -= 0x10000;
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return result;
  }

  function Buffer(arg, encodingOrOffset, length) {
    if (!(this instanceof Buffer)) {
      return new Buffer(arg, encodingOrOffset, length);
    }

    if (typeof arg === 'number') {
      this._data = new Uint8Array(arg);
    } else if (typeof arg === 'string') {
      var encoding = (encodingOrOffset || 'utf8').toLowerCase();
      if (encoding === 'utf8' || encoding === 'utf-8') {
        this._data = utf8Encode(arg);
      } else if (encoding === 'base64') {
        this._data = base64Decode(arg);
      } else if (encoding === 'hex') {
        this._data = hexDecode(arg);
      } else if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
        var bytes = new Uint8Array(arg.length);
        for (var i = 0; i < arg.length; i++) {
          bytes[i] = arg.charCodeAt(i) & 0xff;
        }
        this._data = bytes;
      } else {
        this._data = utf8Encode(arg);
      }
    } else if (arg instanceof Uint8Array) {
      this._data = new Uint8Array(arg);
    } else if (arg instanceof ArrayBuffer) {
      this._data = new Uint8Array(arg);
    } else if (arg && arg._data instanceof Uint8Array) {
      // Buffer-like
      this._data = new Uint8Array(arg._data);
    } else if (Array.isArray(arg)) {
      this._data = new Uint8Array(arg);
    } else {
      this._data = new Uint8Array(0);
    }

    this.length = this._data.length;
  }

  // Static methods
  Buffer.from = function(value, encodingOrOffset, length) {
    if (typeof value === 'string') {
      return new Buffer(value, encodingOrOffset);
    }
    if (Array.isArray(value) || value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return new Buffer(value);
    }
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return new Buffer(value.data);
    }
    if (value && value._data instanceof Uint8Array) {
      return new Buffer(value);
    }
    throw new TypeError('The first argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.');
  };

  Buffer.alloc = function(size, fill, encoding) {
    if (typeof size !== 'number' || size < 0) {
      throw new RangeError('The value of "size" is out of range.');
    }
    var buf = new Buffer(size);
    if (fill !== undefined) {
      if (typeof fill === 'string') {
        var fillBuf = Buffer.from(fill, encoding);
        for (var i = 0; i < size; i++) {
          buf._data[i] = fillBuf._data[i % fillBuf._data.length];
        }
      } else if (typeof fill === 'number') {
        for (var i = 0; i < size; i++) {
          buf._data[i] = fill & 0xff;
        }
      }
      buf.length = buf._data.length;
    }
    return buf;
  };

  Buffer.allocUnsafe = function(size) {
    return Buffer.alloc(size);
  };

  Buffer.concat = function(list, totalLength) {
    if (!Array.isArray(list)) {
      throw new TypeError('"list" argument must be an Array of Buffers');
    }
    if (list.length === 0) return Buffer.alloc(0);

    if (totalLength === undefined) {
      totalLength = 0;
      for (var i = 0; i < list.length; i++) {
        totalLength += list[i].length;
      }
    }

    var result = Buffer.alloc(totalLength);
    var offset = 0;
    for (var i = 0; i < list.length; i++) {
      var buf = list[i];
      var data = buf._data || buf;
      for (var j = 0; j < data.length && offset < totalLength; j++) {
        result._data[offset++] = data[j];
      }
    }
    result.length = result._data.length;
    return result;
  };

  Buffer.isBuffer = function(obj) {
    return obj instanceof Buffer;
  };

  Buffer.isEncoding = function(encoding) {
    if (typeof encoding !== 'string') return false;
    encoding = encoding.toLowerCase();
    return ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'base64', 'hex'].indexOf(encoding) !== -1;
  };

  Buffer.byteLength = function(string, encoding) {
    if (typeof string !== 'string') {
      if (string instanceof Uint8Array || string instanceof ArrayBuffer) {
        return string.byteLength;
      }
      if (Buffer.isBuffer(string)) {
        return string.length;
      }
    }
    encoding = (encoding || 'utf8').toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return utf8Encode(string).length;
    } else if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
      return string.length;
    } else if (encoding === 'base64') {
      return base64Decode(string).length;
    } else if (encoding === 'hex') {
      return string.length >>> 1;
    }
    return utf8Encode(string).length;
  };

  Buffer.compare = function(buf1, buf2) {
    if (!Buffer.isBuffer(buf1) || !Buffer.isBuffer(buf2)) {
      throw new TypeError('Arguments must be Buffers');
    }
    var len = Math.min(buf1.length, buf2.length);
    for (var i = 0; i < len; i++) {
      if (buf1._data[i] < buf2._data[i]) return -1;
      if (buf1._data[i] > buf2._data[i]) return 1;
    }
    if (buf1.length < buf2.length) return -1;
    if (buf1.length > buf2.length) return 1;
    return 0;
  };

  // Prototype methods
  Buffer.prototype.toString = function(encoding, start, end) {
    encoding = (encoding || 'utf8').toLowerCase();
    start = start || 0;
    end = end !== undefined ? end : this.length;

    if (start >= end) return '';

    if (encoding === 'utf8' || encoding === 'utf-8') {
      return utf8Decode(this._data, start, end);
    } else if (encoding === 'base64') {
      return base64Encode(this._data.subarray(start, end));
    } else if (encoding === 'hex') {
      return hexEncode(this._data.subarray(start, end));
    } else if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
      var result = '';
      for (var i = start; i < end; i++) {
        result += String.fromCharCode(this._data[i]);
      }
      return result;
    }
    return utf8Decode(this._data, start, end);
  };

  Buffer.prototype.toJSON = function() {
    var data = [];
    for (var i = 0; i < this._data.length; i++) {
      data.push(this._data[i]);
    }
    return { type: 'Buffer', data: data };
  };

  Buffer.prototype.slice = function(start, end) {
    start = start || 0;
    end = end !== undefined ? end : this.length;
    if (start < 0) start = Math.max(this.length + start, 0);
    if (end < 0) end = Math.max(this.length + end, 0);
    if (end > this.length) end = this.length;
    if (start >= end) return Buffer.alloc(0);
    return Buffer.from(this._data.subarray(start, end));
  };

  Buffer.prototype.subarray = Buffer.prototype.slice;

  Buffer.prototype.copy = function(target, targetStart, sourceStart, sourceEnd) {
    targetStart = targetStart || 0;
    sourceStart = sourceStart || 0;
    sourceEnd = sourceEnd !== undefined ? sourceEnd : this.length;
    if (sourceEnd === sourceStart) return 0;
    if (target.length === 0 || this.length === 0) return 0;

    var len = sourceEnd - sourceStart;
    if (targetStart + len > target.length) {
      len = target.length - targetStart;
    }
    for (var i = 0; i < len; i++) {
      target._data[targetStart + i] = this._data[sourceStart + i];
    }
    return len;
  };

  Buffer.prototype.write = function(string, offset, length, encoding) {
    if (typeof offset === 'string') {
      encoding = offset;
      offset = 0;
      length = this.length;
    } else if (typeof length === 'string') {
      encoding = length;
      length = this.length - offset;
    }
    offset = offset || 0;
    length = length !== undefined ? length : this.length - offset;
    encoding = (encoding || 'utf8').toLowerCase();

    var encoded;
    if (encoding === 'utf8' || encoding === 'utf-8') {
      encoded = utf8Encode(string);
    } else if (encoding === 'ascii' || encoding === 'latin1' || encoding === 'binary') {
      encoded = new Uint8Array(string.length);
      for (var i = 0; i < string.length; i++) {
        encoded[i] = string.charCodeAt(i) & 0xff;
      }
    } else if (encoding === 'hex') {
      encoded = hexDecode(string);
    } else if (encoding === 'base64') {
      encoded = base64Decode(string);
    } else {
      encoded = utf8Encode(string);
    }

    var bytesToWrite = Math.min(length, encoded.length, this.length - offset);
    for (var i = 0; i < bytesToWrite; i++) {
      this._data[offset + i] = encoded[i];
    }
    return bytesToWrite;
  };

  Buffer.prototype.fill = function(value, offset, end, encoding) {
    offset = offset || 0;
    end = end !== undefined ? end : this.length;
    if (typeof value === 'string') {
      if (value.length === 1) {
        var code = value.charCodeAt(0);
        if (code < 256) value = code;
      }
    }
    if (typeof value === 'number') {
      for (var i = offset; i < end; i++) {
        this._data[i] = value & 0xff;
      }
    } else if (typeof value === 'string') {
      var fillBuf = Buffer.from(value, encoding);
      for (var i = offset; i < end; i++) {
        this._data[i] = fillBuf._data[(i - offset) % fillBuf.length];
      }
    }
    return this;
  };

  Buffer.prototype.equals = function(other) {
    if (!Buffer.isBuffer(other)) {
      throw new TypeError('Argument must be a Buffer');
    }
    if (this.length !== other.length) return false;
    for (var i = 0; i < this.length; i++) {
      if (this._data[i] !== other._data[i]) return false;
    }
    return true;
  };

  Buffer.prototype.compare = function(target, targetStart, targetEnd, sourceStart, sourceEnd) {
    if (!Buffer.isBuffer(target)) {
      throw new TypeError('Argument must be a Buffer');
    }
    targetStart = targetStart || 0;
    targetEnd = targetEnd !== undefined ? targetEnd : target.length;
    sourceStart = sourceStart || 0;
    sourceEnd = sourceEnd !== undefined ? sourceEnd : this.length;

    var len = Math.min(sourceEnd - sourceStart, targetEnd - targetStart);
    for (var i = 0; i < len; i++) {
      if (this._data[sourceStart + i] < target._data[targetStart + i]) return -1;
      if (this._data[sourceStart + i] > target._data[targetStart + i]) return 1;
    }
    var sourceLen = sourceEnd - sourceStart;
    var targetLen = targetEnd - targetStart;
    if (sourceLen < targetLen) return -1;
    if (sourceLen > targetLen) return 1;
    return 0;
  };

  Buffer.prototype.indexOf = function(value, byteOffset, encoding) {
    byteOffset = byteOffset || 0;
    if (typeof value === 'string') {
      value = Buffer.from(value, encoding);
    } else if (typeof value === 'number') {
      for (var i = byteOffset; i < this.length; i++) {
        if (this._data[i] === (value & 0xff)) return i;
      }
      return -1;
    }
    if (value.length === 0) return byteOffset;
    for (var i = byteOffset; i <= this.length - value.length; i++) {
      var found = true;
      for (var j = 0; j < value.length; j++) {
        if (this._data[i + j] !== value._data[j]) {
          found = false;
          break;
        }
      }
      if (found) return i;
    }
    return -1;
  };

  Buffer.prototype.includes = function(value, byteOffset, encoding) {
    return this.indexOf(value, byteOffset, encoding) !== -1;
  };

  Buffer.prototype.readUInt8 = function(offset) {
    offset = offset || 0;
    return this._data[offset];
  };

  Buffer.prototype.readUInt16BE = function(offset) {
    offset = offset || 0;
    return (this._data[offset] << 8) | this._data[offset + 1];
  };

  Buffer.prototype.readUInt16LE = function(offset) {
    offset = offset || 0;
    return this._data[offset] | (this._data[offset + 1] << 8);
  };

  Buffer.prototype.readUInt32BE = function(offset) {
    offset = offset || 0;
    return ((this._data[offset] * 0x1000000) +
      ((this._data[offset + 1] << 16) |
       (this._data[offset + 2] << 8) |
       this._data[offset + 3]));
  };

  Buffer.prototype.readUInt32LE = function(offset) {
    offset = offset || 0;
    return ((this._data[offset + 3] * 0x1000000) +
      ((this._data[offset + 2] << 16) |
       (this._data[offset + 1] << 8) |
       this._data[offset]));
  };

  Buffer.prototype.readInt8 = function(offset) {
    offset = offset || 0;
    var val = this._data[offset];
    return val & 0x80 ? val - 0x100 : val;
  };

  Buffer.prototype.readInt16BE = function(offset) {
    offset = offset || 0;
    var val = (this._data[offset] << 8) | this._data[offset + 1];
    return val & 0x8000 ? val - 0x10000 : val;
  };

  Buffer.prototype.readInt16LE = function(offset) {
    offset = offset || 0;
    var val = this._data[offset] | (this._data[offset + 1] << 8);
    return val & 0x8000 ? val - 0x10000 : val;
  };

  Buffer.prototype.readInt32BE = function(offset) {
    offset = offset || 0;
    return (this._data[offset] << 24) |
           (this._data[offset + 1] << 16) |
           (this._data[offset + 2] << 8) |
           this._data[offset + 3];
  };

  Buffer.prototype.readInt32LE = function(offset) {
    offset = offset || 0;
    return (this._data[offset + 3] << 24) |
           (this._data[offset + 2] << 16) |
           (this._data[offset + 1] << 8) |
           this._data[offset];
  };

  Buffer.prototype.writeUInt8 = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = value & 0xff;
    return offset + 1;
  };

  Buffer.prototype.writeUInt16BE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = (value >> 8) & 0xff;
    this._data[offset + 1] = value & 0xff;
    return offset + 2;
  };

  Buffer.prototype.writeUInt16LE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = value & 0xff;
    this._data[offset + 1] = (value >> 8) & 0xff;
    return offset + 2;
  };

  Buffer.prototype.writeUInt32BE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = (value >>> 24) & 0xff;
    this._data[offset + 1] = (value >>> 16) & 0xff;
    this._data[offset + 2] = (value >>> 8) & 0xff;
    this._data[offset + 3] = value & 0xff;
    return offset + 4;
  };

  Buffer.prototype.writeUInt32LE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = value & 0xff;
    this._data[offset + 1] = (value >>> 8) & 0xff;
    this._data[offset + 2] = (value >>> 16) & 0xff;
    this._data[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  };

  Buffer.prototype.writeInt8 = function(value, offset) {
    offset = offset || 0;
    if (value < 0) value = 0x100 + value;
    this._data[offset] = value & 0xff;
    return offset + 1;
  };

  Buffer.prototype.writeInt16BE = function(value, offset) {
    offset = offset || 0;
    if (value < 0) value = 0x10000 + value;
    this._data[offset] = (value >> 8) & 0xff;
    this._data[offset + 1] = value & 0xff;
    return offset + 2;
  };

  Buffer.prototype.writeInt16LE = function(value, offset) {
    offset = offset || 0;
    if (value < 0) value = 0x10000 + value;
    this._data[offset] = value & 0xff;
    this._data[offset + 1] = (value >> 8) & 0xff;
    return offset + 2;
  };

  Buffer.prototype.writeInt32BE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = (value >>> 24) & 0xff;
    this._data[offset + 1] = (value >>> 16) & 0xff;
    this._data[offset + 2] = (value >>> 8) & 0xff;
    this._data[offset + 3] = value & 0xff;
    return offset + 4;
  };

  Buffer.prototype.writeInt32LE = function(value, offset) {
    offset = offset || 0;
    this._data[offset] = value & 0xff;
    this._data[offset + 1] = (value >>> 8) & 0xff;
    this._data[offset + 2] = (value >>> 16) & 0xff;
    this._data[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  };

  Buffer.prototype.swap16 = function() {
    for (var i = 0; i < this.length; i += 2) {
      var tmp = this._data[i];
      this._data[i] = this._data[i + 1];
      this._data[i + 1] = tmp;
    }
    return this;
  };

  Buffer.prototype.swap32 = function() {
    for (var i = 0; i < this.length; i += 4) {
      var tmp0 = this._data[i];
      var tmp1 = this._data[i + 1];
      this._data[i] = this._data[i + 3];
      this._data[i + 1] = this._data[i + 2];
      this._data[i + 2] = tmp1;
      this._data[i + 3] = tmp0;
    }
    return this;
  };

  Buffer.prototype[Symbol.iterator] = function() {
    var index = 0;
    var data = this._data;
    return {
      next: function() {
        if (index < data.length) {
          return { value: data[index++], done: false };
        }
        return { done: true };
      }
    };
  };

  module.exports = { Buffer: Buffer };
})();
`;
}
