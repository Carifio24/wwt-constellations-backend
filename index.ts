import express, { Express, Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { expressjwt, GetVerificationKey } from "express-jwt";
import { JSDOM } from "jsdom";
import jwksClient from "jwks-rsa";
import { MongoClient, ObjectId, WithId, Document } from "mongodb";
import { create } from "xmlbuilder2";

import { Config, State } from "./globals";
import { parseXmlFromUrl, snakeToPascal } from "./util";
import { initializeSceneEndpoints } from "./scenes";
import { initializeSuperuserEndpoints } from "./superuser";

const config = new Config();

// Start setting up the server and global middleware

const app: Express = express();

app.use(cors());
app.use(bodyParser.json());

const requireAuth = expressjwt({
  secret: jwksClient.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `${config.kcBaseUrl}realms/${config.kcRealm}/protocol/openid-connect/certs`
  }) as GetVerificationKey,

  // can add `credentialsRequired: false` to make auth optional
  audience: "account",
  issuer: `${config.kcBaseUrl}realms/${config.kcRealm}`,
  algorithms: ["RS256"]
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
  requireAuth,
  database.collection("scenes"),
  database.collection("images")
);

state.app.get("/", (_req: Request, res: Response) => {
  res.send("Express + TypeScript Server");
});

initializeSceneEndpoints(state);
initializeSuperuserEndpoints(state);

// Endpoints to be migrated:

let data: Document = new JSDOM().window.document;
(async () => {
  const dataURL = "http://www.worldwidetelescope.org/wwtweb/catalog.aspx?W=astrophoto";
  data = await parseXmlFromUrl(dataURL);
})();

app.get("/images", async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.size as string);
  const toSkip = (page - 1) * size;
  const items: WithId<Document>[] = await state.images.find().skip(toSkip).limit(size).toArray();

  const root = create().ele("Folder");
  root.att("Browseable", "True");
  root.att("Group", "Explorer");
  root.att("Searchable", "True");

  items.forEach(item => {
    const iset = root.ele("ImageSet");
    Object.entries(item["imageset"]).forEach(([key, value]) => {
      iset.att(key, String(value));
    });

    Object.entries(item).forEach(([key, value]) => {
      if (key === "imageset") {
        return;
      }
      if (key === "_id") {
        value = (value as ObjectId).toString();
      }
      key = snakeToPascal(key);
      const el = iset.ele(key);
      el.txt(value);
    });

  });

  root.end({ prettyPrint: true });

  res.type("application/xml")
  res.send(root.toString());
});

app.get("/data", async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.limit as string);
  const start = (page - 1) * size;
  const items = [...data.querySelectorAll("Place")].slice(start, start + size);
  const folder = data.createElement("Folder");
  items.forEach(item => {
    folder.appendChild(item.cloneNode(true))
  });
  res.type("application/xml");
  res.send(folder.outerHTML);
});

// Let's get started!

(async () => {
  await dbserver.connect();
  console.log("Connected to database!");

  app.listen(config.port, () => {
    console.log(`⚡️[server]: Server is running at https://localhost:${config.port}`);
  });
})();
