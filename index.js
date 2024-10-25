import fs from "fs";
import * as net from "net";
import * as readline from "node:readline/promises";
import axios from "axios";
import { stdin as input, stdout as output } from "node:process";
import { checkFileExist, uploadFile } from "./helpers/uploadFile.js";
import {
  HOST,
  pieceLength,
  PORT,
  storagePath,
  trackerURL,
} from "./helpers/constant.js";
import { createZeroArary } from "./helpers/createZeroArray.js";
import { downloadFile } from "./helpers/downloadFile.js";
import { makeid } from "./helpers/generateRandom.js";
import ip from "ip";
import { cancelFile } from "./helpers/cancelFile.js";

function createBitfieldMessage(numOfPieces) {
  const message = Buffer.alloc(4 + 1);
  message.writeUInt32BE(1, 0);
  message.writeUInt8(5, 4);
  // message.fill(0xff, 5);

  return message;
}

function createUnchokeMessage() {
  const message = Buffer.from([0, 0, 0, 1, 1]);

  return message;
}

function createPieceMessage(pieceIndex, byteOffset, block) {
  const messageLength = 9 + block.length;
  const message = Buffer.alloc(4 + messageLength);

  message.writeUInt32BE(messageLength, 0);
  message.writeUInt32BE(messageLength, 0); // Write message length
  message.writeUInt8(7, 4); // Write message ID (7 for piece)
  message.writeUInt32BE(pieceIndex, 5); // Write the piece index
  message.writeUInt32BE(byteOffset, 9); // Write the byte offset within the piece

  block.copy(message, 13); // Copy the block of data into the message

  return message;
}

let currentHost, currentPort;

const server = net.createServer((socket) => {
  let fileName;
  let pieceArrayCheck;
  let numOfPieces;
  let peerID = makeid(20);

  socket.on("data", async (data) => {
    // console.log(data);

    //Check handshake from client
    if (data.length === 68) {
      const protocolStrLength = data.readUInt8(0);
      const protocolStr = data.subarray(1, 20).toString();
      const receiveInfoHash = data.subarray(28, 48);

      if (protocolStrLength !== 19 || protocolStr !== "BitTorrent protocol") {
        console.log("Invalid protocol");
        socket.end(); // Close the connection if invalid
        return;
      }

      // console.log(receiveInfoHash);

      const fileFindResult = await axios.post(`${trackerURL}/announce/find`, {
        infoHash: receiveInfoHash.toString("base64"),
      });

      if (fileFindResult.status !== 200) {
        console.log("No infohash found");
        socket.end();
        return;
      }

      fileName = fileFindResult.data.fileName;
      const infoHashBuffer = Buffer.from(fileFindResult.data.infoHash, "hex");
      numOfPieces = fileFindResult.data.numOfPieces;

      if (!receiveInfoHash.equals(infoHashBuffer)) {
        console.log("Invalid info_hash, terminating connection");
        socket.end(); // Close the connection if info_hash doesn't match
        return;
      }

      pieceArrayCheck = createZeroArary(numOfPieces);

      // console.log("Valid handshake received, info_hash and peer_id accepted");

      const response = Buffer.concat([
        Buffer.from([19]), // Protocol length
        Buffer.from("BitTorrent protocol"), // Protocol string
        Buffer.alloc(8), // Reserved bytes (8 bytes set to 0)
        infoHashBuffer, // info_hash
        Buffer.from(peerID), // our peer_id
      ]);

      await new Promise((resolve) => setTimeout(resolve, 100)); // 0.1 second delay
      socket.write(response); // Send handshake

      await new Promise((resolve) => setTimeout(resolve, 100)); // 0.1 second delay
      const bitfieldMessage = createBitfieldMessage(numOfPieces); //send bitfield message
      socket.write(bitfieldMessage);
    } else {
      const messagePrefixLength = data.readUInt32BE(0);
      const messageID = data.readUInt8(4);
      let payload = data.subarray(5);

      //Check interested message
      if (messageID === 2) {
        const unchokeMessage = createUnchokeMessage();
        socket.write(unchokeMessage);
      } else if (messageID === 6) {
        if (!fileName) {
        }

        if (!fs.existsSync(`${storagePath}/${fileName}`)) {
        }

        const fileData = fs.readFileSync(`${storagePath}/${fileName}`);
        // const torrentFile = await parsedTorrentFile(``)

        const pieceIndex = data.readUInt32BE(5);
        const byteOffset = data.readUInt32BE(9);
        const blockLength = data.readUInt32BE(13);

        if (pieceArrayCheck[pieceIndex] === 0 ) {
          pieceArrayCheck[pieceIndex] = 1;

          let pieceStart = pieceIndex * pieceLength;

          const block = fileData.subarray(
            pieceStart + byteOffset,
            pieceStart + byteOffset + blockLength
          );

          const pieceMessage = createPieceMessage(
            pieceIndex,
            byteOffset,
            block
          );

          socket.write(pieceMessage);
        } else {
          const message = Buffer.from([0, 0, 0, 2, 7]);
          socket.write(message);
        }
      }
    }
  });

  socket.on("end", () => {
    // console.log("Client disconnected");
  });

  // Handle errors
  socket.on("error", (err) => {
    console.error("Socket error:", err.message);
  });
});

//---------------------------------------------------------------------

const rl = readline.createInterface({ input, output });

await new Promise((resolve, reject) => setTimeout(resolve, 500));

async function createMenu() {
  console.log("=========MENU=========");
  console.log("1. Chia se file");
  console.log("2. Tai file");
  console.log("3. Thoat ra");
  console.log("=========MENU=========");

  const answer = await rl.question("Chon mot tuy chon: ");

  if (answer === "1") {
    const fileName = await rl.question(
      "Vui long nhap vao ten file muon chia se: "
    );
    if (checkFileExist(fileName)) {
      console.log("File co ton tai. Tien hanh chia se file len tracker");
      const uploadResult = await uploadFile(fileName, currentHost, currentPort);
      if (uploadResult) {
        console.log("Upload len tracker thanh cong");

        await new Promise((resolve, reject) => setTimeout(resolve, 5000));
        console.clear();
        await createMenu();
      }
    } else {
      console.log("File khong ton tai");
    }
  } else if (answer === "2") {
    const fileName = await rl.question(
      "Vui long nhap vao ten file ban muon tai: "
    );
    const downloadResult = await downloadFile(fileName);

    if (downloadResult) {
      console.log("Download file thanh cong");

      // await new Promise((resolve, reject) => setTimeout(resolve, 1000));
      // console.clear();
      // await createMenu();
    }
  } else if (answer === "3") {
    const cancelFileResult = await cancelFile(currentHost, currentPort);

    if (cancelFileResult === true) {
      server.close();
      rl.close();
    }
  }
}

async function createServerMenu() {
  console.log(
    "-----Bạn muốn chạy server trên localhost hay giữa các LAN?-----"
  );
  console.log("1. Localhost");
  console.log("2. LAN");
  console.log(
    "---------------------------------------------------------------"
  );

  const answer = await rl.question("Nhap vao lua chon cua ban: ");

  if (answer === "1") {
    // Start the server and listen for connections
    currentHost = HOST;
    currentPort = PORT;
  } else if (answer === "2") {
    // Start the server and listen for connections
    const ipAddress = ip.address();

    currentHost = ipAddress;
    currentPort = PORT;
  }

  server.listen(currentPort, currentHost, () => {
    console.log(`Server listening on ${currentHost}:${currentPort}`);
  });

  await new Promise((resolve, reject) => setTimeout(resolve, 1000));
  console.clear();
}

await createServerMenu();
await createMenu();
