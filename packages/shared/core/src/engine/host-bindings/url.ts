/**
 * URL and URLSearchParams shim for QuickJS.
 * Pure JS implementation of the WHATWG URL API.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getUrlSource(): string {
  return `
(function() {
  // ---- URLSearchParams ----

  function URLSearchParams(init) {
    this._entries = [];

    if (typeof init === 'string') {
      if (init.charAt(0) === '?') init = init.slice(1);
      this._parseString(init);
    } else if (init instanceof URLSearchParams) {
      var entries = init._entries;
      for (var i = 0; i < entries.length; i++) {
        this._entries.push([entries[i][0], entries[i][1]]);
      }
    } else if (Array.isArray(init)) {
      for (var i = 0; i < init.length; i++) {
        if (!Array.isArray(init[i]) || init[i].length !== 2) {
          throw new TypeError('Each entry must be an array of [name, value]');
        }
        this._entries.push([String(init[i][0]), String(init[i][1])]);
      }
    } else if (init && typeof init === 'object') {
      var keys = Object.keys(init);
      for (var i = 0; i < keys.length; i++) {
        this._entries.push([keys[i], String(init[keys[i]])]);
      }
    }
  }

  URLSearchParams.prototype._parseString = function(str) {
    if (!str) return;
    var pairs = str.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (!pair) continue;
      var eqIdx = pair.indexOf('=');
      var name, value;
      if (eqIdx === -1) {
        name = _decodeURIComponentSafe(pair);
        value = '';
      } else {
        name = _decodeURIComponentSafe(pair.slice(0, eqIdx));
        value = _decodeURIComponentSafe(pair.slice(eqIdx + 1));
      }
      this._entries.push([name, value]);
    }
  };

  function _decodeURIComponentSafe(str) {
    try {
      return decodeURIComponent(str.replace(/\\+/g, ' '));
    } catch (e) {
      return str;
    }
  }

  function _encodeComponent(str) {
    return encodeURIComponent(str)
      .replace(/%20/g, '+')
      .replace(/[!'()~]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
      });
  }

  URLSearchParams.prototype.append = function(name, value) {
    this._entries.push([String(name), String(value)]);
  };

  URLSearchParams.prototype.delete = function(name) {
    this._entries = this._entries.filter(function(e) { return e[0] !== String(name); });
  };

  URLSearchParams.prototype.get = function(name) {
    name = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === name) return this._entries[i][1];
    }
    return null;
  };

  URLSearchParams.prototype.getAll = function(name) {
    name = String(name);
    var results = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === name) results.push(this._entries[i][1]);
    }
    return results;
  };

  URLSearchParams.prototype.has = function(name) {
    name = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === name) return true;
    }
    return false;
  };

  URLSearchParams.prototype.set = function(name, value) {
    name = String(name);
    value = String(value);
    var found = false;
    var newEntries = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === name) {
        if (!found) {
          newEntries.push([name, value]);
          found = true;
        }
        // skip duplicates
      } else {
        newEntries.push(this._entries[i]);
      }
    }
    if (!found) {
      newEntries.push([name, value]);
    }
    this._entries = newEntries;
  };

  URLSearchParams.prototype.sort = function() {
    this._entries.sort(function(a, b) {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
  };

  URLSearchParams.prototype.toString = function() {
    var parts = [];
    for (var i = 0; i < this._entries.length; i++) {
      parts.push(_encodeComponent(this._entries[i][0]) + '=' + _encodeComponent(this._entries[i][1]));
    }
    return parts.join('&');
  };

  URLSearchParams.prototype.forEach = function(callback, thisArg) {
    for (var i = 0; i < this._entries.length; i++) {
      callback.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };

  URLSearchParams.prototype.keys = function() {
    var index = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (index < entries.length) {
          return { value: entries[index++][0], done: false };
        }
        return { done: true };
      }
    };
  };

  URLSearchParams.prototype.values = function() {
    var index = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (index < entries.length) {
          return { value: entries[index++][1], done: false };
        }
        return { done: true };
      }
    };
  };

  URLSearchParams.prototype.entries = function() {
    var index = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (index < entries.length) {
          var e = entries[index++];
          return { value: [e[0], e[1]], done: false };
        }
        return { done: true };
      }
    };
  };

  if (typeof Symbol !== 'undefined' && Symbol.iterator) {
    URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;
  }

  // ---- URL ----

  // Scheme default ports
  var DEFAULT_PORTS = {
    'http:': '80',
    'https:': '443',
    'ftp:': '21',
    'ws:': '80',
    'wss:': '443'
  };

  function URL(url, base) {
    if (typeof url !== 'string') {
      throw new TypeError('URL must be a string');
    }

    var resolved = url;
    if (base !== undefined) {
      var baseObj = (base instanceof URL) ? base : new URL(String(base));
      resolved = _resolveUrl(baseObj, url);
    }

    this._parse(resolved);
    this.searchParams = new URLSearchParams(this.search);
  }

  URL.prototype._parse = function(url) {
    // Simple URL parser
    this.href = url;
    this.protocol = '';
    this.username = '';
    this.password = '';
    this.hostname = '';
    this.port = '';
    this.pathname = '/';
    this.search = '';
    this.hash = '';

    var remaining = url;

    // Extract hash
    var hashIdx = remaining.indexOf('#');
    if (hashIdx !== -1) {
      this.hash = remaining.slice(hashIdx);
      remaining = remaining.slice(0, hashIdx);
    }

    // Extract search
    var searchIdx = remaining.indexOf('?');
    if (searchIdx !== -1) {
      this.search = remaining.slice(searchIdx);
      remaining = remaining.slice(0, searchIdx);
    }

    // Extract protocol
    var protoMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9+\\-.]*:)/);
    if (protoMatch) {
      this.protocol = protoMatch[1].toLowerCase();
      remaining = remaining.slice(this.protocol.length);
    }

    // Check for authority (//...)
    if (remaining.slice(0, 2) === '//') {
      remaining = remaining.slice(2);

      // Extract userinfo
      var atIdx = remaining.indexOf('@');
      var slashIdx = remaining.indexOf('/');
      if (atIdx !== -1 && (slashIdx === -1 || atIdx < slashIdx)) {
        var userinfo = remaining.slice(0, atIdx);
        remaining = remaining.slice(atIdx + 1);
        var colonIdx = userinfo.indexOf(':');
        if (colonIdx !== -1) {
          this.username = userinfo.slice(0, colonIdx);
          this.password = userinfo.slice(colonIdx + 1);
        } else {
          this.username = userinfo;
        }
      }

      // Extract host
      slashIdx = remaining.indexOf('/');
      var host;
      if (slashIdx !== -1) {
        host = remaining.slice(0, slashIdx);
        remaining = remaining.slice(slashIdx);
      } else {
        host = remaining;
        remaining = '';
      }

      // Extract port from host
      var bracketIdx = host.indexOf('[');
      if (bracketIdx !== -1) {
        // IPv6
        var closeBracket = host.indexOf(']');
        this.hostname = host.slice(0, closeBracket + 1);
        var afterBracket = host.slice(closeBracket + 1);
        if (afterBracket.charAt(0) === ':') {
          this.port = afterBracket.slice(1);
        }
      } else {
        var colonIdx = host.lastIndexOf(':');
        if (colonIdx !== -1) {
          this.hostname = host.slice(0, colonIdx);
          this.port = host.slice(colonIdx + 1);
        } else {
          this.hostname = host;
        }
      }

      this.hostname = this.hostname.toLowerCase();
    }

    // Pathname
    if (remaining) {
      this.pathname = remaining;
    } else if (this.hostname) {
      this.pathname = '/';
    }

    this._updateHref();
  };

  URL.prototype._updateHref = function() {
    var href = '';
    if (this.protocol) {
      href += this.protocol;
    }
    if (this.hostname || this.protocol === 'file:') {
      href += '//';
      if (this.username) {
        href += this.username;
        if (this.password) href += ':' + this.password;
        href += '@';
      }
      href += this.hostname;
      if (this.port) href += ':' + this.port;
    }
    href += this.pathname;
    href += this.search;
    href += this.hash;
    this.href = href;

    // Derived properties
    this.host = this.hostname + (this.port ? ':' + this.port : '');
    this.origin = this.protocol + '//' + this.host;
  };

  URL.prototype.toString = function() {
    return this.href;
  };

  URL.prototype.toJSON = function() {
    return this.href;
  };

  function _resolveUrl(base, relative) {
    if (/^[a-zA-Z][a-zA-Z0-9+\\-.]*:/.test(relative)) {
      // Absolute URL
      return relative;
    }

    var baseHref = base.protocol + '//' +
      (base.username ? base.username + (base.password ? ':' + base.password : '') + '@' : '') +
      base.hostname + (base.port ? ':' + base.port : '');

    if (relative.charAt(0) === '/') {
      if (relative.charAt(1) === '/') {
        // Protocol-relative
        return base.protocol + relative;
      }
      return baseHref + relative;
    }

    // Relative path
    var basePath = base.pathname;
    var lastSlash = basePath.lastIndexOf('/');
    var newPath = basePath.slice(0, lastSlash + 1) + relative;

    return baseHref + newPath;
  }

  // Static methods
  URL.canParse = function(url, base) {
    try {
      new URL(url, base);
      return true;
    } catch (e) {
      return false;
    }
  };

  module.exports = { URL: URL, URLSearchParams: URLSearchParams };
})();
`;
}
