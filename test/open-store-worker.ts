// Opens a project database at an agreed moment, so tests can make many processes
// race on the same fresh file. Prints "ok" or the error message.
import { dataDirectory } from "../src/project.js";
import { databaseFile, openDatabase } from "../src/store.js";

const [root, startAt] = process.argv.slice(2);
// Resolve the path before the barrier so that nothing asynchronous separates the
// processes between leaving it and opening the database.
const file = databaseFile(await dataDirectory(root));
while (Date.now() < Number(startAt)) {
  // Busy-wait so every process leaves this loop within the same millisecond.
}
try {
  (await openDatabase(file)).close();
  console.log("ok");
} catch (error) {
  console.log(`ERR ${(error as Error).message}`);
}
