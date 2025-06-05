// launcher.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// --- Configuration ---
const CLIENT_SCRIPT = path.join(__dirname, "client.js"); // Path to your client script
const LOG_DIR = path.join(__dirname, "client_logs"); // Directory for client logs
const NUM_CLIENTS = 5; // Fixed number of clients to launch by default

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  console.log(`Created log directory: ${LOG_DIR}`);
}

console.log(`🚀 Starting ${NUM_CLIENTS} client instance(s)...`);

const clientProcesses = [];
const openFileDescriptors = []; // To hold references to file descriptors for cleanup

for (let i = 1; i <= NUM_CLIENTS; i++) {
  const clientId = i; // Assign a unique ID to each client
  const outputFileName = `client_${clientId}_output.log`;
  const errorFileName = `client_${clientId}_error.log`;
  const outputPath = path.join(LOG_DIR, outputFileName);
  const errorPath = path.join(LOG_DIR, errorFileName);

  let stdoutFd;
  let stderrFd;

  try {
    // Open files and get their file descriptors
    // 'w' flag opens for writing, creates file if it doesn't exist, truncates if it does
    stdoutFd = fs.openSync(outputPath, "w");
    stderrFd = fs.openSync(errorPath, "w");
    openFileDescriptors.push(stdoutFd, stderrFd); // Add to list for closing later
  } catch (err) {
    console.error(
      `❌ Failed to open log files for client #${clientId}: ${err.message}`
    );
    // If file opening fails, we cannot proceed with this client.
    // It's important to not push a partially configured process and break the loop.
    continue;
  }

  console.log(
    `Launching client #${clientId}. Output to ${outputFileName}, Errors to ${errorFileName}`
  );

  // Spawn the client process
  // Arguments are passed after 'node' to the client.js script
  const clientProcess = spawn(
    "node",
    [CLIENT_SCRIPT, `--id=${clientId}`, `--nickname=client-${clientId}`],
    {
      detached: false, // Keep child processes attached to the parent's event loop
      // stdio: ['pipe', stdoutFd, stderrFd] means:
      // 0 (stdin): pipe
      // 1 (stdout): redirect to stdoutFd (file descriptor)
      // 2 (stderr): redirect to stderrFd (file descriptor)
      stdio: ["pipe", stdoutFd, stderrFd],
    }
  );

  clientProcess.on("exit", (code, signal) => {
    console.log(
      `Client #${clientId} exited with code ${code} and signal ${signal}`
    );
    // Close the file descriptors when the process exits
    if (stdoutFd) {
      try {
        fs.closeSync(stdoutFd);
      } catch (e) {
        /* ignore already closed */
      }
    }
    if (stderrFd) {
      try {
        fs.closeSync(stderrFd);
      } catch (e) {
        /* ignore already closed */
      }
    }
  });

  clientProcess.on("error", (err) => {
    console.error(`Failed to start client #${clientId}:`, err.message);
    // Ensure file descriptors are closed even on error
    if (stdoutFd) {
      try {
        fs.closeSync(stdoutFd);
      } catch (e) {
        /* ignore already closed */
      }
    }
    if (stderrFd) {
      try {
        fs.closeSync(stderrFd);
      } catch (e) {
        /* ignore already closed */
      }
    }
  });

  clientProcesses.push(clientProcess);
}

console.log(`✅ All ${NUM_CLIENTS} client launcher processes initiated.`);
console.log(
  `Check the '${path.basename(LOG_DIR)}' directory for individual client logs.`
);

// --- Graceful Shutdown ---
// This ensures that when the launcher script is terminated (e.g., via Ctrl+C),
// it attempts to kill all spawned client processes and close all file descriptors.
function shutdown() {
  console.log(
    "\n🚫 Shutting down launcher. Attempting to terminate client processes..."
  );
  clientProcesses.forEach((cp) => {
    if (cp && cp.exitCode === null) {
      // Check if process is still running
      console.log(`Killing client process PID: ${cp.pid}`);
      cp.kill("SIGTERM"); // Send a terminate signal
    }
  });

  // Close any remaining open file descriptors that might not have been closed
  // by individual client exit handlers (e.g., if launcher exits before clients).
  openFileDescriptors.forEach((fd) => {
    try {
      fs.closeSync(fd);
    } catch (e) {
      // Ignore if already closed or other error
    }
  });

  // Give a moment for processes to exit
  setTimeout(() => {
    console.log("Launcher process exiting.");
    process.exit(0);
  }, 500); // 500ms delay to allow child processes to terminate
}

// Listen for termination signals
process.on("SIGINT", shutdown); // Ctrl+C
process.on("SIGTERM", shutdown); // kill command
process.on("SIGQUIT", shutdown); // Ctrl+\
