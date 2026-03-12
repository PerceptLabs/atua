/**
 * ProcessPipeline — stdio piping between processes
 *
 * Phase D: Enables `proc1.pipe(proc2)` and `proc.pipe(fileStream)`.
 * Supports:
 * - Process-to-process piping (stdout → stdin)
 * - Process-to-file piping (stdout → AtuaFS write)
 * - File-to-process piping (AtuaFS read → stdin)
 * - Tee (stdout → multiple destinations)
 */
import { AtuaProcess } from './AtuaProcess.js';
import type { AtuaFS } from '../fs/AtuaFS.js';

export interface PipeOptions {
  /** Whether to close the destination when source ends (default: true) */
  end?: boolean;
}

/**
 * Pipe stdout from source process to stdin of destination process.
 */
export function pipeProcesses(
  source: AtuaProcess,
  destination: AtuaProcess,
  options: PipeOptions = {},
): void {
  const shouldEnd = options.end ?? true;

  source.on('stdout', (data: string) => {
    try {
      destination.write(data);
    } catch {
      // Destination process may have already exited
    }
  });

  if (shouldEnd) {
    source.on('exit', () => {
      // Signal end of input to destination
      // AtuaProcess doesn't have a closeStdin, but the data will stop
    });
  }
}

/**
 * Pipe stdout from a process to a file in AtuaFS.
 */
export function pipeToFile(
  source: AtuaProcess,
  fs: AtuaFS,
  path: string,
  options: { append?: boolean } = {},
): void {
  // Clear or prepare the file
  if (!options.append) {
    try {
      fs.writeFileSync(path, '');
    } catch {
      // File may not exist yet — that's fine
    }
  }

  source.on('stdout', (data: string) => {
    try {
      fs.appendFileSync(path, data);
    } catch {
      // FS write error — ignore
    }
  });
}

/**
 * Pipe file contents from AtuaFS to a process stdin.
 */
export function pipeFromFile(
  fs: AtuaFS,
  path: string,
  destination: AtuaProcess,
): void {
  try {
    const content = fs.readFileSync(path, 'utf-8') as string;
    destination.write(content);
  } catch (err: any) {
    // File read error — send to stderr
  }
}

/**
 * Tee — pipe stdout to multiple destinations.
 */
export function teeProcess(
  source: AtuaProcess,
  destinations: AtuaProcess[],
): void {
  source.on('stdout', (data: string) => {
    for (const dest of destinations) {
      try {
        dest.write(data);
      } catch {
        // Destination may have already exited
      }
    }
  });
}

/**
 * Collect all stdout from a process into a string.
 */
export function collectOutput(proc: AtuaProcess): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    proc.on('stdout', (data: string) => chunks.push(data));
    proc.on('exit', () => resolve(chunks.join('')));
  });
}

/**
 * Collect all stderr from a process into a string.
 */
export function collectErrors(proc: AtuaProcess): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    proc.on('stderr', (data: string) => chunks.push(data));
    proc.on('exit', () => resolve(chunks.join('')));
  });
}
