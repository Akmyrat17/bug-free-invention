// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const taskManager = require("./task-manager"); // This line is correct

// --- Configuration Constants ---
const PORT = 3000;

// --- Define Server-Side Command IDs for our Binary Protocol ---
const SERVER_COMMAND_TYPE_TASK_DATA = 100;
const SERVER_COMMAND_TYPE_STATUS_MESSAGE = 101;

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Server-Side Data Structures ---
const clients = new Map();
let nextPeerId = 0;
const assignedTasks = new Map(); // Key: peerId, Value: Set of taskIds assigned to that peer

// --- Helper function to find a suitable client for re-assignment ---
function assignOrphanedTask(taskId) {
  // We look for any currently connected client to give this re-queued task.
  for (let [peerId, clientWs] of clients.entries()) {
    if (clientWs.readyState === WebSocket.OPEN) {
      // Re-get the task from taskManager, it should now be 'pending' again
      const task = taskManager.getNextTask(peerId); // taskManager will update its status to 'assigned' again

      if (task) {
        // Should always be true if taskId exists and is re-queued
        const responseBuffer = Buffer.alloc(4 + task.buffer.length); // CORRECTED: + task.buffer.length
        responseBuffer.writeUInt16BE(SERVER_COMMAND_TYPE_TASK_DATA, 0);
        responseBuffer.writeUInt16BE(task.id, 2);
        task.buffer.copy(responseBuffer, 4);
        clientWs.send(responseBuffer);

        // Update assignedTasks for the new client
        let clientTasks = assignedTasks.get(peerId);
        if (!clientTasks) {
          clientTasks = new Set();
          assignedTasks.set(peerId, clientTasks);
        }
        clientTasks.add(task.id);

        console.log(
          `♻️ Re-assigned orphaned Task #${task.id} to peer #${peerId}.`
        );
        return true; // Task re-assigned
      }
    }
  }
  console.warn(
    `Could not re-assign orphaned Task #${taskId}. No available clients.`
  );
  return false;
}

// --- Task Manager Initialization ---
// Make sure taskManager.loadChunks() is called.
taskManager.loadChunks(); // This will also generate audio.raw if it doesn't exist

// --- Express HTTP Routes ---
// Changed from "/" to "/health" for a more standard health check endpoint.
app.get("/health", (_, res) => {
  // Changed from "/" to "/health"
  res.send("OK");
});

