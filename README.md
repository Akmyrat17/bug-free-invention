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
