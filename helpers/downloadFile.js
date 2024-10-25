import { pieceLength, storagePath, torrentPath } from "./constant.js";
import parseTorrent from "parse-torrent";
import fs from "fs";
import axios from "axios";
import * as net from "net";
import crypto from "crypto";
import { makeid } from "./generateRandom.js";
import * as path from "path";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runWorker = (parsedFile, peer, peerID, pieceRange) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${__dirname}/worker.js`, { type: "module" });

    const message = {
      parsedFile,
      peer,
      peerID,
      pieceRange,
    };

    // Send a message to the worker
    worker.postMessage(message);

    // Handle messages from the worker
    worker.on("message", (message) => {
      // console.log("Message received from worker thread");

      // console.log(message);
      resolve(message);
      // worker.terminate();
    });

    // Handle errors from the worker
    worker.on("error", (err) => {
      console.error("Worker error:", err);
      reject(err);
      // worker.terminate();
    });

    // Handle the worker exit
    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Worker stopped with exit code ${code}`);
      } else {
        console.log("Worker finished successfully");
      }
    });
  });
};

const runMultipleWorkers = async (parsedFile, peers, peerID) => {
  const numOfPieces = parsedFile.pieces.length;
  const numOfPeers = peers.length;

  console.log({ numOfPeers, numOfPieces });

  const taskForEachWorker = Math.floor(numOfPieces / numOfPeers);
  const leftOverTask = numOfPieces % numOfPeers;

  const workerPromises = []; // Store all worker promises

  for (let i = 0; i < numOfPeers; i++) {
    const start = i * taskForEachWorker;
    let end = (i + 1) * taskForEachWorker - 1;
    if (i === numOfPeers - 1) {
      end += leftOverTask;
    }

    const pieceRange = { start, end };

    workerPromises.push(runWorker(parsedFile, peers[i], peerID, pieceRange));
  }

  let chunks = await Promise.all(workerPromises);
  chunks = chunks.flat();
  chunks = chunks.sort((a, b) => a.pieceIndex - b.pieceIndex);

  return chunks;
};

async function parsedTorrentFile(fileName) {
  const fileContent = fs.readFileSync(`${torrentPath}/${fileName}`);
  const parsedFile = await parseTorrent(fileContent);
  return parsedFile;
}

const discoveryPeers = async (parsedFile) => {
  const trackerURL = new URL(parsedFile.announce);
  const info_hash = parsedFile.infoHash;
  const left = parsedFile.length;

  trackerURL.searchParams.append("info_hash", info_hash);
  trackerURL.searchParams.append("left", left);

  const result = await axios.get(trackerURL.toString());

  const peers = result.data;

  return peers;
};

async function handshakePeers(parsedFile, peerID) {
  let protocolString = Buffer.from("BitTorrent protocol");
  let peerId = Buffer.from(peerID);
  let protocolLength = 19;
  let reserved = Buffer.alloc(8);
  let infoHash = Buffer.from(parsedFile.infoHashBuffer);
  protocolLength = Buffer.from([protocolLength]);

  const handshake = Buffer.concat([
    protocolLength,
    protocolString,
    reserved,
    infoHash,
    peerId,
  ]);

  return handshake;
}

