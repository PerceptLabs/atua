/**
 * WASIBindings — WASI Preview 1 system call implementations
 *
 * Maps WASI fd_read/fd_write/path_open etc. to AtuaFS operations.
 * Implements the wasi_snapshot_preview1 import namespace.
 *
 * Reference: https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md
 */
import type { AtuaFS } from '../fs/AtuaFS.js';

/** WASI error codes */
export const WASI_ERRNO = {
  SUCCESS: 0,
  EBADF: 8,
  EINVAL: 28,
  EIO: 29,
  EISDIR: 31,
  ENOENT: 44,
  ENOSYS: 52,
  ENOTDIR: 54,
  EPERM: 63,
  EOVERFLOW: 61,
} as const;

/** WASI file types */
const WASI_FILETYPE = {
  UNKNOWN: 0,
  DIRECTORY: 3,
  REGULAR_FILE: 4,
  SYMBOLIC_LINK: 7,
} as const;

/** WASI rights */
const WASI_RIGHTS = {
  FD_READ: 1n << 1n,
  FD_WRITE: 1n << 6n,
  FD_SEEK: 1n << 2n,
  PATH_OPEN: 1n << 8n,
  PATH_CREATE_DIRECTORY: 1n << 9n,
  PATH_CREATE_FILE: 1n << 10n,
  FD_READDIR: 1n << 14n,
  PATH_FILESTAT_GET: 1n << 18n,
  PATH_UNLINK_FILE: 1n << 25n,
  PATH_REMOVE_DIRECTORY: 1n << 26n,
} as const;

/** Clock IDs */
const WASI_CLOCK = {
  REALTIME: 0,
  MONOTONIC: 1,
} as const;

export interface WASIConfig {
  fs?: AtuaFS;
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>; // wasi path -> atua path
  stdout?: (data: string) => void;
  stderr?: (data: string) => void;
  stdin?: () => string | null;
}

interface FileDescriptor {
  path: string;
  type: 'file' | 'directory' | 'stdio';
  rights: bigint;
  offset: number;
  preopen?: string; // wasi preopen path
}

export interface WASIExitError {
  exitCode: number;
}

export class WASIBindings {
  private memory: WebAssembly.Memory | null = null;
  private fds: Map<number, FileDescriptor> = new Map();
  private nextFd = 3;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private exitCode: number | null = null;
  private readonly fs?: AtuaFS;
  private readonly args: string[];
  private readonly envVars: string[];
  private readonly onStdout: (data: string) => void;
  private readonly onStderr: (data: string) => void;
  private readonly onStdin: () => string | null;

  constructor(config: WASIConfig = {}) {
    this.fs = config.fs;
    this.args = config.args ?? ['program'];
    this.envVars = Object.entries(config.env ?? {}).map(
      ([k, v]) => `${k}=${v}`,
    );
    this.onStdout = config.stdout ?? (() => {});
    this.onStderr = config.stderr ?? (() => {});
    this.onStdin = config.stdin ?? (() => null);

    // Set up standard file descriptors
    this.fds.set(0, {
      path: '/dev/stdin',
      type: 'stdio',
      rights: WASI_RIGHTS.FD_READ,
      offset: 0,
    });
    this.fds.set(1, {
      path: '/dev/stdout',
      type: 'stdio',
      rights: WASI_RIGHTS.FD_WRITE,
      offset: 0,
    });
    this.fds.set(2, {
      path: '/dev/stderr',
      type: 'stdio',
      rights: WASI_RIGHTS.FD_WRITE,
      offset: 0,
    });

    // Set up preopened directories
    const preopens = config.preopens ?? { '/': '/' };
    for (const [wasiPath, atuaPath] of Object.entries(preopens)) {
      const fd = this.nextFd++;
      this.fds.set(fd, {
        path: atuaPath,
        type: 'directory',
        rights:
          WASI_RIGHTS.FD_READ |
          WASI_RIGHTS.FD_WRITE |
          WASI_RIGHTS.PATH_OPEN |
          WASI_RIGHTS.PATH_CREATE_DIRECTORY |
          WASI_RIGHTS.PATH_CREATE_FILE |
          WASI_RIGHTS.FD_READDIR |
          WASI_RIGHTS.PATH_FILESTAT_GET |
          WASI_RIGHTS.PATH_UNLINK_FILE |
          WASI_RIGHTS.PATH_REMOVE_DIRECTORY,
        offset: 0,
        preopen: wasiPath,
      });
    }
  }

