import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('could not allocate a preview port'));
        else resolve(port);
      });
    });
  });
}

function outputTail(chunks, maxLength = 4000) {
  return chunks.join('').slice(-maxLength).trim();
}

function waitForClose(proc, timeoutMs) {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      proc.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    proc.once('close', onClose);
  });
}

async function stopProcess(proc) {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;

  let closed = waitForClose(proc, 2000);
  try {
    proc.kill('SIGTERM');
  } catch {
    // The process may have exited between the state check and kill.
  }
  if (await closed) return;

  closed = waitForClose(proc, 1000);
  try {
    proc.kill('SIGKILL');
  } catch {
    // Nothing remains to clean up.
  }
  await closed;
}

function waitForReady(proc, url, timeoutMs, getOutput) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let polling = false;

    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      proc.off('error', onError);
      proc.off('exit', onExit);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const failure = (message) => {
      const output = getOutput();
      return new Error(output ? `${message}\n${output}` : message);
    };
    const onError = (error) => finish(reject, failure(`preview failed to start: ${error.message}`));
    const onExit = (code, signal) => {
      finish(reject, failure(`preview exited before it was ready (code=${code}, signal=${signal})`));
    };
    const poll = async () => {
      if (settled || polling) return;
      polling = true;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.status < 500) finish(resolve);
      } catch {
        // The preview socket is not accepting requests yet.
      } finally {
        polling = false;
      }
    };

    proc.once('error', onError);
    proc.once('exit', onExit);
    const interval = setInterval(() => void poll(), 100);
    const timeout = setTimeout(
      () => finish(reject, failure(`preview server timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    void poll();
  });
}

export async function startPreview({ rootDir, timeoutMs = 20000 }) {
  const port = await getAvailablePort();
  const url = `http://${HOST}:${port}/`;
  const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const output = [];
  const proc = spawn(
    process.execPath,
    [viteCli, 'preview', '--host', HOST, '--port', String(port), '--strictPort'],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  proc.stdout.on('data', (chunk) => {
    const text = String(chunk);
    output.push(text);
    process.stdout.write(text);
  });
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk);
    output.push(text);
    process.stderr.write(text);
  });

  try {
    await waitForReady(proc, url, timeoutMs, () => outputTail(output));
  } catch (error) {
    await stopProcess(proc);
    throw error;
  }

  return {
    port,
    process: proc,
    url,
    stop: () => stopProcess(proc),
  };
}
