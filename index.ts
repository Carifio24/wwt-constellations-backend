// Copyright 2023 the .NET Foundation

// The WWT Constellations backend server.

import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { MongoClient } from "mongodb";

import { Config, State } from "./globals";
import { makeCheckAuthMiddleware } from "./auth";
import { initializeHandleEndpoints } from "./handles";
import { initializeImageEndpoints } from "./images";
import { initializeSceneEndpoints } from "./scenes";
import { initializeSuperuserEndpoints } from "./superuser";

const config = new Config();

// Start setting up the server and global middleware

const app: Express = express();

app.use(cors());
app.use(bodyParser.json());
app.use(makeCheckAuthMiddleware(config));

// Prepare to connect to the Mongo server. We can"t actually do anything useful
// with our database variables until we connect to the DB, though, and that
// happens asynchronously at the end of this file.

const dbserver = new MongoClient(config.mongoConnectionString);
const database = dbserver.db(config.mongoDbName);

// Put it all together.

const state = new State(
  config,
  app,
  database.collection("scenes"),
  database.collection("images"),
  database.collection("handles"),
);

state.app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

initializeHandleEndpoints(state);
initializeImageEndpoints(state);
initializeSceneEndpoints(state);
initializeSuperuserEndpoints(state);

// Let's get started!

(async () => {
  await dbserver.connect();
  console.log("Connected to database!");

  app.listen(config.port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${config.port}`);
  });
})();