  /** Set the WASM memory instance (called before execution) */
  setMemory(memory: WebAssembly.Memory): void {
    this.memory = memory;
  }

  /** Get collected stdout */
  getStdout(): string {
    return this.stdoutBuffer;
  }

  /** Get collected stderr */
  getStderr(): string {
    return this.stderrBuffer;
  }

  /** Get exit code (null if not exited) */
  getExitCode(): number | null {
    return this.exitCode;
  }

  /** Get the WASI import object */
  getImports(): WebAssembly.Imports {
    return {
      wasi_snapshot_preview1: {
        args_get: this.argsGet.bind(this),
        args_sizes_get: this.argsSizesGet.bind(this),
        environ_get: this.environGet.bind(this),
        environ_sizes_get: this.environSizesGet.bind(this),
        clock_time_get: this.clockTimeGet.bind(this),
        clock_res_get: this.clockResGet.bind(this),
        fd_close: this.fdClose.bind(this),
        fd_fdstat_get: this.fdFdstatGet.bind(this),
        fd_fdstat_set_flags: () => WASI_ERRNO.SUCCESS,
        fd_prestat_get: this.fdPrestatGet.bind(this),
        fd_prestat_dir_name: this.fdPrestatDirName.bind(this),
        fd_read: this.fdRead.bind(this),
        fd_write: this.fdWrite.bind(this),
        fd_seek: this.fdSeek.bind(this),
        fd_tell: this.fdTell.bind(this),
        fd_filestat_get: this.fdFilestatGet.bind(this),
        fd_readdir: this.fdReaddir.bind(this),
        path_open: this.pathOpen.bind(this),
        path_filestat_get: this.pathFilestatGet.bind(this),
        path_create_directory: this.pathCreateDirectory.bind(this),
        path_unlink_file: this.pathUnlinkFile.bind(this),
        path_remove_directory: this.pathRemoveDirectory.bind(this),
        path_rename: this.pathRename.bind(this),
        proc_exit: this.procExit.bind(this),
        random_get: this.randomGet.bind(this),
        poll_oneoff: () => WASI_ERRNO.ENOSYS,
        sched_yield: () => WASI_ERRNO.SUCCESS,
        fd_advise: () => WASI_ERRNO.SUCCESS,
        fd_allocate: () => WASI_ERRNO.ENOSYS,
        fd_datasync: () => WASI_ERRNO.SUCCESS,
        fd_fdstat_set_rights: () => WASI_ERRNO.SUCCESS,
        fd_filestat_set_size: () => WASI_ERRNO.ENOSYS,
        fd_filestat_set_times: () => WASI_ERRNO.SUCCESS,
        fd_pread: () => WASI_ERRNO.ENOSYS,
        fd_pwrite: () => WASI_ERRNO.ENOSYS,
        fd_renumber: () => WASI_ERRNO.ENOSYS,
        fd_sync: () => WASI_ERRNO.SUCCESS,
        path_filestat_set_times: () => WASI_ERRNO.SUCCESS,
        path_link: () => WASI_ERRNO.ENOSYS,
        path_readlink: () => WASI_ERRNO.ENOSYS,
        path_symlink: () => WASI_ERRNO.ENOSYS,
        sock_accept: () => WASI_ERRNO.ENOSYS,
        sock_recv: () => WASI_ERRNO.ENOSYS,
        sock_send: () => WASI_ERRNO.ENOSYS,
        sock_shutdown: () => WASI_ERRNO.ENOSYS,
      },
    };
  }

  // --- Helper methods ---

  private getView(): DataView {
    return new DataView(this.memory!.buffer);
  }

  private getU8(): Uint8Array {
    return new Uint8Array(this.memory!.buffer);
  }

  private readString(ptr: number, len: number): string {
    const bytes = this.getU8().slice(ptr, ptr + len);
    return new TextDecoder().decode(bytes);
  }

  private writeString(ptr: number, str: string): number {
    const encoded = new TextEncoder().encode(str);
    this.getU8().set(encoded, ptr);
    return encoded.length;
  }

