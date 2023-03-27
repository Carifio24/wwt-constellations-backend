import { Request, Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { ObjectId } from "mongodb";

import { State } from "./globals";
import { isScene, isSceneSettings } from "./types";

export function initializeSceneEndpoints(state: State) {
  // TODO: associate with a handle and require that we have permissions on it!!!
  state.app.post("/scenes/create", async (req: JwtRequest, res: Response) => {
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

    console.log("auth info", req.auth);

    console.log("About to insert item");
    state.scenes.insertOne(scene).then((result) => {
      res.json({
        created: result.acknowledged,
        id: result.insertedId
      });
    });
  });

  // TODO: associate with a handle and require that we have permissions on it!!!
  state.app.post("/scenes/:id::action", async (req: JwtRequest, res: Response) => {
    console.log("???");
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

    console.log("auth info", req.auth);

    state.scenes.findOneAndUpdate(
      { "_id": new ObjectId(id) },
      { $set: settings },
      { returnDocument: "after" } // Return the modified document
    ).then((result) => {
      console.log(result);
      const updated = (result.lastErrorObject) ? result.lastErrorObject["updatedExisting"] : false;
      res.json({
        updated,
        scene: result.value
      });
    });
  });

  state.app.get("/scenes/:sceneID", async (req: Request, res: Response) => {
    const result = await state.scenes.findOne({ "_id": new ObjectId(req.params.sceneID) });
    res.json(result);
  });
}