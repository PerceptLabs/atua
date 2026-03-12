/**
 * Pure JS implementation of Node's path module (posix only).
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getPathSource(): string {
  return `
(function() {
  var sep = '/';
  var delimiter = ':';

  function assertString(val, name) {
    if (typeof val !== 'string') {
      throw new TypeError(name + ' must be a string. Received ' + typeof val);
    }
  }

  function normalizeStringPosix(path, allowAboveRoot) {
    var res = '';
    var lastSegmentLength = 0;
    var lastSlash = -1;
    var dots = 0;
    var code;
    for (var i = 0; i <= path.length; ++i) {
      if (i < path.length) {
        code = path.charCodeAt(i);
      } else if (code === 47) {
        break;
      } else {
        code = 47;
      }
      if (code === 47) {
        if (lastSlash === i - 1 || dots === 1) {
          // noop
        } else if (lastSlash !== i - 1 && dots === 2) {
          if (res.length < 2 || lastSegmentLength !== 2 ||
              res.charCodeAt(res.length - 1) !== 46 ||
              res.charCodeAt(res.length - 2) !== 46) {
            if (res.length > 2) {
              var lastSlashIndex = res.lastIndexOf(sep);
              if (lastSlashIndex !== res.length - 1) {
                if (lastSlashIndex === -1) {
                  res = '';
                  lastSegmentLength = 0;
                } else {
                  res = res.slice(0, lastSlashIndex);
                  lastSegmentLength = res.length - 1 - res.lastIndexOf(sep);
                }
                lastSlash = i;
                dots = 0;
                continue;
              }
            } else if (res.length === 2 || res.length === 1) {
              res = '';
              lastSegmentLength = 0;
              lastSlash = i;
              dots = 0;
              continue;
            }
          }
          if (allowAboveRoot) {
            if (res.length > 0) {
              res += '/..';
            } else {
              res = '..';
            }
            lastSegmentLength = 2;
          }
        } else {
          if (res.length > 0) {
            res += sep + path.slice(lastSlash + 1, i);
          } else {
            res = path.slice(lastSlash + 1, i);
          }
          lastSegmentLength = i - lastSlash - 1;
        }
        lastSlash = i;
        dots = 0;
      } else if (code === 46 && dots !== -1) {
        ++dots;
      } else {
        dots = -1;
      }
    }
    return res;
  }

  function normalize(path) {
    assertString(path, 'path');
    if (path.length === 0) return '.';
    var isAbs = path.charCodeAt(0) === 47;
    var trailingSeparator = path.charCodeAt(path.length - 1) === 47;
    path = normalizeStringPosix(path, !isAbs);
    if (path.length === 0 && !isAbs) path = '.';
    if (path.length > 0 && trailingSeparator) path += sep;
    if (isAbs) return sep + path;
    return path;
  }

  function isAbsolute(path) {
    assertString(path, 'path');
    return path.length > 0 && path.charCodeAt(0) === 47;
  }

  function join() {
    if (arguments.length === 0) return '.';
    var joined;
    for (var i = 0; i < arguments.length; ++i) {
      var arg = arguments[i];
      assertString(arg, 'path');
      if (arg.length > 0) {
        if (joined === undefined) {
          joined = arg;
        } else {
          joined += sep + arg;
        }
      }
    }
    if (joined === undefined) return '.';
    return normalize(joined);
  }

  function resolve() {
    var resolvedPath = '';
    var resolvedAbsolute = false;
    var cwd = '/';

    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path;
      if (i >= 0) {
        path = arguments[i];
      } else {
        path = cwd;
      }
      assertString(path, 'path');
      if (path.length === 0) continue;
      resolvedPath = path + sep + resolvedPath;
      resolvedAbsolute = path.charCodeAt(0) === 47;
    }

    resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);

    if (resolvedAbsolute) {
      if (resolvedPath.length > 0) return sep + resolvedPath;
      return sep;
    } else if (resolvedPath.length > 0) {
      return resolvedPath;
    } else {
      return '.';
    }
  }

  function relative(from, to) {
    assertString(from, 'from');
    assertString(to, 'to');
    if (from === to) return '';

    from = resolve(from);
    to = resolve(to);
    if (from === to) return '';

    var fromStart = 1;
    for (; fromStart < from.length; ++fromStart) {
      if (from.charCodeAt(fromStart) !== 47) break;
    }
    var fromEnd = from.length;
    var fromLen = fromEnd - fromStart;

    var toStart = 1;
    for (; toStart < to.length; ++toStart) {
      if (to.charCodeAt(toStart) !== 47) break;
    }
    var toEnd = to.length;
    var toLen = toEnd - toStart;

    var length = (fromLen < toLen ? fromLen : toLen);
    var lastCommonSep = -1;
    var i = 0;
    for (; i <= length; ++i) {
      if (i === length) {
        if (toLen > length) {
          if (to.charCodeAt(toStart + i) === 47) {
            return to.slice(toStart + i + 1);
          } else if (i === 0) {
            return to.slice(toStart + i);
          }
        } else if (fromLen > length) {
          if (from.charCodeAt(fromStart + i) === 47) {
            lastCommonSep = i;
          } else if (i === 0) {
            lastCommonSep = 0;
          }
        }
        break;
      }
      var fromCode = from.charCodeAt(fromStart + i);
      var toCode = to.charCodeAt(toStart + i);
      if (fromCode !== toCode) break;
      if (fromCode === 47) lastCommonSep = i;
    }

    var out = '';
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === 47) {
        if (out.length === 0) {
          out += '..';
        } else {
          out += '/..';
        }
      }
    }

    if (out.length > 0) {
      return out + to.slice(toStart + lastCommonSep);
    }
    toStart += lastCommonSep;
    if (to.charCodeAt(toStart) === 47) ++toStart;
    return to.slice(toStart);
  }

  function dirname(path) {
    assertString(path, 'path');
    if (path.length === 0) return '.';
    var hasRoot = path.charCodeAt(0) === 47;
    var end = -1;
    var matchedSlash = true;
    for (var i = path.length - 1; i >= 1; --i) {
      if (path.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        matchedSlash = false;
      }
    }
    if (end === -1) return hasRoot ? sep : '.';
    if (hasRoot && end === 1) return '//';
    return path.slice(0, end);
  }

  function basename(path, ext) {
    assertString(path, 'path');
    if (ext !== undefined) assertString(ext, 'ext');
    var start = 0;
    var end = -1;
    var matchedSlash = true;
    var i;

    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
      if (ext.length === path.length && ext === path) return '';
      var extIdx = ext.length - 1;
      var firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i);
        if (code === 47) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            if (code === ext.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                end = i;
              }
            } else {
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }
      if (start === end) end = firstNonSlashEnd;
      else if (end === -1) end = path.length;
      return path.slice(start, end);
    } else {
      for (i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === 47) {
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else if (end === -1) {
          matchedSlash = false;
          end = i + 1;
        }
      }
      if (end === -1) return '';
      return path.slice(start, end);
    }
  }

  function extname(path) {
    assertString(path, 'path');
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var preDotState = 0;
    for (var i = path.length - 1; i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46) {
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }
    if (startDot === -1 || end === -1 ||
        preDotState === 0 ||
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
      return '';
    }
    return path.slice(startDot, end);
  }

  function parse(path) {
    assertString(path, 'path');
    var ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) return ret;

    var isAbs = path.charCodeAt(0) === 47;
    var start;
    if (isAbs) {
      ret.root = sep;
      start = 1;
    } else {
      start = 0;
    }

    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var i = path.length - 1;
    var preDotState = 0;

    for (; i >= start; --i) {
      var code = path.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46) {
        if (startDot === -1) startDot = i;
        else if (preDotState !== 1) preDotState = 1;
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
        preDotState === 0 ||
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
      if (end !== -1) {
        if (startPart === 0 && isAbs) {
          ret.base = path.slice(1, end);
          ret.name = ret.base;
        } else {
          ret.base = path.slice(startPart, end);
          ret.name = ret.base;
        }
      }
    } else {
      if (startPart === 0 && isAbs) {
        ret.name = path.slice(1, startDot);
        ret.base = path.slice(1, end);
      } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
      }
      ret.ext = path.slice(startDot, end);
    }

    if (startPart > 0) {
      ret.dir = path.slice(0, startPart - 1);
    } else if (isAbs) {
      ret.dir = sep;
    }

    return ret;
  }

  function format(pathObject) {
    if (pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError('The "pathObject" argument must be of type Object. Received ' + typeof pathObject);
    }
    var dir = pathObject.dir || pathObject.root;
    var base = pathObject.base || ((pathObject.name || '') + (pathObject.ext || ''));
    if (!dir) return base;
    if (dir === pathObject.root) return dir + base;
    return dir + sep + base;
  }

  var path = {
    resolve: resolve,
    normalize: normalize,
    isAbsolute: isAbsolute,
    join: join,
    relative: relative,
    dirname: dirname,
    basename: basename,
    extname: extname,
    format: format,
    parse: parse,
    sep: sep,
    delimiter: delimiter,
    posix: null
  };

  path.posix = path;

  module.exports = path;
})();
`;
}
