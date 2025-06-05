# Distributed Audio Processing System

This project implements a distributed system for processing a large audio file across multiple client nodes using **Node.js**, **Express**, and **WebSockets**. The server divides a large audio file into chunks, distributes them to connected clients for processing (e.g., inverting audio samples), collects the results, and finally combines, reverses, and encrypts the output using AES.

---

## 🧠 Features

- ⚙️ **Server-Client Architecture** using Node.js and WebSocket
- 🛰️ **Binary Protocol Communication** for efficient task and result handling
- 📂 **Large File Handling** (~605MB of raw audio float data)
- 🗂️ **Task Management** with chunk reassignment on client disconnects
- 🧮 **Distributed Audio Processing** (inverting floats in chunks)
- 🔐 **AES-256-CBC Encryption** on final result
- 📜 **Structured Output** saved in a `generated_data/` directory
- 🐞 **Verbose Debug Logging** for transparent processing and error tracking

## 🚀 Getting Started

### 📦 Prerequisites

- Node.js v14+
- npm (comes with Node.js)

### 🛠️ Installation

```bash
git clone <your-repository-url>
cd <project-folder>
npm install
```

## 🏃 Running the Application

This system requires both a server and one or more clients to operate. Use the following npm scripts to run each part:

### Start the Server

```bash
npm run start-server
```

### Start a Client

```bash
npm run start-client
```

### Start Multiple Clients

```bash
npm run clients
```

### Start the Server and Clients

```bash
npm run dev-cluster
```

## 📂 File Descriptions

Here's a breakdown of the key files in this project:

**server.js**  
The main server application. This file sets up the Express HTTP server, handles WebSocket connections, manages client handshakes, assigns tasks to connected clients, and receives processed results. It coordinates the overall distributed process.

**client.js**  
The client application. Each instance of this script connects to the server via WebSocket, registers itself, requests audio chunks, performs the necessary audio processing (inverting samples), and submits the processed results back to the server. It also handles reconnection logic.

**task-manager.js**  
This module encapsulates the core business logic for task management. It's responsible for:

- Generating the large `test.raw` dummy audio file.
- Dividing the audio file into smaller tasks (chunks).
- Managing the state of each task (pending, assigned, done).
- Providing the next available task to clients.
- Accepting and validating processed results from clients.
- Re-queueing tasks if clients become unresponsive.
- Orchestrating the finalization process: combining all processed chunks, reversing the entire audio stream, encrypting it, and saving the `result.raw` file along with the encryption keys (`encryption_key.bin`, `encryption_iv.bin`).

**generated_data/**  
A directory created by the `task-manager.js` module. It stores all the large, generated files to keep the main project directory clean:

- `test.raw`: The initial large dummy audio file.
- `result.raw`: The final combined, reversed, and AES-256-CBC encrypted audio output.
- `encryption_key.bin`: The binary file containing the AES encryption key.
- `encryption_iv.bin`: The binary file containing the AES Initialization Vector (IV).
