import { parentPort } from "worker_threads";
import net from "net";
import crypto from "crypto";

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

function handlePeerMessages(client, data, parsedFile, pieceIndex, chunks) {
  const messagePrefixLength = data.readUInt32BE(0);
  const messageID = data.readUInt8(4);
  let payload = data.subarray(5);

  const sendInterestedMessage = () => {
    const interestedMessage = Buffer.from([0, 0, 0, 1, 2]);
    return interestedMessage;
  };

  const sendRequestMessage = (messageID) => {
    // console.log("Sending request message");
    let blockSize = /*2 ** 14*/ 1024;

    if (parsedFile.pieces.length - 1 === pieceIndex) {
      blockSize = parsedFile.lastPieceLength;
    } else {
      blockSize = parsedFile.pieceLength;
    }

    let byteOffset = 0;

    const requestMessage = Buffer.alloc(17);
    requestMessage.writeUInt32BE(13, 0);
    requestMessage.writeUInt8(6, 4);
    requestMessage.writeUInt32BE(pieceIndex, 5);
    requestMessage.writeUInt32BE(byteOffset, 9);
    requestMessage.writeUInt32BE(blockSize, 13);

    // console.log(message);

    return requestMessage;
  };

  if (messageID === 5) {
    client.write(sendInterestedMessage());
  } else if (messageID === 1) {
    // console.log("Received unchoke message");
    client.write(sendRequestMessage(1));
  } else if (messageID === 7) {
    // console.log("Received piece message");
    const payloadBlockSize = payload.subarray(8).length;
    // console.log(">>>check payloadBlockSize", payloadBlockSize);
    // console.log("messageID 7 come here bro");
    if (payloadBlockSize === 0) {
      client.end();
    } else {
      const block = payload.subarray(8);
      chunks.push(block);
      client.write(sendRequestMessage(7));
    }
  } else {
    // console.log(data.length);
  }
}

async function makeConnection(parsedFile, peer, peerID, pieceIndex = 0) {
  return new Promise(async (resolve, reject) => {
    const client = new net.Socket();

    const [peerIP, peerPort] = peer.split(":");
    const handshakeMessage = await handshakePeers(parsedFile, peerID);

    const chunks = [];

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
        handlePeerMessages(client, data, parsedFile, pieceIndex, chunks);
      }
    });

    client.on("close", () => {
      const downloadedData = Buffer.concat(chunks);
      const hash = crypto
        .createHash("sha1")
        .update(downloadedData)
        .digest("hex");
      if (parsedFile.pieces.includes(hash)) {
        console.log(`Download pieces ${pieceIndex} sucessfully`);
        // console.log(chunks);

        // const outputPath = `${storagePath}/${parsedFile.name}`;
        // const outputDir = path.dirname(outputPath);

        // if (!fs.existsSync(outputDir)) {
        //   fs.mkdirSync(outputDir, { recursive: true });
        // }

        // for (const chunk of chunks) {
        //   fs.appendFileSync(outputPath, chunk);
        // }

        resolve(chunks);
      }

      // console.log("Connection closed\n");
      // resolve();
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
    result.push({
      pieceIndex: i,
      piece: data[0],
    });
  }

  parentPort.postMessage(result);
  process.exit(0);
  // parentPort.postMessage("hello from thread");
});
