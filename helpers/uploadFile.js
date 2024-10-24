import fs from "fs";
import parseTorrent from "parse-torrent";
import createTorrent from "create-torrent";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import {
  localhostTrackerURL,
  pieceLength,
  storagePath,
  torrentPath,
  trackerURL,
} from "./constant.js";

cloudinary.config({
  cloud_name: "dixo9ts0g",
  api_key: "628812978474323",
  api_secret: "wycJ-LgW_vxiJ96-Cry4T8zDIIg",
});

export const checkFileExist = (fileName) => {
  if (fs.existsSync(`${storagePath}/${fileName}`)) {
    return true;
  }
  return false;
};

const streamUpload = (buffer, fileName) => {
  return new Promise((resolve, reject) => {
    let stream = cloudinary.uploader.upload_stream(
      {
        public_id: fileName,
        use_filename: true,
        resource_type: "auto",
        unique_filename: false,
      },
      (error, result) => {
        if (result) {
          resolve(result);
        } else {
          reject(error);
        }
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};

const cloudUpload = async (buffer, fileName) => {
  let result = await streamUpload(buffer, fileName);
  return result;
};

const options = {
  announce: `${trackerURL}/announce`,
  pieceLength: pieceLength,
};

export const uploadFile = async (fileName, currentHost, currentPort) => {
  return new Promise((resolve, reject) => {
    createTorrent(
      `${storagePath}/${fileName}`,
      options,
      async (err, torrent) => {
        const fileNameWithoutExtension = fileName.slice(
          0,
          fileName.lastIndexOf(".")
        );

        if (!err) {
          fs.writeFileSync(
            `${torrentPath}/${fileNameWithoutExtension}.torrent`,
            torrent
          );

          const parsedTorrentFile = await parseTorrent(torrent);

          // console.log(parsedTorrentFile);

          const infoHash = parsedTorrentFile.infoHash;
          const size = parsedTorrentFile.length;
          const fileName = parsedTorrentFile.name;
          const numOfPieces = parsedTorrentFile.pieces.length;

          const cloud = await cloudUpload(
            torrent,
            `${fileNameWithoutExtension}.torrent`
          );

          const cloudURL = cloud.url;

          const url = new URL(parsedTorrentFile.announce);

          const uploadToDownloadResult = await axios.post(
            `${url.toString()}/upload`,
            {
              fileName: fileName,
              size: size,
              link: cloudURL,
              infoHash: infoHash,
              seeders: `${currentHost}:${currentPort}`,
            }
          );

          url.searchParams.append("file_name", fileName);
          url.searchParams.append("info_hash", infoHash);
          url.searchParams.append("num_of_pieces", numOfPieces);
          url.searchParams.append("ip", currentHost);
          url.searchParams.append("port", currentPort);
          url.searchParams.append("left", 0);

          const result = await axios.get(url.toString());

          if (result.status === 200 && uploadToDownloadResult.status === 200) {
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
