import { buildPeople } from "./people.js";
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: buildPeople(data.faces, data.threshold, data.review) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
