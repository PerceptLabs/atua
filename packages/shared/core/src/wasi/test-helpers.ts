/**
 * Test helpers for WASI tests
 *
 * Provides utilities for building minimal WASI test binaries
 * and testing WASI bindings directly.
 */

/**
 * Compile WAT (WebAssembly Text) to WASM binary using wabt.js or fallback.
 * For tests, we use pre-assembled minimal binaries.
 */

/**
 * Build a minimal WASM module that imports wasi_snapshot_preview1 functions
 * and calls them. Uses the binary WebAssembly format directly.
 *
 * This creates a module with:
 * - Imports: fd_write, proc_exit from wasi_snapshot_preview1
 * - Memory: 1 page (64KB)
 * - _start: writes a message to stdout, then calls proc_exit(0)
 */
export function buildHelloWasm(): Uint8Array {
  // We build the binary section by section
  const encoder = new TextEncoder();

  // Helper to encode a string with its length prefix
  function encStr(s: string): number[] {
    const bytes = Array.from(encoder.encode(s));
    return [bytes.length, ...bytes];
  }

  // Helper to encode unsigned LEB128
  function uleb128(value: number): number[] {
    const result: number[] = [];
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value !== 0) byte |= 0x80;
      result.push(byte);
    } while (value !== 0);
    return result;
  }

  // Helper to encode signed LEB128 for i32
  function sleb128(value: number): number[] {
    const result: number[] = [];
    let more = true;
    while (more) {
      let byte = value & 0x7f;
      value >>= 7;
      if (
        (value === 0 && (byte & 0x40) === 0) ||
        (value === -1 && (byte & 0x40) !== 0)
      ) {
        more = false;
      } else {
        byte |= 0x80;
      }
      result.push(byte);
    }
    return result;
  }

  function section(id: number, contents: number[]): number[] {
    return [id, ...uleb128(contents.length), ...contents];
  }

  // Type section: define function signatures
  const typeSection = section(1, [
    2, // 2 types
    // Type 0: (i32, i32, i32, i32) -> (i32) — fd_write
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
    // Type 1: (i32) -> () — proc_exit / _start-like
    0x60, 1, 0x7f, 0,
  ]);

  // Import section
  const wasi = 'wasi_snapshot_preview1';
  const importEntries = [
    [...encStr(wasi), ...encStr('fd_write'), 0x00, ...uleb128(0)],
    [...encStr(wasi), ...encStr('proc_exit'), 0x00, ...uleb128(1)],
  ];
  const importPayload = [
    ...uleb128(importEntries.length),
    ...importEntries.flat(),
  ];
  const importSection = section(2, importPayload);

  // Function section: 1 function (_start), with no params no results
  // We need a new type for that: () -> ()
  // Let's add it to the type section
  // Actually, let me redo the type section with 3 types
  const typeSection2 = section(1, [
    3,
    // Type 0: (i32, i32, i32, i32) -> (i32) — fd_write
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
    // Type 1: (i32) -> () — proc_exit
    0x60, 1, 0x7f, 0,
    // Type 2: () -> () — _start
    0x60, 0, 0,
  ]);

  const funcSection = section(3, [1, ...uleb128(2)]); // 1 func, type index 2

  // Memory section: 1 memory, min 1 page
  const memSection = section(5, [1, 0x00, 1]);

  // Export section: export memory and _start
  const exportSection = section(7, [
    2,
    ...encStr('memory'),
    0x02,
    ...uleb128(0), // memory index 0
    ...encStr('_start'),
    0x00,
    ...uleb128(2), // func index 2 (after 2 imports)
  ]);

  // Code section: _start function body
  // The function writes "hello world\n" to stdout using fd_write, then calls proc_exit(0)

  // "hello world\n" = 12 bytes at memory offset 100
  const msg = 'hello world\n';
  const msgBytes = Array.from(encoder.encode(msg));

  // Build the function body instructions
  const instructions: number[] = [];

  // Store the message string byte by byte using i32.store8
  for (let i = 0; i < msgBytes.length; i++) {
    instructions.push(
      0x41, ...sleb128(100 + i), // i32.const (100 + i)
      0x41, ...sleb128(msgBytes[i]), // i32.const byte
      0x3a, 0x00, ...uleb128(0), // i32.store8 align=0 offset=0
    );
  }

  // Set up iovec at offset 0:
  // iov_base (i32) = 100 (where the string is)
  instructions.push(
    0x41, ...sleb128(0), // i32.const 0
    0x41, ...sleb128(100), // i32.const 100
    0x36, 0x02, ...uleb128(0), // i32.store align=2 offset=0
  );
  // iov_len (i32) = 12 (string length)
  instructions.push(
    0x41, ...sleb128(4), // i32.const 4
    0x41, ...sleb128(msgBytes.length), // i32.const 12
    0x36, 0x02, ...uleb128(0), // i32.store align=2 offset=0
  );

  // Call fd_write(fd=1, iovs_ptr=0, iovs_len=1, nwritten_ptr=8)
  instructions.push(
    0x41, ...sleb128(1), // i32.const 1 (stdout)
    0x41, ...sleb128(0), // i32.const 0 (iovs ptr)
    0x41, ...sleb128(1), // i32.const 1 (iovs_len)
    0x41, ...sleb128(50), // i32.const 50 (nwritten ptr)
    0x10, ...uleb128(0), // call fd_write (import index 0)
    0x1a, // drop return value
  );

  // Call proc_exit(0)
  instructions.push(
    0x41, ...sleb128(0), // i32.const 0
    0x10, ...uleb128(1), // call proc_exit (import index 1)
  );

  instructions.push(0x0b); // end

  const funcBody = [0, ...instructions]; // 0 locals
  const funcBodyWithLen = [...uleb128(funcBody.length), ...funcBody];
  const codeSection = section(10, [1, ...funcBodyWithLen]);

  // Assemble the full module
  const moduleBytes = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...typeSection2,
    ...importSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ];

  return new Uint8Array(moduleBytes);
}

