import axios from "axios";
import { localhostTrackerURL, trackerURL } from "./constant.js";

export const cancelFile = async (host, port) => {
  return new Promise(async (resolve, reject) => {
    const address = `${host}:${port}`;

    const cancelAnnounce = await axios.post(`${trackerURL}/announce/cancel`, {
      address: address,
    });

    if (cancelAnnounce.status === 200) {
      resolve(true);
    } else {
      resolve(false);
    }
  });
};
