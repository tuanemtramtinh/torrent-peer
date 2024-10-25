import { parentPort } from "worker_threads";
import net from "net";
import crypto from "crypto";
import { pieceLength } from "./constant.js";

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
    payloadBlockSize = payload.subarray(8).length;
    isReceivingPiece.value = true;

    if (payloadBlockSize === 0) {
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
      const downloadedData = Buffer.concat(chunks);
      // console.log(">>>check downloadedData", downloadedData.length);
      const hash = crypto
        .createHash("sha1")
        .update(downloadedData)
        .digest("hex");
      if (parsedFile.pieces.includes(hash)) {
        console.log(`Download pieces ${pieceIndex} sucessfully`);

        resolve(chunks);
      }
    });

    client.on("error", (err) => {
      console.log(err);
      reject(err);
    });
  });
}

parentPort.on("message", async (message) => {
  // console.log("Message from");

  const { parsedFile, peer, peerID, pieceRange } = message;

  // console.log(message);

  // console.log({ peer, peerID, pieceIndex });

  const { start, end } = pieceRange;

  const result = [];

  for (let i = start; i <= end; i++) {
    const data = await makeConnection(parsedFile, peer, peerID, i);
    const buffer = Buffer.concat(data);
    result.push({
      pieceIndex: i,
      piece: buffer,
    });
  }

  parentPort.postMessage(result);
  process.exit(0);
  // parentPort.postMessage("hello from thread");
});