/**
 * Build a minimal WASM module that calls proc_exit with the given code.
 */
export function buildExitWasm(exitCode: number): Uint8Array {
  const encoder = new TextEncoder();
  function encStr(s: string): number[] {
    const bytes = Array.from(encoder.encode(s));
    return [bytes.length, ...bytes];
  }
  function uleb128(value: number): number[] {
    const result: number[] = [];
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value !== 0) byte |= 0x80;
      result.push(byte);
    } while (value !== 0);
    return result;
  }
  function sleb128(value: number): number[] {
    const result: number[] = [];
    let more = true;
    while (more) {
      let byte = value & 0x7f;
      value >>= 7;
      if (
        (value === 0 && (byte & 0x40) === 0) ||
        (value === -1 && (byte & 0x40) !== 0)
      ) {
        more = false;
      } else {
        byte |= 0x80;
      }
      result.push(byte);
    }
    return result;
  }
  function section(id: number, contents: number[]): number[] {
    return [id, ...uleb128(contents.length), ...contents];
  }

  const wasi = 'wasi_snapshot_preview1';

  const typeSection = section(1, [
    2,
    0x60, 1, 0x7f, 0, // (i32) -> ()
    0x60, 0, 0, // () -> ()
  ]);

  const importSection = section(2, [
    1,
    ...encStr(wasi),
    ...encStr('proc_exit'),
    0x00, ...uleb128(0),
  ]);

  const funcSection = section(3, [1, ...uleb128(1)]);

  const memSection = section(5, [1, 0x00, 1]);

  const exportSection = section(7, [
    2,
    ...encStr('memory'), 0x02, ...uleb128(0),
    ...encStr('_start'), 0x00, ...uleb128(1),
  ]);

  const instructions = [
    0x41, ...sleb128(exitCode),
    0x10, ...uleb128(0), // call proc_exit
    0x0b,
  ];
  const funcBody = [0, ...instructions];
  const codeSection = section(10, [
    1,
    ...uleb128(funcBody.length),
    ...funcBody,
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);
}

/**
 * Build a minimal WASM that just returns (exits 0 without calling proc_exit).
 */
export function buildNoopWasm(): Uint8Array {
  function uleb128(value: number): number[] {
    const result: number[] = [];
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value !== 0) byte |= 0x80;
      result.push(byte);
    } while (value !== 0);
    return result;
  }
  function section(id: number, contents: number[]): number[] {
    return [id, ...uleb128(contents.length), ...contents];
  }
  const encoder = new TextEncoder();
  function encStr(s: string): number[] {
    const bytes = Array.from(encoder.encode(s));
    return [bytes.length, ...bytes];
  }

  const typeSection = section(1, [1, 0x60, 0, 0]);
  const funcSection = section(3, [1, 0]);
  const memSection = section(5, [1, 0x00, 1]);
  const exportSection = section(7, [
    2,
    ...encStr('memory'), 0x02, ...uleb128(0),
    ...encStr('_start'), 0x00, ...uleb128(0),
  ]);
  const codeSection = section(10, [1, 2, 0, 0x0b]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);
}
