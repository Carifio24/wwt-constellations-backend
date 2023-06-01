// Copyright 2023 the .NET Foundation

// The WWT Constellations backend server.

import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import MongoStore from "connect-mongo";
import cors from "cors";
import { MongoClient } from "mongodb";
import session from "express-session";

import { Config, State } from "./globals";
import { makeCheckAuthMiddleware } from "./auth";
import { initializeHandleEndpoints } from "./handles";
import { initializeImageEndpoints } from "./images";
import { initializeSceneEndpoints } from "./scenes";
import { initializeSuperuserEndpoints } from "./superuser";
import { initializeSessionEndpoints } from "./session";

const config = new Config();

// Start setting up the server and global middleware
const app: Express = express();
const is_dev = app.get("env") === "development";

app.use(cors({
  credentials: true,
  exposedHeaders: 'Set-Cookie',
  origin: config.corsOrigins
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
  secret: config.sessionSecrets,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 1000 * sessionTTLSeconds,
  },
  store: sessionStore,
}));

app.use(function (req, res, next) {
  // This is a hack to trick express_session to send the session cookie
  // in an insecure context (http) for development.
  if (is_dev) {
    Object.defineProperty(req, "secure", {
      value: true,
      writable: false
    });
  }

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
  database.collection("handles")
);

state.app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

initializeHandleEndpoints(state);
initializeImageEndpoints(state);
initializeSceneEndpoints(state);
initializeSuperuserEndpoints(state);
initializeSessionEndpoints(state);

// Let's get started!

(async () => {
  await dbpromise;
  console.log("Connected to database!");

  app.listen(config.port, () => {
    console.log(
      `⚡️[server]: Server is running at http://localhost:${config.port}`
    );
  });
})();
