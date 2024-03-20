// Copyright 2023 the .NET Foundation

// The WWT Constellations backend server.

import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import MongoStore from "connect-mongo";
import cors from "cors";
import { MongoClient } from "mongodb";
import session from "express-session";

import { Config, State } from "./globals.js";
import { makeCheckAuthMiddleware } from "./auth.js";
import { initializeFeatureEndpoints } from "./features.js";
import { initializeHandleEndpoints } from "./handles.js";
import { initializeImageEndpoints } from "./images.js";
import { initializeSceneEndpoints } from "./scenes.js";
import { initializeSuperuserEndpoints } from "./superuser.js";
import { initializeSessionEndpoints } from "./session.js";
import { initializeTessellationEndpoints } from "./tessellation.js";
import { initializePermissionsEndpoints } from "./permissions.js";
import { createDailyFeatureUpdateJob } from "./cron.js";

import { setLogLevel } from "@azure/logger";

const config = new Config();
setLogLevel(config.logLevel);

// Start setting up the server and global middleware
const app: Express = express();
const is_dev = app.get("env") === "development";

app.use(cors({
  credentials: true,
  exposedHeaders: 'Set-Cookie',
  origin: true, // reflect origin back to requestor
}));

app.use(bodyParser.json());

app.use(makeCheckAuthMiddleware(config));

// Before we can set up the session handling, we need to set up our connection
// to the MongoDB server that will store session information.
//
// We can't actually do anything useful with our database variables until we
// connect to the DB, though, and that happens asynchronously at the end of this
// file.

const dbserver = new MongoClient(config.mongoConnectionString);
const database = dbserver.db(config.mongoDbName);
const dbpromise = dbserver.connect();

const sessionTTLSeconds = 14 * 24 * 60 * 60; // 14 days

const sessionStore = MongoStore.create({
  clientPromise: dbpromise,
  dbName: "constellations",
  collectionName: "sessions",
  ttl: sessionTTLSeconds,
  // With Azure's CosmosDB, we can't use "native" for autoRemove
  autoRemove: "interval",
  autoRemoveInterval: 10, // minutes
});

app.set("trust proxy", 1);

app.use(session({
  name: "cxsession",
  secret: config.sessionSecrets,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: !is_dev,
    sameSite: 'none',
    maxAge: 1000 * sessionTTLSeconds,
  },
  store: sessionStore,
}));

app.use(function (req, _res, next) {
  if (req.session && !req.session.created) {
    req.session.created = Date.now();
  }

  next();
});


// Put it all together.

const state = new State(
  config,
  app,
  database.collection("scenes"),
  database.collection("images"),
  database.collection("handles"),
  database.collection("events"),
  database.collection("features"),
  database.collection("featureQueue"),
  database.collection("tessellations"),
);

state.app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

initializeFeatureEndpoints(state);
initializeHandleEndpoints(state);
initializeImageEndpoints(state);
initializePermissionsEndpoints(state);
initializeSceneEndpoints(state);
initializeSuperuserEndpoints(state);
initializeSessionEndpoints(state);
initializeTessellationEndpoints(state);

// Let's get started!

(async () => {
  await dbpromise;
  console.log("Connected to database!");

  const dailyUpdateJob = createDailyFeatureUpdateJob(state);
  dailyUpdateJob.on("canceled", () => {
    console.log(`${new Date().toISOString()}: the daily update job was canceled!`);
  });
  dailyUpdateJob.on("error", () => {
    console.error(`${new Date().toISOString()}: there was an error running the daily update job`);
  });

  app.listen(config.port, () => {
    console.log(
      `⚡️[server]: Server is running at http://localhost:${config.port}`
    );
  });
})();
