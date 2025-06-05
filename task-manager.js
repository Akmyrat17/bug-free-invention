// task-manager.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TaskStatus = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  DONE: "done",
};

// CONSTANTS - RESTORED TO ORIGINAL LARGE SCALE
const SAMPLE_RATE = 44100; // 44,100 floats per second
const FLOAT_SIZE = 4; // 32-bit float = 4 bytes

const CHUNK_SAMPLES = SAMPLE_RATE; // 1 second chunks
const CHUNK_BYTES = CHUNK_SAMPLES * FLOAT_SIZE;

const ACTUAL_TOTAL_SAMPLES = 158760000; // Exactly as per original assignment (approx 60 minutes)
const ACTUAL_TOTAL_BYTES = ACTUAL_TOTAL_SAMPLES * FLOAT_SIZE;

// --- NEW: Define the output folder ---
const GENERATED_FILES_DIR = path.join(__dirname, "generated_data");

// --- Update file paths to use the new folder ---
const FILE_PATH = path.join(GENERATED_FILES_DIR, "test.raw");
const RESULT_FILE_PATH = path.join(GENERATED_FILES_DIR, "result.raw");
const ENCRYPTION_KEY_PATH = path.join(
  GENERATED_FILES_DIR,
  "encryption_key.bin"
);
const ENCRYPTION_IV_PATH = path.join(GENERATED_FILES_DIR, "encryption_iv.bin");

// Configuration for re-queuing stuck tasks
const ASSIGNED_TIMEOUT_MS = 5000; // Original 5 seconds timeout

const tasks = new Map();
let totalChunksLoaded = 0;

// Helper to ensure directory exists
function ensureGeneratedDataDirExists() {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    console.log(`[TaskManager] Creating directory: ${GENERATED_FILES_DIR}`);
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
}

// --- ASYNC: Generate Dummy Audio File ---
function generateDummyAudioFile() {
  return new Promise((resolve, reject) => {
    ensureGeneratedDataDirExists(); // Ensure folder exists before writing

    console.log(`[TaskManager] Generating dummy audio file: ${FILE_PATH}`);
    console.log(
      `[TaskManager] Total samples: ${ACTUAL_TOTAL_SAMPLES.toLocaleString()}`
    );
    console.log(
      `[TaskManager] Total size: ${(ACTUAL_TOTAL_BYTES / 1024 / 1024).toFixed(
        1
      )} MB`
    );
    console.log(
      `[TaskManager] Chunk size: ${CHUNK_SAMPLES.toLocaleString()} samples (${(
        CHUNK_BYTES / 1024
      ).toFixed(1)} KB)`
    );

    try {
      const writeStream = fs.createWriteStream(FILE_PATH);
      const BATCH_SIZE_SAMPLES = CHUNK_SAMPLES * 100; // Process 100 chunks at a time for writing

      let samplesWritten = 0;
      const startTime = Date.now();

      // Handle stream finish (all data written and file closed)
      writeStream.on("finish", () => {
        const duration = (Date.now() - startTime) / 1000;
        console.log(
          `[TaskManager] ✅ File created in ${duration.toFixed(
            1
          )}s: ${FILE_PATH}`
        );
        resolve(); // Resolve the promise indicating completion
      });

      // Handle stream errors
      writeStream.on("error", (error) => {
        console.error(
          `[TaskManager] ❌ Error creating file stream:`,
          error.message
        );
        reject(error); // Reject the promise on error
      });

      // Write data in batches
      const writeNextBatch = () => {
        if (samplesWritten < ACTUAL_TOTAL_SAMPLES) {
          const remainingSamples = ACTUAL_TOTAL_SAMPLES - samplesWritten;
          const currentBatchSize = Math.min(
            BATCH_SIZE_SAMPLES,
            remainingSamples
          );
          const batchBuffer = Buffer.alloc(currentBatchSize * FLOAT_SIZE);

          for (let i = 0; i < currentBatchSize; i++) {
            const value = Math.random() * 2 - 1; // Float from -1 to 1
            batchBuffer.writeFloatLE(value, i * FLOAT_SIZE);
          }

          samplesWritten += currentBatchSize;
          const progress = Math.floor(
            (samplesWritten / ACTUAL_TOTAL_SAMPLES) * 100
          );
          if (samplesWritten % (ACTUAL_TOTAL_SAMPLES / 10) < currentBatchSize) {
            console.log(
              `[TaskManager] Generation progress: ${progress}% (${samplesWritten.toLocaleString()}/${ACTUAL_TOTAL_SAMPLES.toLocaleString()})`
            );
          }

          // Write the batch and continue writing if the buffer is drained
          if (!writeStream.write(batchBuffer)) {
            writeStream.once("drain", writeNextBatch); // Pause writing until buffer drains
          } else {
            process.nextTick(writeNextBatch); // Continue writing immediately
          }
        } else {
          writeStream.end(); // All samples written, end the stream
        }
      };

      writeNextBatch(); // Start the writing process
    } catch (error) {
      console.error(
        `[TaskManager] ❌ Initial error setting up file creation:`,
        error.message
      );
      reject(error); // Reject if there's an immediate setup error
    }
  });
}

