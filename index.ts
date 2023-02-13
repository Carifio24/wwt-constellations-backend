import express, { Express, Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import cors from "cors";
import { parseXmlFromUrl, snakeToPascal } from "./util";
import { JSDOM } from 'jsdom';
import { isScene, isSceneSettings } from './types';
import { MongoClient, ObjectId, WithId, Document } from 'mongodb';
import { create } from "xmlbuilder2";

dotenv.config();

const app: Express = express();
app.use(cors());
const port = 7000;

const jsonBodyParser = bodyParser.json();
app.use(jsonBodyParser);

// Connect to CosmosDB
const cosmos = new MongoClient(process.env.MONGO_CONNECTION_STRING ?? "");
(async () => {
  await cosmos.connect();
  console.log("Connected!");
})();

const database = cosmos.db("constellations-db");
console.log(database);
const sceneCollection = database.collection("scenes");
const imageCollection = database.collection("images");


let data: Document = new JSDOM().window.document;
(async () => {
  const dataURL = "http://www.worldwidetelescope.org/wwtweb/catalog.aspx?W=astrophoto";
  data = await parseXmlFromUrl(dataURL);
})();


function checkAuthToken(_token: string) {
  // Just a stub for now
  return true;
}

app.get('/', (_req: Request, res: Response) => {
  res.send('Express + TypeScript Server');
});

app.get('/images', async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.size as string);
  const toSkip = (page - 1) * size;
  const items: WithId<Document>[] = await imageCollection.find().skip(toSkip).limit(size).toArray();

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

app.get('/data', async (req: Request, res: Response) => {
  const query = req.query;
  const page = parseInt(query.page as string);
  const size = parseInt(query.limit as string);
  const start = (page - 1) * size;
  const items = [...data.querySelectorAll("Place")].slice(start, start + size);
  const folder = data.createElement("Folder");
  items.forEach(item => {
    folder.appendChild(item.cloneNode(true))
  });
  res.type('application/xml');
  res.send(folder.outerHTML);
});

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at https://localhost:${port}`);
});

app.post('/scenes/create', async (req: Request, res: Response) => {
  const body = req.body;
  let scene = body.scene;

  if (!isScene(scene)) {
    res.statusCode = 400;
    res.json({
      created: false,
      message: "Malformed scene JSON"
    });
    return;
  }

  const validAuth = checkAuthToken(body.token);
  if (!validAuth) {
    res.statusCode = 400;
    res.json({
      created: false,
      message: "Invalid authentication token"
    });
    return;
  }

  console.log("About to insert item");
  sceneCollection.insertOne(scene).then((result) => {
    res.json({
      created: result.acknowledged,
      id: result.insertedId
    });
  });


});

app.post('/scenes/:id::action', async (req: Request, res: Response) => {
  console.log(req);
  const body = req.body;
  const settings = body.updates;
  const id = req.params.id;

  if (req.params.action !== "update") {
    console.log(`No such supported action ${req.params.action}`);
  }

  if (!isSceneSettings(settings)) {
    res.statusCode = 400;
    res.json({
      updated: false,
      message: "At least one of your fields is not a valid scene field"
    });
    return;
  }

  const validAuth = checkAuthToken(body.token);
  if (!validAuth) {
    res.statusCode = 400;
    res.json({
      updated: false,
      message: "Invalid authentication token"
    });
    return;
  }

  sceneCollection.findOneAndUpdate(
    { "_id": new ObjectId(id) },
    { $set: settings },
    { returnDocument: "after" } // Return the modified document
  ).then((result) => {
    const updated = (result.lastErrorObject) ? result.lastErrorObject['updatedExisting'] : false;
    res.json({
      updated,
      scene: result.value
    });
  });
});

app.get('/scenes/:sceneID', async (req: Request, res: Response) => {

  const result = await sceneCollection.findOne({ "_id": new ObjectId(req.params.sceneID) });
  res.json(result);

});
