// client.js
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

// --- Configuration Constants ---
const SERVER_URL = "ws://localhost:3000";
const CLIENT_NICKNAME = "MyNodeClient_" + Math.floor(Math.random() * 1000);

// --- Binary Protocol Command IDs ---
const CLIENT_COMMAND_HANDSHAKE = 0;
const CLIENT_COMMAND_REQUEST_TASK = 1;
const CLIENT_COMMAND_SUBMIT_RESULT = 2;

const SERVER_COMMAND_TYPE_TASK_DATA = 100;
const SERVER_COMMAND_TYPE_STATUS_MESSAGE = 101;

// --- Client State Variables ---
let ws = null;
let peerId = null;
let isProcessing = false;

// --- Audio Data Constants ---
const SAMPLE_RATE = 44100;
const FLOAT_SIZE = 4;
// These should match task-manager.js for consistent chunking
const CHUNK_SAMPLES = SAMPLE_RATE / 10; // 0.1 second chunks for faster processing visually
const CHUNK_BYTES = CHUNK_SAMPLES * FLOAT_SIZE;

// --- WebSocket Connection Function ---
function connectToServer() {
  console.log(`Attempting to connect to ${SERVER_URL}...`);
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    console.log("✅ WebSocket connected!");
    sendHandshake();
  };

  // --- Event: Message Received ---
  ws.onmessage = (event) => {
    const message = event.data;

    if (!(message instanceof Buffer)) {
      console.warn(
        "📥 Received non-binary message from server:",
        message.toString()
      );
      return;
    }

    // --- First Message: Peer ID Assignment (2-byte Buffer) ---
    if (peerId === null && message.length === 2) {
      peerId = message.readUInt16BE(0);
      console.log(`🆔 Received peerId: #${peerId}. Client is now registered.`);
      requestTask();
      return;
    }

    // --- Subsequent Messages: Must follow our Binary Protocol Header (at least 4 bytes) ---
    if (message.length < 4) {
      console.warn(
        `Received unexpected short binary message (length ${message.length}) from server. Ignoring.`
      );
      return;
    }

    const serverCommandId = message.readUInt16BE(0);
    const associatedValue = message.readUInt16BE(2);

    // --- Server Command 100: Task Data (SERVER_COMMAND_TYPE_TASK_DATA) ---
    if (serverCommandId === SERVER_COMMAND_TYPE_TASK_DATA) {
      const taskId = associatedValue;
      const audioChunkBuffer = message.slice(4);

      console.log(
        `📥 Received Task #${taskId} (size: ${audioChunkBuffer.length} bytes).`
      );

      isProcessing = true;
      processTask(taskId, audioChunkBuffer);
      return;
    }

    // --- Server Command 101: Status Message (SERVER_COMMAND_TYPE_STATUS_MESSAGE) ---
    else if (serverCommandId === SERVER_COMMAND_TYPE_STATUS_MESSAGE) {
      const jsonString = message.slice(4).toString("utf8");
      let statusPayload;
      try {
        statusPayload = JSON.parse(jsonString);
      } catch (e) {
        console.error("❌ Error parsing status JSON from server:", e.message);
        return;
      }

      console.log(`📥 Received status message from server:`, statusPayload);

      if (statusPayload.type === "no-task") {
        console.log(
          "No tasks available right now. Waiting for new tasks or for others to finish."
        );
        isProcessing = false;
        setTimeout(requestTask, 2000);
      } else if (statusPayload.type === "completion") {
        console.log(
          "🎉 Server announced all tasks are completed! No more work for this session."
        );
        isProcessing = false;
        ws.close(1000, "All tasks completed.");
      }
      return;
    }

    console.warn(
      `Received unknown server command ID ${serverCommandId}. Ignoring.`
    );
  };

  ws.onclose = (event) => {
    console.log(
      `❌ WebSocket disconnected. Code: ${event.code}, Reason: ${
        event.reason || "No reason specified"
      }`
    );
    peerId = null;
    isProcessing = false;

    if (event.code !== 1000) {
      // 1000 is normal closure
      console.log("Attempting to reconnect in 5 seconds...");
      setTimeout(connectToServer, 5000);
    }
  };

  ws.onerror = (error) => {
    console.error("🔥 WebSocket error:", error.message);
  };
}

