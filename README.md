Distributed Audio Processing System
This project implements a distributed system for processing a large audio file across multiple client nodes using Node.js, Express, and WebSockets. The server divides a dummy audio file into chunks, distributes them to connected clients for processing (inverting audio samples), collects the results, and then combines, reverses, and encrypts the final processed audio.

Features
Server-Client Architecture: A central Node.js server communicates with multiple Node.js client instances.

WebSocket Communication: Efficient binary communication protocol for task distribution and result submission.

Large File Handling: Generates and processes a large dummy audio file (approximately 605 MB).

Task Management: The server manages task assignment, tracks task status (pending, assigned, done), and re-queues tasks if a client disconnects or becomes unresponsive.

Distributed Processing: Clients invert the audio samples in their assigned chunks.

Result Finalization: Server collects all processed chunks, reverses the entire audio stream, and encrypts it using AES-256-CBC.

Debugging Capabilities: Includes robust logging for tracking task states and system behavior.

Organized Output: All generated data files are stored in a dedicated generated_data/ folder.

Project Structure
.
├── server.js # Main server application
├── client.js # Client application
├── task-manager.js # Core logic for task generation, management, and finalization
├── package.json # Node.js project dependencies
├── package-lock.json # Node.js dependency lock file
├── .gitignore # Specifies files/folders to ignore in Git
└── generated_data/ # Folder for all generated files
├── test.raw # (Generated) Large dummy audio file for processing
├── result.raw # (Generated) Final processed and encrypted audio file
├── encryption_key.bin # (Generated) AES encryption key for result.raw
└── encryption_iv.bin # (Generated) AES initialization vector for result.raw

Getting Started
Follow these instructions to set up and run the distributed audio processing system.

Prerequisites
Node.js (v14 or higher recommended)

npm (Node Package Manager, comes with Node.js)

Installation
Clone the repository:

git clone <your-repository-url>
cd gemini # Or whatever your project folder is named

Install Node.js dependencies:
Navigate to your project directory in the terminal and run:

npm install

This will install express and ws (WebSocket) packages.

Running the Application
This system requires both a server and one or more clients to operate.

1. Start the Server
   Open a new terminal or command prompt window, navigate to your project directory, and run:

node server.js

First Run Notes:

On the very first run (or if generated_data/test.raw is missing), the server will create the generated_data folder and generate a large test.raw file (approx. 605 MB) inside it. This process takes some time (a few seconds to a minute or more depending on your system's disk speed). You will see progress logs during this step.

The server will listen on http://localhost:3000.

All logs (server and task manager) will be printed directly to this terminal.

2. Start Clients
   Open one or more additional terminal or command prompt windows. In each new window, navigate to your project directory and run:

node client.js

Each client.js instance will connect to the server and start requesting, processing, and submitting audio chunks.

You can run multiple client instances to distribute the workload and observe parallel processing. The more clients you run, the faster the total processing will complete.

Expected Output
Server Terminal: You will see logs indicating client connections, task assignments, result submissions (accepted/rejected), re-queueing of stuck tasks, and ultimately, a "FINAL RESULT READY!" message when all tasks are complete.

Client Terminals: You will see logs indicating connection status, tasks received, computation progress, and result submissions.

Final Output Files
Once all tasks are completed, the server will finalize the results and create the following files inside the newly created generated_data/ folder:

generated_data/result.raw: The combined, reversed, and encrypted audio data.

generated_data/encryption_key.bin: The secret key used for AES-256-CBC encryption.

generated_data/encryption_iv.bin: The Initialization Vector (IV) used for AES-256-CBC encryption.

Note: Keep these encryption files safe if you intend to decrypt result.raw later.

Troubleshooting
"ENOENT: no such file or directory" during startup: Ensure generated_data/test.raw (and the generated_data folder itself) is deleted before starting the server. This indicates a timing issue during file creation/reading, which the current code should handle asynchronously.

"Invalid result size" from server: This means the client is sending back a buffer of incorrect length. Ensure client.js is updated with the fix to Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength).

"Attempted to submit result for non-existent task #X": This suggests the server lost track of the task. Verify task-manager.js has the fix for tasks.set(taskId, { ... }) where the key is taskId, not chunkIndex. Also, check for unexpected server restarts.

"Cannot create a string longer than 0x1fffffe8 characters" / RangeError during finalization: This is a Node.js internal limit when trying to log or represent a very large buffer as a string. Ensure task-manager.js's finalizeResults uses new Uint8Array(floatArray.buffer).set(combinedBuffer) and Buffer.from(reversedArray.buffer, reversedArray.byteOffset, reversedArray.byteLength) to explicitly manage buffer memory and avoid implicit string conversions in logs.

ReferenceError: verifyDecryption is not defined: Ensure verifyDecryption function is defined before finalizeResults in task-manager.js.

Contributing
Feel free to fork this repository, make improvements, and submit pull requests.

License
[Specify your license here, e.g., MIT, Apache 2.0, etc.]