  private resolvePath(dirFd: number, relativePath: string): string | null {
    const dir = this.fds.get(dirFd);
    if (!dir) return null;

    const basePath = dir.path.endsWith('/') ? dir.path : dir.path + '/';
    // Normalize path
    let full = basePath + relativePath;
    // Remove double slashes
    full = full.replace(/\/+/g, '/');
    // Remove trailing slash for files
    if (full.length > 1 && full.endsWith('/')) {
      full = full.slice(0, -1);
    }
    return full;
  }

  // --- WASI syscall implementations ---

  private argsGet(argvPtr: number, argvBufPtr: number): number {
    const view = this.getView();
    let bufOffset = argvBufPtr;
    for (let i = 0; i < this.args.length; i++) {
      view.setUint32(argvPtr + i * 4, bufOffset, true);
      const encoded = new TextEncoder().encode(this.args[i] + '\0');
      this.getU8().set(encoded, bufOffset);
      bufOffset += encoded.length;
    }
    return WASI_ERRNO.SUCCESS;
  }

  private argsSizesGet(argcPtr: number, argvBufSizePtr: number): number {
    const view = this.getView();
    view.setUint32(argcPtr, this.args.length, true);
    let totalSize = 0;
    for (const arg of this.args) {
      totalSize += new TextEncoder().encode(arg + '\0').length;
    }
    view.setUint32(argvBufSizePtr, totalSize, true);
    return WASI_ERRNO.SUCCESS;
  }

  private environGet(environPtr: number, environBufPtr: number): number {
    const view = this.getView();
    let bufOffset = environBufPtr;
    for (let i = 0; i < this.envVars.length; i++) {
      view.setUint32(environPtr + i * 4, bufOffset, true);
      const encoded = new TextEncoder().encode(this.envVars[i] + '\0');
      this.getU8().set(encoded, bufOffset);
      bufOffset += encoded.length;
    }
    return WASI_ERRNO.SUCCESS;
  }

  private environSizesGet(
    countPtr: number,
    bufSizePtr: number,
  ): number {
    const view = this.getView();
    view.setUint32(countPtr, this.envVars.length, true);
    let totalSize = 0;
    for (const env of this.envVars) {
      totalSize += new TextEncoder().encode(env + '\0').length;
    }
    view.setUint32(bufSizePtr, totalSize, true);
    return WASI_ERRNO.SUCCESS;
  }

  private clockTimeGet(
    clockId: number,
    _precision: bigint,
    timePtr: number,
  ): number {
    const view = this.getView();
    let timeNs: bigint;
    if (clockId === WASI_CLOCK.REALTIME) {
      timeNs = BigInt(Math.round(Date.now() * 1_000_000));
    } else if (clockId === WASI_CLOCK.MONOTONIC) {
      timeNs = BigInt(Math.round(performance.now() * 1_000_000));
    } else {
      return WASI_ERRNO.EINVAL;
    }
    view.setBigUint64(timePtr, timeNs, true);
    return WASI_ERRNO.SUCCESS;
  }

  private clockResGet(clockId: number, resPtr: number): number {
    const view = this.getView();
    if (
      clockId === WASI_CLOCK.REALTIME ||
      clockId === WASI_CLOCK.MONOTONIC
    ) {
      // 1 microsecond resolution
      view.setBigUint64(resPtr, 1000n, true);
      return WASI_ERRNO.SUCCESS;
    }
    return WASI_ERRNO.EINVAL;
  }

  private fdClose(fd: number): number {
    if (fd < 3) return WASI_ERRNO.SUCCESS; // Don't close stdio
    if (!this.fds.has(fd)) return WASI_ERRNO.EBADF;
    this.fds.delete(fd);
    return WASI_ERRNO.SUCCESS;
  }

  private fdFdstatGet(fd: number, bufPtr: number): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;

