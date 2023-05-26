// Copyright 2023 the .NET Foundation

// The WWT Constellations backend server.

import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
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

const origin = app.get("env") === "development" ? "http://localhost:3000" : "https://wwtelescope.dev";
app.use(cors({credentials: true, exposedHeaders: 'Set-Cookie', origin: origin}));
app.use(bodyParser.json());
app.use(makeCheckAuthMiddleware(config));

app.set("trust proxy", 1);
app.use(session({
  secret: app.get('session_secret') ?? 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'none', },
  // proxy: true
}));

app.use(function (req, res, next) {  
  // This is a hack to trick express_session to send the session cookie
  // in an insecure context (for development purposes)
  if ((state.app.get("env") === "development")) { 
    Object.defineProperty(req, "secure", {
      value: true,
      writable: false
    });
  }
  
  if(req.session && !req.session.created) {
    req.session.created = Date.now();
  }
  next();
});



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
  await dbserver.connect();
  console.log("Connected to database!");

  app.listen(config.port, () => {
    console.log(
      `⚡️[server]: Server is running at http://localhost:${config.port}`
    );
  });
})();
