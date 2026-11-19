import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Segment {
  readonly seconds: number;
  /** Peak amplitude, 0–1. */
  readonly amplitude: number;
}

const SAMPLE_RATE = 22050;

/** A mono 16-bit WAV of 440 Hz tone segments with the given amplitudes. */
export function buildWav(segments: readonly Segment[]): Buffer {
  const total = segments.reduce((sum, s) => sum + Math.round(s.seconds * SAMPLE_RATE), 0);
  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + total * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(total * 2, 40);

  let offset = 44;
  let n = 0;
  for (const segment of segments) {
    const count = Math.round(segment.seconds * SAMPLE_RATE);
    for (let i = 0; i < count; i += 1, n += 1) {
      const sample = Math.sin((2 * Math.PI * 440 * n) / SAMPLE_RATE) * segment.amplitude;
      buffer.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }
  return buffer;
}

export interface TestServer {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

/** Serves `/tone.wav` and whatever HTML `pages` maps. Sends no CORS headers on purpose. */
export async function startServer(
  wav: Buffer,
  pages: Readonly<Record<string, string>>,
): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const path = request.url?.split('?')[0] ?? '/';
    if (path === '/tone.wav') {
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      response.end(wav);
      return;
    }
    const html = pages[path];
    if (html === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