    const view = this.getView();
    // filetype (u8)
    if (desc.type === 'directory') {
      view.setUint8(bufPtr, WASI_FILETYPE.DIRECTORY);
    } else {
      view.setUint8(bufPtr, WASI_FILETYPE.REGULAR_FILE);
    }
    // fdflags (u16)
    view.setUint16(bufPtr + 2, 0, true);
    // rights_base (u64)
    view.setBigUint64(bufPtr + 8, desc.rights, true);
    // rights_inheriting (u64)
    view.setBigUint64(bufPtr + 16, desc.rights, true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdPrestatGet(fd: number, bufPtr: number): number {
    const desc = this.fds.get(fd);
    if (!desc || !desc.preopen) return WASI_ERRNO.EBADF;

    const view = this.getView();
    // pr_type: 0 = dir
    view.setUint8(bufPtr, 0);
    // pr_name_len
    const nameLen = new TextEncoder().encode(desc.preopen).length;
    view.setUint32(bufPtr + 4, nameLen, true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdPrestatDirName(
    fd: number,
    pathPtr: number,
    pathLen: number,
  ): number {
    const desc = this.fds.get(fd);
    if (!desc || !desc.preopen) return WASI_ERRNO.EBADF;

    const encoded = new TextEncoder().encode(desc.preopen);
    const len = Math.min(encoded.length, pathLen);
    this.getU8().set(encoded.subarray(0, len), pathPtr);
    return WASI_ERRNO.SUCCESS;
  }

  private fdRead(
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    nreadPtr: number,
  ): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;

    const view = this.getView();
    let totalRead = 0;

    if (fd === 0) {
      // stdin
      const input = this.onStdin();
      if (input !== null) {
        const encoded = new TextEncoder().encode(input);
        for (let i = 0; i < iovsLen; i++) {
          const bufPtr = view.getUint32(iovsPtr + i * 8, true);
          const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
          const toCopy = Math.min(encoded.length - totalRead, bufLen);
          if (toCopy > 0) {
            this.getU8().set(
              encoded.subarray(totalRead, totalRead + toCopy),
              bufPtr,
            );
            totalRead += toCopy;
          }
        }
      }
    } else if (this.fs && desc.type === 'file') {
      try {
        const content = this.fs.readFileSync(desc.path);
        const bytes =
          typeof content === 'string'
            ? new TextEncoder().encode(content)
            : new Uint8Array(content as ArrayBuffer);

        for (let i = 0; i < iovsLen; i++) {
          const bufPtr = view.getUint32(iovsPtr + i * 8, true);
          const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
          const available = bytes.length - desc.offset;
          const toCopy = Math.min(available, bufLen);
          if (toCopy > 0) {
            this.getU8().set(
              bytes.subarray(desc.offset, desc.offset + toCopy),
              bufPtr,
            );
            desc.offset += toCopy;
            totalRead += toCopy;
          }
        }
      } catch {
        return WASI_ERRNO.EIO;
      }
    }

    view.setUint32(nreadPtr, totalRead, true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdWrite(
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    nwrittenPtr: number,
  ): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;

    const view = this.getView();
    let totalWritten = 0;
    const decoder = new TextDecoder();

    for (let i = 0; i < iovsLen; i++) {
      const bufPtr = view.getUint32(iovsPtr + i * 8, true);
      const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
      const data = this.getU8().slice(bufPtr, bufPtr + bufLen);
      totalWritten += bufLen;

      if (fd === 1) {
        // stdout
        const text = decoder.decode(data, { stream: true });
        this.stdoutBuffer += text;
        this.onStdout(text);
      } else if (fd === 2) {
        // stderr
        const text = decoder.decode(data, { stream: true });
        this.stderrBuffer += text;
        this.onStderr(text);
      } else if (this.fs && desc.type === 'file') {
        try {
          // For file writes, we append data at current offset
          // Simple approach: read current content, splice, write back
          let existing = new Uint8Array(0);
          try {
            const content = this.fs.readFileSync(desc.path);
            existing =
              typeof content === 'string'
                ? new TextEncoder().encode(content)
                : new Uint8Array(content as ArrayBuffer);
          } catch {
            // File might not exist yet
          }

          const newContent = new Uint8Array(
            Math.max(existing.length, desc.offset + bufLen),
          );
          newContent.set(existing);
          newContent.set(data, desc.offset);
          desc.offset += bufLen;

          this.fs.writeFileSync(
            desc.path,
            decoder.decode(newContent),
          );
        } catch {
          return WASI_ERRNO.EIO;
        }
      }
    }

    view.setUint32(nwrittenPtr, totalWritten, true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdSeek(
    fd: number,
    offset: bigint,
    whence: number,
    newOffsetPtr: number,
  ): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;
    if (fd < 3) return WASI_ERRNO.EPERM; // Can't seek stdio

    const offsetNum = Number(offset);
    let newOffset: number;

    switch (whence) {
      case 0: // SEEK_SET
        newOffset = offsetNum;
        break;
      case 1: // SEEK_CUR
        newOffset = desc.offset + offsetNum;
        break;
      case 2: {
        // SEEK_END
        let size = 0;
        if (this.fs) {
          try {
            const stat = this.fs.statSync(desc.path);
            size = stat.size;
          } catch {
            return WASI_ERRNO.EIO;
          }
        }
        newOffset = size + offsetNum;
        break;
      }
      default:
        return WASI_ERRNO.EINVAL;
    }

    desc.offset = Math.max(0, newOffset);
    const view = this.getView();
    view.setBigUint64(newOffsetPtr, BigInt(desc.offset), true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdTell(fd: number, offsetPtr: number): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;

    const view = this.getView();
    view.setBigUint64(offsetPtr, BigInt(desc.offset), true);
    return WASI_ERRNO.SUCCESS;
  }

  private fdFilestatGet(fd: number, bufPtr: number): number {
    const desc = this.fds.get(fd);
    if (!desc) return WASI_ERRNO.EBADF;

    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      const stat = this.fs.statSync(desc.path);
      this.writeFilestat(bufPtr, stat, desc.type === 'directory');
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.ENOENT;
    }
  }

  private fdReaddir(
    fd: number,
    bufPtr: number,
    bufLen: number,
    _cookie: bigint,
    bufUsedPtr: number,
  ): number {
    const desc = this.fds.get(fd);
    if (!desc || desc.type !== 'directory') return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      const entries = this.fs.readdirSync(desc.path);
      const view = this.getView();
      let offset = 0;

      for (let i = 0; i < entries.length; i++) {
        const name = entries[i] as string;
        const encoded = new TextEncoder().encode(name);
        // dirent: d_next(8) + d_ino(8) + d_namlen(4) + d_type(1) = 24 bytes + name
        const entrySize = 24 + encoded.length;
        if (offset + entrySize > bufLen) break;

        // d_next
        view.setBigUint64(bufPtr + offset, BigInt(i + 1), true);
        // d_ino (use hash of name as inode)
        view.setBigUint64(bufPtr + offset + 8, BigInt(i + 1), true);
        // d_namlen
        view.setUint32(bufPtr + offset + 16, encoded.length, true);
        // d_type
        let ftype = WASI_FILETYPE.REGULAR_FILE;
        try {
          const st = this.fs.statSync(
            desc.path + '/' + name,
          );
          if (st.isDirectory()) ftype = WASI_FILETYPE.DIRECTORY;
        } catch {
          // Default to file
        }
        view.setUint8(bufPtr + offset + 20, ftype);
        // name
        this.getU8().set(encoded, bufPtr + offset + 24);
        offset += entrySize;
      }

      view.setUint32(bufUsedPtr, offset, true);
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.EIO;
    }
  }

  private pathOpen(
    dirFd: number,
    _dirflags: number,
    pathPtr: number,
    pathLen: number,
    _oflags: number,
    _fsRightsBase: bigint,
    _fsRightsInheriting: bigint,
    _fdflags: number,
    fdPtr: number,
  ): number {
    const relativePath = this.readString(pathPtr, pathLen);
    const fullPath = this.resolvePath(dirFd, relativePath);
    if (!fullPath) return WASI_ERRNO.EBADF;

    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      const stat = this.fs.statSync(fullPath);
      const fd = this.nextFd++;
      const isDir = stat.isDirectory();
      this.fds.set(fd, {
        path: fullPath,
        type: isDir ? 'directory' : 'file',
        rights:
          WASI_RIGHTS.FD_READ |
          WASI_RIGHTS.FD_WRITE |
          WASI_RIGHTS.FD_SEEK |
          WASI_RIGHTS.PATH_OPEN |
          WASI_RIGHTS.FD_READDIR |
          WASI_RIGHTS.PATH_FILESTAT_GET,
        offset: 0,
      });

      const view = this.getView();
      view.setUint32(fdPtr, fd, true);
      return WASI_ERRNO.SUCCESS;
    } catch {
      // File doesn't exist — check if O_CREAT is set (bit 0 of oflags)
      if (_oflags & 1) {
        try {
          this.fs.writeFileSync(fullPath, '');
          const fd = this.nextFd++;
          this.fds.set(fd, {
            path: fullPath,
            type: 'file',
            rights:
              WASI_RIGHTS.FD_READ |
              WASI_RIGHTS.FD_WRITE |
              WASI_RIGHTS.FD_SEEK,
            offset: 0,
          });
          const view = this.getView();
          view.setUint32(fdPtr, fd, true);
          return WASI_ERRNO.SUCCESS;
        } catch {
          return WASI_ERRNO.EIO;
        }
      }
      return WASI_ERRNO.ENOENT;
    }
  }

  private pathFilestatGet(
    dirFd: number,
    _flags: number,
    pathPtr: number,
    pathLen: number,
    bufPtr: number,
  ): number {
    const relativePath = this.readString(pathPtr, pathLen);
    const fullPath = this.resolvePath(dirFd, relativePath);
    if (!fullPath) return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      const stat = this.fs.statSync(fullPath);
      this.writeFilestat(bufPtr, stat, stat.isDirectory());
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.ENOENT;
    }
  }

  private pathCreateDirectory(
    dirFd: number,
    pathPtr: number,
    pathLen: number,
  ): number {
    const relativePath = this.readString(pathPtr, pathLen);
    const fullPath = this.resolvePath(dirFd, relativePath);
    if (!fullPath) return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      this.fs.mkdirSync(fullPath, { recursive: true });
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.EIO;
    }
  }