function handlePeerMessages(
  client,
  data,
  parsedFile,
  pieceIndex,
  chunks,
  isReceivingPiece
) {
  const messagePrefixLength = data.readUInt32BE(0);
  const messageID = data.readUInt8(4);
  let payload = data.subarray(5);

  // console.log(messagePrefixLength);

  // console.log(">>>check data", data);

  const sendInterestedMessage = () => {
    const interestedMessage = Buffer.from([0, 0, 0, 1, 2]);
    return interestedMessage;
  };

  const sendRequestMessage = (messageID) => {
    // console.log("Sending request message");
    let blockSize;

    if (parsedFile.pieces.length - 1 === pieceIndex) {
      blockSize = parsedFile.lastPieceLength;
    } else {
      blockSize = parsedFile.pieceLength;
    }

    let byteOffset = 0;

    const requestMessage = Buffer.alloc(21);
    requestMessage.writeUInt32BE(13, 0);
    requestMessage.writeUInt8(6, 4);
    requestMessage.writeUInt32BE(pieceIndex, 5);
    requestMessage.writeUInt32BE(byteOffset, 9);
    requestMessage.writeUInt32BE(blockSize, 13);

    return requestMessage;
  };

  if (messagePrefixLength === 1 && messageID === 5) {
    client.write(sendInterestedMessage());
  } else if (messagePrefixLength === 1 && messageID === 1) {
    // console.log("Received unchoke message");
    client.write(sendRequestMessage(1));
  } else if (messageID === 7) {
    let payloadBlockSize;
    let pieceIndex = payload.subarray(0, 4);
    let byteOffset = payload.subarray(4, 8);
    payloadBlockSize = payload.subarray(8).length;
    pieceIndex = pieceIndex.readUInt32BE(0);
    byteOffset = byteOffset.readUInt32BE(0);
    isReceivingPiece.value = true;

    if (
      pieceIndex === 4294967295 &&
      byteOffset === 4294967295 &&
      payloadBlockSize === 0
    ) {
      isReceivingPiece.value = false;
      client.end();
    } else {
      const block = payload.subarray(8);
      chunks.push(block);
      client.write(sendRequestMessage(7));
    }
  } else if (isReceivingPiece.value === true) {
    chunks.push(data);
  }
}

async function makeConnection(parsedFile, peer, peerID, pieceIndex = 0) {
  return new Promise(async (resolve, reject) => {
    const client = new net.Socket();

    const [peerIP, peerPort] = peer.split(":");
    const handshakeMessage = await handshakePeers(parsedFile, peerID);

    const chunks = [];
    const isReceivingPiece = { value: false };

    client.connect(peerPort, peerIP, () => {
      // console.log("Connected");
      client.write(handshakeMessage);
    });

    client.on("data", (data) => {
      // console.log(data, data.length);
      if (data.length === 68) {
        // console.log(
        //   "Peer ID:",
        //   data.subarray(data.length - 20).toString("hex")
        // );
      } else {
        handlePeerMessages(
          client,
          data,
          parsedFile,
          pieceIndex,
          chunks,
          isReceivingPiece
        );
      }
    });

    client.on("close", () => {
      // console.log(chunks);

      const downloadedData = Buffer.concat(chunks);

      const hash = crypto
        .createHash("sha1")
        .update(downloadedData)
        .digest("hex");

      if (parsedFile.pieces.includes(hash)) {
        console.log(`Download pieces ${pieceIndex} sucessfully`);
        // console.log(chunks);

        const outputPath = `${storagePath}/${parsedFile.name}`;
        const outputDir = path.dirname(outputPath);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        for (const chunk of chunks) {
          fs.appendFileSync(outputPath, chunk);
        }
      }

      // console.log("Connection closed\n");
      resolve();
    });

    client.on("error", (err) => {
      console.log(err);
      reject(err);
    });
  });
}

export const downloadFile = async (fileName) => {
  return new Promise(async (resolve, reject) => {
    const parsedFile = await parsedTorrentFile(fileName);
    const peers = await discoveryPeers(parsedFile);
    // const address = peers[0];
    const peerID = makeid(20);

    const numOfPiece = parsedFile.pieces.length;

    if (peers.length > 1 && numOfPiece >= peers.length) {
      const chunks = await runMultipleWorkers(parsedFile, peers, peerID);

      // console.log(chunks);

      const outputPath = `${storagePath}/${parsedFile.name}`;
      const outputDir = path.dirname(outputPath);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      for (const chunk of chunks) {
        fs.appendFileSync(outputPath, chunk.piece);
      }

      resolve(true);
    } else {
      const address = peers[0];

      for (let i = 0; i < parsedFile.pieces.length; i++) {
        await makeConnection(parsedFile, address, peerID, i);
      }

      resolve(true);
    }
  });
};