// --- WebSocket Connection Handling ---
wss.on("connection", (ws) => {
  console.log("🔌 A new client connected to WebSocket.");
  ws.peerId = null; // Initialize peerId for this WebSocket connection

  ws.on("message", (buffer) => {
    // Renamed 'message' to 'buffer' for clarity
    // CORRECTED: Use buffer.length
    if (buffer.length < 4) {
      console.warn(
        "Received a message smaller than expected header (4 bytes). Ignoring."
      );
      return;
    }

    // CORRECTED: Use readUInt16BE
    const peerId = buffer.readUInt16BE(0);
    const commandId = buffer.readUInt16BE(2);

    const jsonString = buffer.slice(4).toString("utf8");
    let payload;

    try {
      payload = JSON.parse(jsonString);
    } catch (error) {
      console.error(
        "❌ Error parsing JSON payload from client:",
        error.message
      );
      return;
    }

    // --- Command ID 0: Handshake / Registration ---
    if (commandId === 0) {
      const assignedId = nextPeerId++;
      clients.set(assignedId, ws);
      ws.peerId = assignedId; // CORRECTED: Set peerId on the WebSocket object
      assignedTasks.set(assignedId, new Set()); // Initialize assigned tasks set for new client

      const response = Buffer.alloc(2);
      response.writeUInt16BE(assignedId, 0);
      ws.send(response);
      console.log(
        `🆔 Registered new client (nickname: ${
          payload.nickname || "N/A"
        }) with peerId #${assignedId}`
      );
      return;
    }

    // --- Ensure peerId is registered for subsequent commands ---
    if (!clients.has(peerId)) {
      console.warn(
        `Received command ${commandId} from unregistered peerId #${peerId}. Ignoring.`
      );
      return;
    }

    // --- Command ID 1: Client Requests a Task ---
    else if (commandId === 1) {
      console.log(`➡️ Peer #${peerId} requested a task.`);
      const task = taskManager.getNextTask(peerId);

      if (task) {
        // CORRECTED: Add task to the client's assigned tasks
        let clientTasks = assignedTasks.get(peerId);
        if (!clientTasks) {
          // Should already exist from handshake, but good defensive check
          clientTasks = new Set();
          assignedTasks.set(peerId, clientTasks);
        }
        clientTasks.add(task.id);

        const responseBuffer = Buffer.alloc(4 + task.buffer.length);
        responseBuffer.writeUInt16BE(SERVER_COMMAND_TYPE_TASK_DATA, 0);
        responseBuffer.writeUInt16BE(task.id, 2);
        task.buffer.copy(responseBuffer, 4);
        ws.send(responseBuffer);
        console.log(`⬅️ Sent Task #${task.id} to peer #${peerId}.`);
      } else {
        const statusPayload = {
          type: "no-task",
          message: "No tasks currently available.",
        };
        const jsonStatusBuffer = Buffer.from(
          JSON.stringify(statusPayload),
          "utf8"
        );

        const responseBuffer = Buffer.alloc(4 + jsonStatusBuffer.length);
        responseBuffer.writeUInt16BE(0, 0); // peerId 0 for general status message
        responseBuffer.writeUInt16BE(SERVER_COMMAND_TYPE_STATUS_MESSAGE, 2);
        jsonStatusBuffer.copy(responseBuffer, 4);
        ws.send(responseBuffer);
        console.log(`⬅️ Informed peer #${peerId}: No tasks available.`);
      }
      return;
    }

    // --- Command ID 2: Client Submits Result ---
    else if (commandId === 2) {
      console.log(`⬆️ Peer #${peerId} submitted result for task.`);
      const taskId = payload.taskId;
      const base64Result = payload.result;

      // CORRECTED: Proper validation for base64Result type
      if (typeof taskId === "undefined" || typeof base64Result !== "string") {
        console.warn(
          `Received malformed result submission from peer #${peerId}. Missing taskId or result. Ignoring.`
        );
        return;
      }

      let resultBuffer;
      try {
        resultBuffer = Buffer.from(base64Result, "base64");
      } catch (err) {
        console.error(
          `❌ Peer #${peerId} submitted invalid Base64 data for taskId #${taskId}:`,
          err.message
        );
        return;
      }

      const accepted = taskManager.submitResult(taskId, resultBuffer);

      if (accepted) {
        // Remove the task from the client's assignedTasks set upon successful submission
        if (assignedTasks.has(peerId)) {
          assignedTasks.get(peerId).delete(taskId);
        }
        console.log(
          `✅ Successfully accepted result for Task #${taskId} from peer #${peerId}.`
        );

        if (taskManager.isAllDone()) {
          console.log(`🎉 All tasks are completed! Initiating finalization...`);
          taskManager.finalizeResults();

          const completionMessage = {
            type: "completion",
            message: "All processing tasks are completed on the server.",
          };
          const jsonCompletionBuffer = Buffer.from(
            JSON.stringify(completionMessage),
            "utf8"
          );

          const responseBuffer = Buffer.alloc(4 + jsonCompletionBuffer.length);
          responseBuffer.writeUInt16BE(0, 0); // peerId 0 for general status message
          responseBuffer.writeUInt16BE(SERVER_COMMAND_TYPE_STATUS_MESSAGE, 2);
          jsonCompletionBuffer.copy(responseBuffer, 4);
          sendToAllClients(responseBuffer);
        } else {
          console.log(
            `Still ${
              taskManager.tasks.size - // This line will now work!
              Array.from(taskManager.tasks.values()).filter(
                (t) => t.status === "done"
              ).length
            } tasks remaining.`
          );
        }
      } else {
        console.warn(
          `⚠️ Result for Task #${taskId} from peer #${peerId} was not accepted (possibly duplicate or task already done).`
        );
      }
      return;
    }

    // Fallback for unknown commands
    console.warn(
      `Received unknown command ${commandId} from peer #${peerId} with payload:`,
      payload
    );
  });

  // --- Helper function to send a message to all connected clients ---
  function sendToAllClients(messageBuffer) {
    for (const [id, clientWs] of clients.entries()) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(messageBuffer);
        console.log(`Broadcasted completion message to peer #${id}.`);
      }
    }
  }

  // --- Handling client disconnects ---
  ws.on("close", (code, reason) => {
    const disconnectedPeerId = ws.peerId; // Use the peerId stored directly on the ws object

    if (disconnectedPeerId !== null && clients.has(disconnectedPeerId)) {
      clients.delete(disconnectedPeerId);
      console.log(
        `🔌 Client peerId #${disconnectedPeerId} disconnected. Code: ${code}, Reason: ${reason.toString()}`
      );

      // --- CRITICAL: Re-assign orphaned tasks ---
      if (assignedTasks.has(disconnectedPeerId)) {
        const tasksToReassign = assignedTasks.get(disconnectedPeerId);
        assignedTasks.delete(disconnectedPeerId);

        console.log(
          `🔍 Peer #${disconnectedPeerId} had ${tasksToReassign.size} tasks assigned. Re-queuing them.`
        );

        for (const taskId of tasksToReassign) {
          const taskInManager = taskManager.tasks.get(taskId); // This line will now work!
          if (
            taskInManager &&
            taskInManager.status === "assigned" &&
            taskInManager.assignedTo === disconnectedPeerId
          ) {
            taskInManager.status = "pending";
            taskInManager.assignedTo = null;
            taskInManager.assignmentTime = null;
            console.log(`🔄 Task #${taskId} re-queued as 'pending'.`);
            assignOrphanedTask(taskId); // Attempt to re-assign immediately
          } else {
            console.warn(
              `Task #${taskId} from disconnected peer was already processed or not in expected state.`
            );
          }
        }
      }
    } else {
      console.log(
        `🔌 An unregistered/unknown client disconnected. Code: ${code}, Reason: ${reason.toString()}`
      );
    }
  });

  // --- Handling WebSocket errors ---
  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error.message);
  });
});

// --- Start the Server ---
server.listen(PORT, () => {
  // CORRECTED: More descriptive server start log
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`); // Corrected path
});