  private pathUnlinkFile(
    dirFd: number,
    pathPtr: number,
    pathLen: number,
  ): number {
    const relativePath = this.readString(pathPtr, pathLen);
    const fullPath = this.resolvePath(dirFd, relativePath);
    if (!fullPath) return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      this.fs.unlinkSync(fullPath);
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.ENOENT;
    }
  }

  private pathRemoveDirectory(
    dirFd: number,
    pathPtr: number,
    pathLen: number,
  ): number {
    const relativePath = this.readString(pathPtr, pathLen);
    const fullPath = this.resolvePath(dirFd, relativePath);
    if (!fullPath) return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      this.fs.rmdirSync(fullPath);
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.EIO;
    }
  }

  private pathRename(
    oldDirFd: number,
    oldPathPtr: number,
    oldPathLen: number,
    newDirFd: number,
    newPathPtr: number,
    newPathLen: number,
  ): number {
    const oldRelPath = this.readString(oldPathPtr, oldPathLen);
    const newRelPath = this.readString(newPathPtr, newPathLen);
    const oldPath = this.resolvePath(oldDirFd, oldRelPath);
    const newPath = this.resolvePath(newDirFd, newRelPath);
    if (!oldPath || !newPath) return WASI_ERRNO.EBADF;
    if (!this.fs) return WASI_ERRNO.ENOSYS;

    try {
      this.fs.renameSync(oldPath, newPath);
      return WASI_ERRNO.SUCCESS;
    } catch {
      return WASI_ERRNO.EIO;
    }
  }

  private procExit(code: number): void {
    this.exitCode = code;
    throw { __wasi_exit: true, exitCode: code };
  }

  private randomGet(bufPtr: number, bufLen: number): number {
    const bytes = new Uint8Array(bufLen);
    crypto.getRandomValues(bytes);
    this.getU8().set(bytes, bufPtr);
    return WASI_ERRNO.SUCCESS;
  }

  private writeFilestat(
    ptr: number,
    stat: any,
    isDirectory: boolean,
  ): void {
    const view = this.getView();
    // dev (u64)
    view.setBigUint64(ptr, 0n, true);
    // ino (u64)
    view.setBigUint64(ptr + 8, BigInt(stat.ino ?? 0), true);
    // filetype (u8)
    view.setUint8(
      ptr + 16,
      isDirectory ? WASI_FILETYPE.DIRECTORY : WASI_FILETYPE.REGULAR_FILE,
    );
    // nlink (u64)
    view.setBigUint64(ptr + 24, 1n, true);
    // size (u64)
    view.setBigUint64(ptr + 32, BigInt(stat.size ?? 0), true);
    // atim (u64)
    const atimeNs = BigInt(
      Math.round((stat.atimeMs ?? Date.now()) * 1_000_000),
    );
    view.setBigUint64(ptr + 40, atimeNs, true);
    // mtim (u64)
    const mtimeNs = BigInt(
      Math.round((stat.mtimeMs ?? Date.now()) * 1_000_000),
    );
    view.setBigUint64(ptr + 48, mtimeNs, true);
    // ctim (u64)
    const ctimeNs = BigInt(
      Math.round((stat.ctimeMs ?? Date.now()) * 1_000_000),
    );
    view.setBigUint64(ptr + 56, ctimeNs, true);
  }
}
