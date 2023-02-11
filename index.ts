import express, { Express, Request, Response } from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import cors from "cors";
import { parseXmlFromUrl } from "./util";
import { JSDOM } from 'jsdom';
import { Scene, isScene, isSceneSettings } from './types';
import { MongoClient } from 'mongodb';

dotenv.config();

const app: Express = express();
app.use(cors());
const port = 8000;

const jsonBodyParser = bodyParser.json();
app.use(jsonBodyParser);

// Connect to CosmosDB
const cosmos = new MongoClient(process.env.MONGO_CONNECTION_STRING ?? "");
(async () => {
  await cosmos.connect();
  console.log("Connected!");
})();

const database = cosmos.db("constellations-scenes-db");
console.log(database);
const collection = database.collection("scenes");


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
  collection.insertOne(scene).then((result) => {
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

  const scene = await collection.findOne({id: id});
  if (scene === null) {
    res.statusCode = 404;
    res.json({
      updated: false,
      message: "No document was found with the specified ID"
    });
  }

  collection.updateOne(
    { id },
    { $set: settings }
  );

});

app.get('/scenes/:sceneID', (req: Request, res: Response) => {

  // Check if the scene exists
  // if not, return null

  const dummyScene: Scene = {
    name: "My Scene",
    imageURLs: [],
    user: "testuser",
    place: {
      raRad: 0,
      decRad: 0,
      zoomDeg: 25,
      rollRad: 15
    }
  };

  res.json({
    scene: dummyScene,
    found: true
  });

});
