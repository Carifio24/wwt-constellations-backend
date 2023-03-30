// Copyright 2023 the .NET Foundation

// A "scene" is an individual post that users can view.
//
// For now, scenes roughly correspond to WWT "places", with the view position,
// background, and one or more imagesets specified. We expect to accumulate
// additional kinds of scenes over time.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { isLeft } from "fp-ts/Either";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";
import { ObjectId } from "mongodb";

import { State } from "./globals";
import { canAddScenes } from "./handles";
import { IoObjectId, UnitInterval } from "./util";

export interface MongoScene {
  handle_id: ObjectId;
  creation_date: Date;
  impressions: number;
  likes: number;

  place: ScenePlaceT;
  content: SceneContentT;
  outgoing_url?: string;
  text: string;
}

const ScenePlace = t.type({
  ra_rad: t.number,
  dec_rad: t.number,
  zoom_deg: t.number,
  roll_rad: t.number,
});

type ScenePlaceT = t.TypeOf<typeof ScenePlace>;

const ImageLayer = t.type({
  image_id: IoObjectId,
  opacity: t.intersection([t.number, UnitInterval]),
});

const SceneContent = t.type({
  image_layers: t.union([t.array(ImageLayer), t.undefined]),
});

type SceneContentT = t.TypeOf<typeof SceneContent>;

export function initializeSceneEndpoints(state: State) {
  // POST /handle/:handle/scene: create a new scene record

  const SceneCreation = t.type({
    place: ScenePlace,
    content: SceneContent,
    outgoing_url: t.union([t.string, t.undefined]),
    text: t.string,
  });

  type SceneCreationT = t.TypeOf<typeof SceneCreation>;

  state.app.post(
    "/handle/:handle/scene",
    async (req: JwtRequest, res: Response) => {
      const handle_name = req.params.handle;

      // Are we authorized?

      const handle = await state.handles.findOne({ "handle": handle_name });

      if (handle === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Handle not found" });
        return;
      }

      if (!canAddScenes(req, handle)) {
        res.statusCode = 401;
        res.json({ error: true, message: "Not authorized" });
        return;
      }

      // Does the input look valid?

      const maybe = SceneCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: SceneCreationT = maybe.right;

      if (input.content.image_layers !== undefined) {
        for (var layer of input.content.image_layers) {
          try {
            const result = await state.images.findOne({ "_id": layer.image_id });

            if (result === null) {
              res.statusCode = 400;
              res.json({ error: true, message: `Required image ${layer.image_id} not found` });
              return;
            }
          } catch (err) {
            res.statusCode = 500;
            res.json({ error: true, message: `Database error in ${req.path}` });
          }
        }
      } else {
        res.statusCode = 400;
        res.json({ error: true, message: "Invalid scene content: no image layers" });
        return;
      }

      // OK, looks good.

      const new_rec: MongoScene = {
        handle_id: handle._id,
        creation_date: new Date(),
        impressions: 0,
        likes: 0,
        place: input.place,
        content: input.content,
        text: input.text,
      };

      if (input.outgoing_url) {
        new_rec.outgoing_url = input.outgoing_url;
      }

      try {
        const result = await state.scenes.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId,
          rel_url: "/scene/" + encodeURIComponent("" + result.insertedId),
        });
      } catch (err) {
        console.error("POST /handle/:handle/scene exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in POST /handle/:handle/scene" });
      }
    }
  );

  // GET /scene/:id - Get general information about a scene

  state.app.get("/scene/:id", async (req: JwtRequest, res: Response) => {
    try {
      const scene = await state.scenes.findOne({ "_id": new ObjectId(req.params.id) });

      if (scene === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }

      const handle = await state.handles.findOne({ "_id": scene.handle_id });

      if (handle === null) {
        console.error(`Database consistency failure, scene ${scene._id} missing handle ${scene.handle_id}`);
        res.statusCode = 500;
        res.json({ error: true, message: "Database consistency failure" });
        return;
      }

      const output: Record<string, any> = {
        error: false,
        id: scene._id,
        handle_id: scene.handle_id,
        handle: {
          handle: handle.handle,
          display_name: handle.display_name,
        },
        creation_date: scene.creation_date,
        likes: scene.likes,
        place: scene.place,
        text: scene.text,
      };

      if (scene.outgoing_url) {
        output.outgoing_url = scene.outgoing_url;
      }

      res.json(output);
    } catch (err) {
      console.error(`Database error in ${req.path}:`, err);
      res.statusCode = 500;
      res.json({ error: true, message: `Database error in ${req.path}` });
    }
  });
}