// --- ASYNC: Load Chunks ---
async function loadChunks() {
  ensureGeneratedDataDirExists(); // Ensure folder exists before reading (in case it was manually deleted)

  if (!fs.existsSync(FILE_PATH)) {
    console.log(
      `[TaskManager] File '${path.basename(FILE_PATH)}' not found. Creating...`
    );
    try {
      await generateDummyAudioFile(); // AWAIT the file generation
    } catch (error) {
      console.error(
        `[TaskManager] ❌ Error during dummy file generation:`,
        error.message
      );
      throw error; // Re-throw to allow server.js to catch and exit
    }
  }

  console.log(`[TaskManager] Loading chunks from ${FILE_PATH}...`);
  let data;
  try {
    const fileStats = fs.statSync(FILE_PATH);
    console.log(
      `[TaskManager] File size: ${(fileStats.size / 1024 / 1024).toFixed(1)} MB`
    );
    data = fs.readFileSync(FILE_PATH);
    console.log(`[TaskManager] Read ${data.length.toLocaleString()} bytes`);
  } catch (error) {
    console.error(`[TaskManager] ❌ Error reading file:`, error.message);
    throw error; // Re-throw to allow server.js to catch and exit
  }

  totalChunksLoaded = Math.ceil(data.length / CHUNK_BYTES);
  console.log(
    `[TaskManager] Will create ${totalChunksLoaded.toLocaleString()} tasks (chunks)`
  );

  if (totalChunksLoaded === 0) {
    console.warn(`[TaskManager] ⚠️ No data to process!`);
    return;
  }

  const startTime = Date.now();
  for (let i = 0; i < totalChunksLoaded; i++) {
    const start = i * CHUNK_BYTES;
    const end = Math.min(start + CHUNK_BYTES, data.length);
    const chunkBuffer = data.slice(start, end);

    const taskId = i + 1; // Task IDs start from 1
    tasks.set(taskId, {
      id: taskId,
      chunkIndex: i,
      buffer: chunkBuffer,
      status: TaskStatus.PENDING,
      assignedTo: null,
      assignmentTime: null,
      result: null,
    });

    if (i % 1000 === 0 && i > 0) {
      const progress = Math.floor((i / totalChunksLoaded) * 100);
      console.log(
        `[TaskManager] Task creation progress: ${progress}% (${i}/${totalChunksLoaded})`
      );
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(
    `[TaskManager] ✅ Created ${totalChunksLoaded.toLocaleString()} tasks in ${duration.toFixed(
      1
    )}s`
  );
}

function getNextTask(peerId) {
  for (const [taskId, task] of tasks.entries()) {
    if (task.status === TaskStatus.PENDING) {
      task.status = TaskStatus.ASSIGNED;
      task.assignedTo = peerId;
      task.assignmentTime = Date.now();

      const pendingCount = Array.from(tasks.values()).filter(
        (t) => t.status === TaskStatus.PENDING
      ).length;
      console.log(
        `[TaskManager] Task #${taskId} assigned to client #${peerId}. Remaining pending: ${pendingCount}`
      );
      return task;
    }
  }

  console.log(`[TaskManager] No pending tasks available for client #${peerId}`);
  return null;
}

function submitResult(taskId, resultBuffer) {
  const taskEntry = tasks.get(taskId);
  if (!taskEntry) {
    console.error(
      `[TaskManager] DEBUG: Task #${taskId} is NOT FOUND in the tasks map during submission processing! This is why it's reported as 'non-existent'.`
    );
  } else {
    console.log(
      `[TaskManager] DEBUG: Task #${taskId} IS present in map. Current status: ${taskEntry.status}. Assigned to peer: ${taskEntry.assignedTo}`
    );
  }

  if (!tasks.has(taskId)) {
    console.warn(`[TaskManager] ⚠️ Task #${taskId} not found!`);
    return false;
  }

  const task = tasks.get(taskId);

  if (task.status === TaskStatus.DONE) {
    console.warn(`[TaskManager] ⚠️ Task #${taskId} already completed!`);
    return false;
  }

  if (resultBuffer.length !== task.buffer.length) {
    console.error(
      `[TaskManager] ❌ Invalid result size for task #${taskId}: received ${resultBuffer.length}, expected ${task.buffer.length}`
    );
    return false;
  }

  task.status = TaskStatus.DONE;
  task.result = resultBuffer;
  task.assignedTo = null;
  task.assignmentTime = null;

  const completedCount = Array.from(tasks.values()).filter(
    (t) => t.status === TaskStatus.DONE
  ).length;
  const progressPercent = Math.floor((completedCount / tasks.size) * 100);

  console.log(
    `[TaskManager] ✅ Task #${taskId} completed. Progress: ${completedCount}/${tasks.size} (${progressPercent}%)`
  );

  return true;
}

function isAllDone() {
  const completedCount = Array.from(tasks.values()).filter(
    (t) => t.status === TaskStatus.DONE
  ).length;
  const allDone = completedCount === tasks.size;

  const logInterval = Math.max(1, Math.floor(tasks.size / 100)); // Log for every 1% of tasks, or 100 tasks if many
  if (completedCount % logInterval === 0 || allDone) {
    console.log(
      `[TaskManager] Completion status: ${completedCount}/${
        tasks.size
      } tasks (${Math.floor((completedCount / tasks.size) * 100)}%)`
    );
  }

  return allDone;
}

function checkAndRequeueStuckTasks() {
  const now = Date.now();
  let reQueuedCount = 0;

  for (const [id, task] of tasks.entries()) {
    if (task.status === TaskStatus.ASSIGNED && task.assignmentTime !== null) {
      if (now - task.assignmentTime > ASSIGNED_TIMEOUT_MS) {
        task.status = TaskStatus.PENDING; // Ensure using TaskStatus.PENDING
        task.assignedTo = null;
        task.assignmentTime = null;
        reQueuedCount++;
        console.log(
          `[TaskManager] 🔄 Task #${task.id} re-queued (was stuck for peer #${task.assignedTo}).`
        );
      }
    }
  }
  if (reQueuedCount > 0) {
    console.log(`[TaskManager] Re-queued ${reQueuedCount} stuck task(s).`);
  } else {
    // console.log(`[TaskManager] No stuck tasks found to re-queue.`);
  }
}

function finalizeResults() {
  if (!isAllDone()) {
    console.error(`[TaskManager] ❌ Not all tasks completed! Cannot finalize.`);
    return null;
  }

  console.log(`[TaskManager] 🎯 Starting result finalization...`);
  const startTime = Date.now();

  const orderedResults = Array.from(tasks.values())
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((task) => task.result);

  console.log(
    `[TaskManager] Collected ${orderedResults.length.toLocaleString()} results (each ${CHUNK_BYTES.toLocaleString()} bytes).`
  );

  const combinedBuffer = Buffer.concat(orderedResults);
  console.log(
    `[TaskManager] Combined into buffer of total size: ${(
      combinedBuffer.length /
      1024 /
      1024
    ).toFixed(1)} MB`
  );

  const floatArray = new Float32Array(combinedBuffer.length / FLOAT_SIZE);
  new Uint8Array(floatArray.buffer).set(combinedBuffer);

  console.log(
    `[TaskManager] Float array: ${floatArray.length.toLocaleString()} elements.`
  );

  console.log(`[TaskManager] Reversing array...`);
  const reversedArray = new Float32Array(floatArray.length);
  for (let i = 0; i < floatArray.length; i++) {
    reversedArray[i] = floatArray[floatArray.length - 1 - i];
  }

  const reversedBuffer = Buffer.from(
    reversedArray.buffer,
    reversedArray.byteOffset,
    reversedArray.byteLength
  );

  console.log(
    `[TaskManager] ✅ Array reversed. Resulting buffer size: ${(
      reversedBuffer.length /
      1024 /
      1024
    ).toFixed(1)} MB`
  );

  console.log(`[TaskManager] Encrypting result with AES-256-CBC...`);
  const encryptionKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv);

  let encrypted = cipher.update(reversedBuffer);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  console.log(
    `[TaskManager] ✅ Data encrypted. Encrypted size: ${(
      encrypted.length /
      1024 /
      1024
    ).toFixed(1)} MB`
  );

  try {
    fs.writeFileSync(ENCRYPTION_KEY_PATH, encryptionKey); // Use new path
    fs.writeFileSync(ENCRYPTION_IV_PATH, iv); // Use new path
    console.log(
      `[TaskManager] Encryption keys saved to ${GENERATED_FILES_DIR}.`
    );
  } catch (error) {
    console.error(`[TaskManager] ⚠️ Error saving keys:`, error.message);
  }

  const finalContent = Buffer.concat([iv, encrypted]);

  try {
    fs.writeFileSync(RESULT_FILE_PATH, finalContent);
    const finalSize = fs.statSync(RESULT_FILE_PATH).size;
    const duration = (Date.now() - startTime) / 1000;

    console.log(`[TaskManager] 🎉 FINAL RESULT READY!`);
    console.log(`[TaskManager] 📁 File: ${RESULT_FILE_PATH}`);
    console.log(
      `[TaskManager] 📊 Size: ${(finalSize / 1024 / 1024).toFixed(1)} MB`
    );
    console.log(`[TaskManager] ⏱️  Processing time: ${duration.toFixed(1)}s`);

    verifyDecryption();
  } catch (error) {
    console.error(`[TaskManager] ❌ Error writing result:`, error.message);
    throw error;
  }

  return finalContent;
}

function verifyDecryption() {
  try {
    console.log(`[TaskManager] 🔍 Verifying decryption...`);

    const key = fs.readFileSync(ENCRYPTION_KEY_PATH); // Use new path
    const storedIv = fs.readFileSync(ENCRYPTION_IV_PATH); // Use new path

    const encryptedFile = fs.readFileSync(RESULT_FILE_PATH);
    const encryptedData = encryptedFile.slice(16); // Remove IV

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, storedIv);
    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decryptedFloats = new Float32Array(
      decrypted.buffer,
      decrypted.byteOffset,
      decrypted.byteLength / FLOAT_SIZE
    );

    console.log(
      `[TaskManager] ✅ Decryption successful! Float elements: ${decryptedFloats.length.toLocaleString()}`
    );
    console.log(
      `[TaskManager] 📋 First 5 values: [${Array.from(
        decryptedFloats.slice(0, 5)
      )
        .map((f) => f.toFixed(3))
        .join(", ")}]`
    );
    console.log(
      `[TaskManager] 📋 Last 5 values: [${Array.from(decryptedFloats.slice(-5))
        .map((f) => f.toFixed(3))
        .join(", ")}]`
    );
  } catch (error) {
    console.error(
      `[TaskManager] ❌ Decryption verification error:`,
      error.message
    );
  }
}

module.exports = {
  generateDummyAudioFile,
  loadChunks,
  getNextTask,
  submitResult,
  isAllDone,
  finalizeResults,
  checkAndRequeueStuckTasks,
  tasks,
  CHUNK_BYTES,
  FLOAT_SIZE,
  ACTUAL_TOTAL_SAMPLES,
};
