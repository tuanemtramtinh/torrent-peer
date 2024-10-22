import fs from "fs";
import parseTorrent from "parse-torrent";
import createTorrent from "create-torrent";
import axios from "axios";
import { HOST, PORT, storagePath, torrentPath } from "./constant.js";

export const checkFileExist = (fileName) => {
  if (fs.existsSync(`${storagePath}/${fileName}`)) {
    return true;
  }
  return false;
};

const options = {
  announce: "http://localhost:3000/announce",
};

export const uploadFile = async (fileName) => {
  return new Promise((resolve, reject) => {
    createTorrent(
      `${storagePath}/${fileName}`,
      options,
      async (err, torrent) => {
        const fileNameWithoutExtension = fileName.slice(
          0,
          fileName.lastIndexOf(".")
        );

        // console.log(fileNameWithoutExtension);

        if (!err) {
          fs.writeFileSync(
            `${torrentPath}/${fileNameWithoutExtension}.torrent`,
            torrent
          );

          const parsedTorrentFile = await parseTorrent(torrent);

          const infoHash = parsedTorrentFile.infoHash;
          const infoHashBuffer = parsedTorrentFile.infoHashBuffer;
          const fileName = parsedTorrentFile.name;
          const numOfPieces = parsedTorrentFile.pieces.length;

          console.log({ infoHashBuffer });

          const url = new URL(parsedTorrentFile.announce);

          url.searchParams.append("file_name", fileName);
          url.searchParams.append("info_hash", infoHash);
          url.searchParams.append("num_of_pieces", numOfPieces);
          url.searchParams.append("ip", HOST);
          url.searchParams.append("port", PORT);
          url.searchParams.append("left", 0);

          const result = await axios.get(url.toString());

          // const uploadURL = new URL(parsedTorrentFile.announce);
          // const finalURL = `${uploadURL.toString()}/infoHashBuffer`;
          // console.log(infoHashBuffer);
          // const uploadInfoHashBuffer = await axios.post(finalURL,
          //   {
          //     infoHash: infoHash,
          //     infoHashBuffer: Buffer.from(infoHashBuffer).toString("base64"),
          //   }
          // );

          // console.log(uploadInfoHashBuffer.data);
          // console.log(result.status);

          if (result.status === 200) {
            // console.log("hello");
            resolve(true);
          } else {
            resolve(false);
          }
        } else {
          console.log("Error creating torrent", err);
        }
      }
    );
  });
};
