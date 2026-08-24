import type { ScanVerdict } from "./types.js";
import type { FileScanner } from "./types.js";

export class NoopFileScanner implements FileScanner {
  readonly name = "noop";

  async scan(_input?: { bytes: Uint8Array; filename: string; contentType: string }): Promise<ScanVerdict> {
    return { status: "unscanned", scanner: this.name };
  }
}

export function createFileScannerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FileScanner {
  const driver = (env.FILE_SCANNER_DRIVER ?? "noop").trim().toLowerCase();
  if (driver === "noop" || driver === "") {
    return new NoopFileScanner();
  }
  return new NoopFileScanner();
}