// --- Helper function to send the initial handshake message ---
function sendHandshake() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = { nickname: CLIENT_NICKNAME };
    const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");

    const messageBuffer = Buffer.alloc(4 + jsonBuffer.length);
    messageBuffer.writeUInt16BE(0, 0);
    messageBuffer.writeUInt16BE(CLIENT_COMMAND_HANDSHAKE, 2);
    jsonBuffer.copy(messageBuffer, 4);
    ws.send(messageBuffer);

    console.log(
      `⬆️ Sent handshake with nickname '${CLIENT_NICKNAME}'. WS State: ${ws.readyState}`
    );
  } else {
    console.warn(
      `⬆️ Could not send handshake. WS State: ${ws ? ws.readyState : "null"}`
    );
  }
}

// --- Helper function to request a new task from the server ---
function requestTask() {
  if (
    peerId !== null &&
    ws &&
    ws.readyState === WebSocket.OPEN &&
    !isProcessing
  ) {
    const payload = {};
    const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");

    const messageBuffer = Buffer.alloc(4 + jsonBuffer.length);
    messageBuffer.writeUInt16BE(peerId, 0);
    messageBuffer.writeUInt16BE(CLIENT_COMMAND_REQUEST_TASK, 2);
    jsonBuffer.copy(messageBuffer, 4);
    ws.send(messageBuffer);
    console.log(
      `⬆️ Peer #${peerId} requesting next task. WS State: ${ws.readyState}`
    );
  } else {
    console.warn(
      `Cannot request task. Peer ID: ${peerId}, WS State: ${
        ws ? ws.readyState : "null"
      }, Is processing: ${isProcessing}`
    );
  }
}

// --- Task Processing Function ---
function processTask(taskId, audioChunkBuffer) {
  console.log(`Working on Task #${taskId}...`);

  if (audioChunkBuffer.length % FLOAT_SIZE !== 0) {
    console.error(
      `Received audioChunkBuffer for Task #${taskId} has an invalid length (${audioChunkBuffer.length} bytes). Not a multiple of ${FLOAT_SIZE}.`
    );
    isProcessing = false;
    requestTask();
    return;
  }

  const floatArray = new Float32Array(
    audioChunkBuffer.buffer,
    audioChunkBuffer.byteOffset,
    audioChunkBuffer.byteLength / FLOAT_SIZE
  );

  for (let i = 0; i < floatArray.length; i++) {
    floatArray[i] = floatArray[i] * -1; // Invert by multiplying by -1
  }

  console.log(`Completed computation for Task #${taskId}.`);
  // CRITICAL FIX: Create Buffer from the exact view of the Float32Array
  const processedResultBuffer = Buffer.from(
    floatArray.buffer,
    floatArray.byteOffset,
    floatArray.byteLength
  );
  submitResult(taskId, processedResultBuffer);
}

// --- Helper function to submit processed task result to the server ---
function submitResult(taskId, processedBuffer) {
  const base64EncodedResult = processedBuffer.toString("base64");

  const payload = {
    taskId: taskId,
    result: base64EncodedResult,
  };
  const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");

  if (ws && ws.readyState === WebSocket.OPEN) {
    const messageBuffer = Buffer.alloc(4 + jsonBuffer.length);
    messageBuffer.writeUInt16BE(peerId, 0);
    messageBuffer.writeUInt16BE(CLIENT_COMMAND_SUBMIT_RESULT, 2);
    jsonBuffer.copy(messageBuffer, 4);

    ws.send(messageBuffer);
    console.log(
      `⬆️ Peer #${peerId} submitted result for Task #${taskId}. WS State: ${ws.readyState}`
    );
  } else {
    console.error(
      `⬆️ Could not submit result for Task #${taskId}. WS State: ${
        ws ? ws.readyState : "null"
      }`
    );
  }

  isProcessing = false;
  requestTask();
}

// --- Start the connection process when the client.js script runs ---
connectToServer();
