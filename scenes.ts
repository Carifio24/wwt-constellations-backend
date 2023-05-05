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
import { ObjectId, WithId } from "mongodb";
import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

import { State } from "./globals";
import { isAllowed as handleIsAllowed } from "./handles";
import { imageToImageset } from "./images";
import { IoObjectId, UnitInterval } from "./util";

const R2D = 180.0 / Math.PI;
const R2H = 12.0 / Math.PI;

export interface MongoScene {
  handle_id: ObjectId;
  creation_date: Date;
  impressions: number;
  likes: number;

  place: ScenePlaceT;
  background_id?: ObjectId;
  content: SceneContentT;
  previews: ScenePreviewsT;
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

const ScenePreviews = t.partial({
  video: t.string,
  thumbnail: t.string
});

type ScenePreviewsT = t.TypeOf<typeof ScenePreviews>;

// Authorization tools

export type SceneCapability =
  "edit"
  ;

export async function isAllowed(state: State, req: JwtRequest, scene: MongoScene, cap: SceneCapability): Promise<boolean> {
  // One day we might have finer-grained permissions, but not yet. We might also
  // have some kind of caching that allows us to not always look up the owning
  // handle info.

  const owner_handle = await state.handles.findOne({ "_id": scene.handle_id });

  if (owner_handle === null) {
    throw new Error(`Internal database inconsistency: scene missing owner ${scene.handle_id}`);
  }

  switch (cap) {
    case "edit": {
      return handleIsAllowed(req, owner_handle, "editScenes");
    }

    default: {
      return false; // this is a can't-happen but might as well be safe
    }
  }
}


// Turn a Scene into a basic WWT place, if possible.
//
// "Possible" means that its content is a single imageset layer.
//
// This function is async since we need to pull the imageset info from the
// database.
export async function sceneToPlace(scene: MongoScene, desc: string, root: XMLBuilder, state: State): Promise<XMLBuilder> {
  const pl = root.ele("Place");

  // Bad hardcodings!!
  pl.att("DataSetType", "Sky");

  // Hardcodings that are probably OK:
  pl.att("Angle", "0");
  pl.att("AngularSize", "0");
  pl.att("Magnitude", "0");
  pl.att("Opacity", "100");

  // Actual settings
  pl.att("Dec", String(scene.place.dec_rad * R2D));
  pl.att("Name", desc);
  pl.att("RA", String(scene.place.ra_rad * R2H));
  pl.att("Rotation", String(scene.place.roll_rad * R2D));
  pl.att("ZoomLevel", String(scene.place.zoom_deg));

  // TODO: "Constellation" attr ? "Thumbnail" ?

  if (scene.content.image_layers && scene.content.image_layers.length == 1) {
    const fg = pl.ele("ForegroundImageSet");

    const image = await state.images.findOne({ "_id": new ObjectId(scene.content.image_layers[0].image_id) });

    if (image === null) {
      throw new Error(`database consistency failure: no image ${scene.content.image_layers[0].image_id}`);
    }

    imageToImageset(image, fg);
  }

  return pl;
}

export async function sceneToJson(scene: WithId<MongoScene>, state: State): Promise<Record<string, any>> {
  // Build up the main part of the response.

  const handle = await state.handles.findOne({ "_id": scene.handle_id });

  if (handle === null) {
    throw new Error(`Database consistency failure, scene ${scene._id} missing handle ${scene.handle_id}`);
  }

  const output: Record<string, any> = {
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

  // ~"Hydrate" the content

  if (scene.content.image_layers) {
    const image_layers = [];

    for (var layer_desc of scene.content.image_layers) {
      const image = await state.images.findOne({ "_id": new ObjectId(layer_desc.image_id) });

      if (image === null) {
        throw new Error(`Database consistency failure, scene ${scene._id} missing image ${layer_desc.image_id}`);
      }

      const image_info = {
        wwt: image.wwt,
        storage: image.storage,
      };

      image_layers.push({
        image: image_info,
        opacity: layer_desc.opacity,
      });
    }

    output.content = { image_layers: image_layers };
  }

  output.previews = {};
  for (const [key, value] of Object.entries(scene.previews)) {
    output.previews[key] = `${state.config.previewBaseUrl}/${value}`;
  }

  if (scene.background_id) {
    const bgImage = await state.images.findOne({ "_id": new ObjectId(scene.background_id) });

    if (bgImage === null) {
       throw new Error(`Database consistency failure, scene ${scene._id} missing background ${scene.background_id}`);
    }

    output.background = {
      wwt: bgImage.wwt,
      storage: bgImage.storage,
    };

  }

  // All done!

  return output;
}

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

      if (!handleIsAllowed(req, handle, "addScenes")) {
        res.statusCode = 403;
        res.json({ error: true, message: "Forbidden" });
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
        previews: {}
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
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
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

      const output = await sceneToJson(scene, state);
      output["error"] = false;
      res.json(output);
    } catch (err) {
      console.error(`${req.method} ${req.path} exception:`, err);
      res.statusCode = 500;
      res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
    }
  });

  // GET /scene/:id/permissions - get information about the logged-in user's
  // permissions with regards to this scene.
  //
  // This API is only informative -- of course, direct API calls are the final
  // arbiters of what is and isn't allowed. But the frontend can use this
  // information to decide what UI elements to expose to a user.
  state.app.get(
    "/scene/:id/permissions",
    async (req: JwtRequest, res: Response) => {
      try {
        const scene = await state.scenes.findOne({ "_id": new ObjectId(req.params.id) });

        if (scene === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        // TODO: if we end up reporting more categories, we should somehow batch
        // the checks to not look up the same handle over and over.

        const edit = await isAllowed(state, req, scene, "edit");

        const output = {
          error: false,
          id: scene._id,
          edit: edit,
        };

        res.json(output);
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /scene/:id/place.wtml - (try to) get WTML expressing this scene as a WWT Place.

  state.app.get(
    "/scene/:id/place.wtml",
    async (req: JwtRequest, res: Response) => {
      try {
        const scene = await state.scenes.findOne({ "_id": new ObjectId(req.params.id) });

        if (scene === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const desc = `Scene ${req.params.id}`;

        const root = create().ele("Folder");
        root.att("Browseable", "True");
        root.att("Group", "Explorer");
        root.att("Name", desc);
        root.att("Searchable", "True");
        root.att("Type", "Sky");

        try {
          await sceneToPlace(scene, desc, root, state);
        } catch (err) {
          // I think a 404 is the most appropriate response here? Not sure.
          res.statusCode = 404;
          res.json({ error: true, message: `scene ${req.params.id} cannot be represented as a WWT Place` });
        }

        root.end({ prettyPrint: true });
        res.type("application/xml")
        res.send(root.toString());
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /scenes/home-timeline?page=$int - get scenes for the homepage timeline
  //
  // For now, there is a global timeline that is sorted on a nonsensical key
  // (the `text`) for testing. We could add personalized timelines and/or apply
  // a sort based on an intentional decision -- add a `timelineOrder` key and
  // update it when we want.

  const page_size = 8;

  state.app.get(
    "/scenes/home-timeline",
    async (req: JwtRequest, res: Response) => {
      try {
        var page_num = 0;

        try {
          const qpage = parseInt(req.query.page as string, 10);

          if (qpage >= 0) {
            page_num = qpage;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page number` });
        }

        const docs = await state.scenes.find()
          .sort({ creation_date: 1 })
          .skip(page_num * page_size)
          .limit(page_size)
          .toArray();
        const scenes = [];

        for (var doc of docs) {
          scenes.push(await sceneToJson(doc, state));
        }

        res.json({
          error: false,
          results: scenes,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /handle/:handle/sceneinfo?page=$int&pagesize=$int - get admin
  // information about scenes
  //
  // This endpoint is for the user dashboard showing summary information about
  // the handle's scenes.

  state.app.get(
    "/handle/:handle/sceneinfo",
    async (req: JwtRequest, res: Response) => {
      try {
        // Validate input(s)

        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        var page_num = 0;

        try {
          const qpage = parseInt(req.query.page as string, 10);

          if (qpage >= 0) {
            page_num = qpage;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page number` });
        }

        var page_size = 10;

        try {
          const qps = parseInt(req.query.pagesize as string, 10);

          if (qps > 0 && qps <= 100) {
            page_size = qps;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page size` });
        }

        // Check authorization

        if (!handleIsAllowed(req, handle, "viewDashboard")) {
          res.statusCode = 403;
          res.json({ error: true, message: "Forbidden" });
          return;
        }

        // OK to proceed

        const filter = { "handle_id": handle._id };
        const count = await state.scenes.countDocuments(filter);
        const infos = await state.scenes.find(filter)
          .sort({ creation_date: -1 })
          .skip(page_num * page_size)
          .limit(page_size)
          .project({ "_id": 1, "creation_date": 1, "impressions": 1, "likes": 1 })
          .toArray();

        res.json({
          error: false,
          total_count: count,
          results: infos,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );
}
